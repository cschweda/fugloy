// Run ▶ (plan 5B, Task 4): one press assembles the current source and runs it on a fresh
// Machine. Errors go to Source ✎ (`report`, and `reveal` for the first). A clean program
// refreshes its own listing quietly (Ruling 10); code in the ROM's space is refused on any ROM;
// with no ROM stored a program that needs one is refused, and the rest run on the stub ROM. The
// ROM-copy notes go to Source's list as warnings. The work itself (utils/emulator/run-once), asm,
// emu and the ROM store load with the kit on the first Run, so this file is all the first screen
// carries. `lastResult` and `runner` are kept for 5C.
import { ref, shallowRef } from 'vue';
import type { Ref, ShallowRef } from 'vue';
import type { AsmResult, Diagnostic } from '@fugloy/asm';
import { defaultDos } from '@fugloy/disasm';
import type { RunKit } from '../utils/emulator/kit';
import { loadFailed } from '../utils/lazy';
import type { Runner, RunnerOptions, RunnerState } from '../utils/emulator/runner';
import type { Roms } from './useRoms';
import { useSources } from './useSources';
import type { Source, Sources } from './useSources';
import { useWorkbench } from './useWorkbench';
import type { Workbench } from './useWorkbench';

export type { RunKit };
export const NO_SOURCE = 'There is no source to run. Open Source ✎ to write a program, then press Run.';

/** What the last Run found, for Source's list: asm's diagnostics, and the ROM notes as warnings, for `text`. */
export interface RunReport {
  text: string;
  diagnostics: readonly Diagnostic[];
  notes: readonly Diagnostic[];
}

export interface Run {
  run(): Promise<void>;
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
  let lastClean: { source: Source; bytes: Uint8Array } | null = null;

  function say(text: string | null, isProblem = false): void {
    message.value = text;
    problem.value = isProblem;
  }

  function showListing(force: boolean): void {
    if (lastClean === null) return;
    const { source, bytes } = lastClean;
    wb.openSource(bytes, cmdName(source.name), { sourceId: source.id, selection: { machine: source.model, dos: defaultDos(source.model) }, force });
  }

  function onStop(r: Runner): void {
    if (runner.value !== r) return;
    state.value = 'stopped';
    if (r.stopReason !== null) say(r.stopReason, true);
    else if (!problem.value) say('Stopped. Press Run to start again.');
  }

  async function go(): Promise<void> {
    await sources.start();
    const source = sources.current.value;
    if (source === null) return say(NO_SOURCE, true);
    let kit: RunKit;
    let roms: Roms;
    try {
      [kit, roms] = await Promise.all([loadKit(), deps.roms ?? import('./useRoms').then((m) => m.useRoms())]);
    } catch {
      return say(loadFailed('The emulator', 'Press Run again'), true);
    }
    runner.value?.stop();
    runner.value = null;
    state.value = 'idle';
    const { model, text } = source;
    const rom = roms.have(model) ? await roms.bytes(model) : null;
    const out = kit.runOnce(kit, { text, model, rom, runner: { ...deps.runner, onFrame: frame, onStop } });
    lastResult.value = out.result;
    report.value = { text, diagnostics: out.diagnostics, notes: out.notes };
    if (out.errorLine !== null) reveal.value = { line: out.errorLine };
    if (out.bytes !== null) {
      lastClean = { source, bytes: out.bytes };
      showListing(false);
    }
    say(out.message, out.problem);
    if (out.runner === null) return;
    runner.value = out.runner;
    out.runner.start();
    state.value = out.runner.state;
    frame(out.runner);
  }

  return {
    async run() {
      if (busy.value) return;
      busy.value = true;
      try {
        await go();
      } finally {
        busy.value = false;
      }
    },
    stop: () => runner.value?.stop(),
    runner,
    lastResult,
    message,
    problem,
    state,
    report,
    reveal,
    busy,
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
