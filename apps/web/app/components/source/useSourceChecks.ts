// What Source ✎ and the Learn page's program column share (phase 6B Task 4, from 5B's and 5C's
// Source ✎): one composable, called from either component's setup, so both check a program, list
// its problems, mark breakpoints and show the running line the same way.
//
// - Checking (5B Ruling 13): the text is assembled 250 ms after typing stops (`scheduleCheck`), or
//   at once (`check`); asm throwing is said through `problem`. `show` merges a Run's ROM notes (the
//   ROM-copy warnings run-once builds from romNotes) into the list and the lint marks while the
//   text is the one the Run assembled, and a Run's report for the text on screen stands in for a
//   check. `summary`, `reveal` and `applyListFix` are ProblemsList's.
// - Breakpoints (5C): the source's, hollow where the latest assembly of the text on screen has no
//   instruction to stop at (the last known while a new one is pending).
// - The running line (5C): sent to the editor only when the set changes and never while `root` is
//   hidden (the latest goes once it shows, through an IntersectionObserver); a pause brings its
//   line into view without moving the selection; while running, Follow does so at most 4 times a
//   second, once the line has left view.
// - The debug keys (utils/running/debug-keys, a chunk of their own, tried twice) are installed on
//   mount; F9 and Run to Here use the editor's cursor line.
// It lives in components/source/, a lazy root, so asm stays off every first screen.
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue';
import type { Ref, ShallowRef } from 'vue';
import { assemble } from '@fugloy/asm';
import type { AsmResult, Diagnostic } from '@fugloy/asm';
import type { Run, RunReport } from '~/composables/useRun';
import { RECHECK_DELAY_MS } from '~/utils/source/diagnostics';
import type { AsmFix } from '~/utils/source/diagnostics';
import { fixExpected } from '~/utils/source/fix';
import { inactiveReason } from '~/utils/source/lines';
import type { LineClass } from '~/utils/source/run-marks';

/** The parts of CodeEditor's exposed API this uses. */
export interface EditorHandle {
  setDiagnostics(diags: readonly Diagnostic[], assembled?: string): void;
  setLineDecorations(set: readonly LineClass[]): void;
  setBreakpoints(lines: readonly number[], inactive?: readonly number[], why?: (line: number) => string): void;
  scrollToLine(n: number): void;
  lineVisible(n: number): boolean;
  revealLine(n: number): void;
  cursorLine(): number | null;
  applyFix(fix: AsmFix, expected?: string | null): boolean;
  focus(): void;
}

export interface CheckedSource {
  id: string;
  text: string;
  model: 1 | 3 | 4;
}

export interface SourceChecksOptions {
  current: Readonly<Ref<CheckedSource | null>>;
  editor: Readonly<Ref<EditorHandle | null>>;
  /** The panel the editor is in: marks wait while it is hidden. */
  root: Readonly<Ref<HTMLElement | null>>;
  run: Run;
  /** The last Run's findings (its ROM notes join the list while its text is on screen). */
  report: () => RunReport | null | undefined;
  /** A sentence for something that went wrong here: asm throwing, the debug keys not loading. */
  problem(text: string): void;
  /** Run (F5 with nothing running). */
  runNow(): void;
}

/** In utils/lazy's loadFailed words (lazy code does not import utils/lazy), naming what is lost. */
export const KEYS_FAILED = 'The debug keys could not be loaded: the connection may have dropped, or the site was updated since this page opened. Reload the page to use F9, F10 and the other debug keys.';

const FOLLOW_INTERVAL_MS = 250;
const plural = (k: number, one: string): string => `${k} ${one}${k === 1 ? '' : 's'}`;

interface Hollow {
  lines: number[];
  why: Map<number, string>;
}

