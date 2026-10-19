<script setup lang="ts">
// Source ✎ (plan 5B, Task 3): the user's Z80 sources in a CodeMirror editor,
// re-assembled 250 ms after typing stops (Ruling 13), each problem marked on
// its line and listed under the editor with its line and, where asm gives an
// exact rewrite, a Fix button. The toolbar picks, makes, renames, deletes and
// downloads sources (useSources, Ruling 11). The page loads this component
// lazily, so CodeMirror and asm stay off the first screen.
//
// 5C: the running line and its trail come from the page's Run (`useRun().debug`), shown only while
// the text is the one the Run assembled (otherwise one sentence says why). A set reaches the editor
// only when it changes, and never while this panel is hidden: the latest is sent once it shows. A
// pause brings its line into view without moving the selection; while running, Follow does so at
// most 4 times a second, once the line has left view. The gutter's breakpoints are the source's;
// the hollow ones (no instruction to stop at) come from this tab's own assembly of the text on
// screen, so they are right before any Run and after edits. The debug keys (utils/running/
// debug-keys) are installed here and by Run ▶: F9 toggles the cursor line's breakpoint, and Run to
// Here runs to the cursor line when focus is, or was last, in this editor.
//
// 6B: the checking, the problems list (ProblemsList), the breakpoints, the running line and the
// debug keys are useSourceChecks, shared with the Learn page's program, which works the same way.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import CodeEditor from './CodeEditor.vue';
import ProblemsList from './ProblemsList.vue';
import { useSourceChecks } from './useSourceChecks';
import ConfirmDialog from '~/components/ConfirmDialog.vue';
import { useSources } from '~/composables/useSources';
import { useOpenAsSource } from '~/composables/useOpenAsSource';
import { useRun } from '~/composables/useRun';
import { SOURCE_CHANGED } from '~/composables/useDebug';
import { download } from '~/utils/exports';
import { speakAnnouncements } from '~/utils/running/announce';
import type { Diagnostic } from '@fugloy/asm';
import type { AsmFix } from '~/utils/source/diagnostics';
import type { RunReport } from '~/composables/useRun';

// `report`: the last Run's findings. Its ROM notes join the list, as warnings, while the text is the one Run assembled.
const props = defineProps<{ report?: RunReport | null }>();
const emit = defineEmits<{ run: []; fix: [fix: AsmFix] }>();

const sources = useSources();
const current = sources.current;
const run = useRun();
const debug = run.debug;
const root = ref<HTMLElement | null>(null);
const editor = ref<InstanceType<typeof CodeEditor> | null>(null);
const ready = ref(false);
const problem = ref<string | null>(null);
// Open as source ✎: when the text does not assemble back to the program, one sentence says where.
const opened = useOpenAsSource();
const openNote = computed(() => (opened.note.value !== null && opened.note.value.sourceId === current.value?.id ? opened.note.value.text : null));

onMounted(async () => {
  await sources.start();
  try {
    if (sources.list.value.length === 0) await sources.create();
    else if (current.value === null) await sources.select(sources.list.value[0]!.id);
  } catch (err) {
    problem.value = err instanceof Error ? err.message : String(err);
  }
  ready.value = true;
});

// Checking, the problems list, the breakpoints, the running line and the debug keys (useSourceChecks, shared with the Learn page).
const checks = useSourceChecks({
  current,
  editor,
  root,
  run,
  report: () => props.report,
  problem: (text) => {
    problem.value = text;
  },
  runNow: () => emit('run'),
});
const { diagnostics, summary, check, reveal, applyListFix } = checks;

/** The running line is hidden because the source changed since the Run. */
const runChanged = computed(() => debug.dirty.value && debug.marks.value.length > 0);

let unspeak: (() => void) | null = null;
onMounted(() => {
  unspeak = speakAnnouncements(debug);
});
onBeforeUnmount(() => unspeak?.());

function onBreakpoints(lines: number[]): void {
  debug.setBreakpoints(lines);
}

