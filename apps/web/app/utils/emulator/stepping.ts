// Breakpoints and stepping (phase 5C Rulings 8 and 9), over emu's breakpoints. DOM-free.
//
// - A line's breakpoint is at its first address (`addressesOf(line)[0]`). Where lines share that
//   address, its `when` compares memory with the line's bytes, so a relocated block stops only on
//   the right line.
// - Step is the runner's step. Step Over decodes the instruction at PC: for a CALL, CALL cc, RST,
//   or a repeating block instruction (LDIR and its kin) it sets `once` breakpoints after it, gated
//   on SP being back where it was, and continues; RST 08H gets a second one past its inline byte
//   (the one RST that takes one). Anything else is a plain step. A user breakpoint hit first wins.
// - Run to Here sets a `once` breakpoint at each address given, then continues.
// - Every temporary breakpoint is removed by `clearTemps`, which a Run calls on any pause or stop.
// - Step and Step Over while running only pause; the next press steps.
// - A CPU halted with interrupts off cannot move on: the actions do nothing and return the sentence.
import type { AsmResult } from '@fugloy/asm';
import type { Machine } from '@fugloy/emu';
import { isHalted } from './running';
import type { Runner } from './runner';

export const HALTED_INTERRUPTS_OFF = 'The CPU is halted (HALT) with interrupts off, so it will not move on. Press Stop, then Run.';

/** The address a breakpoint on `line` stops at, or null for a line with no code. */
export function breakAddress(result: AsmResult, line: number): number | null {
  return result.sourceMap.addressesOf(line)[0] ?? null;
}

/** ED-prefixed LDIR, CPIR, INIR, OTIR, LDDR, CPDR, INDR, OTDR. */
const BLOCK_REPEATS: ReadonlySet<number> = new Set([0xb0, 0xb1, 0xb2, 0xb3, 0xb8, 0xb9, 0xba, 0xbb]);

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
  runTo(addrs: readonly number[]): string | null;
  continue(): string | null;
  /** Removes every temporary breakpoint (call on each pause and stop). */
  clearTemps(): void;
}

/** True when `sp` is at or above `sp0` on the stack (a 64K ring: within 32K above). */
const stackBack = (sp: number, sp0: number): boolean => ((sp - sp0) & 0xffff) < 0x8000;

export function createStepper(runner: Runner): Stepper {
  const m = runner.machine;
  const { result } = runner;
  /** Source line → emu breakpoint id. */
  const user = new Map<number, number>();
  const temps = new Set<number>();

  const stuck = (): string | null => (isHalted(m) && !m.cpu.regs.iff1 ? HALTED_INTERRUPTS_OFF : null);

  function addUser(line: number, addr: number): number {
    const at = result.sourceMap.linesOf(addr);
    const mine = at.find((c) => c.line === line);
    if (at.length < 2 || mine === undefined) return m.debug.break(addr);
    const want = mine.bytes;
    return m.debug.break(addr, {
      when: (mm: Machine) => {
        const got = mm.mem.read(addr, want.length);
        for (let k = 0; k < want.length; k++) if (got[k] !== want[k]) return false;
        return true;
      },
    });
  }

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
        if (addr === null) inactive.push(line);
        else if (!user.has(line)) user.set(line, addUser(line, addr));
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
      const when = (mm: Machine): boolean => stackBack(mm.cpu.regs.sp, sp0);
      for (const addr of targets) temps.add(m.debug.break(addr, { once: true, when }));
      runner.continue();
      return null;
    },
    runTo(addrs) {
      if (runner.state === 'stopped') return null;
      const why = runner.state === 'paused' ? stuck() : null;
      if (why !== null) return why;
      for (const addr of addrs) temps.add(m.debug.break(addr, { once: true }));
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
      temps.clear();
    },
  };
  return stepper;
}
