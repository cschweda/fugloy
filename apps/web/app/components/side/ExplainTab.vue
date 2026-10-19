<script setup lang="ts">
// The Explain tab: a plain-English tutor for the line at the cursor. The lead
// sentence first, then a quiet details strip, why the line is there (the
// register the Z80 makes it use, what it does here, why it is written this
// way, and the routine it is part of, muted, when the routine section does
// not show), what a group of lines does (a
// pattern), on a label row who reaches the label, the routine around the line,
// the data region a data row belongs to (with its picture), and "what's at"
// previews of each address it uses.
// Every address is a link into the listing (go); every table name opens the
// Symbol tab (table). The engine is @fugloy/disasm's explain; the cache is
// utils/explain-view. The workbench page loads this component (and with it the engine) by
// dynamic import once a program is open (6B), so neither is on its first screen.
import { shallowRef, watch } from 'vue';
import type { Explanation, Preview, Row, RoutineSummary, Sentence, TableEntry } from '@fugloy/disasm';
import { hex4 } from '@fugloy/z80';
import ExplainText from './ExplainText.vue';
import RegionPicture from './RegionPicture.vue';
import { detailsText, explainAt, explainRowAt, labelSentences, patternSentences, pictureBytes, summaryAt, summaryParts, whyParts } from '../../utils/explain-view';
import type { WhyPart } from '../../utils/explain-view';

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
  /** The summary's first sentences (length, who reaches it, how it ends) and the rest, behind a disclosure. */
  parts: { head: Sentence[]; more: Sentence[] } | null;
  pattern: Sentence[] | null;
  picture: Uint8Array | null;
  /** On a label row (or a label inside an instruction): who calls or jumps to the label, and whether it is the entry point. */
  label: Sentence[] | null;
  /** "Why it’s here": the register, what it does here, the idiom; and the routine reference, shown last and muted, only when the routine section is not shown. */
  why: { parts: WhyPart[]; routine: Sentence[] } | null;
}

// Recomputed only while the tab shows; while it does not, the last view stays as it was.
const view = shallowRef<View | null>(null);
watch(
  [() => wb.session.value, () => props.target, () => props.active] as const,
  ([s, t, active]) => {
    if (!active) return;
    if (s === null || t === null) {
      view.value = null;
      return;
    }
    const e = t.row === undefined ? explainAt(s, t.addr) : explainRowAt(s, t.row);
    const summary = e.kind === 'code' && e.addr !== null ? summaryAt(s, e.addr) : null;
    const picture = e.region === undefined ? null : pictureBytes(s, e.region);
    const onLabel = t.row?.kind === 'label' || e.kind === 'label';
    // The routine section names the routine, so the why section's muted routine line shows only without it.
    view.value = { e, summary, parts: summary === null ? null : summaryParts(summary), pattern: patternSentences(e), picture, label: onLabel ? labelSentences(s, e) : null, why: whyParts(e, summary !== null) };
  },
  { immediate: true },
);

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

      <section v-if="view.why" data-testid="explain-why">
        <h3 class="fg-sec">Why it’s here</h3>
        <div v-for="p in view.why.parts" :key="p.key" class="fg-explain-why" :data-testid="`explain-why-${p.key}`">
          <h4 class="fg-explain-why-title">{{ p.title }}</h4>
          <ExplainText :sentences="p.sentences" @go="emit('go', $event)" @table="emit('table', $event)" />
        </div>
        <div v-if="view.why.routine.length > 0" class="fg-explain-why-routine" data-testid="explain-why-routine">
          <ExplainText :sentences="view.why.routine" @go="emit('go', $event)" @table="emit('table', $event)" />
        </div>
      </section>

      <section v-if="view.label && view.e.label" data-testid="explain-label">
        <h3 class="fg-sec">The label <span class="fg-explain-range fg-mono">{{ view.e.label.name }}</span></h3>
        <ExplainText :sentences="view.label" @go="emit('go', $event)" @table="emit('table', $event)" />
      </section>

      <section v-if="view.e.pattern && view.pattern" data-testid="explain-pattern">
        <h3 class="fg-sec">What these lines do <span class="fg-explain-range fg-mono">{{ range(view.e.pattern.from, view.e.pattern.to) }}</span></h3>
        <ExplainText :sentences="view.pattern" @go="emit('go', $event)" @table="emit('table', $event)" />
      </section>

      <section v-if="view.summary && view.parts" data-testid="explain-routine">
        <h3 class="fg-sec">The routine <button type="button" class="fg-inline-link fg-mono fg-explain-range" @click="emit('go', view.summary.start)">{{ view.summary.name }}</button></h3>
        <ExplainText :sentences="view.parts.head" @go="emit('go', $event)" @table="emit('table', $event)" />
        <details v-if="view.parts.more.length > 0" class="fg-explain-more" data-testid="explain-routine-more">
          <summary>More about this routine</summary>
          <ExplainText :sentences="view.parts.more" @go="emit('go', $event)" @table="emit('table', $event)" />
        </details>
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
          <li v-for="(p, k) in view.e.previews" :key="`${p.addr}:${p.title}`">
            <button type="button" class="fg-preview" data-testid="explain-preview" :aria-describedby="p.lines.length > 0 ? `fg-preview-lines-${k}` : undefined" @click="openPreview(p)">
              <span class="fg-preview-title"><span class="fg-mono fg-explain-addr">{{ $(p.addr) }}</span> <span class="fg-mono fg-strong">{{ p.title }}</span><span v-if="p.entry" class="fg-muted"> · in the Symbol tab</span></span>
              <span v-if="p.comment" class="fg-preview-line fg-muted">; {{ p.comment }}</span>
              <span :id="`fg-preview-lines-${k}`" class="fg-preview-lines" aria-hidden="true"><span v-for="(l, i) in p.lines" :key="i" class="fg-preview-line" :class="p.entry ? '' : 'fg-mono'">{{ l }}</span></span>
            </button>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
