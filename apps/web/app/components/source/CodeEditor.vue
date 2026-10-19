<script setup lang="ts">
// The Source editor: CodeMirror 6 (plan 5B, Ruling 1), loaded only with the
// Source tab's lazy chunk. asm's diagnostics show as lint marks with a Fix
// action; Ctrl+Enter / ⌘+Enter emits `run`; Tab types a tab, and Esc then Tab
// leaves the editor (CodeMirror's tab-focus mode), so the keyboard never gets
// stuck. `setLineDecorations` and `gutterSlot` are for 5C's running line,
// trail and breakpoint gutter.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Compartment, EditorState, Prec, StateEffect, StateField } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, insertTab } from '@codemirror/commands';
import { lintGutter, setDiagnostics as setLint } from '@codemirror/lint';
import type { Diagnostic } from '@fugloy/asm';
import { columnsToRange, toCmDiagnostics } from '~/utils/source/diagnostics';
import type { AsmFix } from '~/utils/source/diagnostics';
import { fixRange, fixSpec } from '~/utils/source/fix';
import { sourceMarks } from '~/utils/source/decorate';

const props = defineProps<{
  /** Which source is open; a new id starts a fresh document (and history). */
  docId: string;
  text: string;
  /** What screen readers call the editor. */
  label: string;
}>();
const emit = defineEmits<{ 'update:text': [text: string]; run: []; fix: [fix: AsmFix] }>();

const host = ref<HTMLElement | null>(null);
let view: EditorView | null = null;

// 5C's line highlights: a set of { line, class }, replaced as a whole.
const setLines = StateEffect.define<{ line: number; class: string }[]>();
const lineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setLines)) continue;
      const doc = tr.state.doc;
      const marks = e.value
        .filter((l) => l.line >= 1 && l.line <= doc.lines)
        .sort((a, b) => a.line - b.line)
        .map((l) => Decoration.line({ class: l.class }).range(doc.line(l.line).from));
      next = Decoration.set(marks, true);
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});
const gutterCompartment = new Compartment();

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
  },
  { dark: true },
);

function extensions(): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    gutterCompartment.of([]),
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
      if (u.docChanged) emit('update:text', u.state.doc.toString());
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

onMounted(() => {
  view = new EditorView({ state: makeState(props.text), parent: host.value! });
});
onBeforeUnmount(() => {
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
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  },
);
watch(
  () => props.label,
  (label) => view?.dispatch({ effects: labelCompartment.reconfigure(EditorView.contentAttributes.of({ 'aria-label': label })) }),
);

/** Applies an asm fix as one undo step; `expected` is the text it was made for, so a stale fix does nothing. Returns whether it applied. */
function applyFix(fix: AsmFix, expected?: string): boolean {
  if (view === null) return false;
  const spec = fixSpec(view.state.doc, fix, expected);
  if (spec === null) return false;
  view.dispatch(spec);
  emit('fix', fix);
  return true;
}

defineExpose({
  /** Shows asm's diagnostics as marks, each fix as a Fix action in its tooltip. */
  setDiagnostics(diags: readonly Diagnostic[]): void {
    if (view === null) return;
    const doc = view.state.doc;
    const marks = toCmDiagnostics(doc, diags, (fix) => {
      // The text the fix was made for, so a fix offered before later typing is refused.
      const r = fixRange(doc, fix);
      applyFix(fix, r === null ? undefined : doc.sliceString(r.from, r.to));
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
  setLineDecorations(set: { line: number; class: string }[]): void {
    view?.dispatch({ effects: setLines.of(set) });
  },
  /** 5C: where the breakpoint gutter goes. */
  gutterSlot: {
    set(ext: Extension): void {
      view?.dispatch({ effects: gutterCompartment.reconfigure(ext) });
    },
  },
});
</script>

<template>
  <div ref="host" class="fg-code-editor min-h-0" data-testid="code-editor" />
</template>
