// The running line (phase 5C Ruling 2): the source line at PC and the trail of lines just run, read
// from emu's trace once a frame. DOM-free; the editor and the listing turn the marks into styles.
//
// - `now` is the line at PC. Where several lines share the address (a block copied over its own
//   code, or an ORG back over earlier bytes), it is the one whose bytes are in memory now.
// - `trail` is up to TRAIL_LINES more distinct program lines, newest first, from the newest
//   TRAIL_WINDOW trace entries. Each entry's line is the candidate matching the entry's own bytes.
// - `out`: when PC is outside the program and the window holds none of its lines (a ROM routine
//   that loops), the newest program line in the whole trace, searched for once with escalating
//   windows and then kept, frame after frame, until program lines come back. A search that found
//   nothing is not repeated either.
import type { AsmResult, LineAt } from '@fugloy/asm';
import type { Machine } from '@fugloy/emu';
import { TRACE_DEPTH } from './runner';

export interface TrailState {
  now: number | null;
  trail: number[];
  out: number | null;
}

export type MarkMode = 'running' | 'paused' | 'stopped';
export interface LineMark {
  line: number;
  class: string;
}

/** Trace entries read each frame. */
export const TRAIL_WINDOW = 256;
/** Trail lines after `now`. */
export const TRAIL_LINES = 5;
/** The deep search's windows, after the frame's own TRAIL_WINDOW. */
const DEEP_WINDOWS = [4096, TRACE_DEPTH];

type BytesAt = (a: number, n: number) => ArrayLike<number>;

/** True when `got` starts with `want`'s bytes, over as many as both have (at least one). */
function matches(want: readonly number[], got: ArrayLike<number>): boolean {
  const n = Math.min(want.length, got.length);
  if (n === 0) return false;
  for (let k = 0; k < n; k++) if (want[k] !== got[k]) return false;
  return true;
}

/**
 * `linesOf` per address, for each Run's result (its source map never changes): the line when one
 * line emitted code there, null for none, and the candidates when several did. `linesOf` maps and
 * slices on every call, so a frame's lookups become Map gets, and only shared addresses compare bytes.
 */
const linesMemo = new WeakMap<AsmResult, Map<number, number | null | LineAt[]>>();

function candidates(result: AsmResult, addr: number): number | null | LineAt[] {
  let memo = linesMemo.get(result);
  if (memo === undefined) linesMemo.set(result, (memo = new Map()));
  let hit = memo.get(addr);
  if (hit === undefined) {
    const at = result.sourceMap.linesOf(addr);
    hit = at.length === 0 ? null : at.length === 1 ? at[0]!.line : at;
    memo.set(addr, hit);
  }
  return hit;
}

/**
 * The source line that emitted code at `addr`, or null. With several, the one whose bytes
 * `bytesAt(addr, n)` holds (memory now, or a trace entry's bytes); null when none does.
 */
export function lineAt(result: AsmResult, addr: number, bytesAt: BytesAt): number | null {
  const at = candidates(result, addr);
  if (at === null || typeof at === 'number') return at;
  for (const c of at) if (matches(c.bytes, bytesAt(addr, c.bytes.length))) return c.line;
  return null;
}

type Entry = { pc: number; bytes: number[] };
const entryLine = (result: AsmResult, e: Entry): number | null => lineAt(result, e.pc, (a) => (a === e.pc ? e.bytes : []));

/** Trail states whose deep search found no program line, so the next frame does not search again. */
const searchedEmpty = new WeakSet<TrailState>();

/** The running line and its trail now; `prev` is the last frame's state, for `out`. */
export function trailOf(m: Machine, result: AsmResult, prev?: TrailState): TrailState {
  const regs = m.cpu.regs;
  // emu leaves PC just past a HALT it sits in; the HALT is the running line.
  const pc = m.cpu.halted ? (regs.pc - 1) & 0xffff : regs.pc;
  const now = lineAt(result, pc, (a, n) => m.mem.read(a, n));
  const entries = m.debug.trace.last(TRAIL_WINDOW);
  const trail: number[] = [];
  for (let i = entries.length - 1; i >= 0 && trail.length < TRAIL_LINES; i--) {
    const line = entryLine(result, entries[i]!);
    if (line !== null && line !== now && !trail.includes(line)) trail.push(line);
  }
  if (now !== null || trail.length > 0) return { now, trail, out: null };
  // Outside the program, with none of its lines in the window: keep what the last frame found.
  if (prev !== undefined && prev.now === null && prev.trail.length === 0 && (prev.out !== null || searchedEmpty.has(prev))) {
    const kept: TrailState = { now: null, trail: [], out: prev.out };
    if (prev.out === null) searchedEmpty.add(kept);
    return kept;
  }
  let out: number | null = null;
  let checked = entries.length; // the newest entries, already read above
  for (const n of DEEP_WINDOWS) {
    if (checked < TRAIL_WINDOW) break; // the trace holds no more
    const deep = m.debug.trace.last(n);
    for (let i = deep.length - 1 - checked; i >= 0 && out === null; i--) out = entryLine(result, deep[i]!);
    if (out !== null || deep.length < n) break;
    checked = deep.length;
  }
  const state: TrailState = { now: null, trail: [], out };
  if (out === null) searchedEmpty.add(state);
  return state;
}

/**
 * The marks for a state, in line order. Running: `fg-run-now` and `fg-run-trail-1` to `-5`.
 * Paused: `fg-run-paused`, with the faint trail kept. Stopped: `fg-run-stopped` on `now` alone.
 * `fg-run-out` marks the calling line while PC is in the ROM. Reduced motion drops the trail.
 */
export function lineMarks(t: TrailState, mode: MarkMode, reduced: boolean): LineMark[] {
  const marks: LineMark[] = [];
  if (mode === 'stopped') {
    if (t.now !== null) marks.push({ line: t.now, class: 'fg-run-stopped' });
    return marks;
  }
  if (t.now !== null) marks.push({ line: t.now, class: mode === 'paused' ? 'fg-run-paused' : 'fg-run-now' });
  if (t.out !== null) marks.push({ line: t.out, class: 'fg-run-out' });
  if (!reduced) t.trail.forEach((line, k) => marks.push({ line, class: `fg-run-trail-${k + 1}` }));
  return marks.sort((a, b) => a.line - b.line);
}

/** A string that changes exactly when the set of marks does: `line:class,…`. */
export function marksKey(marks: readonly LineMark[]): string {
  let key = '';
  for (const mk of marks) key += `${key === '' ? '' : ','}${mk.line}:${mk.class}`;
  return key;
}

/** What listingFollows reads of a listing's session: its loaded bytes and their bitmap. */
export interface ListingImage {
  module: { image: { bytes: Uint8Array; loaded: Uint8Array } };
}

/**
 * Whether a listing shows the program a Run is running (Ruling 6): it is the running source's own
 * listing (`origin.sourceId`), or its loaded bytes equal the Run's on every byte asm loaded (Open as
 * source). A 64K compare: the caller runs it once per (session, Run) pair.
 */
export function listingFollows(session: ListingImage | null, result: AsmResult, sourceId: string, origin: { kind: 'source'; sourceId: string } | null): boolean {
  if (session === null) return false;
  if (origin !== null) return origin.sourceId === sourceId;
  const want = result.image;
  if (want === null) return false;
  const { bytes, loaded } = session.module.image;
  let any = false;
  for (let a = 0; a < 0x10000; a++) {
    if (want.loaded[a] === 0) continue;
    if (loaded[a] === 0 || bytes[a] !== want.bytes[a]) return false;
    any = true;
  }
  // An image with no bytes would match any listing.
  return any;
}
