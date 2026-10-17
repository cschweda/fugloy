/**
 * Address to listing row, for any address. `rowIndex` keys only each row's first
 * address; this finds the row whose bytes hold the address, and otherwise the row
 * at the greatest indexed address below it. Built from its own sorted array,
 * because a relocated piece lists at runtime addresses below the rows before it.
 */
import type { Row } from '@fugloy/disasm';

interface Entry {
  start: number;
  /** Last address the row holds. */
  end: number;
  index: number;
}

/** The longest row: a 4-byte instruction or a data row of up to four bytes. */
const LONGEST = 4;

/** A function from an address to the index of its row, or null when every row lies above it. */
export function rowLookup(rows: readonly Row[]): (addr: number) => number | null {
  const entries: Entry[] = [];
  rows.forEach((row, index) => {
    if (row.kind === 'code' || row.kind === 'data') entries.push({ start: row.addr, end: row.addr + Math.max(row.bytes.length, 1) - 1, index });
    else if (row.kind === 'label' || row.kind === 'basic') entries.push({ start: row.addr, end: row.addr, index });
  });
  // By address, then by row order: the first row at an address (a label before its instruction) wins, as in rowIndex.
  entries.sort((a, b) => a.start - b.start || a.index - b.index);

  /** Position of the first entry whose start is greater than addr. */
  const upper = (addr: number): number => {
    let lo = 0;
    let hi = entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (entries[mid]!.start <= addr) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  /** The first entry (lowest row index) that starts at `start`, found from any position holding that start. */
  const firstAt = (pos: number): Entry => {
    while (pos > 0 && entries[pos - 1]!.start === entries[pos]!.start) pos--;
    return entries[pos]!;
  };

  return (addr) => {
    const after = upper(addr);
    if (after === 0) return null;
    const below = after - 1;
    if (entries[below]!.start === addr) return firstAt(below).index;
    // Inside a row: only rows starting within LONGEST bytes below can hold it.
    for (let pos = below; pos >= 0 && entries[pos]!.start > addr - LONGEST; pos--) {
      if (entries[pos]!.end >= addr) return entries[pos]!.index;
    }
    return firstAt(below).index;
  };
}
