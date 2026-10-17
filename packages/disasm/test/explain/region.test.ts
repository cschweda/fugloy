/** The Explain tab's data regions: extent, users, pointer variables, the loops that read them, and the block-graphics cells. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { blockCells, dataRegion, explainLine, sentenceText, trsGlyph } from '../../src/explain/index.js';
import type { DataRegion } from '../../src/explain/index.js';
import { openProgram, skeletonHints, withHintFile, withHintText } from '../../src/session.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const sea = withHintText(
  openProgram(new Uint8Array(readFileSync(`${root}examples/sea-dragon/seadrg01.cmd`)), { name: 'seadrg01.cmd', selection: { machine: 3, dos: 'trsdos' } }),
  readFileSync(`${root}examples/sea-dragon/seadrg01.hints`, 'utf8'),
  'seadrg01.hints',
);
const BASE = 0x7000;
const raw = (bytes: number[]) => openProgram(new Uint8Array(bytes), { base: BASE, selection: { machine: 3, dos: 'trsdos' } });
const text = (r: DataRegion): string[] => r.sentences.map(sentenceText);
const must = (r: DataRegion | null): DataRegion => {
  expect(r).not.toBeNull();
  return r!;
};

describe('dataRegion on Sea Dragon (seadrg01.hints)', () => {
  const r = must(dataRegion(sea, 0x7dd5));

  it('$7DD5 belongs to DATA_7399, $7399-$7FFF (file $7C1A-$8880, run at $497F on)', () => {
    expect(r).toMatchObject({ start: 0x7399, end: 0x7fff, name: 'DATA_7399' });
    expect(text(r)[0]).toBe('This row is part of DATA_7399, 3,175 bytes of data from $7399 to $7FFF.');
  });

  it('its users are the two loads of its address', () => {
    expect(r.users).toEqual([
      { addr: 0x4c42, text: 'LD HL,DATA_7399' },
      { addr: 0x5fb6, text: 'LD HL,DATA_7399' },
    ]);
  });

  it('the address is kept in DATA_624A, stored at $4C45 and read back at $4F0C', () => {
    expect(r.pointers).toEqual([{ variable: 0x624a, name: 'DATA_624A', storedAt: 0x4c45, readers: [0x4f0c] }]);
    expect(text(r).join(' ')).toContain('kept in DATA_624A');
  });

  it('the loop at L5FB9 reads it forward, and AND 0F0H at $5FC5 splits off bytes $00-$0F', () => {
    expect(r.readers).toHaveLength(1);
    const loop = r.readers[0]!;
    expect(loop.loop).toBe(0x5fb9);
    expect(loop.step).toBe(1);
    const and = loop.splits.find((s) => s.at === 0x5fc5);
    expect(and?.text).toContain('AND 0F0H');
    expect(and?.text).toBe('bytes $00–$0F are treated differently (AND 0F0H at $5FC5)');
    // A = (HL) AND $0F, both below $80, so JP P after CP 04H is a proven "at least $04".
    expect(loop.splits.find((s) => s.at === 0x5fcd)?.text).toBe('bytes whose low four bits are below $04 are treated differently from the rest (CP 04H at $5FCD)');
    expect(text(r).join(' ')).toContain('stepping forward');
  });

  it('explainLine sets region on a data row and leaves code rows without one', () => {
    expect(explainLine(sea, 0x7dd5).region?.start).toBe(0x7399);
    expect(explainLine(sea, 0x5fb6).region).toBeUndefined();
  });

  it('code and unloaded addresses have no region', () => {
    expect(dataRegion(sea, 0x5fb6)).toBeNull();
    expect(dataRegion(sea, 0x0100)).toBeNull();
  });
});

describe('dataRegion on synthetic programs', () => {
  it('unreferenced-region: no users, and says no instruction refers to it by address', () => {
    // 7000 RET; 7001-7003 bytes nothing refers to.
    const r = must(dataRegion(raw([0xc9, 0x01, 0x02, 0x03]), 0x7002));
    expect(r).toMatchObject({ start: 0x7001, end: 0x7003, name: '$7001', users: [], pointers: [], readers: [] });
    expect(text(r).join(' ')).toMatch(/No instruction refers to it by address/);
  });

  it('a DW word pointing into the region is a user', () => {
    // 7000 LD HL,(7004H); 7003 RET; 7004 DW TILES (declared words); 7006 TILES: two bytes.
    const bytes = new Uint8Array([0x2a, 0x04, 0x70, 0xc9, 0x06, 0x70, 0xaa, 0xbb]);
    const s0 = raw([...bytes]);
    const hints = [
      { directive: 'words' as const, length: 2, block: 0, offset: 4, line: 1 },
      { directive: 'name' as const, name: 'TILES', block: 0, offset: 6, line: 2 },
    ];
    const r = must(dataRegion(withHintFile(s0, { ...skeletonHints(s0.module, bytes), hints }), 0x7007));
    expect(r).toMatchObject({ start: 0x7006, end: 0x7007, name: 'TILES' });
    expect(r.users).toEqual([{ addr: 0x7004, text: 'DW TILES' }]);
  });

  it('an instruction the program rewrites is not a user; its operand is only where it starts', () => {
    // 7000 LD HL,7007H, with a label at $7001 made by 7003 LD (7001H),A; 7006 RET; 7007-7008 data.
    const r = must(dataRegion(raw([0x21, 0x07, 0x70, 0x32, 0x01, 0x70, 0xc9, 0xaa, 0xbb]), 0x7008));
    expect(r.users).toEqual([]);
    const t = text(r).join(' ');
    expect(t).not.toMatch(/No instruction refers to it by address/);
    expect(t).toMatch(/rewrites/);
  });
});

describe('the TRS-80 character cells', () => {
  it('blockCells: bit i lights sub-cell i, row-major from the top left', () => {
    expect(blockCells(0x80)).toEqual([false, false, false, false, false, false]);
    expect(blockCells(0xbf)).toEqual([true, true, true, true, true, true]);
    expect(blockCells(0x81)).toEqual([true, false, false, false, false, false]);
    expect(blockCells(0xa0)).toEqual([false, false, false, false, false, true]);
  });

  it('trsGlyph: text for $20-$7F, blocks for $80-$BF, a dot otherwise', () => {
    expect(trsGlyph(0x41)).toEqual({ kind: 'text', char: 'A' });
    expect(trsGlyph(0x85).kind).toBe('block');
    expect(trsGlyph(0x05)).toEqual({ kind: 'other' });
    expect(trsGlyph(0xc0)).toEqual({ kind: 'other' });
  });
});
