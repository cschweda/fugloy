// The running line's coordinator (phase 5C), one per Run: createRun makes it, so it loads with
// Run's chunk, never on the first screen. DOM-free; Source ✎, Run ▶ and the listing read it.
//
// - `marks`: the running line and its trail (Ruling 2), in the Run's own line numbers, replaced
//   only when the set changes (one string compare a frame) and at most 30 times a second (4 with
//   reduced motion, which also drops the trail). A pause, a step, and a stop publish at once.
// - `breakpoints`: the current source's, saved with it (Ruling 8). A change reaches emu at once
//   while the text on screen is the one the Run assembled (`live`); once it differs (`dirty`), it
//   waits for the next Run, which applies the source's breakpoints before its first frame.
// - Pause, Continue, Step, Step Over and Run to Here go through the Run's one Stepper (Task 1);
//   a sentence it returns (a CPU halted with interrupts off) goes to `run.message`.
// - On each pause and step: the registers, marked where they changed since the last pause
//   (Ruling 11), `reveal` with the line to bring into view (Ruling 7), and `announce` (Ruling 12).
//   While running, the registers and `pcAddr` update 4 times a second.
import { computed, ref, shallowRef, watch } from 'vue';
import type { ComputedRef, Ref, ShallowRef } from 'vue';
import type { AsmResult } from '@fugloy/asm';
import type { RunKit } from '../utils/emulator/kit';
import type { Runner } from '../utils/emulator/runner';
import type { LineMark, TrailState } from '../utils/emulator/running';
import type { Stepper } from '../utils/emulator/stepping';
import type { FlagRow, RegisterRow, RegSnap } from '../utils/emulator/registers';
import type { Sources } from './useSources';

export type DebugMode = 'idle' | 'running' | 'paused' | 'stopped';

export interface Announcement {
  text: string;
  step: boolean;
}

export interface RegisterView {
  rows: RegisterRow[];
  flags: FlagRow[];
  snap: RegSnap;
}

/** Ruling 4's sentence, for Source ✎ once the text differs from what the Run assembled. */
export const SOURCE_CHANGED = 'The source has changed since this Run, so the running line is not shown. Press Run to see it again.';

/** The fastest the marks change: 30 a second, or 4 with reduced motion (Ruling 3). */
export const MARKS_INTERVAL_MS = 1000 / 30;
export const REDUCED_INTERVAL_MS = 250;
/** How often the registers and PC refresh while running. */
export const REGISTERS_INTERVAL_MS = 250;

export interface Debug {
  mode: Ref<DebugMode>;
  marks: ShallowRef<LineMark[]>;
  pcAddr: Ref<number | null>;
  breakpoints: Ref<number[]>;
  inactive: Ref<number[]>;
  /** The source on screen is the running one, but its text is not what the Run assembled. */
  dirty: ComputedRef<boolean>;
  /** The source on screen is the running one, with the text the Run assembled: the marks describe it. */
  live: ComputedRef<boolean>;
  /** Keep the running line in view while running (Ruling 7); off by default, kept for the session. */
  follow: Ref<boolean>;
  /** prefers-reduced-motion: no trail, and the line moves at most 4 times a second. */
  reduced: Ref<boolean>;
  registers: ShallowRef<RegisterView | null>;
  /** A new object on each pause and step: the line to bring into view (null when PC is on none). */
  reveal: ShallowRef<{ line: number | null } | null>;
  /** The latest sentence for screen readers (a pause, a step). */
  announce: Ref<string | null>;
  /** The same, a new object for every sentence (the same words twice are said twice); `step` when a step made it, which the announcer debounces (Ruling 12). */
  announcement: ShallowRef<Announcement | null>;
  toggleBreakpoint(line: number): void;
  /** Replaces the breakpoints (the editor carried them through an edit). */
  setBreakpoints(lines: readonly number[]): void;
  /** Why a breakpoint on `line` cannot stop, as a sentence. */
  inactiveWhy(line: number): string;
  pause(): void;
  continue(): void;
  step(): void;
  stepOver(): void;
  runToLine(line: number): void;
  runToAddr(addr: number): void;
}

