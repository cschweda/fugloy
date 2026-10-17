/** The committed symbol data must validate, and the committed generated files must be exactly what `pnpm symbols` writes. */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildSymbolOutputs } from '../../scripts/write-symbols.js';
import { compareRoms } from '../../src/symbols/compare.js';
import { selectSymbols } from '../../src/symbols/select.js';
import { ROM_COMPARISON, SOURCES, TABLES } from '../../src/symbols/tables.generated.js';
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
    expect(memory(model3)).toEqual([[0x37e8, '$PRSTAT', 2], [0x3800, 'KEYBOARD', 1024], [0x3c00, 'VIDEO', 1024]]);
  });

  // Tandy's ROM summary (m3-basic 12/24) prints the printer status as "$PRSTAT 14312/X'37E8'", and a name a source prints beats a coined one (spec 4.3).
  it('names the printer status pair $PRSTAT, as Tandy prints it on 12/24, and still cites the Model III manual p. 14', () => {
    expect(named(model3, '$PRSTAT')).toMatchObject({
      key: 0x37e8,
      kind: 'region',
      length: 2,
      coined: false,
      cite: [{ source: 'm3-trm', page: '14' }, { source: 'm3-basic', page: '12/24' }],
    });
    expect(named(model3, 'PRTSTATUS')).toBeUndefined();
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

  it('coins every hardware name but $PRSTAT, since the manuals name signals, not symbols; Tandy prints that one', () => {
    expect(model1.length).toBeGreaterThan(0);
    expect(model3.length).toBeGreaterThan(0);
    for (const e of [...model1, ...model3]) expect(e.coined, e.name).toBe(!e.name.startsWith('$'));
    expect([...model1, ...model3].filter((e) => !e.coined).map((e) => e.name)).toEqual(['$PRSTAT']);
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

  it('names all 28 rows of Tandy summary 12/24 in the Model III selection: 27 routines here, and the printer status $PRSTAT in the hardware table', () => {
    expect(SUMMARY).toHaveLength(28);
    // The Model III selection is rom-model3 plus hardware-model3 (here with no DOS table).
    const selection = selectSymbols({ machine: 3, dos: 'none' }).entries();
    expect(selection.map((e) => e.table)).toEqual([...rom, ...TABLES['hardware-model3']].map((e) => e.table));
    const found = SUMMARY.filter(([name, key]) => selection.some((e) => e.name === name && e.key === key));
    expect(found.map(([name]) => name)).toEqual(SUMMARY.map(([name]) => name));
    expect(found).toHaveLength(28);
    // The 27 routines are here, each uncoined and citing its own page.
    const routines = SUMMARY.filter(([name]) => name !== '$PRSTAT');
    expect(routines).toHaveLength(27);
    for (const [name, key, page] of routines) {
      expect(named(name), name).toMatchObject({ key, kind: 'routine', coined: false, cite: [{ source: 'm3-basic', page }] });
    }
    // 37E8 is memory the hardware table owns, and memory entries in one selection may not overlap, so $PRSTAT cannot also be here.
    expect(named('$PRSTAT')).toBeUndefined();
    expect(at(0x37e8)).toBeUndefined();
    expect(TABLES['hardware-model3'].find((e) => e.name === '$PRSTAT')).toMatchObject({ key: 0x37e8, kind: 'region', length: 2, coined: false });
    expect(selectSymbols({ machine: 3, dos: 'none' }).data(0x37e9)).toMatchObject({ entry: { name: '$PRSTAT' }, offset: 1 });
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

  // Twelve routines the Model I table also names. Their code is byte for byte the same in the Model I and Model III ROM images, from the entry to
  // the end of the routine, and Decker documents each for both machines (his book applies to both unless it says "Model I only" or "Model III only"):
  // the error table on p. 61 (and the L3 vectors on p. 72), the line-pointer and line-search routines on p. 56, his keyword entry table on p. 121,
  // and chapter two's number and variable routines on pp. 31, 35, and 36. Each takes the Model I table's name and kind, so the comparison classes it shared.
  it('enters the twelve routines the two ROMs share and Decker documents for both machines, each with the name and kind the Model I table gives it', () => {
    const SHARED: readonly (readonly [number, string, readonly string[]])[] = [
      [0x012d, 'ERR_L3', ['61', '72']], [0x0135, 'BASICSET', ['121']], [0x0138, 'BASICRESET', ['121']], [0x07b2, 'ERR_OV', ['61']],
      [0x0af6, 'ERR_TM', ['61']], [0x1997, 'ERR_SN', ['61']], [0x1af8, 'FIXLINEPTRS', ['56']], [0x1b2c, 'FINDLINE', ['56']],
      [0x1e4a, 'ERR_FC', ['61']], [0x1e5a, 'ASCTODE', ['35']], [0x260d, 'FINDVAR', ['36']], [0x2b05, 'ACCTODE', ['31']],
    ];
    for (const [key, name, decker] of SHARED) {
      expect(at(key), name).toMatchObject({ name, kind: 'routine', coined: true });
      expect(pages(at(key), 'decker'), name).toEqual(decker);
      expect(TABLES['rom-model1'].find((e) => e.key === key), name).toMatchObject({ name, kind: 'routine' });
      expect(ROM_COMPARISON[key.toString(16).toUpperCase().padStart(4, '0')], name).toBe('shared');
    }
  });

  // Decker documents neither address: his keyword table (p. 121) gives POINT no entry and lists SYSTEM at 02B2H, and the ROMs differ inside the
  // SYSTEM routine, at 02E2H-02E4H (his p. 82). The Model I table has both from Paay, so they stay Model I only.
  it('leaves POINT at 0132 and the SYSTEM routine at 02B5 to the Model I table: no Model III source documents them there, and the SYSTEM code differs', () => {
    expect(at(0x0132)).toBeUndefined();
    expect(at(0x02b5)).toBeUndefined();
    expect(ROM_COMPARISON['0132']).toBe('model1-only');
    expect(ROM_COMPARISON['02B5']).toBe('model1-only');
  });

  it('tags a Model III name with [Model III] only where its address is not shared: CASSELECT is tagged, ERR_FC is not', () => {
    const set = selectSymbols({ machine: 3, dos: 'none' });
    expect(set.code(0x1e4a)?.name).toBe('ERR_FC');
    expect(set.machineTag(at(0x1e4a)!)).toBeUndefined();
    expect(set.machineTag(at(0x0212)!)).toBe('[Model III]');
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
    // Across the Model III selection the uncoined names are exactly Tandy's 28 summary names.
    const selection = selectSymbols({ machine: 3, dos: 'none' }).entries();
    expect(selection.filter((e) => !e.coined).map((e) => e.name).sort()).toEqual(SUMMARY.map(([name]) => name).sort());
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

describe('the Model I ROM table', () => {
  const rom = TABLES['rom-model1'];
  const model3 = TABLES['rom-model3'];
  const at = (key: number): TableEntry | undefined => rom.find((e) => e.key === key);
  const atModel3 = (key: number): TableEntry | undefined => model3.find((e) => e.key === key);
  const pages = (e: TableEntry | undefined, source: string): string[] => (e?.cite ?? []).filter((c) => c.source === source).map((c) => c.page);
  const hex4 = (key: number): string => key.toString(16).toUpperCase().padStart(4, '0');

  // Where a Model I source documents the same routine or variable at the same address as the Model III table, the Model I entry takes that name and
  // kind, so the comparison classes the address shared (spec 4.3 and 4.6). Each of these addresses is documented by Paay or Decker for the Model I,
  // and the Model III table names it too (twelve of them entered from Decker's pages after a review; the Model III's are listed in its own block).
  const SHARED_ROM = [
    0x0000, 0x0008, 0x000b, 0x000d, 0x0010, 0x0013, 0x0018, 0x001b, 0x0020, 0x0028, 0x002b, 0x0030, 0x0033, 0x0038, 0x003b, 0x0040, 0x0049, 0x0060, 0x0066,
    0x012d, 0x0135, 0x0138, 0x0150, 0x01c9, 0x01f8, 0x0235, 0x0264, 0x0287, 0x0296, 0x0314, 0x032a, 0x033a, 0x0348, 0x0358, 0x0361, 0x0384, 0x038b, 0x0394,
    0x039c, 0x05d9, 0x07b2, 0x093e, 0x0a7f, 0x0a9a, 0x0af4, 0x0af6, 0x0e6c, 0x0faf, 0x1997, 0x19a2, 0x19ae, 0x1a19, 0x1af8, 0x1b2c, 0x1bb3, 0x1e4a, 0x1e5a,
    0x20f9, 0x20fe, 0x213f, 0x2169, 0x21c9, 0x2337, 0x260d, 0x28a7, 0x2b05, 0x2b75, 0x2bf5, 0x2c1f,
  ] as const;
  const SHARED_RAM = [0x400c, 0x4020, 0x4028, 0x4029] as const;
  // Addresses both tables enter for different things: the Model I routine differs from the Model III one, so the entries carry a note saying how. At 0212 the Model III
  // has only XOR A; RET (Decker p. 17: the routine "is not present in the Model III"), so the Model I's drive-select routine gets its own name.
  const DIFFERENT = [0x0050, 0x01d9, 0x0212, 0x03c2] as const;

  it('has at least 60 entries', () => {
    expect(rom.length).toBeGreaterThanOrEqual(60);
  });

  it('names each address of the asylum16 list that a Model I source documents, and not $0112, which is only text in the start-up banner', () => {
    const documented = [0x0000, 0x0008, 0x0010, 0x0020, 0x0030, 0x0038, 0x002b, 0x0033, 0x01f8, 0x0212, 0x0235, 0x0264, 0x0287, 0x0296, 0x093e, 0x1a19];
    for (const key of documented) expect(at(key), hex4(key)).toMatchObject({ kind: 'routine' });
    // Paay p. 5 puts the "RADIO SHACK LEVEL II BASIC" message at 0111 and Decker p. 80 lists 0112-0115 as part of its text: data, not a routine, so no entry.
    expect(at(0x0112)).toBeUndefined();
    expect(at(0x0111)).toBeUndefined();
  });

  it('names $KBWAIT at 0x0049, citing Paay p. 4 and Decker p. 13 for the Model I and the Model III manual where Tandy prints the name', () => {
    expect(at(0x0049)).toMatchObject({ name: '$KBWAIT', kind: 'routine', coined: false });
    expect(pages(at(0x0049), 'paay')).toEqual(['4']);
    expect(pages(at(0x0049), 'decker')).toEqual(['13']);
    expect(pages(at(0x0049), 'm3-basic')).toEqual(['12/12']);
  });

  it('has the eight RST vectors, 0x00 through 0x38, named as the Model III table names them', () => {
    for (const key of [0x00, 0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38]) {
      expect(at(key), `RST ${key.toString(16)}`).toMatchObject({ kind: 'routine', name: atModel3(key)?.name });
    }
  });

  it('takes the Model III name and kind at every address both machines document, so the comparison classes it shared', () => {
    for (const key of [...SHARED_ROM, ...SHARED_RAM]) {
      const entry = at(key);
      expect(entry, hex4(key)).toBeDefined();
      expect(entry?.name, hex4(key)).toBe(atModel3(key)?.name);
      expect(entry?.kind, hex4(key)).toBe(atModel3(key)?.kind);
      expect(entry?.coined, hex4(key)).toBe(atModel3(key)?.coined);
      expect(ROM_COMPARISON[hex4(key)], hex4(key)).toBe('shared');
      // Entered from the Model I sources, not copied from the Model III table.
      expect(entry?.purpose, hex4(key)).not.toBe(atModel3(key)?.purpose);
    }
  });

  it('classes as different, each with a note, the four addresses where the two ROMs hold different routines', () => {
    const different = Object.entries(ROM_COMPARISON).filter(([, cls]) => cls === 'different').map(([addr]) => addr);
    expect(different).toEqual(DIFFERENT.map(hex4));
    for (const key of DIFFERENT) expect(at(key)?.note, hex4(key)).toBeTruthy();
    expect(at(0x0050)).toMatchObject({ name: 'CTRLCHARTAB', kind: 'region', length: 16 });
    expect(at(0x0050)?.note).toContain('$RSRCV');
    expect(at(0x01d9)).toMatchObject({ name: 'CASBITOUT', kind: 'routine' });
    expect(at(0x01d9)?.note).toContain('$PRSCN');
    expect(at(0x03c2)).toMatchObject({ name: 'IODISPATCH', kind: 'routine' });
    expect(at(0x03c2)?.note).toContain('PRDRIVER');
    // 0212 selects the cassette drive and starts the motor on the Model I; the Model III table keeps its own name for the XOR A; RET stub.
    expect(at(0x0212)).toMatchObject({ name: 'CASDRVSEL', kind: 'routine', coined: true });
    expect(at(0x0212)?.note).toContain('XOR A');
    expect(atModel3(0x0212)).toMatchObject({ name: 'CASSELECT', kind: 'routine' });
  });

  it('lists $DELAY at 0060 as shared, with a note on the timing difference from Decker p. 53', () => {
    expect(ROM_COMPARISON['0060']).toBe('shared');
    expect(pages(at(0x0060), 'decker')).toContain('53');
    expect(at(0x0060)?.note).toMatch(/14\.66.*14\.80/);
    const row = buildSymbolOutputs(dataDir).comparison.split('\n').find((line) => line.startsWith('| `$0060` |'));
    expect(row).toMatch(/^\| `\$0060` \| shared \| `\$DELAY` \(routine\) \| `\$DELAY` \(routine\) \| Model I: .*14\.80/);
  });

  it('leaves no unexplained difference between the two ROM tables', () => {
    expect(compareRoms(rom, model3).unexplained).toEqual([]);
  });

  it('keeps cassette addresses that behave differently on the Model I in the Model I table with their own names and a note on the Model III', () => {
    // 0284 and 0293 select the drive first on the Model I (Decker p. 17); the Model III has only a jump to 0287 and 0243 there.
    expect(at(0x0284)).toMatchObject({ name: 'CSHWRSEL', kind: 'routine' });
    expect(at(0x0293)).toMatchObject({ name: 'CSHINSEL', kind: 'routine' });
    // 0287 and 0296 do not turn the motor on here, which the Model III's do.
    expect(at(0x0287)?.note).toContain('Model III');
    expect(at(0x0296)?.note).toContain('Model III');
    // The Model III keeps 0212 only as XOR A; RET.
    expect(at(0x0212)?.note).toContain('XOR A');
  });

  it('names the Model I drivers and printer status test at their own addresses, noting where the Model III keeps them', () => {
    expect(at(0x03e3)).toMatchObject({ name: 'KBDRIVER', kind: 'routine' });
    expect(at(0x0458)).toMatchObject({ name: 'VDDRIVER', kind: 'routine' });
    expect(at(0x058d)).toMatchObject({ name: 'PRDRIVER', kind: 'routine' });
    expect(at(0x05d1)).toMatchObject({ name: 'PRTTEST', kind: 'routine' });
    expect(at(0x03e3)?.note).toContain('3024');
    // Decker prints "3024H - Model III ROM Keyboard driver address" on p. 14, just after the footer of p. 13 where his Model I 03E3H line sits.
    expect(at(0x03e3)?.note).toContain('(decker 14)');
    expect(at(0x0458)?.note).toContain('0473');
    expect(at(0x058d)?.note).toContain('03C2');
    expect(at(0x05d1)?.note).toContain('044B');
  });

  it('enters the RST jump vectors at 4000H to 4012H as three-byte vectors, 4003H for RST 10H although Paay p. 24 misprints 4001', () => {
    const VECTORS: readonly (readonly [number, string])[] = [
      [0x4000, 'SYNCHKVEC'], [0x4003, 'NEXTCHARVEC'], [0x4006, 'CMPHLDEVEC'], [0x4009, 'TESTNTFVEC'], [0x400c, 'BREAKVEC'], [0x400f, 'DEBUGVEC'], [0x4012, 'INTVEC'],
    ];
    for (const [key, name] of VECTORS) expect(at(key), name).toMatchObject({ name, kind: 'vector', length: 3, coined: true });
    expect(at(0x4001)).toBeUndefined();
    expect(pages(at(0x4003), 'paay')).toEqual(['2']);
    expect(pages(at(0x4000), 'l2-1979')).toEqual(['D-1']);
  });

  it('enters the three device control blocks field by field, as Paay p. 25 and the Level II manual D-2 give them', () => {
    const FIELDS: readonly (readonly [number, string, number])[] = [
      [0x4015, 'KBDCB', 1], [0x4016, 'KBDRVADDR', 2], [0x401d, 'VDDCB', 1], [0x401e, 'VDDRVADDR', 2], [0x4020, 'CURADDR', 2],
      [0x4025, 'PRDCB', 1], [0x4026, 'PRDRVADDR', 2], [0x4028, 'PRTPAGELEN', 1], [0x4029, 'PRTLINECNT', 1],
    ];
    for (const [key, name, length] of FIELDS) {
      expect(at(key), name).toMatchObject({ name, kind: 'variable', length });
      expect(pages(at(key), 'paay'), name).toEqual(['25']);
      expect(pages(at(key), 'l2-1979'), name).toEqual(['D-2']);
    }
  });

  it('enters the reserved RAM of Paay pp. 26 to 28 that Decker pp. 64 to 71 confirm, as variables or vectors with their lengths', () => {
    const RAM: readonly (readonly [number, string, 'variable' | 'vector', number])[] = [
      [0x4036, 'KBROWS', 'variable', 7], [0x403d, 'PORTFFBITS', 'variable', 1], [0x408e, 'USRVEC', 'variable', 2], [0x4093, 'INPORT', 'vector', 3],
      [0x4096, 'OUTPORT', 'vector', 3], [0x4099, 'INKEYBUF', 'variable', 1], [0x409b, 'PRTCOLUMN', 'variable', 1], [0x409c, 'OUTDEVFLAG', 'variable', 1],
      [0x40a4, 'PROGSTART', 'variable', 2], [0x40a6, 'LINEPOS', 'variable', 1], [0x40a7, 'IOBUFPTR', 'variable', 2], [0x40af, 'NTF', 'variable', 1],
      [0x40b1, 'MEMTOP', 'variable', 2], [0x40f9, 'VARSTART', 'variable', 2], [0x40fb, 'ARRAYSTART', 'variable', 2], [0x40fd, 'FREESTART', 'variable', 2],
      [0x411d, 'ACC', 'variable', 8], [0x4127, 'AACC', 'variable', 8],
    ];
    for (const [key, name, kind, length] of RAM) {
      expect(at(key), name).toMatchObject({ name, kind, length, coined: true });
      expect(pages(at(key), 'paay').length, name).toBeGreaterThan(0);
      expect(pages(at(key), 'decker').length, name).toBeGreaterThan(0);
    }
    // The USR vector is where the Level II manual says to POKE 16526 and 16527 (page 8-8).
    expect(pages(at(0x408e), 'l2-1979')).toEqual(['8-8']);
    // Paay p. 26 calls 403D the print size flag; Decker p. 11 says it holds the bits last sent to port FFH. The entry records both.
    expect(at(0x403d)?.note).toContain('print size flag');
  });

  it('keeps clear of the DOS entry points that LDOS names, which stay in the DOS table: none of 402DH to 4035H, none from 4400H up', () => {
    const overlaps = (e: TableEntry, from: number, to: number): boolean => e.key < to && e.key + e.length > from;
    for (const e of rom) {
      expect(overlaps(e, 0x402d, 0x4036), `${e.name} at ${hex4(e.key)} overlaps 402DH-4035H (LDOS @EXIT, @ABORT, @DVRHK)`).toBe(false);
      expect(overlaps(e, 0x4400, 0x10000), `${e.name} at ${hex4(e.key)} reaches the LDOS entry points from 4400H`).toBe(false);
    }
    const set = selectSymbols({ machine: 1, dos: 'ldos' });
    expect(set.code(0x402d)?.name).toBe('@EXIT');
    expect(set.code(0x4030)?.name).toBe('@ABORT');
    expect(set.code(0x4400)?.name).toBe('@CMD');
  });

  it('keeps ROM entries below $4000 as routines, the one ROM data table as a region, and RAM entries from $4000 as variables or vectors', () => {
    for (const e of rom) {
      if (e.key >= 0x4000) expect(['variable', 'vector'], e.name).toContain(e.kind);
      else if (e.key === 0x0050) expect(e.kind, e.name).toBe('region');
      else expect(e.kind, e.name).toBe('routine');
    }
  });

  it('uses Tandy names, which start with $, only where the Model III manual prints them, and coins every other name', () => {
    for (const e of rom) expect(e.coined, e.name).toBe(!e.name.startsWith('$'));
    // Each Tandy name here is Tandy's at the same address in the Model III table, and cites the manual page the Model III entry cites for it.
    for (const e of rom.filter((x) => !x.coined)) {
      expect(atModel3(e.key)?.name, e.name).toBe(e.name);
      expect(pages(e, 'm3-basic'), e.name).toEqual(pages(atModel3(e.key), 'm3-basic'));
    }
    // Every Tandy name of the Model III ROM table has a Model I entry except the ones for routines the Model I lacks.
    const missing = model3.filter((e) => !e.coined && at(e.key)?.name !== e.name).map((e) => e.name);
    expect(missing).toEqual(['$RSRCV', '$RSTX', '$RSINIT', '$INITIO', '$ROUTE', '$PRSCN', '$VDLINE', '$KBBRK', '$CLKON', '$CLKOFF', '$DATE', '$TIME', '$SETCAS']);
  });

  it('cites Paay (printed pages 2 to 30), Decker (1 to 126), the Level II manual, and Tandy only for a Tandy name; never kiwisincebirth', () => {
    for (const e of rom) {
      expect(e.cite.some((c) => ['paay', 'decker', 'l2-1979'].includes(c.source)), `${e.name} cites no Model I source`).toBe(true);
      for (const c of e.cite) {
        expect(['paay', 'decker', 'l2-1979', 'm3-basic'], `${e.name} cites ${c.source}`).toContain(c.source);
        if (c.source === 'paay') expect(Number(c.page), `${e.name} cites paay ${c.page}`).toBeGreaterThanOrEqual(2);
        if (c.source === 'paay') expect(Number(c.page), `${e.name} cites paay ${c.page}`).toBeLessThanOrEqual(30);
        if (c.source === 'decker') expect(c.page, `${e.name} cites decker ${c.page}`).toMatch(/^[1-9]\d{0,2}$/);
        if (c.source === 'decker') expect(Number(c.page), `${e.name} cites decker ${c.page}`).toBeLessThanOrEqual(126);
        if (c.source === 'l2-1979') expect(['8-8', '8-9', 'D-1', 'D-2'], `${e.name} cites l2-1979 ${c.page}`).toContain(c.page);
        if (c.source === 'm3-basic') expect(e.name.startsWith('$'), `${e.name} cites the Model III manual but is not a Tandy name`).toBe(true);
      }
    }
    expect(rom.some((e) => e.cite.some((c) => c.source === 'kiwisincebirth'))).toBe(false);
  });

  it('cites Decker p. 121, his table of BASIC keyword entry points, for SET at 0135 and RESET at 0138, as well as Paay', () => {
    for (const key of [0x0135, 0x0138]) {
      expect(pages(at(key), 'paay'), hex4(key)).toEqual(['5']);
      expect(pages(at(key), 'decker'), hex4(key)).toEqual(['121']);
    }
  });

  it('notes on the SYSTEM routine at 02B5 that BASIC enters the command at 02B2 and that the Model III reverses two instructions at 02E2, so it stays Model I only', () => {
    // Decker p. 121 lists SYSTEM at 02B2H, which calls the DOS link at 41E2H and falls into 02B5H; p. 82 says the Model III has INC HL and JR NZ,02D1H
    // in the opposite order at 02E2H-02E4H, inside this routine, so the two ROMs do not hold the same code from 02B5H.
    expect(at(0x02b5)).toMatchObject({ name: 'BASICSYSTEM', kind: 'routine' });
    expect(at(0x02b5)?.note).toContain('02B2H');
    expect(at(0x02b5)?.note).toContain('02E2H');
    expect(ROM_COMPARISON['02B5']).toBe('model1-only');
  });

  it('cites the Level II manual p. 8-9 for the USR linkage: CALL 0A7FH to take the argument, JP 0A9AH to return a value', () => {
    expect(pages(at(0x0a7f), 'l2-1979')).toEqual(['8-9']);
    expect(pages(at(0x0a9a), 'l2-1979')).toEqual(['8-9']);
  });

  it('cites Decker on the printed page its text and footers give: 51 for the first two RSTs, 52 for the rest, 53 for $DELAY', () => {
    for (const key of [0x0008, 0x0010]) expect(pages(at(key), 'decker'), hex4(key)).toEqual(['51']);
    for (const key of [0x0018, 0x0020, 0x0028, 0x0030, 0x0038]) expect(pages(at(key), 'decker'), hex4(key)).toEqual(['52']);
    expect(pages(at(0x0060), 'decker')).toEqual(['53']);
    // Decker's "Page 65" footer is missing from its OCR; the 403DH entry sits between the "Page 64" and "Page 66" footers, on printed page 65.
    expect(pages(at(0x403d), 'decker')).toContain('65');
    // Decker's Model I bit list continues on p. 12, which is also where he says the Model III keeps its port ECH bits at 4210H.
    expect(pages(at(0x403d), 'decker')).toEqual(['11', '12', '65']);
    expect(at(0x403d)?.note).toContain('(decker 12)');
  });

  it('names the Model I ROM, RST vectors, and RAM it documents through selectSymbols, under both Model I DOS choices', () => {
    for (const dos of ['ldos', 'none'] as const) {
      const set = selectSymbols({ machine: 1, dos });
      expect(set.code(0x0049)?.name, dos).toBe('$KBWAIT');
      expect(set.code(0x0033)?.name, dos).toBe('$VDCHAR');
      expect(set.code(0x03e3)?.name, dos).toBe('KBDRIVER');
      expect(set.data(0x4017)).toMatchObject({ entry: { name: 'KBDRVADDR' }, offset: 1 });
      expect(set.data(0x40a5)).toMatchObject({ entry: { name: 'PROGSTART' }, offset: 1 });
      expect(set.data(0x4122)).toMatchObject({ entry: { name: 'ACC' }, offset: 5 });
    }
  });

  it('tags a Model I name with [Model I] only where the comparison does not class its address shared', () => {
    const set = selectSymbols({ machine: 1, dos: 'none' });
    expect(set.machineTag(at(0x0049)!)).toBeUndefined();
    expect(set.machineTag(at(0x0060)!)).toBeUndefined();
    expect(set.machineTag(at(0x01d9)!)).toBe('[Model I]');
    expect(set.machineTag(at(0x03e3)!)).toBe('[Model I]');
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
    // The edited copy swaps the whole Model I ROM file for this one entry.
    expect(r.entries).toBe(buildSymbolOutputs(dataDir).entries - TABLES['rom-model1'].length + 1);
  });
});
