<script setup lang="ts">
// The workbench. With no program open, the first screen (drop zone and the
// four games); with one, two facing pages: the listing on the left, the
// companion tabs on the right, and the status line under them.
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { addressKey, withHintFile, withSelection } from '@fugloy/disasm';
import type { Row } from '@fugloy/disasm';
import ListingView from '~/components/listing/ListingView.vue';
import FirstScreen from '~/components/FirstScreen.vue';
import StatusLine from '~/components/StatusLine.vue';
import FacingPages from '~/components/workbench/FacingPages.vue';
import PageTabs from '~/components/workbench/PageTabs.vue';
import type { PageTab } from '~/components/workbench/PageTabs.vue';

const wb = useWorkbench();
const { session, rows, cursor, selection, example, facts } = wb;

type LeftTab = 'listing' | 'hints' | 'source';
type RightTab = 'symbol' | 'index' | 'program' | 'run';
const LEFT_TABS: PageTab<LeftTab>[] = [
  { id: 'listing', label: 'Listing' },
  { id: 'hints', label: 'Hints' },
  { id: 'source', label: 'Source ✎', later: true },
];
const RIGHT_TABS: PageTab<RightTab>[] = [
  { id: 'symbol', label: 'Symbol' },
  { id: 'index', label: 'Index' },
  { id: 'program', label: 'Program' },
  { id: 'run', label: 'Run ▶', later: true },
];
const leftTab = ref<LeftTab>('listing');
const rightTab = ref<RightTab>('program');
const listing = ref<InstanceType<typeof ListingView> | null>(null);

function firstCodeAddr(list: readonly Row[]): number | null {
  for (const r of list) if (r.kind === 'code' || r.kind === 'basic') return r.addr;
  return null;
}

/**
 * Scrolls the listing after the pending render, so a call made in the same tick
 * as opening a program reaches the new (keyed) ListingView, not the old one.
 * The last call in a tick wins.
 */
function scrollTo(addr: number): void {
  void nextTick(() => listing.value?.scrollToAddr(addr));
}

/** A program just opened: put the cursor on its first instruction, past the header. */
function showOpened(): void {
  if (session.value === null) return;
  leftTab.value = 'listing';
  const at = cursor.value ?? firstCodeAddr(rows.value);
  if (at === null) return;
  cursor.value = at;
  scrollTo(at);
}
// Sync, so a scroll asked for in the same tick as the open (after it) wins over this default.
watch(wb.openCount, showOpened, { flush: 'sync' });

function onSelect(addr: number, extend: boolean): void {
  if (extend && cursor.value !== null) selection.value = { from: Math.min(cursor.value, addr), to: Math.max(cursor.value, addr) };
  else {
    selection.value = null;
    cursor.value = addr;
  }
}

function onFollow(target: number): void {
  cursor.value = target;
  selection.value = null;
  listing.value?.scrollToAddr(target);
}

const MODEL3 = { machine: 3, dos: 'trsdos' } as const;

/** Re-renders the open program with new rows, for the browser checks: tables toggled, or label names added above the cursor. */
function rerender(kind: 'tables' | 'names'): void {
  const s = session.value;
  if (s === null) return;
  if (kind === 'tables') {
    session.value = withSelection(s, s.selection === undefined ? MODEL3 : undefined);
    return;
  }
  // Name every 20th unnamed data or code row above the cursor's row (by position, not address).
  const named = new Set(s.analysis.symbols.list().map((sym) => sym.addr));
  const hints = [...s.hintFile.hints];
  const cursorAt = cursor.value === null ? -1 : rows.value.findIndex((row) => 'addr' in row && row.addr === cursor.value);
  let n = 0;
  let seen = 0;
  rows.value.forEach((row, i) => {
    if ((row.kind !== 'code' && row.kind !== 'data') || named.has(row.addr)) return;
    if ((cursorAt >= 0 && i >= cursorAt) || seen++ % 20 !== 0) return;
    const key = addressKey(s, row.addr);
    if (key === null) return;
    hints.push({ directive: 'name', name: `TEST_${++n}`, block: key.block, offset: key.offset, line: 0 });
  });
  session.value = withHintFile(s, { ...s.hintFile, hints }, s.hintSource);
}

