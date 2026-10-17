<script setup lang="ts">
// The Manual tab: your own copy of a cited manual, open at the cited printed
// page, with the name or address you came from marked on it when the PDF has a
// text layer. Page through with ← →, zoom with − +; back returns to the
// listing. pdf.js loads the first time this tab opens a manual.
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import type { Cite } from '@fugloy/disasm';
import { useManuals } from '../../composables/useManuals';
import { readerUrl, scanOf } from '../../utils/manuals';
import { sourceOf } from '../../utils/symbol-info';
import type { PdfDoc } from '../../utils/pdf';

export interface ManualRequest {
  cite: Cite;
  /** The name that led here, for the messages. */
  name: string;
  /** What to mark on the cited page, best first. */
  terms: readonly string[];
}

const props = defineProps<{ request: ManualRequest | null }>();
const emit = defineEmits<{ back: [] }>();
const manuals = useManuals();

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3] as const;
const zoom = ref(2);
const page = ref<number | null>(null);
const cited = ref<number | null>(null);
const pages = ref(0);
const loading = ref(false);
const error = ref<string | null>(null);
const mark = ref<string | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const offsetText = ref('');
const doc = shallowRef<PdfDoc | null>(null);
let docSource: string | null = null;
let chain: Promise<void> = Promise.resolve();
let generation = 0;

const source = computed(() => (props.request === null ? undefined : sourceOf(props.request.cite.source)));
const mapping = computed(() => (props.request === null ? 'unset' : manuals.mapping(props.request.cite.source)));
const archive = computed(() => {
  const r = props.request;
  const scan = r === null ? undefined : scanOf(r.cite.source);
  const p = scan?.pages[r?.cite.page ?? ''];
  return scan !== undefined && p !== undefined ? readerUrl(scan.archiveId, p) : (source.value?.url ?? null);
});

async function closeDoc(): Promise<void> {
  const d = doc.value;
  doc.value = null;
  docSource = null;
  if (d !== null) await d.loadingTask.destroy().catch(() => undefined);
}

