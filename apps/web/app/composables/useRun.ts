// Run ▶ (plan 5B, Task 4): one press assembles the current source and runs it on a fresh
// Machine. Errors go to Source ✎ (`report`, and `reveal` for the first). A clean program
// refreshes its own listing quietly (Ruling 10); code in the ROM's space is refused on any ROM;
// with no ROM stored a program that needs one is refused, and the rest run on the stub ROM. The
// ROM-copy notes go to Source's list as warnings. The work itself (utils/emulator/run-once), asm,
// emu and the ROM store load with the kit on the first Run; the page loads this file itself on
// the first Run, so none of it is on the first screen. `lastResult` and `runner` are kept for 5C.
//
// A Run waits for its parts (the kit, the ROM store, the ROM's bytes). Stop, Close and leaving the
// page cancel a Run still waiting: it never starts afterwards. After the wait it reads the current
// source again and runs that, so what runs, and the line an error reveals, is the text on screen
// when it starts, not when Run was pressed. Switching source or model stops a running program.
//
// 5C: `debug` (composables/useDebug) is the running line's coordinator. Each Run hands it the
// runner and its Stepper, after applying the source's saved breakpoints before the first frame.
//
// 5D: the TRS-80 is simply on. `powerOn` boots the model's stored ROM live, with no program: a
// programless runner (`result: null`), never attached to `debug`, running the ROM's own start-up in
// the frame loop. `reset` does it again, `powerOff` stops it. `runExample` runs a bundled game's main
// build, also programless, on the booted snapshot. A Run, a power-on and a Program to try each
// replace whatever runs (one runner), and share the generation counter, so each cancels another
// still loading. Changing the model while the machine is on turns the new model on.
import { computed, effectScope, ref, shallowRef, watch } from 'vue';
import type { ComputedRef, Ref, ShallowRef } from 'vue';
import type { AsmResult, Diagnostic } from '@fugloy/asm';
import type { Model } from '@fugloy/emu';
import { defaultDos } from '@fugloy/disasm';
import type { SymbolSelection } from '@fugloy/disasm';
import { exampleById } from '../data/examples';
import type { ExampleId } from '../data/examples';
import type { RunKit } from '../utils/emulator/kit';
import type { Runner, RunnerOptions, RunnerState } from '../utils/emulator/runner';
import type { Roms } from './useRoms';
import { createDebug } from './useDebug';
import type { Debug } from './useDebug';
import { useSources } from './useSources';
import type { Source, Sources } from './useSources';
import { useWorkbench } from './useWorkbench';
import type { Workbench } from './useWorkbench';

export type { RunKit };
export const NO_SOURCE = 'There is no source to run. Open Source ✎ to write a program, then press Run.';
export const STOPPED = 'Stopped. Press Run to start again.';
/**
 * utils/lazy's loadFailed('The emulator', 'Press Run again'), written out: importing utils/lazy
 * from this lazy module would make the page's chunk export it, which costs the first screen.
 */
export const KIT_FAILED = 'The emulator could not be loaded: the connection may have dropped, or the site was updated since this page opened. Press Run again, or reload the page if that fails.';
export const STOPPED_SOURCE = 'The program stopped because you switched to another source. Press Run to run this one.';
export const STOPPED_MODEL = 'The program stopped because you changed the model. Press Run to run the source on this one.';

/**
 * utils/emulator/rom-ids's MODEL_NAMES, written out: importing rom-ids here would bring emu's hash
 * table into this chunk, out of the kit's (test/run-machine.test.ts checks they agree).
 */
const MODEL_NAMES: Readonly<Record<Model, string>> = { 1: 'Model I', 3: 'Model III', 4: 'Model 4' };

export const NO_ROM_POWER = (m: Model): string => `There is no ${MODEL_NAMES[m]} ROM in this browser, so the ${MODEL_NAMES[m]} cannot be turned on. Add your ROM below.`;
export const EXAMPLE_NEEDS_ROM = (title: string, m: Model): string => `${title} needs the ${MODEL_NAMES[m]} ROM, which is not in this browser yet. Add your ROM below, then press Run again.`;
export const POWERED_ON = (m: Model): string => `The ${MODEL_NAMES[m]} is on. Type to it on the screen.`;
const EXAMPLE_RUNNING = (title: string, m: Model): string => `${title} is running on your ${MODEL_NAMES[m]} ROM.`;
const EXAMPLE_FAILED = (title: string): string => `${title} could not be loaded: the connection may have dropped, or the site was updated since this page opened. Press Run again, or reload the page if that fails.`;
const POWER_FAILED = (m: Model, err: unknown): string =>
  `The ${MODEL_NAMES[m]} could not be turned on (${err instanceof Error ? err.message.replace(/\.$/, '') : String(err)}). Check the ROM below, or reload the page if it happens again.`;

