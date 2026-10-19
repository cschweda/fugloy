/**
 * The starter program, examples/clear-screen.z: it assembles cleanly, to the
 * bytes zmac gives, and run on @fugloy/emu it leaves the screen blank. CI
 * runs it on a synthetic ROM (a stack and a loop, as the MCP tests use); the
 * real ROMs fugloy.mcp.json names run it too when they are present.
 */
import { readFileSync } from 'node:fs';
import { Machine } from '@fugloy/emu';
import { describe, expect, it } from 'vitest';
import { configuredRom } from '../../emu/test/rom.js';
import { skipIfNoZmac } from '../../disasm/test/roundtrip/zmac.js';
import { assemble, toCmd } from '../src/index.js';
import type { AsmResult } from '../src/index.js';
import { bytesOf, diagnosticsOf, runZmac } from './helpers.js';

const source = readFileSync(new URL('../examples/clear-screen.z', import.meta.url), 'utf8');
const zit = skipIfNoZmac();

/** The program's bytes at $7000, by hand from the Zilog encodings. */
const EXPECTED = [0x21, 0x00, 0x3c, 0x01, 0x00, 0x04, 0x36, 0x20, 0x23, 0x0b, 0x78, 0xb1, 0x20, 0xf8, 0x18, 0xfe];
const WAIT = 0x700e;

/** A Model III ROM that sets the stack and loops, so the program alone writes the screen. */
function syntheticRom(): Uint8Array {
  const rom = new Uint8Array(0x3800);
  rom.set([0x31, 0x00, 0x80, 0x18, 0xfe]);
  return rom;
}

/** Loads the program's .CMD the way a user's file loads, runs it, and returns the screen. */
function runOn(m: Machine, result: AsmResult): string[] {
  const manifest = m.load.cmd(toCmd(result));
  expect(manifest.entry).toBe(0x7000);
  // 1024 trips round the loop at about 40 T-states each; run well past that.
  m.run({ cycles: 200_000 });
  expect(m.cpu.regs.pc).toBe(WAIT);
  return m.video.text();
}

const blank = (screen: string[]): boolean => screen.length === 16 && screen.every((row) => row === ' '.repeat(64));

describe('the starter program', () => {
  it('assembles with no diagnostic to the expected bytes, entry START', () => {
    const r = assemble(source);
    expect(diagnosticsOf(r)).toEqual([]);
    expect(bytesOf(source)).toEqual(EXPECTED);
    expect(r.image!.runs()).toEqual([{ start: 0x7000, end: 0x700f, length: 16 }]);
    expect(r.entry).toBe(0x7000);
    expect(r.symbols.get('WAIT')?.value).toBe(WAIT);
  });

  it('has a comment on every instruction line', () => {
    for (const line of source.split('\n')) if (/^\S*\s+[A-Z]/.test(line)) expect(line, line).toMatch(/;\s*\S/);
  });

  zit('zmac assembles it to the same bytes', () => {
    const z = runZmac(source);
    expect(z.clean, z.output).toBe(true);
    expect(z.bytes).toEqual(EXPECTED);
    expect(z.entry).toBe(0x7000);
  });

  it('blanks the screen on the emulator with a synthetic ROM', () => {
    const m = new Machine({ roms: { level2: syntheticRom() } });
    m.mem.write(0x3c00, new Array(0x400).fill(0x58)); // a screen full of X
    expect(m.video.text()[0]).toBe('X'.repeat(64));
    expect(blank(runOn(m, assemble(source)))).toBe(true);
  });

  for (const [model, key] of [
    [3, 'model3'],
    [1, 'model1'],
  ] as const) {
    const rom = configuredRom(key);
    it.skipIf(rom === null)(`blanks the screen on the Model ${model === 3 ? 'III' : 'I'} with its real ROM`, () => {
      const m = new Machine({ model, roms: { level2: rom! } });
      // Let the ROM start and put its first prompt on the screen.
      m.run({ cycles: 4_000_000 });
      expect(blank(m.video.text())).toBe(false);
      expect(blank(runOn(m, assemble(source, { model })))).toBe(true);
    });
  }
});
