/**
 * MCP phase D, part 2 (docs/fugloy-mcp-spec.md §5 `search` and `callees`; Rulings 3 and 4 of the
 * MCP phases D–F plan) on a synthetic ROM and synthetic programs, so CI runs them.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RAIDERS, buildCmd, connect, syntheticRom, testConfig } from './helpers.js';

const NO_MACHINE = 'No program loaded; call load first.';

/**
 * TREE, a program whose calls form a known tree. MAIN (7000h) calls A twice, B once, RST 28H
 * (a RET in this test's ROM) once, and R. A (7020h) calls C twice; B (7030h) calls C and A; C
 * (7040h) calls D (7050h), which returns. R (7060h) calls itself until B reaches zero.
 */
const TREE = (() => {
  const code = new Array(0x70).fill(0);
  const place = (addr, bytes) => code.splice(addr - 0x7000, bytes.length, ...bytes);
  place(0x7000, [0x31, 0x00, 0x7f]); // 7000  LD SP,7F00H
  place(0x7003, [0xcd, 0x20, 0x70]); // 7003  CALL 7020H
  place(0x7006, [0xcd, 0x20, 0x70]); // 7006  CALL 7020H
  place(0x7009, [0xcd, 0x30, 0x70]); // 7009  CALL 7030H
  place(0x700c, [0xef]); //             700C  RST 28H
  place(0x700d, [0x06, 0x03]); //       700D  LD B,3
  place(0x700f, [0xcd, 0x60, 0x70]); // 700F  CALL 7060H
  place(0x7012, [0x18, 0xfe]); //       7012  JR 7012H
  place(0x7020, [0xcd, 0x40, 0x70]); // 7020  CALL 7040H
  place(0x7023, [0xcd, 0x40, 0x70]); // 7023  CALL 7040H
  place(0x7026, [0xc9]); //             7026  RET
  place(0x7030, [0xcd, 0x40, 0x70]); // 7030  CALL 7040H
  place(0x7033, [0xcd, 0x20, 0x70]); // 7033  CALL 7020H
  place(0x7036, [0xc9]); //             7036  RET
  place(0x7040, [0xcd, 0x50, 0x70]); // 7040  CALL 7050H
  place(0x7043, [0xc9]); //             7043  RET
  place(0x7050, [0xc9]); //             7050  RET
  place(0x7060, [0x05, 0xc8]); //       7060  DEC B / RET Z
  place(0x7062, [0xcd, 0x60, 0x70]); // 7062  CALL 7060H
  place(0x7065, [0xc9]); //             7065  RET
  return buildCmd([{ name: 'TREE' }, { addr: 0x7000, data: code }], 0x7000);
})();

/** The synthetic ROM with a RET at 0028h, for TREE's RST 28H. */
function treeRom() {
  const rom = syntheticRom();
  rom[0x28] = 0xc9;
  return rom;
}

let dir;
const at = (name) => join(dir, name);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fugloy-mcp-phase-d2-'));
  writeFileSync(at('synthetic.rom'), treeRom());
  writeFileSync(at('raiders.cmd'), RAIDERS);
  writeFileSync(at('tree.cmd'), TREE);
  writeFileSync(at('tree-labelled.cmd'), TREE); // its own sidecar, so ALPHA stays out of the other tests
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const server = () => connect({ config: testConfig({ roms: { model3: at('synthetic.rom') } }) });

async function ok(call, name, args) {
  const r = await call(name, args);
  if (r.isError) throw new Error(`${name} failed: ${r.text}`);
  return r.text;
}

async function loaded(file) {
  const s = await server();
  await ok(s.call, 'load', { path: at(file) });
  return s;
}