function onText(text: string): void {
  const src = current.value;
  if (src === null) return;
  // The reassembly note describes the text as it was opened: the first edit makes it stale.
  if (opened.note.value?.sourceId === src.id) opened.note.value = null;
  sources.update(src.id, { text });
  checks.typed();
}

function onFix(fix: AsmFix): void {
  check();
  emit('fix', fix);
}

/** A line Run asked to reveal before the editor was there. */
let pendingReveal: number | null = null;

// A source switched to (or the first one, once the editor is there), or its model changed: check it at once.
watch(
  [() => current.value?.id, () => current.value?.model, () => editor.value !== null],
  ([id, , mounted]) => {
    if (id === undefined || !mounted) return;
    checks.documentChanged();
    if (pendingReveal !== null) editor.value?.revealLine(pendingReveal);
    pendingReveal = null;
  },
  { flush: 'post' },
);

// The toolbar.
async function pick(e: Event): Promise<void> {
  const id = (e.target as HTMLSelectElement).value;
  await sources.select(id);
}

async function makeNew(): Promise<void> {
  await sources.create();
  editor.value?.focus();
}

const renaming = ref(false);
const renameText = ref('');
const renameError = ref<string | null>(null);
const renameInput = ref<HTMLInputElement | null>(null);

function startRename(): void {
  if (current.value === null) return;
  renameText.value = current.value.name;
  renameError.value = null;
  renaming.value = true;
  void nextTick(() => renameInput.value?.select());
}

async function submitRename(): Promise<void> {
  const src = current.value;
  if (src === null) return;
  const refused = await sources.rename(src.id, renameText.value);
  if (refused !== null) {
    renameError.value = refused;
    return;
  }
  renaming.value = false;
  renameError.value = null;
}

function cancelRename(): void {
  renaming.value = false;
  renameError.value = null;
}

const confirmingDelete = ref(false);
async function confirmDelete(): Promise<void> {
  confirmingDelete.value = false;
  const src = current.value;
  if (src === null) return;
  try {
    await sources.remove(src.id);
    if (sources.list.value.length === 0) await sources.create();
  } catch (err) {
    problem.value = err instanceof Error ? err.message : String(err);
  }
}

/** The download's name: the source's, ending in .z. */
const downloadName = computed(() => {
  const name = current.value?.name ?? 'program.z';
  return /\.z$/i.test(name) ? name : `${name}.z`;
});

function downloadSource(): void {
  const src = current.value;
  if (src === null) return;
  download({ filename: downloadName.value, mime: 'text/plain', bytes: new TextEncoder().encode(src.text), warnings: [] });
}

defineExpose({
  /** Shows asm's diagnostics from a fresh assembly of `text` (Run does one; the current text by default) without waiting. */
  showDiagnostics(diags: readonly Diagnostic[], text?: string): void {
    checks.cancelCheck();
    checks.show(diags, text ?? current.value?.text ?? '');
  },
  revealLine: reveal,
  /** Moves the cursor to a line and scrolls it into view, without taking the focus (Run never moves it), once the editor is there. */
  cursorToLine(line: number): void {
    if (editor.value === null) pendingReveal = line;
    else editor.value.revealLine(line);
  },
  /** Reveals the first error (else the first problem), if there is one. */
  revealFirst(): void {
    const d = diagnostics.value.find((x) => x.severity === 'error') ?? diagnostics.value[0];
    if (d !== undefined) reveal(d.line);
  },
  focus(): void {
    editor.value?.focus();
  },
});
</script>

