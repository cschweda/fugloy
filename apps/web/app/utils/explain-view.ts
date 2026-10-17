// The Explain tab's cache and helpers. The engine (@fugloy/disasm's explain)
// keeps its own indexes per analysis; this keeps each finished explanation per
// session and address, and each routine summary per session and routine start,
// so stepping back and forth through lines costs a map lookup. A new session
// (a hint edit, another symbol table) gets fresh entries: its analysis differs.
import { explainLine, explainRow, summarizeRoutine } from '@fugloy/disasm';
import type { Details, Explanation, Row, RoutineSummary, Session } from '@fugloy/disasm';

const lines = new WeakMap<Session, Map<number, Explanation>>();
/** Rows that are not lines of the program (ORG, notes, header), by kind, address and text. */
const others = new WeakMap<Session, Map<string, Explanation>>();
/** Summaries by routine start, and the start each asked-for address belongs to (null: no routine reaches it). */
const summaries = new WeakMap<Session, { byStart: Map<number, RoutineSummary>; startOf: Map<number, number | null> }>();

function mapOf<K, V>(m: WeakMap<Session, Map<K, V>>, s: Session): Map<K, V> {
  let hit = m.get(s);
  if (hit === undefined) {
    hit = new Map();
    m.set(s, hit);
  }
  return hit;
}

/** The explanation of the line at `addr`, cached per session and address. */
export function explainAt(s: Session, addr: number): Explanation {
  const cache = mapOf(lines, s);
  let e = cache.get(addr);
  if (e === undefined) {
    e = explainLine(s, addr);
    cache.set(addr, e);
  }
  return e;
}

/** The explanation of a listing row: a line of the program through explainAt, any other row by its own kind. */
export function explainRowAt(s: Session, row: Row): Explanation {
  if (row.kind === 'code' || row.kind === 'data' || row.kind === 'label' || row.kind === 'basic') return explainAt(s, row.addr);
  const key = `${row.kind}:${'addr' in row ? row.addr : ''}:${'text' in row ? row.text : ''}`;
  const cache = mapOf(others, s);
  let e = cache.get(key);
  if (e === undefined) {
    e = explainRow(s, row);
    cache.set(key, e);
  }
  return e;
}

/** The summary of the routine around `addr`, cached per session and routine start; null when no routine reaches it. */
export function summaryAt(s: Session, addr: number): RoutineSummary | null {
  let c = summaries.get(s);
  if (c === undefined) {
    c = { byStart: new Map(), startOf: new Map() };
    summaries.set(s, c);
  }
  if (c.startOf.has(addr)) {
    const start = c.startOf.get(addr)!;
    return start === null ? null : c.byStart.get(start)!;
  }
  const r = summarizeRoutine(s, addr);
  if (r === null) {
    c.startOf.set(addr, null);
    return null;
  }
  const kept = c.byStart.get(r.start) ?? r;
  c.byStart.set(r.start, kept);
  c.startOf.set(addr, r.start);
  return kept;
}

/**
 * Builds the engine's routine index for a session in idle time, by summarizing
 * the routine at `addr` (the entry), so the first step with Explain open does
 * not pay for it. Returns a function that cancels it if it has not run.
 */
export function warmExplain(s: Session, addr: number, done?: () => void): () => void {
  const run = (): void => {
    summaryAt(s, addr);
    done?.();
  };
  const g = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (typeof g.requestIdleCallback === 'function' && typeof g.cancelIdleCallback === 'function') {
    const id = g.requestIdleCallback(run, { timeout: 2000 });
    return () => g.cancelIdleCallback!(id);
  }
  const id = setTimeout(run, 0);
  return () => clearTimeout(id);
}

/** The details strip as one quiet line: size, T-states (both when conditional), the flags it changes, and "undocumented". */
export function detailsText(d: Details): string {
  const parts = [d.bytes === 1 ? '1 byte' : `${d.bytes} bytes`];
  parts.push(d.cyclesNotTaken === undefined ? `${d.cycles} T-states` : `${d.cycles} or ${d.cyclesNotTaken} T-states`);
  parts.push(d.flags === '' ? 'flags unchanged' : `changes ${d.flags.split('').join(' ')}`);
  if (!d.documented) parts.push('undocumented');
  return parts.join(' · ');
}

/** The most bytes a region picture draws (16K). */
export const PICTURE_MAX = 0x4000;

/** The bytes a region picture draws, from the runtime image (where relocated code runs), at most PICTURE_MAX. */
export function pictureBytes(s: Session, region: { start: number; end: number }): Uint8Array {
  const end = Math.min(region.end, region.start + PICTURE_MAX - 1);
  return s.analysis.space.image.bytes.slice(region.start, end + 1);
}
