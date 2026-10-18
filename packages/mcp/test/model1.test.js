/**
 * The Model I through the MCP server (emu phase 6, Task 4), on a synthetic 12K ROM so CI runs it:
 * `load { model: 1 }` builds a Model I from roms.model1 and says so in the manifest, `status`
 * names it, `reset` keeps it, emulated time counts on its 1.774 MHz clock (`run seconds`, the
 * `Ran` line), `key` types at 10 characters a second by default on it (20 on the Model III), a
 * disk boots to 4200h, `poke` knows its 12K ROM and the Expansion Interface's space, and
 * `reset: false` will not turn a running Model III into a Model I.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diskContainer, formatOf } from '../src/tools/load.js';
import { buildCmd, connect, syntheticRom, testConfig } from './helpers.js';

/** The Model I's clock (emu models.js), and the Model III's. */
const MODEL1_HZ = 1774080;
const MODEL3_HZ = 2027520;

/** A synthetic 12K Model I ROM: LD SP,8000H, then a JR to itself. */
function model1Rom() {
  const rom = new Uint8Array(0x3000);
  rom.set([0x31, 0x00, 0x80, 0x18, 0xfe]);
  return rom;
}

/** SPIN: LD SP,7F00H, then a JR to itself, at 7000h. */
const SPIN = buildCmd([{ name: 'SPIN' }, { addr: 0x7000, data: [0x31, 0x00, 0x7f, 0x18, 0xfe] }], 0x7000);

/** A 35-track, 10-sector JV1 (the Model I's single-density format), all zeros. */
const JV1 = new Uint8Array(35 * 10 * 256);

/** A 36-track one: the Model I's drives took 35 to 42 tracks, the Model III's JV1 sizes do not include it. */
const JV1_36 = new Uint8Array(36 * 10 * 256);

let dir = '';
const at = (/** @type {string} */ name) => join(dir, name);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fugloy-mcp-model1-'));
  writeFileSync(at('model1.rom'), model1Rom());
  writeFileSync(at('model3.rom'), syntheticRom());
  writeFileSync(at('spin.cmd'), SPIN);
  writeFileSync(at('blank.dsk'), JV1);
  writeFileSync(at('blank36.dsk'), JV1_36);
  // CALL 3000H, then a JR to itself.
  writeFileSync(at('call3000.cmd'), buildCmd([{ addr: 0x7000, data: [0xcd, 0x00, 0x30, 0x18, 0xfe] }], 0x7000));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A server with both synthetic ROMs, and `over` on the config. */
const server = (over = {}) => connect({ config: testConfig({ roms: { model1: at('model1.rom'), model3: at('model3.rom') }, ...over }) });

/** The count on a result's `Ran N cycles` line. */
const ranCycles = (/** @type {string} */ text) => Number(/Ran ([\d,]+) cycles/.exec(text)?.[1].replaceAll(',', '') ?? NaN);

async function ok(call, name, args) {
  const r = await call(name, args);
  if (r.isError) throw new Error(`${name} failed: ${r.text}`);
  return r.text;
}

