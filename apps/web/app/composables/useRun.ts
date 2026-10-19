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
import { computed, ref, shallowRef, watch } from 'vue';
import type { ComputedRef, Ref, ShallowRef } from 'vue';
import type { AsmResult, Diagnostic } from '@fugloy/asm';
import { defaultDos } from '@fugloy/disasm';
import type { SymbolSelection } from '@fugloy/disasm';
import type { RunKit } from '../utils/emulator/kit';
import type { Runner, RunnerOptions, RunnerState } from '../utils/emulator/runner';
import type { Roms } from './useRoms';
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
  /** Set when a Run found errors: Source ✎ shows and reveals `line` (a new object each time). */
  reveal: ShallowRef<{ line: number } | null>;
  /** The last clean Run's program into the listing, even over a program opened from a file. */
  showInListing(): Promise<void>;
  /** The last Run wrote a program that Show in Listing can open (cleared by every Run that writes none). */
  listable: ComputedRef<boolean>;
  /** Called after each frame the runner runs, and when a run starts; returns the unsubscribe. */
  onFrame(cb: (r: Runner) => void): () => void;
  busy: Ref<boolean>;
}

export interface RunDeps {
  sources?: Sources;
  roms?: Roms;
  wb?: Workbench;
  kit?: () => Promise<RunKit>;
  /** The runner's clock, for the tests. */
  runner?: Pick<RunnerOptions, 'schedule' | 'cancel' | 'now'>;
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

export function createRun(deps: RunDeps = {}): Run {
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
  const frameListeners = new Set<(r: Runner) => void>();
  const frame = (r: Runner): void => {
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
    if (runner.value !== r) return;
    state.value = 'stopped';
    if (r.stopReason !== null) say(r.stopReason, true);
    else if (!problem.value) say(STOPPED);
  }

  /** Bumped by every stop: a Run that began under an older one is cancelled. */
  let generation = 0;

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
    runner.value?.stop();
    runner.value = null;
    clean.value = null;
    state.value = 'idle';
    const { model, text } = source;
    const out = kit.runOnce(kit, { text, model, rom, runner: { ...deps.runner, onFrame: frame, onStop } });
    lastResult.value = out.result;
    report.value = { text, diagnostics: out.diagnostics, notes: out.notes };
    if (out.errorLine !== null) reveal.value = { line: out.errorLine };
    if (out.bytes !== null) {
      clean.value = { source, bytes: out.bytes };
      showListing(false);
    }
    say(out.message, out.problem);
    if (out.runner === null) return;
    runner.value = out.runner;
    out.runner.start();
    state.value = out.runner.state;
    frame(out.runner);
  }

  /** Stops the running program with `why` in place of the usual sentence. */
  function halt(why: string): void {
    const r = runner.value;
    if (r === null || r.state === 'stopped') return;
    r.stop();
    say(why);
  }

  // Switching source or model leaves nothing on screen that describes the running program: stop it, saying why.
  watch(
    [() => sources.current.value?.id, () => sources.current.value?.model],
    ([id], [oldId]) => halt(id !== oldId ? STOPPED_SOURCE : STOPPED_MODEL),
  );

  return {
    async run() {
      if (busy.value) return;
      busy.value = true;
      const gen = generation;
      try {
        await go(gen);
      } finally {
        if (gen === generation) busy.value = false;
      }
    },
    stop() {
      generation++;
      const loading = busy.value;
      busy.value = false;
      runner.value?.stop();
      if (loading) say(STOPPED);
    },
    runner,
    lastResult,
    message,
    problem,
    state,
    report,
    reveal,
    busy,
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
