<script setup lang="ts">
// Source ✎ (plan 5B, Task 3): the user's Z80 sources in a CodeMirror editor,
// re-assembled 250 ms after typing stops (Ruling 13), each problem marked on
// its line and listed under the editor with its line and, where asm gives an
// exact rewrite, a Fix button. The toolbar picks, makes, renames, deletes and
// downloads sources (useSources, Ruling 11). The page loads this component
// lazily, so CodeMirror and asm stay off the first screen.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { assemble } from '@fugloy/asm';
import type { Diagnostic } from '@fugloy/asm';
import CodeEditor from './CodeEditor.vue';
import ConfirmDialog from '~/components/ConfirmDialog.vue';
import { useSources } from '~/composables/useSources';
import { useOpenAsSource } from '~/composables/useOpenAsSource';
import { download } from '~/utils/exports';
import { RECHECK_DELAY_MS, severityWord } from '~/utils/source/diagnostics';
import { fixExpected } from '~/utils/source/fix';
import type { AsmFix } from '~/utils/source/diagnostics';
import type { RunReport } from '~/composables/useRun';

// `report`: the last Run's findings. Its ROM notes join the list, as warnings, while the text is the one Run assembled.
const props = defineProps<{ report?: RunReport | null }>();
const emit = defineEmits<{ run: []; fix: [fix: AsmFix] }>();

const sources = useSources();
const current = sources.current;
const editor = ref<InstanceType<typeof CodeEditor> | null>(null);
const diagnostics = shallowRef<readonly Diagnostic[]>([]);
/** The text asm read for `diagnostics`, so a fix from a list older than the latest typing is refused. */
let assembledText = '';
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

let timer: ReturnType<typeof setTimeout> | null = null;
function cancelCheck(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}
onBeforeUnmount(cancelCheck);

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
    diags = assemble(src.text, { model: src.model }).diagnostics;
  } catch (err) {
    diags = [];
    problem.value = err instanceof Error ? err.message : String(err);
  }
  show(diags, src.text);
}

function show(asmDiags: readonly Diagnostic[], text: string): void {
  const r = props.report;
  const diags = r != null && r.text === text && r.notes.length > 0 ? [...asmDiags, ...r.notes].sort((a, b) => a.line - b.line) : asmDiags;
  diagnostics.value = diags;
  assembledText = text;
  editor.value?.setDiagnostics(diags, text);
}

function scheduleCheck(): void {
  cancelCheck();
  timer = setTimeout(check, RECHECK_DELAY_MS);
}

function onText(text: string): void {
  const src = current.value;
  if (src === null) return;
  // The reassembly note describes the text as it was opened: the first edit makes it stale.
  if (opened.note.value?.sourceId === src.id) opened.note.value = null;
  sources.update(src.id, { text });
  scheduleCheck();
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
    check();
    if (pendingReveal !== null) editor.value?.revealLine(pendingReveal);
    pendingReveal = null;
  },
  { flush: 'post' },
);

// A Run's findings for the text on screen show at once.
watch(
  () => props.report,
  (r) => {
    if (r != null && r.text === current.value?.text) {
      cancelCheck();
      show(r.diagnostics, r.text);
    }
  },
);

const counts = computed(() => {
  const n = { error: 0, warning: 0, info: 0 };
  for (const d of diagnostics.value) n[d.severity]++;
  return n;
});
const plural = (k: number, one: string): string => `${k} ${one}${k === 1 ? '' : 's'}`;
const summary = computed(() => {
  const { error, warning, info } = counts.value;
  const parts = [error && plural(error, 'error'), warning && plural(warning, 'warning'), info && plural(info, 'note')].filter((p): p is string => typeof p === 'string');
  return parts.length === 0 ? 'No problems: the program assembles.' : parts.join(', ');
});

function reveal(line: number): void {
  editor.value?.revealLine(line);
  editor.value?.focus();
}

function fixLabel(fix: AsmFix): string {
  return `Fix line ${fix.line}: write ${fix.replacement}`;
}

/** The list's Fix: applied only if the line still holds what asm saw; either way the editor keeps the focus (the button may be gone). */
function applyListFix(fix: AsmFix): void {
  const applied = editor.value?.applyFix(fix, fixExpected(assembledText, fix)) ?? false;
  // A list older than the latest typing: bring it up to date now.
  if (!applied) check();
  editor.value?.focus();
}

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
    cancelCheck();
    show(diags, text ?? current.value?.text ?? '');
  },
  revealLine: reveal,
  /** Scrolls to a line and puts the cursor there without taking the focus (Run never moves it), once the editor is there. */
  showLine(line: number): void {
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
  <section class="fg-source" aria-label="Source" data-testid="source-tab">
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
    <CodeEditor
      v-if="ready && current !== null"
      ref="editor"
      class="fg-source-editor"
      :doc-id="current.id"
      :text="current.text"
      :label="`Source of ${current.name}, Z80 assembly. Tab types a tab; press Escape, then Tab, to leave the editor.`"
      @update:text="onText"
      @run="emit('run')"
      @fix="onFix"
      @stale-fix="check"
    />
    <p class="fg-source-hint fg-muted">Tab types a tab. To leave the editor, press Esc, then Tab.</p>
    <div class="fg-source-diags" data-testid="source-diags">
      <h2 id="source-diags-title" class="sr-only">Problems</h2>
      <p class="fg-source-count" role="status" aria-live="polite" data-testid="source-diag-count">{{ summary }}</p>
      <ul v-if="diagnostics.length > 0" aria-labelledby="source-diags-title">
        <li v-for="(d, i) in diagnostics" :key="i" class="fg-source-diag" :class="`fg-source-${d.severity}`" data-testid="source-diag">
          <button type="button" class="fg-source-go" data-testid="source-diag-go" @click="reveal(d.line)">
            <span class="fg-source-sev">{{ severityWord(d.severity) }}</span>
            <span class="fg-source-line fg-mono">Line {{ d.line }}</span>
            <span class="fg-source-msg">{{ d.message }}</span>
          </button>
          <button v-if="d.fix" type="button" class="fg-button fg-source-fix" data-testid="source-diag-fix" :aria-label="fixLabel(d.fix)" @click="applyListFix(d.fix)">Fix</button>
        </li>
      </ul>
    </div>
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
.fg-source-diags { flex: none; max-height: 30%; overflow: auto; padding: 4px 12px 8px; border-top: 1px solid var(--fg-border); font-size: 12px; }
.fg-source-count { margin: 0 0 4px; color: var(--fg-muted); }
.fg-source-diags ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.fg-source-diag { display: flex; align-items: flex-start; gap: 6px; }
.fg-source-go { display: flex; flex: 1; gap: 8px; text-align: left; padding: 2px 4px; border-radius: 3px; color: var(--fg-text); background: none; border: 0; cursor: pointer; }
.fg-source-go:hover { background: var(--fg-hover); }
.fg-source-go:focus-visible { outline: 2px solid var(--fg-accent); outline-offset: 1px; }
.fg-source-sev { flex: none; width: 4.5em; font-weight: 600; }
.fg-source-error .fg-source-sev { color: var(--fg-error); }
.fg-source-warning .fg-source-sev { color: var(--fg-string); }
.fg-source-info .fg-source-sev { color: var(--fg-register); }
.fg-source-line { flex: none; width: 5em; color: var(--fg-line); }
.fg-source-fix { flex: none; padding: 0 8px; }
</style>