/** What createRun hands over for each Run that made a runner. */
export interface DebugRun {
  kit: RunKit;
  runner: Runner;
  stepper: Stepper;
  result: AsmResult;
  inactive: number[];
  sourceId: string;
  text: string;
}

/** The hooks createRun calls; not part of the page's API. */
export interface DebugControl extends Debug {
  attach(run: DebugRun): void;
  /** The last Run is gone (a new Run starts, or made no runner). */
  detach(): void;
  frame(r: Runner): void;
  paused(r: Runner): void;
  stopped(r: Runner): void;
}

export interface DebugDeps {
  sources: Sources;
  /** run.message and run.problem. */
  say(text: string, problem?: boolean): void;
  /** Keeps run.state in step with the runner. */
  state(s: Runner['state']): void;
  now?: (() => number) | undefined;
  /** prefers-reduced-motion's query (null where there is none); followed as it changes. */
  motionQuery?: () => MediaQueryList | null;
}

const hex4 = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

/** A listing line's instruction, as a screen reader should hear it: no label, no comment. */
function codeOf(text: string): string {
  return text
    .replace(/;.*$/, '')
    .replace(/^\s*[A-Za-z_.$?@][\w.$?@]*:/, '')
    .trim()
    .replace(/\s+/, ' ')
    .replace(/\s*,\s*/g, ',');
}

/** The registers that changed between two snapshots, AF named as A and F (PC and R move always). */
function changedNames(now: RegSnap, prev: RegSnap): string[] {
  const out: string[] = [];
  if (now.af >> 8 !== prev.af >> 8) out.push('A');
  if ((now.af & 0xff) !== (prev.af & 0xff)) out.push('F');
  const rest: [string, keyof RegSnap][] = [
    ['BC', 'bc'],
    ['DE', 'de'],
    ['HL', 'hl'],
    ['IX', 'ix'],
    ['IY', 'iy'],
    ['SP', 'sp'],
    ['AF′', 'af2'],
    ['BC′', 'bc2'],
    ['DE′', 'de2'],
    ['HL′', 'hl2'],
    ['I', 'i'],
    ['IM', 'im'],
    ['IFF1', 'iff1'],
    ['IFF2', 'iff2'],
  ];
  for (const [name, k] of rest) if (now[k] !== prev[k]) out.push(name);
  return out;
}

const defaultMotionQuery = (): MediaQueryList | null => {
  try {
    return typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  } catch {
    return null;
  }
};

