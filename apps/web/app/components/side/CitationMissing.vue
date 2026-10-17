<script setup lang="ts">
// Under a citation whose manual you have not added: the cover (from archive.org,
// so you can be sure you are finding the right book), the cited page in
// archive.org's reader, and a way to add your own copy. The cover is the only
// request to another site, and it carries nothing about your files.
import { computed, inject } from 'vue';
import { routerKey } from 'vue-router';
import type { Cite } from '@fugloy/disasm';
import { coverUrl, readerUrl, scanOf } from '../../utils/manuals';
import { sourceOf } from '../../utils/symbol-info';

const props = defineProps<{ cite: Cite }>();
const router = inject(routerKey, null);
const source = computed(() => sourceOf(props.cite.source));
const scan = computed(() => scanOf(props.cite.source));
/** The cited page in archive.org's reader, when the scan's table lists it; else the item itself. */
const reader = computed(() => {
  const s = scan.value;
  const p = s === undefined ? undefined : s.pages[props.cite.page];
  return s !== undefined && p !== undefined ? readerUrl(s.archiveId, p) : null;
});
const addHref = computed(() => `/manuals?add=${encodeURIComponent(props.cite.source)}`);

function add(e: MouseEvent): void {
  if (router === null || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  void router.push(addHref.value);
}
</script>

<template>
  <div v-if="source" class="fg-cite-missing" data-testid="citation-missing">
    <figure v-if="source.archiveId" class="fg-cover-thumb">
      <img :src="coverUrl(source.archiveId)" :alt="`Cover of ${source.title}`" loading="lazy" referrerpolicy="no-referrer" width="56" height="72" />
      <figcaption class="fg-muted">cover image from archive.org</figcaption>
    </figure>
    <div class="flex flex-col gap-1">
      <a v-if="reader" :href="reader" class="fg-inline-link" rel="noopener noreferrer" target="_blank" data-testid="archive-page">Open page {{ cite.page }} on archive.org</a>
      <a v-else-if="source.url" :href="source.url" class="fg-inline-link" rel="noopener noreferrer" target="_blank" data-testid="archive-page">Find a scan (page {{ cite.page }})</a>
      <a :href="addHref" class="fg-inline-link" data-testid="add-manual" @click="add">Add this manual</a>
    </div>
  </div>
</template>