<template>
  <section ref="root" class="fg-source" aria-label="Source" data-testid="source-tab">
    <div class="fg-source-bar" role="group" aria-label="Sources">
      <label for="source-pick" class="sr-only">Source</label>
      <select id="source-pick" class="fg-input fg-mono" data-testid="source-pick" :value="current?.id ?? ''" :disabled="current === null" @change="pick">
        <option v-for="s in sources.list.value" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
      <button type="button" class="fg-button" data-testid="source-new" @click="makeNew">New</button>
      <button type="button" class="fg-button" data-testid="source-rename" :disabled="current === null" @click="startRename">Rename</button>
      <button type="button" class="fg-button" data-testid="source-delete" :disabled="current === null" @click="confirmingDelete = true">Delete</button>
      <button type="button" class="fg-button" data-testid="source-download" :disabled="current === null" :title="`Download ${downloadName}`" @click="downloadSource">Download .z</button>
    </div>
    <form v-if="renaming" class="fg-source-rename" data-testid="source-rename-form" @submit.prevent="submitRename">
      <label for="source-rename-input" class="fg-muted">Name</label>
      <input
        id="source-rename-input"
        ref="renameInput"
        v-model="renameText"
        class="fg-input fg-mono"
        autocomplete="off"
        spellcheck="false"
        data-testid="source-rename-input"
        :aria-invalid="renameError !== null"
        aria-describedby="source-rename-error"
        @keydown.esc.stop.prevent="cancelRename"
      />
      <button type="submit" class="fg-button fg-button-primary">Rename</button>
      <button type="button" class="fg-button" @click="cancelRename">Cancel</button>
      <span id="source-rename-error" class="fg-source-error" role="alert" data-testid="source-rename-error">{{ renameError }}</span>
    </form>
    <p v-if="sources.unavailable.value || sources.saveError.value || problem" class="fg-edit-message" role="alert" data-testid="source-message">
      {{ problem ?? sources.saveError.value ?? sources.unavailable.value }}
    </p>
    <p v-if="openNote !== null" class="fg-source-note" role="note" data-testid="source-open-note">{{ openNote }}</p>
    <p v-if="runChanged" class="fg-source-note" role="note" data-testid="source-run-changed">{{ SOURCE_CHANGED }}</p>
    <CodeEditor
      v-if="ready && current !== null"
      ref="editor"
      class="fg-source-editor"
      :doc-id="current.id"
      :text="current.text"
      :label="`Source of ${current.name}, Z80 assembly. Tab types a tab; press Escape, then Tab, to leave the editor.`"
      @update:text="onText"
      @update:breakpoints="onBreakpoints"
      @toggle-breakpoint="debug.toggleBreakpoint"
      @run="emit('run')"
      @fix="onFix"
      @stale-fix="check"
    />
    <p class="fg-source-hint fg-muted">Tab types a tab. To leave the editor, press Esc, then Tab.</p>
    <ProblemsList class="fg-source-diags" prefix="source" :diagnostics="diagnostics" :summary="summary" @reveal="reveal" @fix="applyListFix" />
    <ConfirmDialog
      testid="source-delete-dialog"
      :open="confirmingDelete"
      :title="`Delete ${current?.name ?? 'this source'}?`"
      :message="`${current?.name ?? 'This source'} is removed from this browser. Download it first if you want to keep a copy.`"
      confirm-label="Delete"
      focus-cancel
      @confirm="confirmDelete"
      @cancel="confirmingDelete = false"
    />
  </section>
</template>

<style scoped>
.fg-source { display: flex; flex: 1; min-height: 0; flex-direction: column; }
.fg-source-bar, .fg-source-rename { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 12px; border-bottom: 1px solid var(--fg-border); font-size: 12px; }
.fg-source-bar select { max-width: 16rem; }
.fg-source-error { color: var(--fg-error); }
.fg-source-note { flex: none; margin: 0; padding: 4px 12px; font-size: 12px; border-bottom: 1px solid var(--fg-border); color: var(--fg-string); }
.fg-source-editor { flex: 1; min-height: 8rem; overflow: hidden; }
.fg-source-hint { flex: none; margin: 0; padding: 2px 12px; font-size: 11px; border-top: 1px solid var(--fg-border); }
.fg-source-diags { flex: none; max-height: 30%; overflow: auto; padding: 4px 12px 8px; border-top: 1px solid var(--fg-border); }
</style>
