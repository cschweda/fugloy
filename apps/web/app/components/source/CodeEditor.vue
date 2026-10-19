<script setup lang="ts">
// The Source editor: CodeMirror 6 (plan 5B, Ruling 1), loaded only with the
// Source tab's lazy chunk. asm's diagnostics show as lint marks with a Fix
// action; Ctrl+Enter / ⌘+Enter emits `run`; Tab types a tab, and Esc then Tab
// leaves the editor (CodeMirror's tab-focus mode), so the keyboard never gets
// stuck. 5C: `setLineDecorations` lights the running line and its trail, and
// the breakpoint gutter (utils/source/run-marks) carries each breakpoint with
// its line through edits, reporting the lines it moved (`update:breakpoints`)
// and a click on a line (`toggle-breakpoint`).
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, insertTab } from '@codemirror/commands';
import { lintGutter, setDiagnostics as setLint } from '@codemirror/lint';
import type { Diagnostic } from '@fugloy/asm';
import { columnsToRange, toCmDiagnostics } from '~/utils/source/diagnostics';
import type { AsmFix } from '~/utils/source/diagnostics';
import { fixExpected, fixSpec } from '~/utils/source/fix';
import { sourceMarks } from '~/utils/source/decorate';
import { breakpointField, breakpointGutter, breakpointLines, external, lineField, setBreakpointMarks, setLines } from '~/utils/source/run-marks';
import type { LineClass } from '~/utils/source/run-marks';

const props = defineProps<{
  /** Which source is open; a new id starts a fresh document (and history). */
  docId: string;
  text: string;
  /** What screen readers call the editor. */
  label: string;
}>();
const emit = defineEmits<{
  'update:text': [text: string];
  run: [];
  fix: [fix: AsmFix];
  'stale-fix': [];
  /** The breakpoint lines after an edit moved or removed some. */
  'update:breakpoints': [lines: number[]];
  /** A click in the breakpoint gutter, on this line. */
  'toggle-breakpoint': [line: number];
}>();

const host = ref<HTMLElement | null>(null);
let view: EditorView | null = null;

const theme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'var(--fg-bg)', color: 'var(--fg-text)', fontSize: '13px' },
    '.cm-scroller': { fontFamily: 'var(--fg-mono)', lineHeight: '1.55' },
    '.cm-content': { caretColor: 'var(--fg-text-strong)', tabSize: '8' },
    '.cm-gutters': { backgroundColor: 'var(--fg-surface)', color: 'var(--fg-line)', borderRight: '1px solid var(--fg-border)' },
    '.cm-activeLine': { backgroundColor: 'var(--fg-cursor)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--fg-cursor)', color: 'var(--fg-text-strong)' },
    '&.cm-focused': { outline: '2px solid var(--fg-accent)', outlineOffset: '-2px' },
    '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--fg-text-strong)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#264f78 !important' },
    '.fg-src-comment': { color: 'var(--fg-comment)', fontStyle: 'italic' },
    '.fg-src-label': { color: 'var(--fg-label)' },
    '.cm-tooltip': { backgroundColor: 'var(--fg-surface)', color: 'var(--fg-text)', border: '1px solid var(--fg-border)' },
    '.cm-diagnosticAction': { backgroundColor: 'var(--fg-accent)', color: '#0d1117', borderRadius: '3px' },
    // 5C: the running line, its trail fading in five steps, the paused line (a solid band and a
    // 3 px bar), the line that called into the ROM, and the line a stop names.
    '.cm-line.fg-run-now': { backgroundColor: 'rgba(126, 231, 135, 0.24)' },
    '.cm-line.fg-run-trail-1': { backgroundColor: 'rgba(126, 231, 135, 0.17)' },
    '.cm-line.fg-run-trail-2': { backgroundColor: 'rgba(126, 231, 135, 0.13)' },
    '.cm-line.fg-run-trail-3': { backgroundColor: 'rgba(126, 231, 135, 0.09)' },
    '.cm-line.fg-run-trail-4': { backgroundColor: 'rgba(126, 231, 135, 0.06)' },
    '.cm-line.fg-run-trail-5': { backgroundColor: 'rgba(126, 231, 135, 0.04)' },
    '.cm-line.fg-run-paused': { backgroundColor: 'rgba(255, 166, 87, 0.22)', boxShadow: 'inset 3px 0 0 var(--fg-string)' },
    '.cm-line.fg-run-out': { backgroundColor: 'rgba(121, 192, 255, 0.12)', boxShadow: 'inset 3px 0 0 var(--fg-register)' },
    '.cm-line.fg-run-stopped': { backgroundColor: 'rgba(255, 161, 152, 0.16)', boxShadow: 'inset 3px 0 0 var(--fg-error)' },
    '.fg-bp-gutter .cm-gutterElement': { cursor: 'pointer', padding: '0 3px', color: 'var(--fg-error)' },
    '.fg-bp-gutter .cm-gutterElement:hover': { backgroundColor: 'var(--fg-hover)' },
    '.fg-bp-off': { color: 'var(--fg-muted)' },
    // The paused line's cell: tinted like its band, with ▶ in place of ● (red when on a breakpoint).
    '.fg-bp-gutter .cm-gutterElement.fg-bp-pc-line': { backgroundColor: 'rgba(255, 166, 87, 0.22)' },
    '.fg-bp-pc': { color: 'var(--fg-string)' },
    '.fg-bp-pc.fg-bp-pc-break': { color: 'var(--fg-error)' },
  },
  { dark: true },
);

