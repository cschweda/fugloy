// The Run tab's frame loop (phase 5B Rulings 2, 3, and 5). Each animation frame runs as many
// T-states as the time since the last one, at the clock the machine has now, with the gap capped
// at a 30th of a second so a tab coming back does not run a catch-up storm. Overshoot is carried:
// the machine keeps time over many frames. A hidden page gets no frames, which pauses the program.
//
// On the stub ROM, every byte of the ROM's space but its start-up code is HALT, and emu leaves PC
// just past a HALT it executes (checked in test/emulator-runtime.test.ts). So a PC inside the ROM
// after a slice means the program went there, and the run stops. The runner keeps emu's
// instruction trace (the last TRACE_DEPTH instructions) on for every run, stub or real ROM (5C
// Ruling 1: the running line's trail reads it), so the stop always names the last line of the
// program that ran, and where it went:
// - a RET to the address the stub left on the stack: the program returned from its entry;
// - $0038 from a program instruction that is not RST 38H: an interrupt, naming the EI line;
// - memory that holds none of the program's code first (on the Model I, the empty $3000-$37FF,
//   whose $FF bytes are RST 38H): the program ran into memory that is not its own;
// - anywhere else: the routine there (a jump to $0000 says $0000, though it halts further on).
//
// The Model I's HALT line drives its reset switch's NMI (emu spec §5), so a halted CPU there takes
// the NMI to $0066 at the next instruction, and from a HALT in the stub's space it does so again
// and again, a word pushed each time. So on that model a stub run's slices stop when the CPU halts
// (`until: 'halt'`, before the NMI), and a HALT in the program's own code stops the run with
// MODEL1_HALT, naming its line: the Model I's answer, a reset to BASIC, is one the stub cannot
// give. A HALT anywhere else is the trap's, as above. The user's ROM, and the other models, whose
// HALT waits for an interrupt, are untouched.
//
// Breakpoints (5C Ruling 8) are emu's own: a slice that ends with `{ reason: 'break' }` pauses the
// run before that instruction, sets `pausedBy`, and calls `onPause`; Pause and each step call
// `onPause` too. `continue()` resumes past a breakpoint at PC: emu skips the
// check at a run's first boundary only at the PC its last run stopped at for a break, so after any
// other pause (a manual one, or a step) Continue first steps past PC: until the trace's newest entry
// is the instruction at PC, since emu's step counts an interrupt response with the instruction
// after it, so a pending interrupt runs its handler first (bounded by STEP_PAST_LIMIT). A halted
// CPU is not stepped: emu checks no breakpoint while halted. A block instruction (LDIR and its kin)
// repeats at the same PC; the stepper's breakpoints do not stop between its iterations
// (stepping.ts), so after stepping past one iteration the run goes on to the block's end. (The ROM keyboard hook's stand-in RET
// at $002B and $0049 leaves no trace entry, but a breakpoint is only ever on a program line.)
//
// A programless runner (`result: null`, phase 5D) is the TRS-80 simply on, or a bundled game: it
// runs on the user's ROM only (never the stub, whose trap needs a program to name), checks no
// trap, and stops only when told to or on an emulator error.
import type { AsmResult } from '@fugloy/asm';
import type { Machine, Model } from '@fugloy/emu';
import { MODEL_NAMES } from './rom-ids';
import { describeRom, romAdvice, romNameAt } from './rom-use';
import { romEnd, stubHalts } from './stub-rom';

export type RunnerState = 'running' | 'paused' | 'stopped';

/** Why a paused runner paused: Pause, a step, or a breakpoint (with emu's id for it). */
export type PausedBy = { kind: 'pause' | 'step' | 'break'; id?: number };

