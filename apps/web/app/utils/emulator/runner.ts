// The Run tab's frame loop (phase 5B Rulings 2, 3, and 5). Each animation frame runs as many
// T-states as the time since the last one, at the clock the machine has now, with the gap capped
// at a 30th of a second so a tab coming back does not run a catch-up storm. Overshoot is carried:
// the machine keeps time over many frames. A hidden page gets no frames, which pauses the program.
//
// On the stub ROM, every byte of the ROM's space but its start-up code is HALT, and emu leaves PC
// just past a HALT it executes (checked in test/emulator-runtime.test.ts). So a PC inside the ROM
// after a slice means the program went there, and the run stops. Under the stub the runner keeps
// emu's instruction trace (the last TRACE_DEPTH instructions), so the stop always names the last
// line of the program that ran, and where it went:
// - a RET to the address the stub left on the stack: the program returned from its entry;
// - $0038 from a program instruction that is not RST 38H: an interrupt, naming the EI line;
// - memory that holds none of the program's code first (on the Model I, the empty $3000-$37FF,
//   whose $FF bytes are RST 38H): the program ran into memory that is not its own;
// - anywhere else: the routine there (a jump to $0000 says $0000, though it halts further on).
import type { AsmResult } from '@fugloy/asm';
import type { Machine } from '@fugloy/emu';
import { MODEL_NAMES } from './rom-ids';
import { describeRom, romAdvice, romNameAt } from './rom-use';
import { romEnd, stubHalts } from './stub-rom';

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
  /** Once the run stops, for whatever reason (the trap, an error, or `stop`). */
  onStop?: (r: Runner) => void;
}

/** The longest gap a frame makes up, in seconds. */
export const MAX_FRAME_SECONDS = 1 / 30;

const hex4 = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

/** The line of the first EI the program assembles, or null. */
function eiLine(result: AsmResult): number | null {
  for (const l of result.listing) if (l.address !== null && l.bytes.length === 1 && l.bytes[0] === 0xfb && /\bEI\b/i.test(l.text.split(';')[0]!)) return l.line;
  return null;
}

/** How many instructions the trace keeps under the stub. */
export const TRACE_DEPTH = 65_536;

type TraceEntry = { pc: number; bytes: number[] };

/** The newest trace entry the program's own code ran, and the entry after it (where it went). */
function lastProgramStep(m: Machine, result: AsmResult): { from: TraceEntry | null; to: TraceEntry | null } {
  for (const n of [64, 4096, TRACE_DEPTH]) {
    const entries = m.debug.trace.last(n);
    for (let i = entries.length - 1; i >= 0; i--)
      if (result.sourceMap.lineOf(entries[i]!.pc) !== null) return { from: entries[i]!, to: entries[i + 1] ?? null };
    if (entries.length < n) break;
  }
  return { from: null, to: null };
}

/** What an instruction's bytes do to PC, as a verb. */
function verbOf(b: readonly number[]): string {
  const op = b[0]!;
  const ed = op === 0xed ? b[1]! : -1;
  if (op === 0xcd || (op & 0xc7) === 0xc4 || (op & 0xc7) === 0xc7) return 'calls';
  if (op === 0xc9 || (op & 0xc7) === 0xc0 || ed === 0x4d || ed === 0x45) return 'returns to';
  if (op === 0xc3 || (op & 0xc7) === 0xc2 || op === 0xe9 || op === 0x18 || op === 0x10 || (op & 0xe7) === 0x20 || ((op === 0xdd || op === 0xfd) && b[1] === 0xe9)) return 'jumps to';
  return 'runs on into';
}

/** The stop for a PC inside the stub ROM: a sentence and its line. */
function trapStop(m: Machine, result: AsmResult): { reason: string; line: number | null } {
  const model = m.model;
  const end = romEnd(model);
  const { returned } = stubHalts(model);
  const { from, to } = lastProgramStep(m, result);
  const entryLine = result.entry === null ? null : result.sourceMap.lineOf(result.entry);
  const line = from === null ? entryLine : result.sourceMap.lineOf(from.pc);
  const pc = m.cpu.regs.pc;
  const target = to?.pc ?? ((pc - 1) & 0xffff);
  const who = from === null ? `After more than ${TRACE_DEPTH.toLocaleString('en-US')} instructions outside its code, the program (which starts at line ${entryLine})` : `Line ${line}`;

  if (target === 0x0038 && from !== null && from.bytes[0] !== 0xff) {
    const ei = eiLine(result) ?? line;
    return {
      line: ei,
      reason: `${ei === null ? 'The program turns interrupts on' : `Line ${ei} turns interrupts on`} (EI), so the TRS-80's clock interrupt went to $0038, where the ROM handles it, ${romAdvice(model, 'remove the EI (DI keeps them off)')}`,
    };
  }
  if (target === returned)
    return {
      line,
      reason: `${who} returns (RET) to the ROM, but no ROM is loaded, so there is nothing to return to. End the program with a loop that waits, such as WAIT: JR WAIT, or with HALT.`,
    };
  if (target >= end) {
    const gap = model === 1 && target >= 0x3000 && target < 0x3800;
    const where = gap ? `${hex4(target)}, where the Model I has no memory at all (its $FF bytes run as RST 38H)` : `${hex4(target)}, which holds none of its code`;
    return { line, reason: `${who} ${from === null ? 'ran' : verbOf(from.bytes)} ${where}, and from there into the ROM's space, ${romAdvice(model, 'check where that line sends the program')}` };
  }
  const name = romNameAt(target, model);
  const what = name === undefined ? `${hex4(target)}, inside the ${MODEL_NAMES[model]} ROM` : describeRom(name);
  return { line, reason: `${who} ${from === null ? 'went to' : verbOf(from.bytes)} ${what}, ${romAdvice(model)}` };
}

export function createRunner(opts: RunnerOptions): Runner {
  const { machine: m, result, stub } = opts;
  const schedule = opts.schedule ?? ((cb: () => void) => requestAnimationFrame(cb));
  const cancel = opts.cancel ?? ((id: number) => cancelAnimationFrame(id));
  const now = opts.now ?? (() => performance.now());
  const end = romEnd(m.model);
  if (stub && !m.debug.trace.enabled) m.debug.trace.enable({ depth: TRACE_DEPTH });

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
      if (state === 'stopped') return;
      state = 'stopped';
      stopReason = reason ?? null;
      stopLine = line;
      unschedule();
      opts.onStop?.(runner);
    },
  };
  return runner;
}