// No lintKeymap: its panel (Mod-Shift-m) and F8 duplicate the list under the
// editor, which is the keyboard and screen-reader route to every diagnostic
// and its Fix; the marks and their tooltips are for the mouse.
function extensions(): Extension[] {
  return [
    breakpointGutter((line) => emit('toggle-breakpoint', line)),
    lineNumbers(),
    highlightActiveLineGutter(),
    lintGutter(),
    history(),
    drawSelection(),
    highlightActiveLine(),
    sourceMarks,
    lineField,
    Prec.highest(
      keymap.of([
        { key: 'Mod-Enter', run: () => (emit('run'), true) },
        { key: 'Tab', run: insertTab },
      ]),
    ),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.contentAttributes.of({ spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
    EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      emit('update:text', u.state.doc.toString());
      // A replacement from outside (a restore) is followed by the source's own breakpoints.
      if (u.transactions.some((tr) => tr.annotation(external) === true)) return;
      if (u.startState.field(breakpointField) === u.state.field(breakpointField)) return;
      const before = breakpointLines(u.startState);
      const after = breakpointLines(u.state);
      if (before.join() !== after.join()) emit('update:breakpoints', after);
    }),
    theme,
  ];
}

const labelCompartment = new Compartment();

function makeState(text: string): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [extensions(), labelCompartment.of(EditorView.contentAttributes.of({ 'aria-label': props.label }))],
  });
}

// CodeMirror (6.43) applies typing still in the DOM when a scroll event comes, without reading the
// cursor: a keystroke that lands with a late scroll (a long text cleared, say) leaves the cursor
// before it, and the next keys go in front. Read the DOM first, cursor and all, in the capture
// phase, so CodeMirror's own read finds nothing pending. `observer` is internal; without it, nothing.
interface Observed {
  observer?: { flush?: () => unknown };
}
function readTyping(): void {
  const observer = (view as unknown as Observed | null)?.observer;
  if (typeof observer?.flush === 'function') observer.flush();
}

onMounted(() => {
  view = new EditorView({ state: makeState(props.text), parent: host.value! });
  window.addEventListener('scroll', readTyping, { capture: true, passive: true });
});
onBeforeUnmount(() => {
  window.removeEventListener('scroll', readTyping, { capture: true });
  view?.destroy();
  view = null;
});