export function useSourceChecks(o: SourceChecksOptions) {
  const { current, editor, root, run } = o;
  const debug = run.debug;
  const diagnostics = shallowRef<readonly Diagnostic[]>([]);
  /** The last assembly of a text, from check() or from a Run: the hollow breakpoints' source. */
  const asm: ShallowRef<{ text: string; result: AsmResult } | null> = shallowRef(null);
  /** The text asm read for `diagnostics`, so a fix from a list older than the latest typing is refused. */
  let assembledText = '';

  // Checking.
  let timer: ReturnType<typeof setTimeout> | null = null;
  function cancelCheck(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function show(asmDiags: readonly Diagnostic[], text: string): void {
    const r = o.report();
    const diags = r != null && r.text === text && r.notes.length > 0 ? [...asmDiags, ...r.notes].sort((a, b) => a.line - b.line) : asmDiags;
    diagnostics.value = diags;
    assembledText = text;
    editor.value?.setDiagnostics(diags, text);
  }
  /** Assembles the current source now and shows what asm says. */
  function check(): void {
    cancelCheck();
    const src = current.value;
    if (src === null) {
      diagnostics.value = [];
      return;
    }
    let diags: readonly Diagnostic[];
    try {
      const result = assemble(src.text, { model: src.model });
      asm.value = { text: src.text, result };
      diags = result.diagnostics;
    } catch (err) {
      diags = [];
      o.problem(err instanceof Error ? err.message : String(err));
    }
    show(diags, src.text);
  }
  function scheduleCheck(): void {
    cancelCheck();
    timer = setTimeout(check, RECHECK_DELAY_MS);
  }
  // A Run's findings for the text on screen show at once.
  watch(o.report, (r) => {
    if (r != null && r.text === current.value?.text) {
      // The Run assembled this text: its result stands in for the check it cancels.
      const result = run.lastResult.value;
      if (result !== null) asm.value = { text: r.text, result };
      cancelCheck();
      show(r.diagnostics, r.text);
    }
  });

  // The running line.
  /** The marks the editor should show: none once the text is not what the Run assembled. */
  const shownMarks = computed(() => (debug.live.value ? debug.marks.value : []));
  const keyOf = (set: readonly { line: number; class: string }[]): string => set.map((m) => `${m.line}:${m.class}`).join();
  /** The key of the set the editor has, and a line a pause asked to bring into view while hidden. */
  let sentKey = '';
  let pendingShow: number | null = null;
  let followAt = -Infinity;
  const shown = (): boolean => root.value !== null && (typeof root.value.checkVisibility !== 'function' || root.value.checkVisibility());
  function deliver(): void {
    const ed = editor.value;
    if (ed === null || !shown()) return;
    if (pendingShow !== null && debug.live.value) ed.scrollToLine(pendingShow);
    pendingShow = null;
    const set = shownMarks.value;
    const key = keyOf(set);
    if (key === sentKey) return;
    sentKey = key;
    ed.setLineDecorations(set);
    // Follow: while running, bring the line back into view once it leaves, at most 4 times a second.
    const line = set.find((m) => m.class === 'fg-run-now')?.line;
    if (!debug.follow.value || debug.mode.value !== 'running' || line === undefined) return;
    const at = performance.now();
    if (at - followAt < FOLLOW_INTERVAL_MS || ed.lineVisible(line)) return;
    followAt = at;
    ed.scrollToLine(line);
  }
  watch(shownMarks, deliver);
  // A scroll waiting for the panel to show is stale once the program moves on.
  watch(debug.mode, (m) => {
    if (m !== 'paused') pendingShow = null;
  });
  // A pause or step: its line into view, now or once the panel shows.
  watch(debug.reveal, (r) => {
    if (r === null || r.line === null || !debug.live.value) return;
    pendingShow = r.line;
    deliver();
  });

  // Breakpoints.
  let lastHollow: Hollow = { lines: [], why: new Map() };
  const hollow = computed<Hollow>(() => {
    const a = asm.value;
    if (a === null || a.text !== current.value?.text) return lastHollow;
    const why = new Map<number, string>();
    for (const line of debug.breakpoints.value) {
      const r = inactiveReason(a.result, line);
      if (r !== null) why.set(line, r);
    }
    lastHollow = { lines: [...why.keys()], why };
    return lastHollow;
  });
  const noStop = (line: number): string => `Line ${line} has no instruction to stop at.`;
  function showBreakpoints(): void {
    const h = hollow.value;
    editor.value?.setBreakpoints(debug.breakpoints.value, h.lines, (line) => h.why.get(line) ?? noStop(line));
  }
  watch([debug.breakpoints, hollow], showBreakpoints);

  // Hidden (v-show) and shown again: send what changed meanwhile. Then the debug keys.
  let observer: IntersectionObserver | null = null;
  let uninstallKeys: (() => void) | null = null;
  let gone = false;
  const loadKeys = () => import('~/utils/running/debug-keys');
  onMounted(async () => {
    if (typeof IntersectionObserver === 'function' && root.value !== null) {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) deliver();
      });
      observer.observe(root.value);
    }
    // A chunk of its own, shared with Run ▶; tried twice, then `problem` says so.
    const m = await loadKeys()
      .catch(() => loadKeys())
      .catch(() => null);
    if (gone) return;
    if (m === null) return o.problem(KEYS_FAILED);
    uninstallKeys = m.installDebugKeys(debug, {
      runNow: o.runNow,
      stop: () => run.stop(),
      // The listing's line comes from the Run itself (debug.listingLine), which debug-keys asks.
      cursorLine: (where) => (where === 'source' ? (editor.value?.cursorLine() ?? null) : null),
      say: (text) => {
        run.message.value = text;
        run.problem.value = true;
      },
    });
  });
  onBeforeUnmount(() => {
    gone = true;
    cancelCheck();
    observer?.disconnect();
    uninstallKeys?.();
  });

  // The problems list.
  const summary = computed(() => {
    const n = { error: 0, warning: 0, info: 0 };
    for (const d of diagnostics.value) n[d.severity]++;
    const parts = [n.error && plural(n.error, 'error'), n.warning && plural(n.warning, 'warning'), n.info && plural(n.info, 'note')].filter((p): p is string => typeof p === 'string');
    return parts.length === 0 ? 'No problems: the program assembles.' : parts.join(', ');
  });
  function reveal(line: number): void {
    editor.value?.revealLine(line);
    editor.value?.focus();
  }
  /** The list's Fix: applied only if the line still holds what asm saw; either way the editor keeps the focus (the button may be gone). */
  function applyListFix(fix: AsmFix): void {
    const applied = editor.value?.applyFix(fix, fixExpected(assembledText, fix)) ?? false;
    // A list older than the latest typing: bring it up to date now.
    if (!applied) check();
    editor.value?.focus();
  }

  return {
    diagnostics,
    asm,
    summary,
    check,
    scheduleCheck,
    cancelCheck,
    show,
    reveal,
    applyListFix,
    showBreakpoints,
    deliver,
    /** The text was typed: a pause's line is in the old text; check after the delay. */
    typed(): void {
      pendingShow = null;
      scheduleCheck();
    },
    /** A new document (another source, a new editor) or model: no marks sent yet; breakpoints, marks and a check at once. */
    documentChanged(): void {
      sentKey = '';
      showBreakpoints();
      deliver();
      check();
    },
  };
}
