/** The committed symbol data must validate, and the committed generated files must be exactly what `pnpm symbols` writes. */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildSymbolOutputs } from '../../scripts/write-symbols.js';
import { selectSymbols } from '../../src/symbols/select.js';
import { SOURCES, TABLES } from '../../src/symbols/tables.generated.js';
import { TABLE_IDS } from '../../src/symbols/types.js';
import type { TableEntry } from '../../src/symbols/types.js';

const dataDir = fileURLToPath(new URL('../../data/symbols/', import.meta.url));
const modulePath = fileURLToPath(new URL('../../src/symbols/tables.generated.ts', import.meta.url));

describe('the committed symbol data', () => {
  const built = buildSymbolOutputs(dataDir);

  it('validates with no errors', () => {
    expect(built.errors).toEqual([]);
  });

  it('compiles to the committed tables.generated.ts', () => {
    expect(built.module, 'tables.generated.ts is out of date: run pnpm symbols').toBe(readFileSync(modulePath, 'utf8'));
  });

  it('compiles to the committed COMPARISON.md', () => {
    expect(built.comparison, 'COMPARISON.md is out of date: run pnpm symbols').toBe(readFileSync(join(dataDir, 'COMPARISON.md'), 'utf8'));
  });

  it('registers the ten sources of the design spec', () => {
    expect(SOURCES.map((s) => s.id)).toEqual(['m3-basic', 'paay', 'decker', 'l2-1979', 'm1-trh', 'm3-trm', 'trsdos13', 'ldos51', 'soltoff', 'm4-trm']);
  });

  it('keeps titles with apostrophes and dashes whole through the generated literals', () => {
    expect(SOURCES.find((s) => s.id === 'trsdos13')?.title).toBe("TRS-80 Model III Disk System Owner's Manual");
    expect(SOURCES.find((s) => s.id === 'soltoff')).toMatchObject({ title: "The Programmer's Guide to LDOS/TRSDOS Version 6", year: '1983–84' });
  });

  it('has a list for every table, each in key order and filed under its own id', () => {
    expect(Object.keys(TABLES)).toEqual([...TABLE_IDS]);
    for (const id of TABLE_IDS) {
      const entries = TABLES[id];
      expect(entries.every((e) => e.table === id)).toBe(true);
      expect(entries.map((e) => e.key)).toEqual(entries.map((e) => e.key).sort((a, b) => a - b));
    }
  });

  it('names $KBWAIT at 0x0049 in the Model III ROM table, citing the Model III manual', () => {
    expect(TABLES['rom-model3'].find((e) => e.key === 0x0049)).toMatchObject({
      name: '$KBWAIT',
      kind: 'routine',
      cite: [{ source: 'm3-basic', page: '12/12' }],
    });
  });

  it('names $JP2DOS at 0x402D in the TRSDOS 1.3 table', () => {
    expect(TABLES['dos-trsdos13'].find((e) => e.key === 0x402d)).toMatchObject({ name: '$JP2DOS', kind: 'routine' });
  });
});

