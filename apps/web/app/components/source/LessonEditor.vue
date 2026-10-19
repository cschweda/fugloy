<script setup lang="ts">
// The Learn page's program column (phase 6B Task 4), a lazy root: the lesson's program in Source ✎'s
// CodeMirror editor (CodeEditor), with Run ▶ (and Ctrl/⌘+Enter anywhere on the page), Reset to the
// lesson, Open in the workbench, and Explain's sentence for a clicked line under it.
//
// As in Source ✎, through the same useSourceChecks and ProblemsList: the text is re-assembled 250 ms
// after typing stops and each problem is marked on its line and listed under the editor with a Fix
// button where asm has one; a Run's errors and its ROM notes show at once, and the first error's
// line is revealed; asm throwing, or the debug keys failing to load, is said in a sentence; the
// breakpoint gutter (a click, or F9) holds the source's breakpoints, hollow where a line has no
// instruction; the running line and its trail light the program while the text is the one the Run
// assembled; and the debug keys are installed here.
//
// The program is the page's lesson source (one per lesson, in memory). Each edit is kept in this
// browser through utils/learn/progress 500 ms after typing stops, and at once when the lesson is
// left or the page hidden. Reset to the lesson puts the lesson's program back, forgets the saved
// edit and stops the run. A Run that assembles and starts is clean: the page marks the lesson done
// (`clean`), and its .CMD (asm's toCmd, as the Run kit's) lets a click on a line show Explain's
// sentence for it until the text changes.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { toCmd } from '@fugloy/asm';
import type { AsmResult } from '@fugloy/asm';
import CodeEditor from './CodeEditor.vue';
import ProblemsList from './ProblemsList.vue';
import { useSourceChecks } from './useSourceChecks';
import type { Run } from '~/composables/useRun';
import type { Sources } from '~/composables/useSources';
import type { Lesson } from '~/utils/learn/lesson-format';
import { learnProgress } from '~/utils/learn/learn-run';
import { explainSourceLine } from '~/utils/learn/explain-line';
import { EXPLAIN_NO_CODE, EXPLAIN_PROMPT } from '~/utils/learn/page';

const props = defineProps<{ run: Run; sources: Sources; lesson: Lesson }>();
const emit = defineEmits<{ clean: []; 'open-workbench': [text: string, model: 1 | 3] }>();

/** How long after the last keystroke an edit is kept in the browser. */
const SAVE_DELAY_MS = 500;

const run = props.run;
const debug = run.debug;
const sources = props.sources;
const current = sources.current;
const editor = ref<InstanceType<typeof CodeEditor> | null>(null);
const host = ref<HTMLElement | null>(null);
const isMac = ref(false);
const runKey = computed(() => (isMac.value ? '⌘+Enter' : 'Ctrl+Enter'));
/** A sentence for what went wrong here (asm throwing, the debug keys not loading). */
const problem = ref<string | null>(null);
let gone = false;

// Checking, the problems list, the breakpoints, the running line and the debug keys: Source ✎'s (useSourceChecks).
const checks = useSourceChecks({
  current,
  editor,
  root: host,
  run,
  report: () => run.report.value,
  problem: (text) => {
    problem.value = text;
  },
  runNow: () => void runNow(),
});
const { diagnostics, summary, check, reveal, applyListFix } = checks;

// Keeping the edit.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveNow(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  const src = current.value;
  if (src !== null) learnProgress().saveEdit(props.lesson.slug, src.text);
}
function scheduleSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}
function onPageHide(): void {
  if (saveTimer !== null) saveNow();
}

function onText(text: string): void {
  const src = current.value;
  if (src === null) return;
  sources.update(src.id, { text });
  scheduleSave();
  checks.typed();
}

// Run ▶.
/** The last clean Run: its text, what asm made of it, its .CMD and model, for Explain. */
const clean = shallowRef<{ text: string; result: AsmResult; bytes: Uint8Array; model: 1 | 3 } | null>(null);
async function runNow(): Promise<void> {
  await run.run();
  if (gone) return;
  const result = run.lastResult.value;
  const text = run.report.value?.text;
  if (run.runner.value === null || run.problem.value || result === null || !result.ok || text === undefined) return;
  let bytes: Uint8Array;
  try {
    bytes = toCmd(result);
  } catch {
    return;
  }
  const model = current.value?.model === 1 ? 1 : 3;
  clean.value = { text, result, bytes, model };
  explained.value = null;
  emit('clean');
}

// A Run's first error: its line, revealed.
watch(
  () => run.reveal.value,
  (r) => {
    if (r !== null) editor.value?.revealLine(r.line);
  },
);

// Ctrl/⌘+Enter anywhere on the page (in the editor, CodeMirror's own key handles it first).
function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.defaultPrevented) return;
  if (document.querySelector('dialog[open]') !== null) return;
  e.preventDefault();
  void runNow();
}

