/**
 * Where the program uses a name: the rows whose link spans point at it, and the
 * callers and jumpers the analysis recorded. A port, a service call and an
 * address are different things that may share a number, so a use names its kind.
 */
import type { Analysis, Row, Span } from '@fugloy/disasm';

export type UseKind = 'addr' | 'port' | 'svc';
export interface UseTarget {
  kind: UseKind;
  key: number;
  /** Bytes an address entry covers from `key`; a use of any of them counts. Default 1. */
  length?: number;
}
export interface Use {
  addr: number;
  text: string;
}

/** What a link span points at: a port or service call when its table entry says so, otherwise an address. */
export function spanUseKind(span: Span): UseKind {
  const k = span.entry?.kind;
  return k === 'port' || k === 'svc' ? k : 'addr';
}

/** Rows (in listing order) with a link span for `target`, each once, with the row's text. */
export function usesOf(_analysis: Analysis, rows: readonly Row[], target: UseTarget): Use[] {
  const out: Use[] = [];
  for (const row of rows) {
    if (row.kind !== 'code' && row.kind !== 'data') continue;
    const hit = row.spans.some((s) => (s.kind === 'label' || s.kind === 'table') && s.target !== undefined && s.target >= target.key && s.target < target.key + (target.length ?? 1) && spanUseKind(s) === target.kind);
    if (hit) out.push({ addr: row.addr, text: row.spans.map((s) => s.text).join('') });
  }
  return out;
}

/** The instructions that call and that jump to `addr` (RST counts as a call), each address once, ascending. */
export function callersOf(analysis: Analysis, addr: number): { callers: number[]; jumpers: number[] } {
  const callers = new Set<number>();
  const jumpers = new Set<number>();
  for (const x of analysis.pass1.xrefs) {
    if (x.to !== addr) continue;
    (x.kind === 'call' || x.kind === 'ccall' || x.kind === 'rst' ? callers : jumpers).add(x.from);
  }
  const asc = (s: Set<number>): number[] => [...s].sort((a, b) => a - b);
  return { callers: asc(callers), jumpers: asc(jumpers) };
}

/** What kind of span was followed: a program label, or a table name (ROM, hardware, DOS) with its table and key. */
export interface FollowInfo {
  span: 'label' | 'table';
  use: 'addr' | 'port' | 'svc';
  table?: string;
  key?: number;
}