describe('the hardware tables', () => {
  const model1 = TABLES['hardware-model1'];
  const model3 = TABLES['hardware-model3'];
  const named = (entries: readonly TableEntry[], name: string): TableEntry | undefined => entries.find((e) => e.name === name);
  const ports = (entries: readonly TableEntry[]): [number, string][] => entries.filter((e) => e.kind === 'port').map((e) => [e.key, e.name]);
  const memory = (entries: readonly TableEntry[]): [number, string, number][] => entries.filter((e) => e.kind !== 'port').map((e) => [e.key, e.name, e.length]);

  it('names VIDEO at 0x3C00, 1024 bytes, and KEYBOARD at 0x3800 in both tables', () => {
    for (const table of [model1, model3]) {
      expect(named(table, 'VIDEO')).toMatchObject({ key: 0x3c00, length: 1024, kind: 'region', coined: true });
      expect(named(table, 'KEYBOARD')).toMatchObject({ key: 0x3800, kind: 'region', coined: true });
    }
  });

  it('gives KEYBOARD the length each manual decodes: 256 bytes in the Model I handbook, 1024 in the Model III manual', () => {
    expect(named(model1, 'KEYBOARD')?.length).toBe(256);
    expect(named(model3, 'KEYBOARD')?.length).toBe(1024);
  });

  it('gives the Model III a port entry for 0xEC and 0xFF, and the Model I none for 0xEC', () => {
    expect(model3.find((e) => e.kind === 'port' && e.key === 0xec)).toMatchObject({ name: 'MODEPORT' });
    expect(model3.find((e) => e.kind === 'port' && e.key === 0xff)).toMatchObject({ name: 'CASSETTE' });
    expect(model1.some((e) => e.kind === 'port' && e.key === 0xec)).toBe(false);
  });

  it('enters each port of the Model III manual (pp. 15, 21, and 22) once, IN and OUT sharing the entry', () => {
    expect(ports(model3)).toEqual([
      [0xe0, 'INTPORT'], [0xe4, 'NMIPORT'], [0xe8, 'RS232_MODEM'], [0xe9, 'RS232_BAUD'], [0xea, 'RS232_CTRL'], [0xeb, 'RS232_DATA'], [0xec, 'MODEPORT'],
      [0xf0, 'FDC_CMDSTAT'], [0xf1, 'FDC_TRACK'], [0xf2, 'FDC_SECTOR'], [0xf3, 'FDC_DATA'], [0xf4, 'FDC_DRVSEL'], [0xf8, 'PRINTER'], [0xff, 'CASSETTE'],
    ]);
    const numbers = ports(model3).map(([port]) => port);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('enters the Model III memory map devices of manual p. 14: the printer status pair, keyboard, and video', () => {
    expect(memory(model3)).toEqual([[0x37e8, 'PRTSTATUS', 2], [0x3800, 'KEYBOARD', 1024], [0x3c00, 'VIDEO', 1024]]);
  });

  it('enters the Model I memory-mapped devices (Level II manual D-2, Decker 63) and the one port, FF', () => {
    expect(memory(model1)).toEqual([
      [0x37de, 'COMSTATUS', 1], [0x37df, 'COMDATA', 1], [0x37e0, 'INTLATCH', 1], [0x37e1, 'FDC_DRVSEL', 1], [0x37e4, 'CAS_SELECT', 1], [0x37e8, 'PRINTER', 1],
      [0x37ec, 'FDC_CMDSTAT', 1], [0x37ed, 'FDC_TRACK', 1], [0x37ee, 'FDC_SECTOR', 1], [0x37ef, 'FDC_DATA', 1], [0x3800, 'KEYBOARD', 256], [0x3c00, 'VIDEO', 1024],
    ]);
    expect(ports(model1)).toEqual([[0xff, 'CASSETTE']]);
  });

  it('cites m3-trm for every Model III entry, and for the Model I what documents it: the handbook, the Level II manual, or Decker', () => {
    for (const e of model3) expect(e.cite.some((c) => c.source === 'm3-trm'), e.name).toBe(true);
    for (const e of model1) expect(e.cite.some((c) => ['m1-trh', 'l2-1979', 'decker'].includes(c.source)), e.name).toBe(true);
    // What the handbook itself documents: the keyboard and video maps and port FF.
    for (const name of ['KEYBOARD', 'VIDEO', 'CASSETTE']) expect(named(model1, name)?.cite.some((c) => c.source === 'm1-trh'), name).toBe(true);
  });

  // Decker's "Page N" line closes page N: its contents puts chapter 5 at p. 63, and the chapter heading sits after the "Page 62" line. Its own address
  // index lists 37DE-37EF, 3800, 3BFF, and 3C00 under p. 63, and 37E8 and 37EC also under p. 64. Each purpose comes from the table on p. 63, except the
  // printer's read-status and write-data behavior, which is p. 64 prose.
  it('cites Decker on the printed page its address index gives: 63 for the device table, and 64 as well for the printer prose', () => {
    const pages = (name: string): string[] => (named(model1, name)?.cite ?? []).filter((c) => c.source === 'decker').map((c) => c.page);
    for (const name of ['COMSTATUS', 'COMDATA', 'INTLATCH', 'FDC_DRVSEL', 'CAS_SELECT', 'FDC_CMDSTAT', 'FDC_TRACK', 'FDC_SECTOR', 'FDC_DATA']) expect(pages(name), name).toEqual(['63']);
    expect(pages('PRINTER')).toEqual(['63', '64']);
  });

  it('coins every hardware name, since the manuals name signals, not symbols', () => {
    expect(model1.length).toBeGreaterThan(0);
    expect(model3.length).toBeGreaterThan(0);
    for (const e of [...model1, ...model3]) expect(e.coined, e.name).toBe(true);
  });

  it('names the screen and a port through selectSymbols, for both machines', () => {
    for (const machine of [1, 3] as const) {
      const set = selectSymbols({ machine, dos: 'none' });
      expect(set.data(0x3c40)).toMatchObject({ entry: { name: 'VIDEO' }, offset: 0x40 });
      expect(set.port(0xff)?.name).toBe('CASSETTE');
    }
    expect(selectSymbols({ machine: 3, dos: 'none' }).port(0xec)?.name).toBe('MODEPORT');
    expect(selectSymbols({ machine: 1, dos: 'none' }).port(0xec)).toBeUndefined();
  });
});

describe('the Model III ROM table', () => {
  const rom = TABLES['rom-model3'];
  const at = (key: number): TableEntry | undefined => rom.find((e) => e.key === key);
  const named = (name: string): TableEntry | undefined => rom.find((e) => e.name === name);
  const pages = (e: TableEntry | undefined, source: string): string[] => (e?.cite ?? []).filter((c) => c.source === source).map((c) => c.page);

  // The 28 rows of Tandy's "Summary of Important ROM Addresses" (m3-basic 12/24), each with the manual page of its own entry. Every row's decimal
  // and hex agree on the page image, and each routine's own heading prints the same pair. The page numbers are chapter and page (12/15), as the
  // archive.org copy named in sources.json prints them.
  const SUMMARY: readonly (readonly [string, number, string])[] = [
    ['$RESET', 0x0000, '12/15'], ['$KBCHAR', 0x002b, '12/11'], ['$VDCHAR', 0x0033, '12/20'], ['$PRCHAR', 0x003b, '12/14'], ['$KBLINE', 0x0040, '12/12'],
    ['$KBWAIT', 0x0049, '12/12'], ['$RSRCV', 0x0050, '12/18'], ['$RSTX', 0x0055, '12/19'], ['$RSINIT', 0x005a, '12/17'], ['$DELAY', 0x0060, '12/10'],
    ['$INITIO', 0x0069, '12/10'], ['$ROUTE', 0x006c, '12/16'], ['$VDCLS', 0x01c9, '12/21'], ['$PRSCN', 0x01d9, '12/14'], ['$CSOFF', 0x01f8, '12/8'],
    ['$VDLINE', 0x021b, '12/21'], ['$CSIN', 0x0235, '12/7'], ['$CSOUT', 0x0264, '12/9'], ['$CSHWR', 0x0287, '12/7'], ['$KBBRK', 0x028d, '12/13'],
    ['$CSHIN', 0x0296, '12/6'], ['$CLKON', 0x0298, '12/5'], ['$CLKOFF', 0x02a1, '12/5'], ['$READY', 0x1a19, '12/15'], ['$DATE', 0x3033, '12/9'],
    ['$TIME', 0x3036, '12/20'], ['$SETCAS', 0x3042, '12/19'], ['$PRSTAT', 0x37e8, '12/24'],
  ];

  it('has at least 60 entries', () => {
    expect(rom.length).toBeGreaterThanOrEqual(60);
  });

  it('names the 28 rows of Tandy summary 12/24: 27 routines here, and the printer status at 0x37E8 through the hardware table that owns it', () => {
    expect(SUMMARY).toHaveLength(28);
    const here = SUMMARY.filter(([name]) => name !== '$PRSTAT');
    expect(here).toHaveLength(27);
    for (const [name, key, page] of here) {
      expect(named(name), name).toMatchObject({ key, kind: 'routine', coined: false, cite: [{ source: 'm3-basic', page }] });
    }
    // 37E8 is memory, and the hardware table already names it PRTSTATUS; memory entries in one selection may not overlap.
    expect(named('$PRSTAT')).toBeUndefined();
    expect(at(0x37e8)).toBeUndefined();
    expect(TABLES['hardware-model3'].find((e) => e.key === 0x37e8)).toMatchObject({ name: 'PRTSTATUS', kind: 'region' });
  });

  it('puts $PRCHAR at 0x003B, the print routine Tandy lists there', () => {
    expect(named('$PRCHAR')).toMatchObject({ key: 0x003b });
    expect(at(0x003b)?.name).toBe('$PRCHAR');
  });

  it('has the eight RST vectors, 0x00 through 0x38, as routines', () => {
    for (const key of [0x00, 0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38]) expect(at(key), `RST ${key.toString(16)}`).toMatchObject({ kind: 'routine' });
    expect(at(0x00)?.name).toBe('$RESET');
  });

  // Decker's "Page N" line closes page N (its contents puts chapter 4 at p. 50, and its own address index lists 0008 and 0010 under 51, and
  // 0018, 0020, 0028, 0030, and 0038 under 52), so the RST text above "Page 51" is on p. 51 and the text above "Page 52" on p. 52.
  it('cites Decker on printed pages 51 and 52 for the RST vectors it describes', () => {
    for (const key of [0x08, 0x10]) expect(pages(at(key), 'decker'), `RST ${key.toString(16)}`).toEqual(['51']);
    for (const key of [0x18, 0x20, 0x28, 0x30, 0x38]) expect(pages(at(key), 'decker'), `RST ${key.toString(16)}`).toEqual(['52']);
    for (const key of [0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38]) expect(at(key)?.coined, `RST ${key.toString(16)}`).toBe(true);
  });

  // The 18 rows of Tandy's "Summary of Important RAM Addresses" (12/25 and 12/26), each a variable, or a vector for the BREAK jump. Lengths come
  // from the page: three bytes for the vector, two for an address or device code, six for the clock, one otherwise.
  it('enters each RAM address of Tandy summaries 12/25 and 12/26 as a variable or vector with its length', () => {
    const RAM: readonly (readonly [number, string, 'variable' | 'vector', number, string])[] = [
      [0x400c, 'BREAKVEC', 'vector', 3, '12/25'], [0x4019, 'CAPSLOCK', 'variable', 1, '12/25'], [0x401c, 'CURBLINK', 'variable', 1, '12/25'],
      [0x4020, 'CURADDR', 'variable', 2, '12/25'], [0x4023, 'CURCHAR', 'variable', 1, '12/25'], [0x4028, 'PRTPAGELEN', 'variable', 1, '12/25'],
      [0x4029, 'PRTLINECNT', 'variable', 1, '12/25'], [0x402b, 'PRTWIDTH', 'variable', 1, '12/25'], [0x41e8, 'RSRXBUF', 'variable', 1, '12/25'],
      [0x41f0, 'RSTXBUF', 'variable', 1, '12/25'], [0x41f8, 'RSBAUD', 'variable', 1, '12/25'], [0x41f9, 'RSFORMAT', 'variable', 1, '12/25'],
      [0x41fa, 'RSWAIT', 'variable', 1, '12/25'], [0x4211, 'CASBAUD', 'variable', 1, '12/25'], [0x4214, 'SCROLLPROT', 'variable', 1, '12/26'],
      [0x4217, 'TIMEDATE', 'variable', 6, '12/26'], [0x4220, 'ROUTEDST', 'variable', 2, '12/26'], [0x4222, 'ROUTESRC', 'variable', 2, '12/26'],
    ];
    expect(RAM).toHaveLength(18);
    for (const [key, name, kind, length, page] of RAM) {
      expect(at(key), name).toMatchObject({ name, kind, length, coined: true });
      expect(pages(at(key), 'm3-basic')[0], name).toBe(page);
    }
  });

  it('names each address of the asylum16 list that a Model III source documents, and not $0112, which is only text in the start-up banner', () => {
    const documented = [0x0000, 0x0008, 0x0010, 0x0020, 0x0030, 0x0038, 0x002b, 0x0033, 0x01f8, 0x0212, 0x0235, 0x0264, 0x0287, 0x0296, 0x093e, 0x1a19];
    for (const key of documented) expect(at(key), key.toString(16)).toMatchObject({ kind: 'routine' });
    expect(at(0x0212)?.cite).toEqual([{ source: 'decker', page: '17' }]);
    expect(at(0x093e)?.cite).toEqual([{ source: 'decker', page: '28' }]);
    // Decker's differences list gives 0112-0115 only as part of the banner "Radio Shack Model III Basic": no routine, so no entry.
    expect(at(0x0112)).toBeUndefined();
  });

  it('keeps ROM entries below $4000 as routines and RAM entries from $4000 as variables or vectors', () => {
    for (const e of rom) {
      if (e.key < 0x4000) expect(e.kind, e.name).toBe('routine');
      else expect(['variable', 'vector'], e.name).toContain(e.kind);
    }
  });

  it('uses Tandy names, which start with $, only where Tandy prints them, and coins every other name', () => {
    for (const e of rom) expect(e.coined, e.name).toBe(!e.name.startsWith('$'));
    expect(rom.filter((e) => !e.coined).map((e) => e.name).sort()).toEqual(SUMMARY.filter(([name]) => name !== '$PRSTAT').map(([name]) => name).sort());
  });

  it('cites only Tandy chapter 12 (12/2 to 12/26) and Decker pages the book prints (1 to 126), and never kiwisincebirth', () => {
    for (const e of rom) {
      expect(e.cite.length, e.name).toBeGreaterThan(0);
      for (const c of e.cite) {
        expect(['m3-basic', 'decker'], `${e.name} cites ${c.source}`).toContain(c.source);
        if (c.source === 'm3-basic') {
          const m = /^12\/(\d+)$/.exec(c.page);
          expect(m, `${e.name} cites ${c.page}`).not.toBeNull();
          expect(Number(m?.[1]), `${e.name} cites ${c.page}`).toBeGreaterThanOrEqual(2);
          expect(Number(m?.[1]), `${e.name} cites ${c.page}`).toBeLessThanOrEqual(26);
        } else {
          expect(c.page, `${e.name} cites decker ${c.page}`).toMatch(/^[1-9]\d{0,2}$/);
          expect(Number(c.page), `${e.name} cites decker ${c.page}`).toBeLessThanOrEqual(126);
        }
      }
    }
    expect(rom.some((e) => e.cite.some((c) => c.source === 'kiwisincebirth'))).toBe(false);
  });

  it('names the ROM, the RST vectors, and the RAM it documents through selectSymbols, under every DOS', () => {
    for (const dos of ['trsdos', 'ldos', 'none'] as const) {
      const set = selectSymbols({ machine: 3, dos });
      expect(set.code(0x0049)?.name, dos).toBe('$KBWAIT');
      expect(set.code(0x0000)?.name, dos).toBe('$RESET');
      expect(set.code(0x0038)?.name, dos).toBe(at(0x38)?.name);
      expect(set.code(0x400c)?.name, dos).toBe('BREAKVEC');
      expect(set.data(0x4021)).toMatchObject({ entry: { name: 'CURADDR' }, offset: 1 });
      expect(set.data(0x4219)).toMatchObject({ entry: { name: 'TIMEDATE' }, offset: 2 });
    }
  });
});

describe('buildSymbolOutputs on an edited copy of the data', () => {
  const copies: string[] = [];
  afterAll(() => {
    for (const dir of copies) rmSync(dir, { recursive: true, force: true });
  });
  /** Builds from a fresh copy of the data after `edit` has changed it. */
  const buildWith = (edit: (dir: string) => void) => {
    const dir = mkdtempSync(join(tmpdir(), 'fugloy-symbols-'));
    copies.push(dir);
    cpSync(dataDir, dir, { recursive: true });
    edit(dir);
    return buildSymbolOutputs(dir);
  };
  const romModel1 = (...entries: object[]): string => JSON.stringify({ table: 'rom-model1', entries });
  const keyAt49 = { addr: '0049', name: '$KEY', kind: 'routine', purpose: 'wait for a key', cite: [{ source: 'paay', page: '5' }] };

  it('reports a table file that is missing, and writes no output', () => {
    const r = buildWith((dir) => rmSync(join(dir, 'hardware-model1.json')));
    expect(r).toEqual({ module: '', comparison: '', errors: ['hardware-model1.json: cannot read the file'], entries: 0 });
  });

  it('reports a file that is not JSON', () => {
    const r = buildWith((dir) => writeFileSync(join(dir, 'rom-model1.json'), '{ "table": '));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^rom-model1\.json: not valid JSON \(/);
    expect(r.module).toBe('');
  });

  it('reports what the validator finds', () => {
    const r = buildWith((dir) => writeFileSync(join(dir, 'rom-model1.json'), romModel1({ ...keyAt49, addr: '4O2D', name: 'X' })));
    expect(r.errors).toEqual(['rom-model1.json entry 0 "X": addr "4O2D" is not four uppercase hex digits']);
    expect(r.comparison).toBe('');
  });

  it('writes a port key in two hex digits, a service call in decimal, a coined flag, and a note last', () => {
    const r = buildWith((dir) => {
      const hardware = [
        { addr: '3C00', name: 'VIDEO', kind: 'region', length: 1024, coined: true, purpose: 'screen memory', cite: [{ source: 'm3-trm', page: '14' }], note: "it's memory-mapped" },
        { port: 'EC', name: 'MODEPORT', kind: 'port', coined: true, purpose: 'display mode', cite: [{ source: 'm3-trm', page: '15' }] },
      ];
      const calls = [{ svc: 10, name: '@DSPLY', kind: 'svc', purpose: 'display a line', cite: [{ source: 'soltoff', page: '101' }] }];
      writeFileSync(join(dir, 'hardware-model3.json'), JSON.stringify({ table: 'hardware-model3', entries: hardware }));
      writeFileSync(join(dir, 'svc-lsdos6.json'), JSON.stringify({ table: 'svc-lsdos6', entries: calls }));
    });
    expect(r.errors).toEqual([]);
    const lines = r.module.split('\n');
    expect(lines).toContain("    { table: 'hardware-model3', kind: 'port', key: 0xEC, name: 'MODEPORT', length: 1, purpose: 'display mode', cite: [{ source: 'm3-trm', page: '15' }], coined: true },");
    expect(lines).toContain(`    { table: 'hardware-model3', kind: 'region', key: 0x3C00, name: 'VIDEO', length: 1024, purpose: 'screen memory', cite: [{ source: 'm3-trm', page: '14' }], coined: true, note: "it's memory-mapped" },`);
    expect(lines).toContain("    { table: 'svc-lsdos6', kind: 'svc', key: 10, name: '@DSPLY', length: 1, purpose: 'display a line', cite: [{ source: 'soltoff', page: '101' }], coined: false },");
  });

  it('writes the ROM comparison in address order, though JavaScript enumerates all-digit keys like 1000 first', () => {
    const r = buildWith((dir) => writeFileSync(join(dir, 'rom-model1.json'), romModel1({ ...keyAt49, addr: '1000', name: '$X1000' })));
    expect(r.errors).toEqual([]);
    const listed = [...r.module.slice(r.module.indexOf('export const ROM_COMPARISON')).matchAll(/^ {2}'([0-9A-F]{4})':/gm)].map((m) => m[1]);
    expect(listed).toContain('1000');
    expect(listed).toEqual([...listed].sort());
  });

  it('reports a ROM address the two maps name differently when neither entry has a note', () => {
    const r = buildWith((dir) => writeFileSync(join(dir, 'rom-model1.json'), romModel1(keyAt49)));
    expect(r.errors).toEqual(['$0049 is $KEY (routine) in rom-model1.json but $KBWAIT (routine) in rom-model3.json, and neither entry has a note saying why']);
    expect(r.module).toBe('');
  });

  it('accepts that difference once an entry has a note, and lists it in the report', () => {
    const r = buildWith((dir) => writeFileSync(join(dir, 'rom-model1.json'), romModel1({ ...keyAt49, note: 'Model III renamed it' })));
    expect(r.errors).toEqual([]);
    expect(r.comparison).toContain('| `$0049` | different | `$KEY` (routine) | `$KBWAIT` (routine) | Model I: Model III renamed it |');
    expect(r.module).toContain("'0049': 'different'");
    expect(r.entries).toBe(buildSymbolOutputs(dataDir).entries + 1);
  });
});
