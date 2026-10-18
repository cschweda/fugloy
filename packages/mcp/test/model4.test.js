/**
 * The Model 4 through the MCP server (emu phase 6b, Task 3), on a synthetic 14K ROM so CI runs it:
 * `load { model: 4 }` builds a 128K Model 4 from roms.model4 and says so in the manifest; `status`
 * and `reset` keep it; `snapshot` and `diff` compare 3C00h-FFFFh as the CPU saw it (the Model 4's
 * `m.mem.ram` is its banks, not the Model III's RAM from 4000h), with a note when the two sides
 * are in different memory maps, and video RAM the screen does not show is marked off screen;
 * `screen` shows 80 by 24; and `coverage export` writes each map and page as its own key.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCmd, connect, syntheticRom, testConfig } from './helpers.js';

/** The program at 7000h, then `JR $`. */
const prog = (name, code) => buildCmd([{ name }, { addr: 0x7000, data: [...code, 0x18, 0xfe] }], 0x7000);

/**
 * OFFSCRN: put video page 1 at 3C00h, stop at 7004h (a snapshot there), then write 3C00h (byte
 * 400h of the 2K, off a 64 by 16 screen) and 9000h.
 */
const OFFSCRN = prog('OFFSCRN', [
  0x3e, 0x80, 0xd3, 0x84, //       7000  LD A,80H / OUT (84H),A
  0x3e, 0x41, 0x32, 0x00, 0x3c, // 7004  LD A,41H / LD (3C00H),A
  0x3e, 0x42, 0x32, 0x00, 0x90, // 7009  LD A,42H / LD (9000H),A
]);

/** WIDE: 80 by 24 (port 84h bit 2), then 'W' at 3C50h, row 1 column 0 of the 80-column screen. */
const WIDE = prog('WIDE', [0x3e, 0x04, 0xd3, 0x84, 0x3e, 0x57, 0x32, 0x50, 0x3c]);

/** MAP3: switch to map 3 (all RAM; the code at 7000h is in bank 0 either way). */
const MAP3 = prog('MAP3', [0x3e, 0x03, 0xd3, 0x84]);

/**
 * MAP2: map 2 (RAM to F3FFh, the keyboard at F400h-F7FFh, all 2K of video RAM at F800h), then
 * write 3C00h (RAM in map 2), read F400h (the keyboard), and write F800h (video RAM):
 *   7000  LD A,02H / OUT (84H),A
 *   7004  LD (3C00H),A
 *   7007  LD A,(F400H)
 *   700A  LD (F800H),A
 */
const MAP2 = prog('MAP2', [0x3e, 0x02, 0xd3, 0x84, 0x32, 0x00, 0x3c, 0x3a, 0x00, 0xf4, 0x32, 0x00, 0xf8]);

/** HIDDEN: put video page 1 at 3C00h and write it (byte 400h of the 2K, off a 64 by 16 screen) over and over. */
const HIDDEN = prog('HIDDEN', [0x3e, 0x80, 0xd3, 0x84, 0x21, 0x00, 0x3c, 0x34, 0x18, 0xfd]);

/** FAST: switch to 4 MHz (port ECh bit 6), then `JR $`. */
const FAST = prog('FAST', [0x3e, 0x40, 0xd3, 0xec]);

let dir = '';
const at = (/** @type {string} */ name) => join(dir, name);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fugloy-mcp-model4-'));
  writeFileSync(at('model4.rom'), syntheticRom());
  writeFileSync(at('model3.rom'), syntheticRom());
  writeFileSync(at('offscrn.cmd'), OFFSCRN);
  writeFileSync(at('wide.cmd'), WIDE);
  writeFileSync(at('map3.cmd'), MAP3);
  writeFileSync(at('map2.cmd'), MAP2);
  writeFileSync(at('hidden.cmd'), HIDDEN);
  writeFileSync(at('fast.cmd'), FAST);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A server with both synthetic ROMs, and `over` on the config. */
const server = (over = {}) => connect({ config: testConfig({ roms: { model3: at('model3.rom'), model4: at('model4.rom') }, ...over }) });

async function ok(call, name, args) {
  const r = await call(name, args);
  if (r.isError) throw new Error(`${name} failed: ${r.text}`);
  return r.text;
}

