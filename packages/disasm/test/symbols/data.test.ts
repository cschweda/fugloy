/** The committed symbol data must validate, and the committed generated files must be exactly what `pnpm symbols` writes. */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildSymbolOutputs } from '../../scripts/write-symbols.js';
import { SOURCES, TABLES } from '../../src/symbols/tables.generated.js';
import { TABLE_IDS } from '../../src/symbols/types.js';

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