export function createDebug(deps: DebugDeps): DebugControl {
  const { sources, say } = deps;
  const now = deps.now ?? (() => performance.now());
  const mode = ref<DebugMode>('idle');
  const marks = shallowRef<LineMark[]>([]);
  const pcAddr = ref<number | null>(null);
  const breakpoints = ref<number[]>([]);
  const inactive = ref<number[]>([]);
  const follow = ref(false);
  // Followed for the session: one listener on the page's one Run, never removed.
  const motion = (deps.motionQuery ?? defaultMotionQuery)();
  const reduced = ref(motion?.matches === true);
  motion?.addEventListener?.('change', (e) => {
    reduced.value = e.matches;
  });
  const registers = shallowRef<RegisterView | null>(null);
  const reveal = shallowRef<{ line: number | null } | null>(null);
  const announce = ref<string | null>(null);
  const announcement = shallowRef<Announcement | null>(null);
  function speak(text: string, step: boolean): void {
    announce.value = text;
    announcement.value = { text, step };
  }
  const current = shallowRef<DebugRun | null>(null);

  /** The last frame's trail, for its `out` line (reset for each Run: Task 1, finding 9). */
  let prev: TrailState | undefined;
  let shownKey = '';
  let shownAt = -Infinity;
  let regsAt = -Infinity;
  /** The registers at the last pause, for what a step changed. */
  let pauseSnap: RegSnap | null = null;
  /** A runner Continue must start rather than continue (Task 1, finding 8). */
  let started = false;

  const sameSource = (): boolean => current.value !== null && sources.current.value?.id === current.value.sourceId;
  const live = computed(() => sameSource() && sources.current.value!.text === current.value!.text);
  const dirty = computed(() => sameSource() && sources.current.value!.text !== current.value!.text);

  function publish(set: LineMark[], key: string, at: number): void {
    shownKey = key;
    shownAt = at;
    marks.value = set;
  }

  function publishNow(state: TrailState, m: 'running' | 'paused' | 'stopped'): void {
    const a = current.value!;
    const set = a.kit.lineMarks(state, m, reduced.value);
    publish(set, a.kit.marksKey(set), now());
  }

  function readRegs(withChanges: boolean): RegSnap {
    const a = current.value!;
    const snap = a.kit.readRegisters(a.runner.machine);
    const prevSnap = withChanges ? pauseSnap : null;
    registers.value = { snap, rows: a.kit.registerRows(snap, prevSnap), flags: a.kit.flagRows(snap.af & 0xff, prevSnap === null ? null : prevSnap.af & 0xff) };
    pcAddr.value = snap.pc;
    return snap;
  }

  function setMode(m: DebugMode): void {
    mode.value = m;
    if (m !== 'idle') deps.state(m);
  }

  /** The current source's breakpoints into emu, when the Run is of this very text. */
  function apply(): void {
    const a = current.value;
    if (a === null || !live.value) {
      inactive.value = [];
      return;
    }
    inactive.value = a.stepper.setBreakpoints(breakpoints.value).inactive;
  }

  function save(): void {
    const src = sources.current.value;
    if (src === null) return;
    const have = src.breakpoints ?? [];
    if (have.length === breakpoints.value.length && have.every((n, k) => n === breakpoints.value[k])) return;
    sources.update(src.id, { breakpoints: [...breakpoints.value] });
  }

  function setBreakpoints(lines: readonly number[]): void {
    breakpoints.value = [...new Set(lines)].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
    save();
    apply();
  }

  // Each source shows its own breakpoints.
  watch(
    () => sources.current.value?.id,
    () => {
      breakpoints.value = [...(sources.current.value?.breakpoints ?? [])];
      apply();
    },
    { immediate: true },
  );
  // A change to them from elsewhere (they are the source's) shows too; our own saves match already.
  watch(
    () => sources.current.value?.breakpoints,
    (b) => {
      const want = b ?? [];
      if (want.length === breakpoints.value.length && want.every((n, k) => n === breakpoints.value[k])) return;
      breakpoints.value = [...want];
      apply();
    },
  );
  // Back to the Run's text (an undo): its breakpoints apply again; away from it, none are hollow.
  watch(live, apply);

  /** A sentence for the pause or step that just happened. */
  function sentence(r: Runner, a: DebugRun, line: number | null, changed: string[] | null): string {
    const listed = line === null ? undefined : a.result.listing.find((l) => l.line === line);
    if (line !== null) {
      const code = listed === undefined ? '' : `, ${codeOf(listed.text)}`;
      if (changed !== null) return `Line ${line}${code}.${changed.length > 0 ? ` Changed: ${changed.join(', ')}.` : ''}`;
      return `Paused at line ${line}${code}${r.pausedBy?.kind === 'break' ? ', at a breakpoint' : ''}.`;
    }
    const pc = r.pc;
    const rom = pc < a.kit.romEnd(r.machine.model);
    const name = rom ? a.kit.romNameAt(pc, r.machine.model) : undefined;
    const where = `${hex4(pc)}${rom ? ' in the ROM' : ', outside the program'}${name === undefined ? '' : ` (${name.entry.purpose})`}`;
    const last = prev?.out ?? null;
    const tail = last === null ? '' : `; the program's last line was ${last}`;
    if (changed !== null) return `${where[0]!.toUpperCase()}${where.slice(1)}${tail}.${changed.length > 0 ? ` Changed: ${changed.join(', ')}.` : ''}`;
    return `Paused at ${where}${tail}.`;
  }

  /** A stepper action's result: a sentence means the CPU cannot move on. */
  function after(why: string | null): void {
    const a = current.value;
    if (why !== null) {
      say(why, true);
      speak(why, false);
    }
    if (a !== null && a.runner.state === 'running') setMode('running');
  }

  const control: DebugControl = {
    mode,
    marks,
    pcAddr,
    breakpoints,
    inactive,
    dirty,
    live,
    follow,
    reduced,
    registers,
    reveal,
    announce,
    announcement,
    toggleBreakpoint(line) {
      setBreakpoints(breakpoints.value.includes(line) ? breakpoints.value.filter((n) => n !== line) : [...breakpoints.value, line]);
    },
    setBreakpoints,
    inactiveWhy(line) {
      const a = current.value;
      return (a !== null && live.value ? a.kit.inactiveReason(a.result, line) : null) ?? `Line ${line} has no instruction to stop at.`;
    },
    pause() {
      current.value?.runner.pause();
    },
    continue() {
      const a = current.value;
      if (a === null) return;
      if (!started && a.runner.state === 'paused') {
        // A runner that never ran: start() honours a breakpoint on the entry line.
        started = true;
        a.runner.start();
        return after(null);
      }
      after(a.stepper.continue());
    },
    step() {
      const a = current.value;
      if (a === null) return;
      after(a.stepper.step());
    },
    stepOver() {
      const a = current.value;
      if (a === null) return;
      after(a.stepper.stepOver());
    },
    runToLine(line) {
      const a = current.value;
      if (a === null || a.runner.state === 'stopped') return;
      if (!live.value) return say(SOURCE_CHANGED, true);
      const addr = a.kit.breakAddress(a.result, line);
      const why = a.kit.inactiveReason(a.result, line);
      if (addr === null || why !== null) {
        say(`${why ?? `Line ${line} has no instruction to stop at.`} Pick a line with an instruction, then try again.`, true);
        return;
      }
      after(a.stepper.runTo([addr], line));
    },
    runToAddr(addr) {
      const a = current.value;
      if (a === null) return;
      after(a.stepper.runTo([addr & 0xffff]));
    },
    attach(run) {
      current.value = run;
      prev = undefined;
      shownKey = '';
      shownAt = -Infinity;
      regsAt = -Infinity;
      pauseSnap = null;
      started = run.runner.state !== 'paused' || run.runner.pausedBy !== null;
      registers.value = null;
      reveal.value = null;
      announce.value = null;
      announcement.value = null;
      marks.value = [];
      inactive.value = live.value ? run.inactive : [];
      setMode(run.runner.state === 'running' ? 'running' : run.runner.state);
    },
    detach() {
      current.value = null;
      prev = undefined;
      shownKey = '';
      marks.value = [];
      pcAddr.value = null;
      registers.value = null;
      inactive.value = [];
      mode.value = 'idle';
    },
    frame(r) {
      const a = current.value;
      if (a === null || r !== a.runner || r.state !== 'running') return;
      if (mode.value !== 'running') setMode('running');
      const t = a.kit.trailOf(r.machine, a.result, prev);
      prev = t;
      const set = a.kit.lineMarks(t, 'running', reduced.value);
      const key = a.kit.marksKey(set);
      const at = now();
      if (at - regsAt >= REGISTERS_INTERVAL_MS) {
        // On a 250 ms beat, not 250 ms after the frame that read them: 4 a second at any frame rate.
        regsAt = at - regsAt < 2 * REGISTERS_INTERVAL_MS ? regsAt + REGISTERS_INTERVAL_MS : at;
        readRegs(false);
      }
      if (key === shownKey || at - shownAt < (reduced.value ? REDUCED_INTERVAL_MS : MARKS_INTERVAL_MS)) return;
      publish(set, key, at);
    },
    paused(r) {
      const a = current.value;
      if (a === null || r !== a.runner) return;
      const stepped = r.pausedBy?.kind === 'step';
      setMode('paused');
      const t = a.kit.trailOf(r.machine, a.result, prev);
      prev = t;
      publishNow(t, 'paused');
      const before = pauseSnap;
      const snap = readRegs(true);
      pauseSnap = snap;
      const line = t.now;
      reveal.value = { line: line ?? t.out };
      const text = sentence(r, a, line, stepped && before !== null ? changedNames(snap, before) : stepped ? [] : null);
      say(text);
      speak(text, stepped);
    },
    stopped(r) {
      const a = current.value;
      if (a === null || r !== a.runner) return;
      setMode('stopped');
      publishNow({ now: r.stopLine, trail: [], out: null }, 'stopped');
    },
  };
  return control;
}