export interface Runner {
  readonly state: RunnerState;
  /** The program counter now. */
  readonly pc: number;
  readonly machine: Machine;
  /** The program the run is of; null for a programless runner (the machine on, or a bundled game). */
  readonly result: AsmResult | null;
  /** Why the run stopped, as a sentence; null while it has not, or when stopped without one. */
  readonly stopReason: string | null;
  /** The source line the stop is about (1-based), when there is one. */
  readonly stopLine: number | null;
  /** Why the runner is paused; null while running, stopped, or not yet started. */
  readonly pausedBy: PausedBy | null;
  /** Starts the frame loop (from paused, the state a new runner is in); a breakpoint at PC stops it at once. */
  start(): void;
  pause(): void;
  /** The same as `continue()`. */
  resume(): void;
  /** Resumes from paused, past a breakpoint at PC (stepping over it first when the pause was not that breakpoint's). */
  continue(): void;
  /** Runs one instruction (pausing first if running), for 5C's stepping. */
  step(): void;
  stop(reason?: string): void;
}

export interface RunnerOptions {
  machine: Machine;
  /** Null for a programless runner, which `stub` must not be. */
  result: AsmResult | null;
  /** True on the stub ROM: a PC inside the ROM, or on the Model I a HALT, stops the run with a sentence. */
  stub: boolean;
  schedule?: (cb: () => void) => number;
  cancel?: (id: number) => void;
  /** Milliseconds, as performance.now(). */
  now?: () => number;
  /** After each frame's slice (and each step); 5C maps PC to a line here. */
  onFrame?: (r: Runner) => void;
  /** Once the run stops, for whatever reason (the trap, an error, or `stop`). */
  onStop?: (r: Runner) => void;
  /** Each time the run pauses: at a breakpoint, by `pause`, or after a step (see `pausedBy`). */
  onPause?: (r: Runner) => void;
}

/** The longest gap a frame makes up, in seconds. */
export const MAX_FRAME_SECONDS = 1 / 30;

/**
 * True on the Model I, whose CPU's HALT line drives the reset switch's NMI (emu spec §5): a HALT
 * there is answered at the next instruction by the NMI to $0066, the ROM's reset, so it never
 * waits for an interrupt. The Model III and Model 4 have no such wiring: their HALT waits.
 */
export const haltRaisesNmi = (model: Model): boolean => model === 1;

/**
 * Why a stub run on the Model I stopped at the program's HALT on `line`. Its advice is worded as
 * romAdvice words it, "Add a Model I ROM in the Run tab, or ...", which the Learn page rewords to
 * "Lessons run without one, so ...", so "one" there must read as the ROM the sentence just said is
 * needed and not loaded, not as the stub ROM.
 */
export const MODEL1_HALT = (line: number): string =>
  `Line ${line} halts the CPU (HALT), and a Model I answers a HALT with a reset to BASIC (its HALT line drives the reset switch's NMI), which needs a ROM, and none is loaded. Add a Model I ROM in the Run tab, or end the program with a loop that waits, such as WAIT: JR WAIT.`;

const hex4 = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

/** The line of the first EI the program assembles, or null. */
function eiLine(result: AsmResult): number | null {
  for (const l of result.listing) if (l.address !== null && l.bytes.length === 1 && l.bytes[0] === 0xfb && /\bEI\b/i.test(l.text.split(';')[0]!)) return l.line;
  return null;
}

/** The most steps Continue takes to run the instruction at PC (an interrupt handler may run first). */
export const STEP_PAST_LIMIT = 1000;

/** How many instructions the trace keeps (every run, 5C Ruling 1). */
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