// Reset to the lesson.
function resetLesson(): void {
  const src = current.value;
  if (src === null) return;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  learnProgress().clearEdit(props.lesson.slug);
  run.stop();
  sources.update(src.id, { text: props.lesson.program });
  clean.value = null;
  explained.value = null;
  check();
}

function openWorkbench(): void {
  const src = current.value;
  if (src !== null) emit('open-workbench', src.text, src.model === 1 ? 1 : 3);
}

// Explain: a click (or a cursor move by key) on a line.
const explained = ref<string | null>(null);
const explainText = computed(() => explained.value ?? EXPLAIN_PROMPT);
function explainCursor(): void {
  const line = editor.value?.cursorLine() ?? null;
  const c = clean.value;
  if (line === null) return;
  if (c === null || c.text !== current.value?.text) {
    explained.value = null;
    return;
  }
  explained.value = explainSourceLine(c.result, c.bytes, line, c.model) ?? EXPLAIN_NO_CODE(line);
}
const MOVES = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);
function onEditorKeyup(e: KeyboardEvent): void {
  if (MOVES.has(e.key)) explainCursor();
}

// The source (or its model, by the Model switch), once the editor is there: checked at once.
watch(
  [() => current.value?.id, () => current.value?.model, () => editor.value !== null],
  ([id, , mounted]) => {
    if (id !== undefined && mounted) checks.documentChanged();
  },
  { flush: 'post' },
);

onMounted(() => {
  isMac.value = /Mac|iPhone|iPad/.test(navigator.platform);
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('pagehide', onPageHide);
});
onBeforeUnmount(() => {
  gone = true;
  if (saveTimer !== null) saveNow();
  document.removeEventListener('keydown', onKeydown);
  window.removeEventListener('pagehide', onPageHide);
});
</script>

<template>
  <div class="fg-lesson-editor" data-testid="lesson-editor">
    <div class="fg-lesson-bar" role="group" aria-label="Program controls">
      <h2 class="fg-strong">Program</h2>
      <button type="button" class="fg-button fg-button-primary" data-testid="lesson-run" :aria-busy="run.busy.value" :title="`Assemble and run (${runKey})`" @click="runNow">Run ▶</button>
      <button type="button" class="fg-button" data-testid="lesson-reset" title="Put the lesson's own program back, and forget your changes to it" @click="resetLesson">Reset to the lesson</button>
      <button type="button" class="fg-button" data-testid="lesson-open-workbench" title="Copy this program into a new source in the workbench's Source ✎" @click="openWorkbench">Open in the workbench</button>
    </div>
    <!-- A click on a line explains it; with the keyboard, moving the cursor by line does (onEditorKeyup). -->
    <div ref="host" class="fg-lesson-code" @click="explainCursor" @keyup="onEditorKeyup">
      <CodeEditor
        v-if="current !== null"
        ref="editor"
        :doc-id="current.id"
        wrap
        :text="current.text"
        :label="`The program for lesson ${lesson.number}, ${lesson.title}, in Z80 assembly. Tab types a tab; press Escape, then Tab, to leave the editor.`"
        @update:text="onText"
        @update:breakpoints="(lines: number[]) => debug.setBreakpoints(lines)"
        @toggle-breakpoint="(line: number) => debug.toggleBreakpoint(line)"
        @run="runNow"
        @fix="check"
        @stale-fix="check"
      />
    </div>
    <p class="fg-lesson-hint fg-muted">Tab types a tab. To leave the editor, press Esc, then Tab. Click a line's left edge (or press F9) for a breakpoint.</p>
    <p class="fg-lesson-explain" aria-live="polite" data-testid="lesson-explain">{{ explainText }}</p>
    <p v-if="problem !== null" class="fg-lesson-problem" role="alert" data-testid="lesson-problem">{{ problem }}</p>
    <ProblemsList prefix="lesson" :diagnostics="diagnostics" :summary="summary" @reveal="reveal" @fix="applyListFix" />
  </div>
</template>

<style scoped>
.fg-lesson-editor { display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
.fg-lesson-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.fg-lesson-bar h2 { margin: 0 6px 0 0; font-size: 15px; font-weight: 700; }
/* The editor grows with its program and wraps long lines, so it never scrolls inside the page. */
.fg-lesson-code { min-height: 16rem; border: 1px solid var(--fg-border); border-radius: 4px; overflow: hidden; }
.fg-lesson-code :deep(.fg-code-editor) { min-height: 16rem; }
.fg-lesson-hint { margin: 0; font-size: 11px; }
.fg-lesson-explain { margin: 0; min-height: 3em; padding: 8px 10px; border: 1px solid var(--fg-border); border-left: 3px solid var(--fg-register); border-radius: 4px; }
.fg-lesson-problem { margin: 0; color: var(--fg-error); }
</style>