watch(
  () => props.docId,
  () => view?.setState(makeState(props.text)),
);
// A change from outside (a restore, say) replaces the text; the editor's own echo does nothing.
watch(
  () => props.text,
  (text) => {
    if (view === null || view.state.doc.toString() === text) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, annotations: external.of(true) });
  },
);
watch(
  () => props.label,
  (label) => view?.dispatch({ effects: labelCompartment.reconfigure(EditorView.contentAttributes.of({ 'aria-label': label })) }),
);

/**
 * Applies an asm fix as one undo step. `expected` is the text it replaces in
 * the source asm assembled (`fixExpected`), so a fix offered before later
 * typing does nothing; null (the fix is not in that source) always refuses.
 * Returns whether it applied.
 */
function applyFix(fix: AsmFix, expected?: string | null): boolean {
  if (view === null || expected === null) return false;
  const spec = fixSpec(view.state.doc, fix, expected);
  if (spec === null) return false;
  view.dispatch(spec);
  emit('fix', fix);
  return true;
}

defineExpose({
  /**
   * Shows asm's diagnostics as marks, each fix as a Fix action in its tooltip.
   * `assembled` is the text asm read (the document now, by default); a fix is
   * refused once the document no longer holds what it replaces.
   */
  setDiagnostics(diags: readonly Diagnostic[], assembled?: string): void {
    if (view === null) return;
    const doc = view.state.doc;
    const text = assembled ?? doc.toString();
    const marks = toCmDiagnostics(doc, diags, (fix) => {
      if (!applyFix(fix, fixExpected(text, fix))) emit('stale-fix');
    });
    view.dispatch(setLint(view.state, marks));
  },
  /** Puts the cursor at the start of the line (1-based), scrolled into the middle of the editor. */
  revealLine(n: number): void {
    if (view === null) return;
    const { from } = columnsToRange(view.state.doc, { line: n, column: 1, endColumn: 1 });
    view.dispatch({ selection: { anchor: from }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
  },
  focus(): void {
    view?.focus();
  },
  applyFix,
  /** 5C: classes on whole lines (the running line, its trail); replaces the last set. */
  setLineDecorations(set: readonly LineClass[]): void {
    view?.dispatch({ effects: setLines.of([...set]) });
  },
  /**
   * 5C: the breakpoints, replacing the last set: ● on each line, ○ on the `inactive` ones (no
   * instruction to stop at), titled by `why`.
   */
  setBreakpoints(lines: readonly number[], inactive: readonly number[] = [], why: (line: number) => string = (n) => `Line ${n} has no instruction to stop at.`): void {
    if (view === null) return;
    const off = new Set(inactive);
    view.dispatch({ effects: setBreakpointMarks.of(lines.map((line) => ({ line, why: off.has(line) ? why(line) : null }))) });
  },
  /** 5C: scrolls line `n` into view, if it is not, without moving the cursor (unlike `revealLine`) or the focus. */
  scrollToLine(n: number): void {
    if (view === null || n < 1 || n > view.state.doc.lines) return;
    view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(n).from, { y: 'nearest' }) });
  },
  /** 5C: the line the cursor is on (1-based), or null before the editor is there. */
  cursorLine(): number | null {
    return view === null ? null : view.state.doc.lineAt(view.state.selection.main.head).number;
  },
  /** 5C: whether line `n` is wholly inside the editor's visible area. */
  lineVisible(n: number): boolean {
    if (view === null || n < 1 || n > view.state.doc.lines) return false;
    const block = view.lineBlockAt(view.state.doc.line(n).from);
    const box = view.scrollDOM.getBoundingClientRect();
    const top = view.documentTop + block.top;
    return top >= box.top && top + block.height <= box.bottom;
  },
});
</script>

<template>
  <div ref="host" class="fg-code-editor min-h-0" data-testid="code-editor" />
</template>
