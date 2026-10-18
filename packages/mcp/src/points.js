/**
 * Shared words for the debugging tools: how breakpoints and watches are named in results and
 * refusals, and which routine an address lies in (the nearest call target at or below it).
 */
import { COVERAGE } from '@fugloy/emu';
import { hex4 } from './args.js';

/** How far below an address `routineOf` looks for a call target. */
export const ROUTINE_REACH = 256;

/** `3C00h–3FFFh`, or `3C05h` for one byte. */
export const watchSpan = (/** @type {{ addr: number, len: number }} */ w) =>
  w.len === 1 ? hex4(w.addr) : `${hex4(w.addr)}–${hex4((w.addr + w.len - 1) & 0xffff)}`;

/** `the breakpoints are #1 at 7030h, #2 at 7033h` or `no breakpoints are set`. */
export function breakList(/** @type {import('@fugloy/emu').Machine} */ m) {
  const all = m.debug.breaks;
  return all.length === 0 ? 'no breakpoints are set' : `the breakpoints are ${all.map((b) => `#${b.id} at ${hex4(b.addr)}`).join(', ')}`;
}

/** `the watches are #1 on 3C00h–3FFFh` or `no watches are set`. */
export function watchList(/** @type {import('@fugloy/emu').Machine} */ m) {
  const all = m.debug.watches;
  return all.length === 0 ? 'no watches are set' : `the watches are ${all.map((w) => `#${w.id} on ${watchSpan(w)}`).join(', ')}`;
}

/**
 * The nearest address at or below `addr`, within `ROUTINE_REACH` bytes, that a CALL or RST has
 * landed on since load (coverage's CALL_TARGET): a heuristic for the routine `addr` is in.
 * @param {import('@fugloy/emu').Machine} m
 * @param {number} addr
 * @returns {number | null}
 */
export function routineOf(m, addr) {
  const bits = m.debug.coverage.bits;
  for (let k = 0; k < ROUTINE_REACH && addr - k >= 0; k++) if (bits[addr - k] & COVERAGE.CALL_TARGET) return addr - k;
  return null;
}