describe('the Model 4 through the MCP server', () => {
  it('load { model: 4 } builds a 128K Model 4 on roms.model4, and status and reset keep it', async () => {
    const { call, session, close } = await server();
    const manifest = (await ok(call, 'load', { path: at('map3.cmd'), model: 4 })).split('\n');
    expect(session.machine?.model).toBe(4);
    expect(session.machine?.mem.ram.length).toBe(128 * 1024);
    expect(manifest).toContain('Model: Model 4 (128K; its ROM boots it in Model III mode: memory map 0, 2 MHz, 64 by 16)');
    expect(manifest).toContain('Entry: 7000h (the PC is there now)');
    const status = await ok(call, 'status', {});
    expect(status).toContain('Model: 4\n');
    expect(status).toContain(`ROM: ${at('model4.rom')}`);
    await ok(call, 'reset', {});
    expect(session.machine?.model).toBe(4);
    // reset: false cannot turn the running Model 4 into a Model III.
    expect((await call('load', { path: at('map3.cmd'), model: 3, reset: false })).text).toBe('The running machine is the Model 4; reset: false loads into it, so it cannot become the Model III. Call load with reset: true (the default) for a fresh Model III.');
    await close();
  });

  it('defaultModel 4 builds a Model 4 when load names no model', async () => {
    const { call, session, close } = await server({ defaultModel: 4 });
    await ok(call, 'load', { path: at('map3.cmd') });
    expect(session.machine?.model).toBe(4);
    await close();
  });

  it('diff compares what the CPU saw, and marks video RAM the screen does not show', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('offscrn.cmd'), model: 4 });
    await ok(call, 'run', { until: 'pc:7004' });
    await ok(call, 'snapshot', { name: 'a' });
    await ok(call, 'run', { cycles: 200 });
    const diff = (await ok(call, 'diff', { a: 'a', b: 'now' })).split('\n');
    expect(diff[0]).toBe('diff a → now over 3C00h–FFFFh: 2 runs, 2 bytes changed');
    expect(diff).toContain('3C00h (1 byte)  20 → 41  ; video RAM off screen');
    expect(diff).toContain('9000h (1 byte)  00 → 42');
    // The screen shows the first 1K: no cell changed, and the off-screen byte is counted, not listed.
    expect(await ok(call, 'screen', { diff: 'a' })).toBe('0 cells changed\n(1 byte of video RAM off screen (offsets 1024–2047) also changed, at offset 1024; not shown)');
    await close();
  });

  it('diff notes when the two sides are in different memory maps', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('map3.cmd'), model: 4 });
    await ok(call, 'snapshot', { name: 'm0' });
    await ok(call, 'run', { cycles: 100 });
    const diff = await ok(call, 'diff', { a: 'm0', b: 'now', range: '3C00-3FFF' });
    expect(diff).toContain('Note: m0 was taken in map 0, page 0, video page 0 and now in map 3, page 0; each side is what the CPU saw at 3C00h–FFFFh in its own map, so some of these bytes are other memory, not changes.');
    // Map 3's 3C00h-3FFFh is RAM (zeros here), where map 0 showed video RAM (spaces).
    expect(diff).toMatch(/^3C00h–3FFFh \(1,024 bytes\)$/m);
    // Coverage is kept per map: the export carries map 3 as its own key, and the summary says so.
    expect(await ok(call, 'coverage', {})).toContain('Maps: coverage is kept per memory map and page (0:0, 3:0); these counts are of map 3, page 0, the one in force, and coverage mode "export" writes each');
    const out = at('map3.labels.json');
    await ok(call, 'coverage', { mode: 'export', path: out });
    const file = JSON.parse(readFileSync(out, 'utf8'));
    expect(file.program.model).toBe(4);
    expect(Object.keys(file.coverage)).toEqual(['0:0', '3:0']);
    await close();
  });

  it('screen shows 80 by 24, and a snapshot from 64 columns is shown in its own width', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('wide.cmd'), model: 4 });
    await ok(call, 'snapshot', { name: 'narrow' });
    await ok(call, 'run', { cycles: 200 });
    const lines = (await ok(call, 'screen', {})).split('\n');
    expect(lines).toHaveLength(2 + 24 + 2);
    expect(lines[2]).toBe('0123456789'.repeat(8));
    expect(lines[4]).toBe('W'.padEnd(80));
    const diff = await ok(call, 'screen', { diff: 'narrow' });
    expect(diff.split('\n')[0]).toBe('The widths differ: snapshot "narrow" was taken at 64 columns and the screen is now 80 columns by 24 rows, so cells cannot be compared one by one. The two screens, each in its own width:');
    await close();
  });

  it('poke follows the memory map in force: ROM, keyboard, or RAM', async () => {
    const { call, session, close } = await server();
    await ok(call, 'load', { path: at('map3.cmd'), model: 4 });
    // Map 0, as the Model III: ROM at 0100h is refused without force.
    expect((await call('poke', { addr: '0100', bytes: 'AA' })).text).toBe('0100h-0100h is in ROM (0000h-37FFh); nothing was written. Pass force: true to patch the ROM image anyway.');
    await ok(call, 'run', { cycles: 100 });
    // Map 3: RAM everywhere, so 0100h and 3800h take a plain poke and read back.
    expect(await ok(call, 'poke', { addr: '0100', bytes: 'AA' })).toBe('Wrote 1 byte at 0100h:\n0100h  00 → AA');
    expect(await ok(call, 'poke', { addr: '3800', bytes: 'BB' })).toBe('Wrote 1 byte at 3800h:\n3800h  00 → BB');
    expect(session.machine?.mem.ram[0x0100]).toBe(0xaa);
    expect(session.machine?.system.memory.rom[0x0100]).not.toBe(0xaa);
    await close();

    const two = await server();
    await ok(two.call, 'load', { path: at('map2.cmd'), model: 4 });
    await ok(two.call, 'run', { cycles: 200 });
    // Map 2: the keyboard is at F400h-F7FFh, and 3800h is RAM.
    expect((await two.call('poke', { addr: 'F5FF', bytes: '01' })).text).toBe('F5FFh is in the keyboard matrix (F400h-F7FFh, in memory map 2), which cannot be written; nothing was written.');
    expect(await ok(two.call, 'poke', { addr: '3800', bytes: 'CC' })).toBe('Wrote 1 byte at 3800h:\n3800h  00 → CC');
    await two.close();
  });

  it('suggest\'s facts follow the memory map: map 2\'s video RAM is at F800h and its keyboard at F400h', async () => {
    const { call, session, close } = await server();
    await ok(call, 'load', { path: at('map2.cmd'), model: 4 });
    await ok(call, 'run', { cycles: 200 });
    // FACT: VIDEO 1, KEYBOARD 2 (src/attribution.js).
    expect(session.facts[0x7004]).toBe(0); // 3C00h is RAM in map 2
    expect(session.facts[0x7007]).toBe(2); // F400h is the keyboard
    expect(session.facts[0x700a]).toBe(1); // F800h is video RAM
    await close();
  });

  it('run until screen and settled compare only the bytes on screen', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('hidden.cmd'), model: 4 });
    // The program changes video RAM off screen all the time; the screen itself never changes.
    expect((await ok(call, 'run', { until: 'screen', seconds: 0.1 })).split('\n')[0]).toBe('stopped: cycles (the 0.1 s asked for)');
    expect((await ok(call, 'run', { until: 'settled', seconds: 0.1 })).split('\n')[0]).toBe('stopped: cycles (the 0.1 s asked for)');
    await close();
  });

  it('counts emulated seconds on the clock in force through a clock switch', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('fast.cmd'), model: 4 });
    const lines = (await ok(call, 'run', { seconds: 1 })).split('\n');
    expect(lines[0]).toBe('stopped: cycles (the 1 s asked for)');
    // The first slice (about 2,000 T-states, to an instruction's end) counts at 2 MHz, the rest at
    // 4 MHz: about 4,055,040 - 2,000 T-states in 1 s (the start-of-call clock would give 2,027,520).
    const ran = Number(/^Ran ([\d,]+) cycles/.exec(/** @type {string} */ (lines[1]))?.[1]?.replaceAll(',', ''));
    expect(ran).toBeGreaterThan(4053000);
    expect(ran).toBeLessThan(4053100);
    expect(lines[1]).toMatch(/\(1\.000 s emulated\)$/);
    await close();
  });

  it('restore refuses a snapshot from another model with a sentence of its own', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('map3.cmd'), model: 4 });
    await ok(call, 'snapshot', { name: 'four' });
    await ok(call, 'load', { path: at('map3.cmd'), model: 3 });
    expect((await call('restore', { name: 'four' })).text).toBe('Snapshot "four" was taken on a Model 4, and the machine is a Model III; a save state restores only into the model that saved it. Load the program with model: 4 first, then restore.');
    await close();
  });
});
