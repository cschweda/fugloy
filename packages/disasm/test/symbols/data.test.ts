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