describe('phase D search', () => {
  it('search and callees before load explain themselves', async () => {
    const { call, close } = await server();
    expect(await call('search', { text: 'A' })).toEqual({ text: NO_MACHINE, isError: true });
    expect(await call('callees', { addr: '7000' })).toEqual({ text: NO_MACHINE, isError: true });
    await close();
  });

  it('bytes matches, in ROM too unless range excludes it', async () => {
    const { call, close } = await loaded('raiders.cmd');
    expect(await ok(call, 'search', { bytes: 'CD3070', range: '7000-70FF' })).toBe(
      'search bytes CD 30 70 over 7000h–70FFh: 3 matches\n7009h  7019h  7022h',
    );
    expect(await ok(call, 'search', { bytes: [0xcd, 0x30, 0x70] })).toContain('3 matches');
    // The synthetic ROM starts LD SP,8000H.
    expect(await ok(call, 'search', { bytes: '31 00 80' })).toBe('search bytes 31 00 80 over 0000h–FFFFh: 1 match\n0000h');
    expect(await ok(call, 'search', { bytes: '310080', range: '3800-FFFF' })).toBe('search bytes 31 00 80 over 3800h–FFFFh: no matches');
    // A match must lie wholly inside the range.
    expect(await ok(call, 'search', { bytes: 'CD3070', range: '7009-700A' })).toContain('no matches');
    expect(await ok(call, 'search', { bytes: 'CD3070', range: { addr: '7009', len: 3 } })).toContain('1 match\n7009h');
    // A pattern longer than the range finds nothing, even where it would wrap past FFFFh.
    await ok(call, 'poke', { addr: 'FFFE', bytes: 'CD30' });
    await ok(call, 'poke', { addr: '0000', bytes: '70', force: true });
    expect(await ok(call, 'search', { bytes: 'CD3070', range: 'FFFE-FFFF' })).toBe('search bytes CD 30 70 over FFFEh–FFFFh: no matches');
    expect(await ok(call, 'search', { bytes: 'CD3070' })).not.toContain('FFFEh');
    await close();
  });

  it('text matches exactly, and fold matches either case and the screen forms', async () => {
    const { call, session, close } = await loaded('raiders.cmd');
    expect(await ok(call, 'search', { text: 'RAIDERS' })).toBe('search text "RAIDERS" over 0000h–FFFFh: 1 match\n7046h');
    await ok(call, 'run', { until: 'screen' });
    expect(await ok(call, 'search', { text: 'RAIDERS' })).toBe('search text "RAIDERS" over 0000h–FFFFh: 2 matches\n3C06h  7046h');
    expect(await ok(call, 'search', { text: 'raiders' })).toContain('no matches');
    expect(await ok(call, 'search', { text: 'raiders', fold: true })).toBe('search text "raiders" (folded) over 0000h–FFFFh: 2 matches\n3C06h  7046h');
    // Video RAM can hold 01h-1Ah for A-Z; the screen shows them as letters.
    session.machine.mem.write(0x3e00, [0x13, 0x05, 0x01, 0x20, 0x44]); // "SEA D" with SEA in 00h-1Fh form
    expect(await ok(call, 'search', { text: 'Sea D', range: '3C00-3FFF' })).toContain('no matches');
    expect(await ok(call, 'search', { text: 'Sea D', fold: true, range: '3C00-3FFF' })).toContain('1 match\n3E00h');
    // Punctuation outside 40h-5Fh never folds.
    expect(await ok(call, 'search', { text: ' D', fold: true, range: '3E00-3E05' })).toContain('1 match\n3E03h');
    await close();
  });

  it('an empty or doubled pattern is refused', async () => {
    const { call, close } = await loaded('raiders.cmd');
    expect(await call('search', { bytes: '' })).toEqual({ text: 'bytes is empty; give at least one byte.', isError: true });
    expect(await call('search', { bytes: '  ' })).toEqual({ text: 'bytes is empty; give at least one byte.', isError: true });
    expect(await call('search', { bytes: [] })).toEqual({ text: 'bytes is empty; give at least one byte.', isError: true });
    expect(await call('search', { text: '' })).toEqual({ text: 'text is empty; give at least one character.', isError: true });
    expect(await call('search', {})).toEqual({ text: 'Give bytes or text to search for.', isError: true });
    expect(await call('search', { bytes: 'CD', text: 'A' })).toEqual({ text: 'Give bytes or text, not both.', isError: true });
    expect(await call('search', { bytes: 'CD', fold: true })).toEqual({ text: 'fold applies to text; bytes are always matched exactly.', isError: true });
    expect(await call('search', { text: 'naïve' })).toEqual({
      text: 'text holds "ï", which is not a printable ASCII character (20h–7Eh); search for it with bytes instead.',
      isError: true,
    });
    expect((await call('search', { bytes: 'ABC' })).isError).toBe(true);
    await close();
  });

  it('lists at most 256 addresses, then counts the rest', async () => {
    const { call, session, close } = await loaded('raiders.cmd');
    const mem = session.machine.mem.read(0, 0x10000);
    const zeros = mem.filter((b) => b === 0).length;
    expect(zeros).toBeGreaterThan(256);
    const lines = (await ok(call, 'search', { bytes: '00' })).split('\n');
    expect(lines[0]).toBe(`search bytes 00 over 0000h–FFFFh: ${zeros.toLocaleString('en-US')} matches`);
    expect(lines).toHaveLength(1 + 32 + 1);
    expect(lines.slice(1, 33).join('  ').split('  ')).toHaveLength(256);
    expect(lines.at(-1)).toBe(`… and ${(zeros - 256).toLocaleString('en-US')} more matches past the first 256; narrow range to see them.`);
    await close();
  });
});

