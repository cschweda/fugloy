<script setup lang="ts">
// One citation: the source's title and the page, who wrote it, and where to find
// it. `openable` (you have added this manual) turns the title into a button that
// opens your copy at that page (open-manual). Without it, the citation shows the
// cover, the page on archive.org, and "Add this manual".
import { computed } from 'vue';
import type { Cite } from '@fugloy/disasm';
import CitationMissing from './CitationMissing.vue';
import { catalogLabel, sourceLine, sourceOf } from '../../utils/symbol-info';

const props = defineProps<{ cite: Cite; openable?: boolean }>();
const emit = defineEmits<{ 'open-manual': [cite: Cite] }>();
const source = computed(() => sourceOf(props.cite.source));
</script>

<template>
  <li class="fg-cite" data-testid="citation">
    <template v-if="source">
      <button v-if="openable" type="button" class="fg-inline-link fg-strong" data-testid="open-manual" :title="`Open your copy at page ${cite.page}`" @click="emit('open-manual', cite)">{{ source.title }}</button>
      <span v-else class="fg-strong">{{ source.title }}</span>,
      page {{ cite.page }}
      <span class="fg-muted"> · {{ sourceLine(source) }}<template v-if="source.catalog"> · {{ catalogLabel(source.catalog) }}</template></span>
      <template v-if="source.url && openable"> <a :href="source.url" class="fg-inline-link" rel="noopener" target="_blank">archive.org</a></template>
      <CitationMissing v-if="!openable" :cite="cite" />
    </template>
    <template v-else>{{ cite.source }}, page {{ cite.page }}</template>
  </li>
</template>
