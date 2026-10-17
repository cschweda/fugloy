<script setup lang="ts">
// Page 1 of your own copy of a manual, small, on the Manuals page. Drawn once
// with pdf.js (loaded on first use), then the PDF is closed.
import { onMounted, ref } from 'vue';
import { useManuals } from '~/composables/useManuals';

const props = defineProps<{ sourceId: string; title: string }>();
const manuals = useManuals();
const canvas = ref<HTMLCanvasElement | null>(null);
const failed = ref(false);

onMounted(async () => {
  try {
    const blob = await manuals.blob(props.sourceId);
    if (blob === null || canvas.value === null) return;
    const { loadPdf, renderPage } = await import('~/utils/pdf');
    const doc = await loadPdf(blob);
    try {
      const page = await doc.getPage(1);
      const width = page.getViewport({ scale: 1 }).width;
      await renderPage(doc, 1, canvas.value, undefined, { scale: 112 / width });
    } finally {
      void doc.loadingTask.destroy();
    }
  } catch {
    failed.value = true;
  }
});
</script>

<template>
  <figure class="fg-cover">
    <canvas v-show="!failed" ref="canvas" class="fg-cover-img" role="img" :aria-label="`Page 1 of your copy of ${title}`" data-testid="manual-thumb" />
    <div v-if="failed" class="fg-cover-card">{{ title }}</div>
    <figcaption class="fg-muted">page 1 of your copy</figcaption>
  </figure>
</template>
