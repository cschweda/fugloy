// Breakpoints and stepping (phase 5C Rulings 8 and 9), over emu's breakpoints. DOM-free.
//
// - A line's breakpoint is at its first address (`addressesOf(line)[0]`). Where lines share that
//   address, its `when` compares memory with the line's bytes, so a relocated block stops only on
//   the right line. A line with no code, or with data (DB, DW, DS), is inactive: it has no
//   instruction to stop at (`inactiveReason` says why).
// - Step is the runner's step. Step Over decodes the instruction at PC: for a CALL, CALL cc, RST,
//   or a repeating block instruction (LDIR and its kin) it sets `once` breakpoints after it, gated
//   on SP being back where it was, and continues; RST 08H gets a second one past its inline byte
//   (the one RST that takes one). Anything else is a plain step. A user breakpoint hit first wins.
// - Run to Here sets a `once` breakpoint at each address given, then continues; given the target
//   line, a shared address gets the same byte check as a user breakpoint.
// - A repeating block instruction (LDIR, LDDR, CPIR, CPDR, INIR, INDR, OTIR, OTDR) runs each
//   iteration as its own instruction at the same PC, so every breakpoint the stepper sets carries
//   `onceAcross`: it stops only when the instruction is about to start, never between iterations
//   (the trace's newest entry is then that same instruction at that PC). Continue from a stop there
//   or from a pause mid-block, and Step Over on it, run until PC leaves it. An interrupt taken
//   mid-block makes the handler's RET the newest entry, so the breakpoint stops once more there.
// - Every temporary breakpoint is removed by `clearTemps`, which a Run calls on any pause or stop.
// - Step and Step Over while running only pause; the next press steps.
// - A CPU halted with interrupts off cannot move on: the actions do nothing and return the sentence.
import type { AsmResult } from '@fugloy/asm';
import type { Machine } from '@fugloy/emu';
import { inactiveReason } from '../source/lines';
import type { Runner } from './runner';

export { inactiveReason };

export const HALTED_INTERRUPTS_OFF = 'The CPU is halted (HALT) with interrupts off, so it will not move on. Press Stop, then Run.';
/** Added to a step's sentence while the CPU is halted with interrupts on: each step idles until one comes. */
export const HALTED_WAITING = 'The CPU is halted (HALT), waiting for an interrupt; press Continue to run until one comes.';

/** The address a breakpoint on `line` stops at, or null for a line with no code. */
export function breakAddress(result: AsmResult, line: number): number | null {
  return result.sourceMap.addressesOf(line)[0] ?? null;
}

/**
 * A `when` for a breakpoint at `addr` on `line`: where several lines share the address, it holds
 * only while memory has this line's bytes there. Undefined when no check is needed.
 */
function byteGate(result: AsmResult, line: number, addr: number): ((m: Machine) => boolean) | undefined {
  const at = result.sourceMap.linesOf(addr);
  const mine = at.find((c) => c.line === line);
  if (at.length < 2 || mine === undefined) return undefined;
  const want = mine.bytes;
  return (mm: Machine) => {
    const got = mm.mem.read(addr, want.length);
    for (let k = 0; k < want.length; k++) if (got[k] !== want[k]) return false;
    return true;
  };
}

/** ED-prefixed LDIR, CPIR, INIR, OTIR, LDDR, CPDR, INDR, OTDR. */
const BLOCK_REPEATS: ReadonlySet<number> = new Set([0xb0, 0xb1, 0xb2, 0xb3, 0xb8, 0xb9, 0xba, 0xbb]);

/** True when the instruction the CPU ran last was a block repeat at `addr`: the next one there is its next iteration. */
function repeating(m: Machine, addr: number): boolean {
  const last = m.debug.trace.last(1)[0];
  return last !== undefined && last.pc === addr && last.bytes[0] === 0xed && BLOCK_REPEATS.has(last.bytes[1]!);
}

/** `gate` (when given), plus: not between a block repeat's iterations at `addr`. */
function onceAcross(addr: number, gate?: (m: Machine) => boolean): (m: Machine) => boolean {
  return gate === undefined ? (mm) => !repeating(mm, addr) : (mm) => !repeating(mm, addr) && gate(mm);
}

/**
 * Where Step Over stops for the instruction at PC: after a CALL (3 bytes), a CALL cc, an RST (1
 * byte; RST 08H also 2, past its inline byte), or a block repeat (2 bytes). Null for any other
 * instruction, which Step Over runs as a plain step.
 */