/** What the runner is: none, the machine on with no program, or a program (a Run's or a Program to try's). */
export type Power = 'off' | 'on' | 'program';

/** What the last Run found, for Source's list: asm's diagnostics, and the ROM notes as warnings, for `text`. */
export interface RunReport {
  text: string;
  diagnostics: readonly Diagnostic[];
  notes: readonly Diagnostic[];
}

export interface Run {
  run(): Promise<void>;
  /** Stops the program, or cancels a Run still loading its parts (Stop, Close, leaving the page). */
  stop(): void;
  runner: ShallowRef<Runner | null>;
  lastResult: ShallowRef<AsmResult | null>;
  /** What Run says: running on what, why it stopped, or why it did not run. */
  message: Ref<string | null>;
  /** The message is a problem (a refusal, an error, a trap), not news. */
  problem: Ref<boolean>;
  state: Ref<RunnerState | 'idle'>;
  report: ShallowRef<RunReport | null>;
  /** Source ✎ shows `line` and moves its cursor there (a new object each time): set when a Run found errors (the first), and by Run ▶'s breakpoint list (Go to line). */
  reveal: ShallowRef<{ line: number } | null>;
  /** The last clean Run's program into the listing, even over a program opened from a file. */
  showInListing(): Promise<void>;
  /** The last Run wrote a program that Show in Listing can open (cleared by every Run that writes none). */
  listable: ComputedRef<boolean>;
  /** Called after each frame the runner runs, and when a run starts; returns the unsubscribe. */
  onFrame(cb: (r: Runner) => void): () => void;
  busy: Ref<boolean>;
  /** The running line, breakpoints and stepping (5C). */
  debug: Debug;
  /** 'on' while the machine runs (or is paused) with no program, 'program' while a Run or a Program to try does, else 'off'. */
  power: ComputedRef<Power>;
  /** Stops anything running, then turns on the current source's model (the Model III with no source) from its stored ROM. */
  powerOn(): Promise<void>;
  /** Turns the machine's model on again from the start. */
  reset(): Promise<void>;
  /** The same as `stop()`. */
  powerOff(): void;
  /** Pauses the runner itself (the machine, or a Program to try: neither has the debugger). */
  pauseMachine(): void;
  /** Continues a runner paused by `pauseMachine`. */
  continueMachine(): void;
  /** Runs a bundled game's main build on its model's stored ROM, programless. Armored Patrol is not offered (it throws). */
  runExample(id: ExampleId): Promise<void>;
  /** The model the current machine runs, of any kind; null with none. */
  machineModel: Ref<Model | null>;
}

export interface RunDeps {
  sources?: Sources;
  roms?: Roms;
  wb?: Workbench;
  kit?: () => Promise<RunKit>;
  /** The runner's clock, for the tests. */
  runner?: Pick<RunnerOptions, 'schedule' | 'cancel' | 'now'>;
  /** Fetches a Program to try's bytes (default globalThis.fetch); the tests pass their own. */
  fetch?: typeof fetch | undefined;
}

/**
 * Shows a Source ✎ program's .CMD in the listing (Ruling 10), quietly. Unless `force` (the Run
 * tab's "Show in Listing"), only when no program is open or the open one is this source's own;
 * returns whether it opened. Here, not in useWorkbench, so it loads with Run, off the first screen.
 */
export function openSourceListing(wb: Workbench, bytes: Uint8Array, name: string, opts: { sourceId: string; selection: SymbolSelection; force?: boolean }): boolean {
  const own = wb.session.value === null || wb.origin.value?.sourceId === opts.sourceId;
  if (!own && opts.force !== true) return false;
  const opened = wb.openCount.value;
  wb.openBytes(bytes, name, { selection: opts.selection, origin: 'source', sourceId: opts.sourceId, keepView: own });
  return wb.openCount.value !== opened;
}

const cmdName = (name: string): string => `${name.replace(/\.[^.]*$/, '') || 'program'}.cmd`;

/**
 * A Run, with its watchers (and its coordinator's) in a detached effect scope of their own, so they
 * live as long as the Run whichever component's setup first asked for it.
 */
export function createRun(deps: RunDeps = {}): Run {
  return effectScope(true).run(() => buildRun(deps))!;
}