describe('the Model I through the MCP server', () => {
  it('load { model: 1 } builds a Model I on roms.model1, and status and reset keep it', async () => {
    const { call, session, close } = await server();
    const manifest = (await ok(call, 'load', { path: at('spin.cmd'), model: 1 })).split('\n');
    expect(session.machine?.model).toBe(1);
    expect(manifest).toContain('Model: Model I (48K, with the Expansion Interface)');
    expect(manifest.find((l) => l.startsWith('ROM: '))).toMatch(/^ROM: unrecognised \(SHA-256 [0-9a-f]{16}…\)$/);
    expect(manifest).toContain('Entry: 7000h (the PC is there now)');
    const status = await ok(call, 'status', {});
    expect(status).toContain('Model: I\n');
    expect(status).toContain(`ROM: ${at('model1.rom')}`);
    await ok(call, 'reset', {});
    expect(session.machine?.model).toBe(1);
    // A load without model builds the config's defaultModel again, the Model III here.
    const again = await ok(call, 'load', { path: at('spin.cmd') });
    expect(session.machine?.model).toBe(3);
    expect(again).not.toContain('Model: ');
    expect(await ok(call, 'status', {})).toContain(`ROM: ${at('model3.rom')}`);
    await close();
  });

  it('defaultModel 1 makes the Model I what load and reset build', async () => {
    const { call, session, close } = await server({ defaultModel: 1 });
    expect(await ok(call, 'status', {})).toContain('Model: I\n');
    await ok(call, 'reset', {});
    expect(session.machine?.model).toBe(1);
    await ok(call, 'load', { path: at('spin.cmd') });
    expect(session.machine?.model).toBe(1);
    await close();
  });

  it('without roms.model1 the sentence names the entry to set', async () => {
    const { call, close } = await connect({ config: testConfig({ roms: { model3: at('model3.rom') } }) });
    expect(await call('load', { path: at('spin.cmd'), model: 1 })).toEqual({
      text: 'No Model I Level II ROM is configured; set roms.model1 in fugloy.mcp.json (see the MCP spec §3).',
      isError: true,
    });
    await close();
    const missing = await server({ roms: { model1: at('nowhere.rom') }, source: '/x/fugloy.mcp.json' });
    expect(await missing.call('load', { path: at('spin.cmd'), model: 1 })).toEqual({
      text: `The configured Model I ROM ${at('nowhere.rom')} does not exist; fix roms.model1 in /x/fugloy.mcp.json.`,
      isError: true,
    });
    await missing.close();
  });

  it('a 14K image as roms.model1 is refused with the emulator\'s sentence on its size', async () => {
    const { call, close } = await server({ roms: { model1: at('model3.rom') } });
    const r = await call('load', { path: at('spin.cmd'), model: 1 });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/12KB/);
    await close();
  });

  it('reset: false will not change the running machine\'s model', async () => {
    const { call, session, close } = await server();
    await ok(call, 'load', { path: at('spin.cmd') });
    expect(await call('load', { path: at('spin.cmd'), model: 1, reset: false })).toEqual({
      text: 'The running machine is the Model III; reset: false loads into it, so it cannot become the Model I. Call load with reset: true (the default) for a fresh Model I.',
      isError: true,
    });
    expect(session.machine?.model).toBe(3);
    expect((await call('load', { path: at('spin.cmd'), model: 3, reset: false })).isError).toBe(false);
    await close();
  });

  it('emulated seconds count on the Model I\'s clock', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('spin.cmd'), model: 1 });
    const one = await ok(call, 'run', { seconds: 1 });
    expect(one.split('\n')[0]).toBe('stopped: cycles (the 1 s asked for)');
    // The run stops at the end of the instruction that reaches the budget (a JR is 12 T-states).
    expect(one).toMatch(/\nRan 1,774,0[89]\d cycles \(1\.000 s emulated\)\n/);
    expect(ranCycles(one) - MODEL1_HZ).toBeLessThan(12);
    const capped = await ok(call, 'run', {});
    expect(ranCycles(capped) - 10 * MODEL1_HZ).toBeLessThan(12);
    expect(capped).toContain('(10.000 s emulated)');
    await close();

    const three = await server();
    await ok(three.call, 'load', { path: at('spin.cmd') });
    const m3 = await ok(three.call, 'run', { seconds: 1 });
    expect(ranCycles(m3) - MODEL3_HZ).toBeLessThan(12);
    expect(m3).toContain('(1.000 s emulated)');
    await three.close();
  });

  it('key types at 10 characters a second by default on the Model I, 20 on the Model III', async () => {
    const one = await server();
    await ok(one.call, 'load', { path: at('spin.cmd'), model: 1 });
    const typed = await ok(one.call, 'key', { text: 'AB' });
    expect(typed.split('\n')[0]).toBe('Typed 2 keys (matrix, 10 cps)');
    // Two keys at 10 a second (each pressed and released within its tenth), then 0.2 s more.
    const ran = ranCycles(typed);
    expect(ran / MODEL1_HZ).toBeGreaterThan(0.35);
    expect(ran / MODEL1_HZ).toBeLessThan(0.45);
    expect((await ok(one.call, 'key', { text: 'A', cps: 20 })).split('\n')[0]).toBe('Typed 1 key (matrix, 20 cps)');
    await one.close();

    const three = await server();
    await ok(three.call, 'load', { path: at('spin.cmd') });
    expect((await ok(three.call, 'key', { text: 'AB' })).split('\n')[0]).toBe('Typed 2 keys (matrix, 20 cps)');
    await three.close();
  });

  it('a disk on the Model I is booted toward 4200h, track 0, sector 0', async () => {
    const { call, close } = await server();
    const text = await ok(call, 'load', { path: at('blank.dsk'), model: 1 });
    expect(text).toContain('Format: disk image (JV1, 35 tracks, 1 side, 10 sectors a track), in drive 0');
    expect(text).toContain('Entry: none (the ROM boots from drive 0: track 0, sector 0 runs at 4200h)');
    // The synthetic ROM spins at 0003h and never reads the disk.
    expect(text).toContain('Boot: the ROM did not reach the boot sector at 4200h within 5 s emulated (the PC is 0003h); the disk may not be one the Model I ROM can boot');
    await close();
  });

  it('a 36-track JV1 loads on the Model I and is refused on the Model III', async () => {
    const { call, close } = await server();
    const text = await ok(call, 'load', { path: at('blank36.dsk'), model: 1 });
    expect(text).toContain('Format: disk image (JV1, 36 tracks, 1 side, 10 sectors a track), in drive 0');
    expect(await call('load', { path: at('blank36.dsk'), model: 3 })).toEqual({
      text: `${at('blank36.dsk')} is not a .CMD, .BAS, or .CAS program or a JV1, JV3, or DMK disk image as far as its content shows (the extension is not consulted); raw memory images cannot be loaded.`,
      isError: true,
    });
    expect(formatOf(JV1_36, 1)).toBe('dsk');
    expect(diskContainer(JV1_36, 1)).toBe('jv1');
    expect(formatOf(JV1_36)).toBe(null);
    await close();
  });

  it('a sidecar written on the Model III is ignored on the Model I, and the other way round', async () => {
    const { call, close } = await server();
    writeFileSync(at('side.cmd'), SPIN);
    await ok(call, 'load', { path: at('side.cmd'), model: 3 });
    await ok(call, 'run', { cycles: 1000 });
    expect(await ok(call, 'coverage', { mode: 'export' })).toContain(`Wrote ${at('side.fugloy.json')}`);
    const before = readFileSync(at('side.fugloy.json'), 'utf8');
    const manifest = await ok(call, 'load', { path: at('side.cmd'), model: 1 });
    expect(manifest).toContain(`Sidecar: ${at('side.fugloy.json')} ignored: it was written on the Model III, and this machine is the Model I, whose ROM and hardware differ (its coverage would merge with another ROM's); label and coverage export leave it as it is`);
    expect((await call('coverage', { mode: 'export' })).isError).toBe(true);
    expect(readFileSync(at('side.fugloy.json'), 'utf8')).toBe(before);
    // Back on the Model III it is the program's sidecar again.
    expect(await ok(call, 'load', { path: at('side.cmd'), model: 3 })).toMatch(/Sidecar: \S+side\.fugloy\.json: 1 label, 1 recorded session/);
    await close();
  });

  it('poke knows the Model I\'s 12K ROM and the Expansion Interface\'s space', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('spin.cmd'), model: 1 });
    expect(await call('poke', { addr: '2FFF', bytes: '00' })).toEqual({
      text: '2FFFh-2FFFh is in ROM (0000h-2FFFh); nothing was written. Pass force: true to patch the ROM image anyway.',
      isError: true,
    });
    expect(await call('poke', { addr: '37E1', bytes: '01', force: true })).toEqual({
      text: '37E1h is in the Model I\'s Expansion Interface space (3000h-37FFh: its registers at 37E0h-37EFh, nothing else), which cannot be poked; nothing was written.',
      isError: true,
    });
    expect((await ok(call, 'poke', { addr: '2FFF', bytes: 'AA', force: true })).split('\n')[0]).toBe('Wrote 1 byte at 2FFFh (into ROM, forced):');
    await close();
  });

  it('suggest leaves out the Model I\'s 12K ROM only, since 3000h-37FFh is not ROM there', async () => {
    const { call, close } = await server();
    for (const model of [1, 3]) {
      await ok(call, 'load', { path: at('call3000.cmd'), model });
      await ok(call, 'run', { cycles: 40 });
      const text = await ok(call, 'suggest', { minCalls: 1 });
      if (model === 1) expect(text.split('\n')[2]).toMatch(/^3000h\s+1\s+1\b/);
      else expect(text).toBe('No unlabelled call target has 1 or more calls since load.');
    }
    await close();
  });

  it('disasm names the Model I\'s ROM and hardware', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('spin.cmd'), model: 1 });
    // LD A,(37E0H) / LD (37E1H),A
    await ok(call, 'poke', { addr: '7100', bytes: '3AE037' });
    const listing = await ok(call, 'disasm', { addr: '7100', n: 1 });
    expect(listing).toMatch(/LD\s+A,\(37E0H\)\s+; \S+/);
    await close();
  });
});