export function stepOverTargets(m: Machine): number[] | null {
  const pc = m.cpu.regs.pc;
  const [op, next] = m.mem.read(pc, 2) as unknown as [number, number];
  const at = (n: number): number => (pc + n) & 0xffff;
  if (op === 0xcd || (op & 0xc7) === 0xc4) return [at(3)];
  if (op === 0xcf) return [at(1), at(2)];
  if ((op & 0xc7) === 0xc7) return [at(1)];
  if (op === 0xed && BLOCK_REPEATS.has(next)) return [at(2)];
  return null;
}

export interface Stepper {
  /** Sets the user's breakpoints to these source lines; `inactive` lists the lines with no code. */
  setBreakpoints(lines: readonly number[]): { inactive: number[] };
  /** Each action returns null, or a sentence when the CPU cannot move on. */
  step(): string | null;
  stepOver(): string | null;
  /** `line`, when known, is the target line: its byte check guards a shared address. */
  runTo(addrs: readonly number[], line?: number): string | null;
  continue(): string | null;
  /** Removes every temporary breakpoint (call on each pause and stop). */
  clearTemps(): void;
  /** Whether emu breakpoint `id` is one of Step Over's or Run to Here's, now or until the next clearTemps after the one that removed it: a pause on it is the end of a step, not a user breakpoint. */
  wasTemp(id: number): boolean;
}

/** True when `sp` is at or above `sp0` on the stack (a 64K ring: within 32K above). */
const stackBack = (sp: number, sp0: number): boolean => ((sp - sp0) & 0xffff) < 0x8000;

export function createStepper(runner: Runner): Stepper {
  const m = runner.machine;
  const { result } = runner;
  // Breakpoints and stepping are by source line: a programless runner (5D) has none.
  if (result === null) throw new Error('A programless runner has no source lines to step or break on.');
  /** Source line → emu breakpoint id. */
  const user = new Map<number, number>();
  const temps = new Set<number>();
  /** The temporaries the last clearTemps removed (a pause clears them before anyone asks). */
  let cleared = new Set<number>();

  const stuck = (): string | null => (m.cpu.halted && !m.cpu.regs.iff1 ? HALTED_INTERRUPTS_OFF : null);

  const stepper: Stepper = {
    setBreakpoints(lines) {
      const wanted = new Set(lines);
      for (const [line, id] of user)
        if (!wanted.has(line)) {
          m.debug.unbreak(id);
          user.delete(line);
        }
      const inactive: number[] = [];
      for (const line of wanted) {
        const addr = breakAddress(result, line);
        if (addr === null || inactiveReason(result, line) !== null) inactive.push(line);
        else if (!user.has(line)) user.set(line, m.debug.break(addr, { when: onceAcross(addr, byteGate(result, line, addr)) }));
      }
      return { inactive: inactive.sort((a, b) => a - b) };
    },
    step() {
      if (runner.state === 'running') {
        runner.pause();
        return null;
      }
      if (runner.state !== 'paused') return null;
      const why = stuck();
      if (why === null) runner.step();
      return why;
    },
    stepOver() {
      if (runner.state === 'running') {
        runner.pause();
        return null;
      }
      if (runner.state !== 'paused') return null;
      const why = stuck();
      if (why !== null) return why;
      const targets = stepOverTargets(m);
      if (targets === null) {
        runner.step();
        return null;
      }
      const sp0 = m.cpu.regs.sp;
      const back = (mm: Machine): boolean => stackBack(mm.cpu.regs.sp, sp0);
      for (const addr of targets) temps.add(m.debug.break(addr, { once: true, when: onceAcross(addr, back) }));
      runner.continue();
      return null;
    },
    runTo(addrs, line) {
      if (runner.state === 'stopped') return null;
      const why = runner.state === 'paused' ? stuck() : null;
      if (why !== null) return why;
      for (const addr of addrs) temps.add(m.debug.break(addr, { once: true, when: onceAcross(addr, line === undefined ? undefined : byteGate(result, line, addr)) }));
      if (runner.state === 'paused') runner.continue();
      return null;
    },
    continue() {
      if (runner.state !== 'paused') return null;
      const why = stuck();
      if (why === null) runner.continue();
      return why;
    },
    clearTemps() {
      for (const id of temps) m.debug.unbreak(id);
      cleared = new Set(temps);
      temps.clear();
    },
    wasTemp(id) {
      return temps.has(id) || cleared.has(id);
    },
  };
  return stepper;
}
