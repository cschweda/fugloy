<script setup lang="ts">
// One citation: the source's title and the page, who wrote it, and where to find
// it. `openable` turns the title into a button that asks for the manual at that
// page (open-manual); the Manuals work (Task 16) sets it once there is a manual
// to open.
import { computed } from 'vue';
import type { Cite } from '@fugloy/disasm';
import { catalogLabel, sourceLine, sourceOf } from '../../utils/symbol-info';

const props = defineProps<{ cite: Cite; openable?: boolean }>();
const emit = defineEmits<{ 'open-manual': [cite: Cite] }>();
const source = computed(() => sourceOf(props.cite.source));
</script>

<template>
  <li class="fg-cite" data-testid="citation">
    <template v-if="source">
      <button v-if="openable" type="button" class="fg-inline-link fg-strong" @click="emit('open-manual', cite)">{{ source.title }}</button>
      <span v-else class="fg-strong">{{ source.title }}</span>,
      page {{ cite.page }}
      <span class="fg-muted"> · {{ sourceLine(source) }}<template v-if="source.catalog"> · {{ catalogLabel(source.catalog) }}</template></span>
      <template v-if="source.url"> <a :href="source.url" class="fg-inline-link" rel="noopener" target="_blank">archive.org</a></template>
    </template>
    <template v-else>{{ cite.source }}, page {{ cite.page }}</template>
  </li>
</template>
