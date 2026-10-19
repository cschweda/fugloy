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
import type { AsmResult } from '@fugloy/asm';
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
 * The source line that emitted code at `addr`, or null. With several, the one whose bytes
 * `bytesAt(addr, n)` holds (memory now, or a trace entry's bytes); null when none does.
 */
export function lineAt(result: AsmResult, addr: number, bytesAt: BytesAt): number | null {
  const at = result.sourceMap.linesOf(addr);
  if (at.length === 0) return null;
  if (at.length === 1) return at[0]!.line;
  for (const c of at) if (matches(c.bytes, bytesAt(addr, c.bytes.length))) return c.line;
  return null;
}

type Entry = { pc: number; bytes: number[] };
const entryLine = (result: AsmResult, e: Entry): number | null => lineAt(result, e.pc, (a) => (a === e.pc ? e.bytes : []));

/** Trail states whose deep search found no program line, so the next frame does not search again. */
const searchedEmpty = new WeakSet<TrailState>();

/** True when the CPU sits in a HALT (emu leaves PC just past it). Read through emu's escape hatch. */
export function isHalted(m: Machine): boolean {
  return m.system.cpu.halted === true;
}

/** The running line and its trail now; `prev` is the last frame's state, for `out`. */
export function trailOf(m: Machine, result: AsmResult, prev?: TrailState): TrailState {
  const regs = m.cpu.regs;
  const pc = isHalted(m) ? (regs.pc - 1) & 0xffff : regs.pc;
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
