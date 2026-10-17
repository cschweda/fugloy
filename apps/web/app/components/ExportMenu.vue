<script setup lang="ts">
// Export ▾ in the top bar. Downloads are a Blob and an <a download>; nothing is
// sent anywhere. Warnings for a .CAS show under its item before the download.
import { computed, ref } from 'vue';
import { casWarnings, download, exportFile, exportKinds } from '~/utils/exports';
import type { ExportKind } from '~/utils/exports';

const wb = useWorkbench();
const menu = ref<HTMLDetailsElement | null>(null);
const failure = ref<string | null>(null);

const LABELS: Record<ExportKind, { label: string; note: string }> = {
  zmac: { label: 'zmac source', note: 'Reassembles to the same image.' },
  hints: { label: 'Hint file', note: 'Your names, comments and decisions.' },
  ir: { label: 'JSON IR', note: 'The analysis as data.' },
  cmd: { label: '.CMD load module', note: 'For trs80gp, trsjs and other emulators.' },
  cas: { label: '.CAS cassette tape', note: 'For trs80gp, trsjs and other emulators.' },
};

const kinds = computed(() => (wb.session.value === null ? [] : exportKinds(wb.session.value)));
// The workbench's facts, computed once per session, not again here on every edit.
const warnings = computed(() => (wb.session.value === null || wb.facts.value === null ? [] : casWarnings(wb.session.value, wb.facts.value)));
const noEntry = computed(() => {
  const s = wb.session.value;
  return s !== null && s.module.format !== 'bas' && s.analysis.entry === null;
});

function run(kind: ExportKind): void {
  const s = wb.session.value;
  if (s === null) return;
  failure.value = null;
  try {
    download(exportFile(s, kind));
    if (menu.value !== null) menu.value.open = false;
  } catch (err) {
    failure.value = `Could not export: ${err instanceof Error ? err.message : String(err)}`;
  }
}
</script>

<template>
  <details v-if="kinds.length > 0" ref="menu" class="fg-menu" data-testid="export-menu">
    <summary class="fg-link" data-testid="export-summary">Export ▾</summary>
    <div class="fg-menu-panel" role="group" aria-label="Export this program">
      <template v-for="k in kinds" :key="k">
        <button type="button" class="fg-button" :data-testid="`export-${k}`" @click="run(k)">{{ LABELS[k].label }}</button>
        <p class="fg-muted text-xs">{{ LABELS[k].note }}</p>
        <template v-if="k === 'cas'">
          <p v-for="w in warnings" :key="w" class="text-xs" role="note" data-testid="export-warning">Warning: this program {{ w }}. It still downloads.</p>
          <p v-if="noEntry" class="text-xs" role="note" data-testid="export-warning">No entry point: a .CAS needs one, so this cannot be exported.</p>
        </template>
      </template>
      <p v-if="failure !== null" class="text-xs" role="alert" data-testid="export-failure">{{ failure }}</p>
    </div>
  </details>
</template>
