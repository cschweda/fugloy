/**
 * What `suggest` says about a routine (Ruling 4). While coverage is on (from the load, Ruling 3)
 * the memory and port hooks record, per instruction address, whether the instruction wrote video
 * RAM ($3C00–$3FFF), read the keyboard ($3800–$3BFF), or wrote port $FF (sound). A call target
 * is credited with the facts of the executed instructions from the target to its routine's end
 * (`routineEnd`). Facts are attributed by address, so code shared by two routines, or a routine
 * that jumps elsewhere, is credited by where the bytes are, not by who ran them: a heuristic.
 */
import { COVERAGE } from '@fugloy/emu';

export const FACT = /** @type {const} */ ({ VIDEO: 1, KEYBOARD: 2, SOUND: 4 });

/** How far past a call target `routineEnd` looks, in bytes (Ruling 4). */
export const ROUTINE_SPAN = 256;

/** A loop body taken this many times per call, on average, earns "loops ≥ 1000× a call". */
export const LONG_LOOP = 1000;

/**
 * Install the hooks that record the facts into `facts` (65,536 bytes, one per instruction
 * address). The hooks see every data access, so each does one comparison and returns.
 * @param {import('@fugloy/emu').Machine} m
 * @param {Uint8Array} facts
 */
export function recordFacts(m, facts) {
  m.debug.hooks.onMemWrite = (addr, _value, _prev, pc) => {
    if ((addr & 0xfc00) === 0x3c00) facts[pc] |= FACT.VIDEO;
  };
  m.debug.hooks.onMemRead = (addr, _value, pc) => {
    if ((addr & 0xfc00) === 0x3800) facts[pc] |= FACT.KEYBOARD;
  };
  m.debug.hooks.onPort = (port, _value, dir, pc) => {
    if (dir === 'out' && (port & 0xff) === 0xff) facts[pc] |= FACT.SOUND;
  };
}

/**
 * Whether the instruction at `addr` always returns: RET, RETN, or RETI (a conditional RET ends
 * only one path, so the routine goes on past it).
 * @param {import('@fugloy/emu').Machine} m
 * @param {number} addr
 */
function alwaysReturns(m, addr) {
  const [op, next] = m.mem.read(addr, 2);
  return op === 0xc9 || (op === 0xed && (next & 0xc7) === 0x45);
}

/**
 * The last byte of the routine called at `target`: from the target, through bytes executed as
 * instructions or their operands, up to and including the first executed RET, RETN, or RETI;
 * it ends early before a byte never executed, at another call target, or after `ROUTINE_SPAN`
 * bytes. (Ruling 4 says "its first executed RET-family instruction"; a conditional RET is not
 * taken as the end, since a print loop's `RET Z` usually comes before the work.)
 * @param {import('@fugloy/emu').Machine} m
 * @param {number} target
 * @returns {number}
 */
export function routineEnd(m, target) {
  const bits = m.debug.coverage.bits;
  let end = target;
  for (let k = 0; k < ROUTINE_SPAN && target + k <= 0xffff; k++) {
    const a = target + k;
    if (!(bits[a] & (COVERAGE.EXEC | COVERAGE.OPERAND))) break;
    if (k > 0 && bits[a] & COVERAGE.CALL_TARGET) break;
    end = a;
    if (bits[a] & COVERAGE.EXEC && alwaysReturns(m, a)) break;
  }
  return end;
}

/**
 * The notes for the routine called at `target`, `calls` times: the facts its instructions
 * recorded, then a long loop when its backward jumps were taken at least `LONG_LOOP` times a call.
 * @param {import('@fugloy/emu').Machine} m
 * @param {Uint8Array} facts
 * @param {number} target
 * @param {number} calls
 * @param {Map<number, { from: number, kind: string, count: number }[]>} callerMap
 * @returns {string[]}
 */
export function routineNotes(m, facts, target, calls, callerMap) {
  const end = routineEnd(m, target);
  const bits = m.debug.coverage.bits;
  let seen = 0;
  for (let a = target; a <= end; a++) if (bits[a] & COVERAGE.EXEC) seen |= facts[a];
  let back = 0;
  for (const [to, edges] of callerMap) {
    if (to < target || to > end) continue;
    for (const e of edges) if ((e.kind === 'jr' || e.kind === 'jp') && e.from >= to && e.from <= end) back += e.count;
  }
  const notes = [];
  if (seen & FACT.VIDEO) notes.push('writes video RAM');
  if (seen & FACT.KEYBOARD) notes.push('reads the keyboard');
  if (seen & FACT.SOUND) notes.push('writes port FFh (sound)');
  if (calls > 0 && back / calls >= LONG_LOOP) notes.push(`loops ≥ ${LONG_LOOP}× a call`);
  return notes;
}
