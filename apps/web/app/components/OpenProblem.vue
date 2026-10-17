<script setup lang="ts">
// What went wrong opening the last file: what it is not, a "Load as raw binary
// at…" offer, and for a PDF a pointer to the Manuals page. Shown on the first
// screen and, as a bar, over the open workbench.
import { ref } from 'vue';
import RawBaseDialog from '~/components/RawBaseDialog.vue';

defineProps<{ bar?: boolean }>();
const wb = useWorkbench();
const askBase = ref(false);

function onRawBase(base: number): void {
  askBase.value = false;
  wb.openRaw(base);
}
</script>

<template>
  <div v-if="wb.error.value !== null" class="fg-problem" :class="{ 'fg-problem-bar': bar }" role="alert" data-testid="open-error">
    <span class="fg-strong">{{ wb.error.value }}</span>
    <span v-for="d in wb.errorDetails.value" :key="d" class="fg-muted fg-mono text-xs">{{ d }}</span>
    <span v-if="wb.rawCandidate.value !== null" class="fg-muted text-xs">
      Fugløy reads <span class="fg-mono">.CMD</span> load modules and tokenized BASIC by their contents.
      <button type="button" class="fg-inline-link" data-testid="load-raw" @click="askBase = true">Load as raw binary at…</button>
    </span>
    <span v-if="wb.suggestManuals.value" class="fg-muted text-xs">
      This looks like a PDF. Manuals go on the <NuxtLink to="/manuals" class="fg-inline-link">Manuals</NuxtLink> page.
    </span>
  </div>
  <RawBaseDialog :open="askBase" :name="wb.rawCandidate.value?.name ?? ''" :size="wb.rawCandidate.value?.bytes.length ?? 0" @load="onRawBase" @close="askBase = false" />
</template>