/** Opens the request's manual (if it is not the open one) and finds the cited page. */
async function open(r: ManualRequest): Promise<void> {
  const gen = ++generation;
  error.value = null;
  mark.value = null;
  loading.value = true;
  try {
    if (docSource !== r.cite.source) {
      await closeDoc();
      const blob = await manuals.blob(r.cite.source);
      if (gen !== generation) return;
      if (blob === null) {
        error.value = 'This manual is no longer stored in this browser. Add it again on the Manuals page.';
        return;
      }
      const { loadPdf } = await import('../../utils/pdf');
      const d = await loadPdf(blob);
      if (gen !== generation) {
        void d.loadingTask.destroy();
        return;
      }
      doc.value = d;
      docSource = r.cite.source;
      pages.value = d.numPages;
    }
    const p = await manuals.pdfPageFor(r.cite);
    if (gen !== generation) return;
    cited.value = p !== null && p >= 1 && p <= pages.value ? p : null;
    page.value = cited.value ?? 1;
  } catch (err) {
    if (gen === generation) error.value = `The PDF could not be opened: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    if (gen === generation) loading.value = false;
  }
}

function draw(): void {
  chain = chain.then(async () => {
    const d = doc.value;
    const n = page.value;
    const r = props.request;
    await nextTick();
    const c = canvas.value;
    if (d === null || n === null || c === null || r === null) return;
    const { renderPage } = await import('../../utils/pdf');
    try {
      const res = await renderPage(d, n, c, n === cited.value ? r.terms : undefined, { scale: ZOOMS[zoom.value] });
      if (n !== cited.value) mark.value = null;
      else if (res.found !== null) mark.value = res.found === r.name ? `${r.name} is marked on the page.` : `${r.name} is not in the page’s text; ${res.found} is marked.`;
      else mark.value = res.hasText ? `${r.name} is not in this page’s text.` : 'This PDF has no text layer, so nothing can be marked.';
    } catch (err) {
      error.value = `The page could not be drawn: ${err instanceof Error ? err.message : String(err)}`;
    }
  });
}

watch(
  () => props.request,
  (r) => {
    if (r !== null) void open(r).then(draw);
  },
  { immediate: true },
);
watch([page, zoom], draw);

async function setOffset(): Promise<void> {
  const r = props.request;
  const n = Number(offsetText.value);
  if (r === null || !Number.isInteger(n) || n < 1) return;
  await manuals.setOffset(r.cite.source, n);
  await open(r);
  draw();
}

const step = (d: 1 | -1): void => {
  if (page.value !== null) page.value = Math.min(pages.value, Math.max(1, page.value + d));
};

onBeforeUnmount(() => {
  generation++;
  void closeDoc();
});
</script>

<template>
  <div class="flex min-h-0 flex-col gap-2" data-testid="manual-tab">
    <p v-if="request === null" class="fg-muted">Click the title of a citation in the Symbol tab to read your copy of the manual here.</p>
    <template v-else>
      <div class="fg-manual-bar">
        <button type="button" class="fg-button" data-testid="manual-back" @click="emit('back')">← Back to the listing</button>
        <span class="flex-1" />
        <button type="button" class="fg-button" aria-label="Previous PDF page" :disabled="page === null || page <= 1" @click="step(-1)">←</button>
        <span class="fg-mono fg-muted" data-testid="manual-page">{{ page === null ? '–' : `PDF page ${page} of ${pages}` }}</span>
        <button type="button" class="fg-button" aria-label="Next PDF page" :disabled="page === null || page >= pages" @click="step(1)">→</button>
        <button type="button" class="fg-button" aria-label="Zoom out" :disabled="zoom <= 0" @click="zoom--">−</button>
        <span class="fg-mono fg-muted">{{ Math.round(ZOOMS[zoom]! * 100) }}%</span>
        <button type="button" class="fg-button" aria-label="Zoom in" :disabled="zoom >= ZOOMS.length - 1" @click="zoom++">+</button>
      </div>
      <p>
        <span class="fg-strong">{{ source?.title ?? request.cite.source }}</span>, page {{ request.cite.page }}
        <span v-if="cited !== null" class="fg-muted"> (PDF page {{ cited }})</span>
      </p>
      <p v-if="mapping === 'assumed'" class="fg-muted text-xs" data-testid="manual-assumed">Page mapping assumed from the archive.org scan: your PDF is not one Fugløy has checked, but it has the scan’s page count.</p>
      <p v-if="error" class="fg-error" role="alert">{{ error }}</p>
      <p v-else-if="loading" class="fg-muted" role="status">Opening your copy…</p>
      <template v-else-if="cited === null">
        <p data-testid="manual-unmapped">Fugløy does not know which page of your PDF holds printed page {{ request.cite.page }}.</p>
        <form v-if="/^\d+$/.test(request.cite.page)" class="fg-manual-offset" @submit.prevent="setOffset">
          <label for="manual-offset" class="fg-muted">Which PDF page is printed page 1?</label>
          <input id="manual-offset" v-model="offsetText" class="fg-input fg-mono" inputmode="numeric" autocomplete="off" data-testid="manual-offset" />
          <button type="submit" class="fg-button">Set</button>
        </form>
        <p v-else class="fg-muted">This page is not numbered plainly, so page through to find it.</p>
        <p v-if="archive"><a :href="archive" class="fg-inline-link" rel="noopener noreferrer" target="_blank">Open page {{ request.cite.page }} on archive.org</a></p>
      </template>
      <p v-if="mark" class="fg-muted text-xs" role="status" data-testid="manual-mark">{{ mark }}</p>
      <div v-show="page !== null && !error" class="fg-manual-view">
        <canvas ref="canvas" class="fg-manual-canvas" data-testid="manual-canvas" :aria-label="`Page ${page ?? ''} of your copy of ${source?.title ?? ''}`" role="img" />
      </div>
    </template>
  </div>
</template>
