// The Run tab's frame loop (phase 5B Rulings 2, 3, and 5). Each animation frame runs as many
// T-states as the time since the last one, at the clock the machine has now, with the gap capped
// at a 30th of a second so a tab coming back does not run a catch-up storm. Overshoot is carried:
// the machine keeps time over many frames. A hidden page gets no frames, which pauses the program.
//
// On the stub ROM, every byte of the ROM's space but its start-up code is HALT, and emu leaves PC
// just past a HALT it executes (checked in test/emulator-runtime.test.ts). So a PC inside the ROM
// after a slice means the program went there: the run stops, naming the line that called (from
// the return address on the stack) or, for an interrupt at $0038, the line with the EI.
import type { AsmResult } from '@fugloy/asm';
import type { Machine } from '@fugloy/emu';
import { MODEL_NAMES } from './rom-ids';
import { describeRom, romAdvice, romNameAt } from './rom-use';
import { HALT, romEnd } from './stub-rom';

export type RunnerState = 'running' | 'paused' | 'stopped';

export interface Runner {
  readonly state: RunnerState;
  /** The program counter now. */
  readonly pc: number;
  readonly machine: Machine;
  readonly result: AsmResult;
  /** Why the run stopped, as a sentence; null while it has not, or when stopped without one. */
  readonly stopReason: string | null;
  /** The source line the stop is about (1-based), when there is one. */
  readonly stopLine: number | null;
  /** Starts the frame loop (from paused, the state a new runner is in). */
  start(): void;
  pause(): void;
  resume(): void;
  /** Runs one instruction (pausing first if running), for 5C's stepping. */
  step(): void;
  stop(reason?: string): void;
}

export interface RunnerOptions {
  machine: Machine;
  result: AsmResult;
  /** True on the stub ROM: a PC inside the ROM stops the run with a sentence. */
  stub: boolean;
  schedule?: (cb: () => void) => number;
  cancel?: (id: number) => void;
  /** Milliseconds, as performance.now(). */
  now?: () => number;
  /** After each frame's slice (and each step); 5C maps PC to a line here. */
  onFrame?: (r: Runner) => void;
}

/** The longest gap a frame makes up, in seconds. */
export const MAX_FRAME_SECONDS = 1 / 30;

const hex4 = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

/** The line of the first EI the program assembles, or null. */
function eiLine(result: AsmResult): number | null {
  for (const l of result.listing) if (l.address !== null && l.bytes.length === 1 && l.bytes[0] === 0xfb && /\bEI\b/i.test(l.text.split(';')[0]!)) return l.line;
  return null;
}

/** The line of the CALL or RST that pushed `ret`, if the program has one there. */
function callerLine(m: Machine, result: AsmResult, ret: number): number | null {
  const call = (ret - 3) & 0xffff;
  const op3 = m.mem.read(call, 1)[0]!;
  if (op3 === 0xcd || (op3 & 0xc7) === 0xc4) {
    const line = result.sourceMap.lineOf(call);
    if (line !== null) return line;
  }
  const rst = (ret - 1) & 0xffff;
  if ((m.mem.read(rst, 1)[0]! & 0xc7) === 0xc7) return result.sourceMap.lineOf(rst);
  return null;
}

/** The stop for a PC inside the stub ROM: a sentence and its line. */
function trapStop(m: Machine, result: AsmResult): { reason: string; line: number | null } {
  const model = m.model;
  const pc = m.cpu.regs.pc;
  const at = m.mem.read((pc - 1) & 0xffff, 1)[0] === HALT ? (pc - 1) & 0xffff : pc;
  const sp = m.cpu.regs.sp;
  const top = m.mem.read(sp, 2);
  const ret = top[0]! | (top[1]! << 8);
  if (at === 0x0038) {
    const line = eiLine(result) ?? result.sourceMap.lineOf(ret);
    const who = line === null ? 'The program turns interrupts on' : `Line ${line} turns interrupts on`;
    return {
      line,
      reason: `${who} (EI), so the TRS-80's clock interrupt went to $0038, where the ROM handles it, ${romAdvice(model, 'remove the EI (DI keeps them off)')}`,
    };
  }
  const name = romNameAt(at, model);
  const what = name === undefined ? `${hex4(at)}, inside the ${MODEL_NAMES[model]} ROM` : describeRom(name);
  const line = callerLine(m, result, ret);
  const who = line === null ? 'The program' : `The program, called from line ${line},`;
  return { line, reason: `${who} went to ${what}, ${romAdvice(model)}` };
}

export function createRunner(opts: RunnerOptions): Runner {
  const { machine: m, result, stub } = opts;
  const schedule = opts.schedule ?? ((cb: () => void) => requestAnimationFrame(cb));
  const cancel = opts.cancel ?? ((id: number) => cancelAnimationFrame(id));
  const now = opts.now ?? (() => performance.now());
  const end = romEnd(m.model);

  let state: RunnerState = 'paused';
  let stopReason: string | null = null;
  let stopLine: number | null = null;
  let handle: number | null = null;
  let last = 0;
  /** The machine's T-state count the frames have paid for so far. */
  let target = 0;

  const unschedule = (): void => {
    if (handle !== null) cancel(handle);
    handle = null;
  };

  /** After a slice or a step: stop at the stub's trap. True when stopped. */
  const checkTrap = (): boolean => {
    if (!stub || m.cpu.regs.pc >= end) return false;
    const t = trapStop(m, result);
    runner.stop(t.reason, t.line);
    return true;
  };

  const tick = (): void => {
    handle = null;
    if (state !== 'running') return;
    const t = now();
    const dt = Math.min(Math.max(0, (t - last) / 1000), MAX_FRAME_SECONDS);
    last = t;
    target += Math.round(m.clockHz * dt);
    const budget = target - m.cycles;
    try {
      if (budget > 0) m.run({ cycles: budget });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      runner.stop(`The emulator stopped at ${hex4(m.cpu.regs.pc)} with an error: ${msg.replace(/\.?$/, '.')} Press Run to start again.`);
      return;
    }
    if (checkTrap()) return;
    opts.onFrame?.(runner);
    if (state === 'running') handle = schedule(tick);
  };

  const go = (): void => {
    state = 'running';
    last = now();
    target = m.cycles;
    unschedule();
    handle = schedule(tick);
  };

  const runner: Runner & { stop(reason?: string, line?: number | null): void } = {
    get state() {
      return state;
    },
    get pc() {
      return m.cpu.regs.pc;
    },
    machine: m,
    result,
    get stopReason() {
      return stopReason;
    },
    get stopLine() {
      return stopLine;
    },
    start() {
      if (state === 'paused') go();
    },
    pause() {
      if (state !== 'running') return;
      state = 'paused';
      unschedule();
    },
    resume() {
      if (state === 'paused') go();
    },
    step() {
      if (state === 'stopped') return;
      runner.pause();
      try {
        m.step();
      } catch (e) {
        runner.stop(`The emulator stopped at ${hex4(m.cpu.regs.pc)} with an error: ${(e instanceof Error ? e.message : String(e)).replace(/\.?$/, '.')} Press Run to start again.`);
        return;
      }
      if (checkTrap()) return;
      opts.onFrame?.(runner);
    },
    stop(reason?: string, line: number | null = null) {
      state = 'stopped';
      stopReason = reason ?? null;
      stopLine = line;
      unschedule();
    },
  };
  return runner;
}
