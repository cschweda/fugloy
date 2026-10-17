/**
 * What the editing keys act on, worked out from the rows and the session: the
 * range C/D/W/S/T mark, the addresses N and ; can name, the row ↑ and ↓ move
 * to, and the link Enter follows. Pure.
 */
import { addressKey, dataReference, targetOf } from '@fugloy/disasm';
import type { Row, Session } from '@fugloy/disasm';
import { isFollowable } from './row-classes';
import { cursorRowIndex, rowLookup } from './row-lookup';
import { spanUseKind } from './xrefs';
import type { FollowInfo } from './xrefs';

/** The address of the next (`dir` 1) or previous (-1) row the cursor can stand on (code, data, BASIC); the first one when there is no cursor; null at either end. */
export function stepCursor(rows: readonly Row[], cursor: number | null, dir: 1 | -1): number | null {
  const at = cursorRowIndex(rows, rowLookup(rows), cursor);
  const start = at === null ? (dir === 1 ? 0 : rows.length - 1) : at + dir;
  for (let i = start; i >= 0 && i < rows.length; i += dir) {
    const row = rows[i]!;
    if ((row.kind === 'code' || row.kind === 'data' || row.kind === 'basic') && row.addr !== cursor) return row.addr;
  }
  return null;
}

/** Last address a row holds. */
function rowEnd(rows: readonly Row[], addr: number): number {
  const row = rows[cursorRowIndex(rows, rowLookup(rows), addr) ?? -1];
  return row !== undefined && (row.kind === 'code' || row.kind === 'data') && row.addr === addr ? addr + Math.max(row.bytes.length, 1) - 1 : addr;
}

/** The bytes a mark covers: the selection's rows (or the cursor's row), from the first one's first byte through the last one's last. */
export function markRange(rows: readonly Row[], cursor: number | null, selection: { from: number; to: number } | null): { from: number; to: number } | null {
  if (selection !== null) return { from: selection.from, to: rowEnd(rows, selection.to) };
  return cursor === null ? null : { from: cursor, to: rowEnd(rows, cursor) };
}

export interface EditTarget {
  addr: number;
  /** `this row`, or `operand` for an address outside the program the row names. */
  what: 'row' | 'operand';
}

/** What N and ; can name from a row: the row's own address, then each address outside the program its instruction names. */
export function editTargets(s: Session, addr: number): EditTarget[] {
  const out: EditTarget[] = [{ addr, what: 'row' }];
  const ins = s.analysis.pass1.instructions.get(addr);
  if (ins === undefined) return out;
  for (const t of [dataReference(ins), targetOf(ins)]) {
    if (t === null || out.some((o) => o.addr === t)) continue;
    if (addressKey(s, t) === null && !s.module.image.isLoaded(t)) out.push({ addr: t, what: 'operand' });
  }
  return out;
}

/** The first link on a row, as a click on it would follow it. */
export function followOf(row: Row): { target: number; info: FollowInfo } | null {
  if (row.kind !== 'code' && row.kind !== 'data') return null;
  const span = row.spans.find(isFollowable);
  if (span === undefined) return null;
  const info: FollowInfo = { span: span.kind === 'table' ? 'table' : 'label', use: spanUseKind(span) };
  if (span.entry !== undefined) Object.assign(info, { table: span.entry.table, key: span.entry.key });
  return { target: span.target, info };
}