declare global {
  interface Window {
    /** Drives the workbench from the Playwright checks (test/e2e). Takes only bytes it is handed; fetches nothing. */
    __fugloyTest?: {
      rowCount: () => number;
      scrollToAddr: (addr: number) => void;
      setCursor: (addr: number | null) => void;
      rerender: (kind: 'tables' | 'names') => void;
      load: (bytes: number[], name: string, hints?: string, base?: number) => void;
      /** The open program's loaded bytes, in address order. */
      loadedBytes: () => number[];
    };
  }
}

onMounted(() => {
  // Back from another page with a program still open: show it where it was.
  if (session.value !== null) showOpened();
  window.__fugloyTest = {
    rowCount: () => rows.value.length,
    scrollToAddr: scrollTo,
    setCursor: (addr) => {
      cursor.value = addr;
    },
    rerender,
    load: (bytes, name, hints, base) =>
      wb.openBytes(Uint8Array.from(bytes), name, {
        selection: MODEL3,
        ...(hints === undefined ? {} : { hintText: hints, hintSource: name.replace(/\.[^.]+$/, '.hints') }),
        ...(base === undefined ? {} : { base }),
      }),
    loadedBytes: () => {
      const image = session.value?.module.image;
      return image === undefined ? [] : image.runs().flatMap((r) => Array.from(image.bytes.subarray(r.start, r.end + 1)));
    },
  };
});
onBeforeUnmount(() => {
  delete window.__fugloyTest;
});
</script>

<template>
  <div v-if="session !== null" class="flex min-h-0 flex-1 flex-col" data-testid="workbench">
    <div v-if="wb.error.value !== null" class="fg-problem fg-problem-bar" role="alert">
      <span class="fg-strong">{{ wb.error.value }}</span>
      <span v-for="d in wb.errorDetails.value" :key="d" class="fg-muted fg-mono text-xs">{{ d }}</span>
    </div>
    <FacingPages>
      <template #left-name>Listing</template>
      <template #right-name>Details</template>
      <template #left>
        <PageTabs v-model="leftTab" :tabs="LEFT_TABS" label="Left page" id-prefix="left" />
        <div id="left-panel-listing" v-show="leftTab === 'listing'" role="tabpanel" aria-labelledby="left-tab-listing" class="flex min-h-0 flex-1 flex-col">
          <ListingView
            :key="wb.openCount.value"
            ref="listing"
            class="min-h-0 flex-1"
            :rows="rows"
            :cursor="cursor"
            :selection="selection"
            @select="onSelect"
            @follow="onFollow"
          />
        </div>
        <div id="left-panel-hints" v-show="leftTab === 'hints'" role="tabpanel" aria-labelledby="left-tab-hints" class="fg-panel">
          <p class="fg-muted">The hint file, as you edit, arrives with editing.</p>
          <p v-if="session.hintSource" class="fg-muted">Hints loaded from <span class="fg-mono">{{ session.hintSource }}</span>: {{ session.hintFile.hints.length }}.</p>
        </div>
      </template>
      <template #right>
        <PageTabs v-model="rightTab" :tabs="RIGHT_TABS" label="Right page" id-prefix="right" />
        <div id="right-panel-symbol" v-show="rightTab === 'symbol'" role="tabpanel" aria-labelledby="right-tab-symbol" class="fg-panel">
          <p class="fg-muted">Select a name in the listing to see what it is and where it is used.</p>
        </div>
        <div id="right-panel-index" v-show="rightTab === 'index'" role="tabpanel" aria-labelledby="right-tab-index" class="fg-panel">
          <p class="fg-muted">Every label, routine, and table name, each a link into the listing.</p>
        </div>
        <div id="right-panel-program" v-show="rightTab === 'program'" role="tabpanel" aria-labelledby="right-tab-program" class="fg-panel" data-testid="program-panel">
          <template v-if="example !== null">
            <h2 class="fg-strong text-base font-bold">{{ example.title }}</h2>
            <p>{{ example.authors }}<template v-if="example.publisher">, {{ example.publisher }}</template><template v-if="example.year">, {{ example.year }}</template>.</p>
            <p class="fg-muted">
              {{ example.rights }}: “{{ example.rightsQuote }}”
              (<a :href="example.rightsUrl" class="fg-inline-link" rel="noopener" target="_blank">trs-80.org</a>).
            </p>
          </template>
          <template v-else>
            <h2 class="fg-strong fg-mono text-base font-bold">{{ session.name }}</h2>
            <p v-if="facts?.name" class="fg-muted">Name record: <span class="fg-mono">{{ facts.name }}</span></p>
          </template>
        </div>
      </template>
    </FacingPages>
    <StatusLine />
  </div>
  <FirstScreen v-else />
</template>
