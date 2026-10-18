/** The listing's rows as the Explain tab reads them: built once per analysis, and found by address. */
import { listingRows, rowIndex } from '../rows.js';
import type { Row } from '../rows.js';
import type { Analysis } from '../pipeline.js';

export type ListRow = Extract<Row, { kind: 'code' | 'data' }>;

export interface Rows {
  rows: Row[];
  index: Map<number, number>;
}

const rowCache = new WeakMap<Analysis, Rows>();

/** The listing's rows, built once per analysis. */
export function rowsOf(a: Analysis): Rows {
  let hit = rowCache.get(a);
  if (hit === undefined) {
    const rows = listingRows(a);
    hit = { rows, index: rowIndex(rows) };
    rowCache.set(a, hit);
  }
  return hit;
}

/** The index of the code or data row that covers `addr`, or undefined. */
export function rowAt(r: Rows, addr: number): number | undefined {
  for (let back = 0; back < 4; back++) {
    const start = (addr - back) & 0xffff;
    let i = r.index.get(start);
    if (i === undefined) continue;
    while (i < r.rows.length && r.rows[i]!.kind !== 'code' && r.rows[i]!.kind !== 'data') i++;
    const row = r.rows[i] as ListRow | undefined;
    if (row === undefined || row.addr !== start) continue;
    if (addr - start < row.bytes.length) return i;
  }
  return undefined;
}

/** The text column of the row that covers `addr` (`LD HL,DATA_7399`), or undefined. */
export function rowText(a: Analysis, addr: number): string | undefined {
  const r = rowsOf(a);
  const i = rowAt(r, addr);
  return i === undefined ? undefined : (r.rows[i] as ListRow).spans.map((s) => s.text).join('');
}
