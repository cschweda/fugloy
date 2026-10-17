import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listingRows, openProgram, rowIndex } from '@fugloy/disasm';
import type { Row } from '@fugloy/disasm';
import { rowLookup } from '../app/utils/row-lookup';

const code = (addr: number, n: number): Row => ({ kind: 'code', addr, bytes: new Array<number>(n).fill(0), spans: [] });

describe('rowLookup', () => {
  const rows: Row[] = [
    { kind: 'header', text: '; x' },
    { kind: 'org', addr: 0x8000 },
    { kind: 'label', addr: 0x8000, name: 'START', user: false },
    code(0x8000, 3),
    code(0x8003, 1),
    { kind: 'data', addr: 0x8004, bytes: [1, 2, 3, 4], spans: [] },
    // A relocated piece: rows at runtime addresses below the ones before them.
    { kind: 'note', text: '; relocated', addr: 0x4000 },
    code(0x4000, 2),
    code(0x4002, 3),
  ];
  const find = rowLookup(rows);

  it('finds the label row of a row first address, as rowIndex does', () => {
    expect(find(0x8000)).toBe(2);
    expect(find(0x8000)).toBe(rowIndex(rows).get(0x8000));
  });

  it('finds the row of an address inside a 3-byte instruction', () => {
    expect(find(0x8001)).toBe(3);
    expect(find(0x8002)).toBe(3);
    expect(find(0x4003)).toBe(8);
    expect(find(0x4004)).toBe(8);
  });

  it('finds rows of relocated pieces, whose addresses run below earlier rows', () => {
    expect(find(0x4000)).toBe(7);
    expect(find(0x8006)).toBe(5);
  });

  it('falls back to the greatest indexed address below the target', () => {
    expect(find(0x4100)).toBe(8);
    expect(find(0x9000)).toBe(5);
  });

  it('gives null below every row', () => {
    expect(find(0x0100)).toBeNull();
    expect(rowLookup([])(0x4000)).toBeNull();
  });

  it('indexes basic rows by their address', () => {
    const bas = rowLookup([{ kind: 'header', text: '; b' }, { kind: 'basic', line: 10, addr: 0x6a00, text: 'CLS' }, { kind: 'basic', line: 20, addr: 0x6a08, text: 'END' }]);
    expect(bas(0x6a00)).toBe(1);
    expect(bas(0x6a05)).toBe(1);
    expect(bas(0x6a08)).toBe(2);
  });

  it('finds every address of a real program to a row that holds or precedes it', () => {
    const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL('../public/examples/sea-dragon/seadrg01.cmd', import.meta.url))));
    const all = listingRows(openProgram(bytes).analysis);
    const lookup = rowLookup(all);
    for (const [addr, i] of rowIndex(all)) expect(lookup(addr)).toBe(i);
    for (const [i, row] of all.entries()) {
      if (row.kind !== 'code' || row.bytes.length < 2) continue;
      expect(lookup(row.addr + 1)).toBe(i);
    }
  });
});