function buildRun(deps: RunDeps): Run {
  const sources = deps.sources ?? useSources();
  const wb = deps.wb ?? useWorkbench();
  const loadKit = deps.kit ?? (() => import('../utils/emulator/kit'));
  const runner = shallowRef<Runner | null>(null);
  const lastResult = shallowRef<AsmResult | null>(null);
  const message = ref<string | null>(null);
  const problem = ref(false);
  const state = ref<RunnerState | 'idle'>('idle');
  const report = shallowRef<RunReport | null>(null);
  const reveal = shallowRef<{ line: number } | null>(null);
  const busy = ref(false);
  const machineModel = ref<Model | null>(null);
  /** What the current runner is, while there is one. */
  const kind = ref<'on' | 'program'>('program');
  const frameListeners = new Set<(r: Runner) => void>();
  const debug = createDebug({
    sources,
    say: (text, isProblem = false) => say(text, isProblem),
    state: (s) => {
      if (runner.value !== null) state.value = s;
    },
    now: deps.runner?.now,
    wb,
  });
  const frame = (r: Runner): void => {
    // Called through the object: the e2e hook frameCost (pages/index.vue) wraps debug.frame to time it.
    debug.frame(r);
    for (const cb of frameListeners) cb(r);
  };
  /** The source and its program from the last clean Run, for Show in Listing. */
  const clean = shallowRef<{ source: Source; bytes: Uint8Array } | null>(null);

  function say(text: string | null, isProblem = false): void {
    message.value = text;
    problem.value = isProblem;
  }

  function showListing(force: boolean): void {
    if (clean.value === null) return;
    const { source, bytes } = clean.value;
    openSourceListing(wb, bytes, cmdName(source.name), { sourceId: source.id, selection: { machine: source.model, dos: defaultDos(source.model) }, force });
  }

  function onStop(r: Runner): void {
    debug.stopped(r);
    if (runner.value !== r) return;
    state.value = 'stopped';
    if (r.stopReason !== null) say(r.stopReason, true);
    else if (!problem.value) say(STOPPED);
  }

  /** Bumped by every stop, Run, power-on and Program to try: one that began under an older one is cancelled. */
  let generation = 0;

  /** Cancels whatever is still loading (a Run, a power-on, a Program to try); returns the new generation. */
  function cancelLoading(): number {
    generation++;
    busy.value = false;
    return generation;
  }

  /** Stops and forgets the current runner, and the debugger's hold on it. */
  function clearRunner(): void {
    runner.value?.stop();
    runner.value = null;
    machineModel.value = null;
    debug.detach();
    state.value = 'idle';
  }

  /** Starts `r` as the current runner. */
  function startRunner(r: Runner, what: 'on' | 'program', model: Model): void {
    kind.value = what;
    machineModel.value = model;
    runner.value = r;
    r.start();
    state.value = r.state;
  }

  /** The kit and the ROM store, loaded; null (said) when they could not be, or the wait went stale. */
  async function parts(stale: () => boolean): Promise<{ kit: RunKit; roms: Roms } | null> {
    try {
      const [kit, roms] = await Promise.all([loadKit(), deps.roms ?? import('./useRoms').then((m) => m.useRoms())]);
      await roms.start();
      return stale() ? null : { kit, roms };
    } catch {
      if (!stale()) say(KIT_FAILED, true);
      return null;
    }
  }

  /** A programless runner's options: no debugger, its pauses and stops kept in `state`. */
  const machineOptions = (): Omit<RunnerOptions, 'machine' | 'result' | 'stub'> => ({
    ...deps.runner,
    onFrame: frame,
    onStop,
    onPause: (r) => {
      if (runner.value === r) state.value = r.state;
    },
  });

  /** Turns `model` on (or the current source's, or the Model III's), live from its stored ROM. */
  async function boot(model: Model | null): Promise<void> {
    const gen = cancelLoading();
    const stale = (): boolean => gen !== generation;
    clearRunner();
    await sources.start();
    if (stale()) return;
    const got = await parts(stale);
    if (got === null) return;
    const m: Model = model ?? sources.current.value?.model ?? 3;
    const rom = got.roms.have(m) ? await got.roms.bytes(m) : null;
    if (stale()) return;
    if (rom === null) return say(NO_ROM_POWER(m));
    let r: Runner;
    try {
      r = got.kit.createRunner({ ...machineOptions(), machine: got.kit.powerOnMachine(m, rom), result: null, stub: false });
    } catch (err) {
      return say(POWER_FAILED(m, err), true);
    }
    say(POWERED_ON(m));
    startRunner(r, 'on', m);
    frame(r);
  }

  async function runExample(id: ExampleId): Promise<void> {
    // Armored Patrol never reaches its title on the emulator.
    if (id === 'armored-patrol') throw new Error('Armored Patrol is not offered as a Program to try.');
    const ex = exampleById(id);
    const model = ex.machine as Model;
    const gen = cancelLoading();
    const stale = (): boolean => gen !== generation;
    const got = await parts(stale);
    if (got === null) return;
    const rom = got.roms.have(model) ? await got.roms.bytes(model) : null;
    if (stale()) return;
    if (rom === null) return say(EXAMPLE_NEEDS_ROM(ex.title, model), true);
    let cmd: Uint8Array;
    try {
      const res = await (deps.fetch ?? globalThis.fetch)(`/examples/${id}/${ex.mainBuild}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cmd = new Uint8Array(await res.arrayBuffer());
    } catch {
      if (!stale()) say(EXAMPLE_FAILED(ex.title), true);
      return;
    }
    if (stale()) return;
    clearRunner();
    let r: Runner;
    try {
      const machine = got.kit.prepareMachine({ model, rom, cmd });
      r = got.kit.createRunner({ ...machineOptions(), machine, result: null, stub: false });
    } catch (err) {
      return say(err instanceof got.kit.SentenceError ? err.message : POWER_FAILED(model, err), true);
    }
    say(EXAMPLE_RUNNING(ex.title, model));
    startRunner(r, 'program', model);
    frame(r);
  }

  async function go(gen: number): Promise<void> {
    const stale = (): boolean => gen !== generation;
    await sources.start();
    if (stale()) return;
    if (sources.current.value === null) return say(NO_SOURCE, true);
    let kit: RunKit;
    let roms: Roms;
    try {
      [kit, roms] = await Promise.all([loadKit(), deps.roms ?? import('./useRoms').then((m) => m.useRoms())]);
      // The stored ROMs are read before asking which there are: a first Run before the Run tab was ever opened sees them too.
      await roms.start();
    } catch {
      if (stale()) return;
      return say(KIT_FAILED, true);
    }
    if (stale()) return;
    // Read after the wait, and again if it changed while the ROM was read: what runs is the source on screen now.
    let source: Source;
    let rom: Uint8Array | null;
    for (;;) {
      const now = sources.current.value;
      if (now === null) return say(NO_SOURCE, true);
      source = now;
      rom = roms.have(source.model) ? await roms.bytes(source.model) : null;
      if (stale()) return;
      if (sources.current.value === source) break;
    }
    clearRunner();
    clean.value = null;
    const { model, text } = source;
    const out = kit.runOnce(kit, { text, model, rom, breakpoints: source.breakpoints ?? [], runner: { ...deps.runner, onFrame: frame, onStop, onPause: (r) => debug.paused(r) } });
    lastResult.value = out.result;
    report.value = { text, diagnostics: out.diagnostics, notes: out.notes };
    if (out.errorLine !== null) reveal.value = { line: out.errorLine };
    if (out.bytes !== null) {
      clean.value = { source, bytes: out.bytes };
      showListing(false);
    }
    say(out.message, out.problem);
    if (out.runner === null) return;
    startRunner(out.runner, 'program', model);
    if (out.stepper !== null) debug.attach({ kit, runner: out.runner, stepper: out.stepper, result: out.result, inactive: out.inactive, sourceId: source.id, text });
    frame(out.runner);
  }

  function stop(): void {
    const loading = busy.value;
    cancelLoading();
    runner.value?.stop();
    if (loading) say(STOPPED);
  }

  /** Stops the running program with `why` in place of the usual sentence. */
  function halt(why: string): void {
    const r = runner.value;
    if (r === null || r.state === 'stopped') return;
    r.stop();
    say(why);
  }

  const power = computed<Power>(() => {
    if (runner.value === null || state.value === 'idle' || state.value === 'stopped') return 'off';
    return kind.value;
  });

  // Switching source or model leaves nothing on screen that describes the running program: stop it, saying why.
  // The machine on with no program follows the model instead: the new model is turned on.
  watch(
    [() => sources.current.value?.id, () => sources.current.value?.model],
    ([id, model], [oldId]) => {
      if (power.value === 'on') {
        if (model !== undefined && model !== machineModel.value) void boot(model);
        return;
      }
      halt(id !== oldId ? STOPPED_SOURCE : STOPPED_MODEL);
    },
  );

  return {
    async run() {
      if (busy.value) return;
      const gen = cancelLoading();
      busy.value = true;
      try {
        await go(gen);
      } finally {
        if (gen === generation) busy.value = false;
      }
    },
    stop,
    power,
    powerOn: () => boot(null),
    reset: () => boot(machineModel.value),
    powerOff: () => stop(),
    pauseMachine() {
      runner.value?.pause();
    },
    continueMachine() {
      const r = runner.value;
      if (r === null || r.state !== 'paused') return;
      r.continue();
      state.value = r.state;
    },
    runExample,
    machineModel,
    runner,
    lastResult,
    message,
    problem,
    state,
    report,
    reveal,
    busy,
    debug,
    listable: computed(() => clean.value !== null),
    async showInListing() {
      showListing(true);
    },
    onFrame(cb) {
      frameListeners.add(cb);
      return () => frameListeners.delete(cb);
    },
  };
}

let shared: Run | null = null;

/** The page's one Run. */
export function useRun(): Run {
  shared ??= createRun();
  return shared;
}
