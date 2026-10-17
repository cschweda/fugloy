<script setup lang="ts">
// The Explain tab: a plain-English tutor for the line at the cursor. The lead
// sentence first, then a quiet details strip, what a group of lines does (a
// pattern), the routine around the line, the data region a data row belongs
// to (with its picture), and "what's at" previews of each address it uses.
// Every address is a link into the listing (go); every table name opens the
// Symbol tab (table). The engine is @fugloy/disasm's explain; the cache is
// utils/explain-view.
import { computed } from 'vue';
import type { Explanation, Preview, Row, RoutineSummary, TableEntry } from '@fugloy/disasm';
import { hex4 } from '@fugloy/z80';
import ExplainText from './ExplainText.vue';
import RegionPicture from './RegionPicture.vue';
import { detailsText, explainAt, explainRowAt, pictureBytes, summaryAt } from '../../utils/explain-view';

/** What to explain: the clicked row when the cursor is still on it, otherwise the cursor's line. */
export interface ExplainTarget {
  addr: number;
  row?: Row;
}

const props = defineProps<{ target: ExplainTarget | null; /** The tab is showing; while it is not, nothing is recomputed. */ active: boolean }>();
const emit = defineEmits<{ go: [addr: number]; table: [entry: TableEntry] }>();
defineSlots<{ /** Actions under the routine summary (Use as comment). */ 'summary-actions'?: (p: { summary: RoutineSummary }) => unknown }>();

const wb = useWorkbench();

interface View {
  e: Explanation;
  summary: RoutineSummary | null;
  picture: Uint8Array | null;
}

let last: View | null = null;
const view = computed<View | null>(() => {
  const s = wb.session.value;
  const t = props.target;
  if (!props.active) return last;
  if (s === null || t === null) return (last = null);
  const e = t.row === undefined ? explainAt(s, t.addr) : explainRowAt(s, t.row);
  const summary = e.kind === 'code' && e.addr !== null ? summaryAt(s, e.addr) : null;
  const picture = e.region === undefined ? null : pictureBytes(s, e.region);
  return (last = { e, summary, picture });
});

const $ = (n: number): string => `$${hex4(n)}`;
const range = (from: number, to: number): string => (from === to ? $(from) : `${$(from)}–${$(to)}`);

/** A preview goes to its address in the listing; a ROM or hardware name the program does not load opens in the Symbol tab. */
function openPreview(p: Preview): void {
  if (p.entry !== undefined) emit('table', p.entry);
  else emit('go', p.addr);
}
</script>

<template>
  <div data-testid="explain-tab" class="fg-explain">
    <p v-if="view === null" class="fg-muted" data-testid="explain-prompt">Click a line to have it explained.</p>
    <template v-else>
      <h2 v-if="view.e.line !== ''" class="fg-explain-line fg-mono" data-testid="explain-line">{{ view.e.line }}</h2>
      <div class="fg-explain-lead" data-testid="explain-lead">
        <ExplainText :sentences="view.e.sentences" lead @go="emit('go', $event)" @table="emit('table', $event)" />
      </div>
      <p v-if="view.e.details" class="fg-explain-details" data-testid="explain-details">{{ detailsText(view.e.details) }}</p>

      <section v-if="view.e.pattern" data-testid="explain-pattern">
        <h3 class="fg-sec">What these lines do <span class="fg-explain-range fg-mono">{{ range(view.e.pattern.from, view.e.pattern.to) }}</span></h3>
        <ExplainText :sentences="view.e.pattern.sentences" @go="emit('go', $event)" @table="emit('table', $event)" />
      </section>

      <section v-if="view.summary" data-testid="explain-routine">
        <h3 class="fg-sec">The routine <button type="button" class="fg-inline-link fg-mono fg-explain-range" @click="emit('go', view.summary.start)">{{ view.summary.name }}</button></h3>
        <ExplainText :sentences="view.summary.sentences" @go="emit('go', $event)" @table="emit('table', $event)" />
        <slot name="summary-actions" :summary="view.summary" />
      </section>

      <section v-if="view.e.region" data-testid="explain-region">
        <h3 class="fg-sec">The data region <span class="fg-explain-range fg-mono">{{ view.e.region.name }} · {{ range(view.e.region.start, view.e.region.end) }}</span></h3>
        <ExplainText :sentences="view.e.region.sentences" @go="emit('go', $event)" @table="emit('table', $event)" />
        <RegionPicture v-if="view.picture" :bytes="view.picture" :name="view.e.region.name" />
      </section>

      <section v-if="view.e.previews.length > 0" data-testid="explain-previews">
        <h3 class="fg-sec">What’s at these addresses</h3>
        <ul class="fg-uses fg-previews">
          <li v-for="p in view.e.previews" :key="`${p.addr}:${p.title}`">
            <button type="button" class="fg-preview" data-testid="explain-preview" @click="openPreview(p)">
              <span class="fg-preview-title"><span class="fg-mono fg-explain-addr">{{ $(p.addr) }}</span> <span class="fg-mono fg-strong">{{ p.title }}</span><span v-if="p.entry" class="fg-muted"> · in the Symbol tab</span></span>
              <span v-for="(l, i) in p.lines" :key="i" class="fg-preview-line" :class="p.entry ? '' : 'fg-mono'">{{ l }}</span>
              <span v-if="p.comment" class="fg-preview-line fg-muted">; {{ p.comment }}</span>
            </button>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