/** The program's line for the HALT the CPU sits in (the trace's newest entry: a halted CPU adds none), or null when that HALT is not its code. */
function haltLine(m: Machine, result: AsmResult): number | null {
  const halt = m.debug.trace.last(1)[0];
  return halt === undefined ? null : result.sourceMap.lineOf(halt.pc);
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
      // HALT ends a program only where it waits: on the Model I it is a reset.
      reason: `${who} returns (RET) to the ROM, but no ROM is loaded, so there is nothing to return to. End the program with a loop that waits, such as WAIT: JR WAIT${haltRaisesNmi(model) ? '' : ', or with HALT'}.`,
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
  if (result === null && stub) throw new Error('A programless runner cannot run on the stub ROM: its trap needs a program.');
  const schedule = opts.schedule ?? ((cb: () => void) => requestAnimationFrame(cb));
  const cancel = opts.cancel ?? ((id: number) => cancelAnimationFrame(id));
  const now = opts.now ?? (() => performance.now());
  const end = romEnd(m.model);
  /** A stub run on the Model I stops when the CPU halts, before its NMI. */
  const haltStops = stub && haltRaisesNmi(m.model);
  if (!m.debug.trace.enabled) m.debug.trace.enable({ depth: TRACE_DEPTH });

  let state: RunnerState = 'paused';
  let stopReason: string | null = null;
  let stopLine: number | null = null;
  let pausedBy: PausedBy | null = null;
  let handle: number | null = null;
  let last = 0;
  /** The machine's T-state count the frames have paid for so far. */
  let target = 0;

  const unschedule = (): void => {
    if (handle !== null) cancel(handle);
    handle = null;
  };

  /** After a slice or a step: stop at the stub's trap, or at a Model I program's HALT. True when stopped. */
  const checkTrap = (): boolean => {
    if (!stub || result === null) return false;
    const haltedOn = haltStops && m.cpu.halted ? haltLine(m, result) : null;
    if (haltedOn !== null) {
      runner.stop(MODEL1_HALT(haltedOn), haltedOn);
      return true;
    }
    if (m.cpu.regs.pc >= end) return false;
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
    let hit: number | null = null;
    try {
      if (budget > 0) {
        const r = m.run(haltStops ? { cycles: budget, until: 'halt' } : { cycles: budget });
        if (r.reason === 'break') hit = r.id;
      }
    } catch (e) {
      fail(e);
      return;
    }
    if (hit !== null) {
      // Stopped before the breakpoint's instruction: the frame ends here, paused.
      halt({ kind: 'break', id: hit });
      opts.onFrame?.(runner);
      opts.onPause?.(runner);
      return;
    }
    if (checkTrap()) return;
    opts.onFrame?.(runner);
    if (state === 'running') handle = schedule(tick);
  };

  const fail = (e: unknown): void => {
    runner.stop(`The emulator stopped at ${hex4(m.cpu.regs.pc)} with an error: ${(e instanceof Error ? e.message : String(e)).replace(/\.?$/, '.')} Press Run to start again.`);
  };

  /** Pauses with no callback. */
  const halt = (why: PausedBy): void => {
    state = 'paused';
    pausedBy = why;
    unschedule();
  };

  /** One instruction, then the trap. False when the run stopped. */
  const stepOnce = (): boolean => {
    try {
      m.step();
    } catch (e) {
      fail(e);
      return false;
    }
    return !checkTrap();
  };

  const hasBreakAt = (pc: number): boolean => m.debug.breaks.some((b) => b.addr === pc);

  /** Steps until the instruction at `pc` has run. False when the run stopped. */
  const stepPast = (pc: number): boolean => {
    for (let k = 0; k < STEP_PAST_LIMIT; k++) {
      if (!stepOnce()) return false;
      if (m.debug.trace.last(1)[0]?.pc === pc) return true;
    }
    return true;
  };

  const go = (): void => {
    state = 'running';
    pausedBy = null;
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
    get pausedBy() {
      return pausedBy;
    },
    start() {
      if (state === 'paused') go();
    },
    pause() {
      if (state !== 'running') return;
      halt({ kind: 'pause' });
      opts.onPause?.(runner);
    },
    resume() {
      runner.continue();
    },
    continue() {
      if (state !== 'paused') return;
      // emu resumes past a breakpoint only at the PC its last run stopped at for one.
      const pc = m.cpu.regs.pc;
      if (pausedBy?.kind !== 'break' && !m.cpu.halted && hasBreakAt(pc) && !stepPast(pc)) return;
      go();
    },
    step() {
      if (state === 'stopped') return;
      halt({ kind: 'step' });
      if (!stepOnce()) return;
      opts.onFrame?.(runner);
      opts.onPause?.(runner);
    },
    stop(reason?: string, line: number | null = null) {
      if (state === 'stopped') return;
      state = 'stopped';
      pausedBy = null;
      stopReason = reason ?? null;
      stopLine = line;
      unschedule();
      opts.onStop?.(runner);
    },
  };
  return runner;
}