describe('phase D callees', () => {
  it('draws a two-level tree with call counts and sites', async () => {
    const { call, close } = await loaded('tree-labelled.cmd');
    await ok(call, 'run', { cycles: 5000 });
    await ok(call, 'label', { addr: '7020', name: 'ALPHA' });
    expect(await ok(call, 'callees', { addr: '7000' })).toBe(
      [
        'Callees of 7000h (7000h–7013h, to its first executed RET), 2 levels, calls since load:',
        '7000h',
        '  7020h  2 calls from 2 sites  ; ALPHA',
        '    7040h  6 calls from 2 sites',
        '  0028h  1 call from 1 site (RST)  ; BREAKRST',
        '  7030h  1 call from 1 site',
        '    7020h  1 call from 1 site  ; ALPHA',
        '    7040h  1 call from 1 site',
        '  7060h  1 call from 1 site',
        '    7060h  2 calls from 1 site  (recursive; see above)',
      ].join('\n'),
    );
    await close();
  });

  it('depth bounds the tree, from 1 to 4', async () => {
    const { call, close } = await loaded('tree.cmd');
    await ok(call, 'run', { cycles: 5000 });
    const one = (await ok(call, 'callees', { addr: '7000', depth: 1 })).split('\n');
    expect(one[0]).toContain('1 level,');
    expect(one.slice(2).every((l) => /^ {2}\S/.test(l))).toBe(true);
    expect(one).toHaveLength(2 + 4);
    expect(await ok(call, 'callees', { addr: '7000', depth: 3 })).toBe(
      [
        'Callees of 7000h (7000h–7013h, to its first executed RET), 3 levels, calls since load:',
        '7000h',
        '  7020h  2 calls from 2 sites',
        '    7040h  6 calls from 2 sites',
        '      7050h  7 calls from 1 site',
        '  0028h  1 call from 1 site (RST)  ; BREAKRST',
        '  7030h  1 call from 1 site',
        '    7020h  1 call from 1 site  (callees listed above)',
        '    7040h  1 call from 1 site  (callees listed above)',
        '  7060h  1 call from 1 site',
        '    7060h  2 calls from 1 site  (recursive; see above)',
      ].join('\n'),
    );
    for (const depth of [0, 5]) {
      expect(await call('callees', { addr: '7000', depth })).toEqual({ text: `depth must be between 1 and 4, not ${depth}.`, isError: true });
    }
    expect((await call('callees', { addr: '7000', depth: '2' })).text).toContain('decimal number');
    await close();
  });

  it('a leaf, an address never run, and one inside a routine', async () => {
    const { call, close } = await loaded('tree.cmd');
    await ok(call, 'run', { cycles: 5000 });
    expect(await ok(call, 'callees', { addr: '7050' })).toBe('The routine at 7050h (7050h–7050h, to its first executed RET) made no CALL or RST since load.');
    expect(await ok(call, 'callees', { addr: 'C000' })).toBe('C000h has not run as an instruction since load, so it has no callees yet.');
    // 7024h is inside 7023h's CALL, so it never ran as an instruction; the routine is at 7020h.
    expect(await ok(call, 'callees', { addr: '7024' })).toBe(
      '7024h has not run as an instruction since load, so it has no callees yet. The nearest call target below it is 7020h; try callees with addr 7020h.',
    );
    await close();
  });
});
