// Local only: the workbench's exported Sea Dragon .CMD and .CAS run in
// @fugloy/emu, the repository's own headless Model III, booted from the real ROM
// that the gitignored fugloy.mcp.json names (roms.model3). Without it the tests
// skip, so CI and a clean worktree pass. The emulator loads each file the way
// it loads any .CMD or SYSTEM tape (its fast-load path: blocks into RAM, then a
// jump to the entry), runs a few emulated seconds, and the screen must hold
// the game's title, the same screen the original seadrg01.cmd draws, and then
// answer ENTER with the game's first question.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { fastLoadCmd, fastLoadSystem, Machine, parseCas, parseCmd, TRS80System } from '@fugloy/emu';
import { createRunner } from '../app/utils/emulator/runner';
import { stubRom } from '../app/utils/emulator/stub-rom';
import { fakeClock, frames } from './emulator-support';
import { openProgram, withHintText } from '@fugloy/disasm';
import { exportFile } from '../app/utils/exports';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const ex = (p: string): string => resolve(repo, 'examples', p);

/** The Model III ROM from fugloy.mcp.json at the repository root (or $FUGLOY_CONFIG), as packages/emu/test/rom.js reads it; null when there is none. */
function modelIIIRom(): Uint8Array | null {
  const config = process.env.FUGLOY_CONFIG || resolve(repo, 'fugloy.mcp.json');
  if (!existsSync(config)) return null;
  const entry = (JSON.parse(readFileSync(config, 'utf8')).roms ?? {}).model3 as string | undefined;
  if (entry === undefined) return null;
  const path = isAbsolute(entry) ? entry : resolve(dirname(config), entry);
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
}

const rom = modelIIIRom();
const seadrg01 = new Uint8Array(readFileSync(ex('sea-dragon/seadrg01.cmd')));
const session = withHintText(
  openProgram(seadrg01, { name: 'seadrg01.cmd', selection: { machine: 3, dos: 'trsdos' } }),
  readFileSync(ex('sea-dragon/seadrg01.hints'), 'utf8'),
  'seadrg01.hints',
);

/** A Model III at READY (cassette BASIC, as a tape or a no-DOS .CMD load expects), its READY screen, and the machine. */
function machineAtReady(): { system: TRS80System; ready: Uint8Array } {
  const system = new TRS80System({ romData: rom! });
  system.cpu.strictMode = true;
  expect(system.bootToCassetteBasic()).toBe(true);
  return { system, ready: Uint8Array.from(system.memory.videoRam) };
}

const differs = (a: Uint8Array, b: Uint8Array): number => a.reduce((n, v, i) => n + (v === b[i] ? 0 : 1), 0);
const nonBlank = (v: Uint8Array): number => v.reduce((n, c) => n + (c === 0x20 ? 0 : 1), 0);

/** Runs a loaded game 5 emulated seconds and checks its title screen, then presses ENTER. Returns the title screen's video RAM. */
function playsSeaDragon(system: TRS80System, ready: Uint8Array): Uint8Array {
  system.runSeconds(5);
  const title = Uint8Array.from(system.memory.videoRam);
  const text = system.screenText().join('\n');
  expect(text).not.toContain('READY');
  expect(text).toContain('BY: Wayne Westmoreland & Terry Gilman');
  expect(text).toContain('(C) Copyright 1982');
  expect(nonBlank(title)).toBeGreaterThan(512);
  expect(differs(title, ready)).toBeGreaterThan(512);
  system.keyboard.keyDown('Enter', 'start');
  system.runSeconds(0.2);
  system.keyboard.keyUp('start');
  system.runSeconds(3);
  expect(system.screenText().join('\n')).toContain('1 or 2 Players?');
  return title;
}

describe.skipIf(rom === null)('the exported Sea Dragon runs in the headless Model III (@fugloy/emu)', { timeout: 60_000 }, () => {
  const original = (): Uint8Array => {
    const { system, ready } = machineAtReady();
    fastLoadCmd(system, parseCmd(seadrg01));
    return playsSeaDragon(system, ready);
  };

  it('the exported .CMD shows the title screen and starts a game', () => {
    const f = exportFile(session, 'cmd');
    expect(f.filename).toBe('seadrg01.cmd');
    const { system, ready } = machineAtReady();
    const parsed = parseCmd(f.bytes);
    expect(parsed.entry).toBe(0x8881);
    fastLoadCmd(system, parsed);
    const title = playsSeaDragon(system, ready);
    expect(differs(title, original())).toBe(0);
  });

  it('the exported .CAS loads with no checksum errors, shows the title screen, and starts a game', () => {
    const f = exportFile(session, 'cas');
    expect(f.filename).toBe('seadrg01.cas');
    expect(f.warnings).toEqual([]);
    const { system, ready } = machineAtReady();
    const parsed = parseCas(f.bytes);
    expect(parsed.kind).toBe('system');
    if (parsed.kind !== 'system') return;
    expect(parsed.checksumErrors).toBe(0);
    expect(parsed.entry).toBe(0x8881);
    fastLoadSystem(system, parsed);
    const title = playsSeaDragon(system, ready);
    expect(differs(title, original())).toBe(0);
  });
});

// Phase 5D: a programless runner (the TRS-80 simply on). It runs on any ROM, checks no trap, and
// stops only when told; on the stub, where a PC in the ROM is a trap, it is refused.
describe('a programless runner', () => {
  it('is refused on the stub ROM', () => {
    const machine = new Machine({ model: 3, roms: { level2: stubRom(3) } });
    expect(() => createRunner({ machine, result: null, stub: true })).toThrow(Error);
  });

  it('runs frames on a ROM, with no result, and never stops on its own', () => {
    const machine = new Machine({ model: 3, roms: { level2: stubRom(3) } });
    const clock = fakeClock();
    const onStop = vi.fn();
    const runner = createRunner({ machine, result: null, stub: false, ...clock, onStop });
    expect(runner.result).toBeNull();
    runner.start();
    frames(clock, 30);
    expect(machine.cycles).toBeGreaterThan(0);
    expect(runner.state).toBe('running');
    expect(onStop).not.toHaveBeenCalled();
    runner.stop();
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
