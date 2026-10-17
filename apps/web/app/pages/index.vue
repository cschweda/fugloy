<script setup lang="ts">
// The workbench. With no program open, the first screen (drop zone and the
// four games); with one, two facing pages: the listing on the left, the
// companion tabs on the right, and the status line under them.
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { addressKey, withHintFile, withSelection } from '@fugloy/disasm';
import type { Row, TableEntry } from '@fugloy/disasm';
import ListingView from '~/components/listing/ListingView.vue';
import FirstScreen from '~/components/FirstScreen.vue';
import ConfirmDialog from '~/components/ConfirmDialog.vue';
import OpenProblem from '~/components/OpenProblem.vue';
import StatusLine from '~/components/StatusLine.vue';
import IndexTab from '~/components/side/IndexTab.vue';
import SymbolTab from '~/components/side/SymbolTab.vue';
import { resolveGoTo } from '~/utils/goto';
import { isTyping, keyId } from '~/utils/keys';
import { entryOf } from '~/utils/symbol-info';
import type { FollowInfo } from '~/utils/xrefs';
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
const nav = useNavigation(scrollTo);
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

// Files dropped anywhere on the page, or picked on the first screen. The layout
// stops the browser opening a dropped file; this decides what to do with it.
const reading = ref(false);
/** A program dropped over the open one, waiting for "Replace". */
const pendingReplace = ref<{ bytes: Uint8Array; name: string } | null>(null);

async function receive(file: File): Promise<void> {
  reading.value = true;
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    wb.report(`${file.name} could not be read: ${err instanceof Error ? err.message : String(err)}`);
    return;
  } finally {
    reading.value = false;
  }
  // Opening a program replaces the open one, so ask. Anything else fails
  // without replacing it (a PDF also points at the Manuals page).
  if (wb.wouldReplace(bytes)) pendingReplace.value = { bytes, name: file.name };
  else wb.openBytes(bytes, file.name);
}

function confirmReplace(): void {
  const p = pendingReplace.value;
  pendingReplace.value = null;
  if (p !== null) wb.openBytes(p.bytes, p.name);
}

function onDocumentDrop(e: DragEvent): void {
  const file = e.dataTransfer?.files[0];
  if (file === undefined) return;
  e.preventDefault();
  void receive(file);
}

function onSelect(addr: number, extend: boolean): void {
  if (extend && cursor.value !== null) selection.value = { from: Math.min(cursor.value, addr), to: Math.max(cursor.value, addr) };
  else {
    selection.value = null;
    cursor.value = addr;
  }
}

/** A label opens in the Symbol tab and the cursor goes there (a step back can undo); a table name only fills the panel. */
function showLabel(addr: number): void {
  wb.symbolFocus.value = { kind: 'label', addr };
  rightTab.value = 'symbol';
  go(addr);
}

function showTable(entry: TableEntry): void {
  wb.symbolFocus.value = { kind: 'table', entry };
  rightTab.value = 'symbol';
}

function onFollow(target: number, info: FollowInfo): void {
  if (info.span === 'table') {
    const entry = entryOf(info.table, info.key);
    if (entry !== undefined) showTable(entry);
  } else showLabel(target);
}

/** Goes to an address in the listing, as a followed link: the cursor moves and the step is remembered. */
function go(addr: number): void {
  leftTab.value = 'listing';
  nav.goTo(addr);
}

// The G box, an inline input above the listing.
const goOpen = ref(false);
const goText = ref('');
const goError = ref<string | null>(null);
const goInput = ref<HTMLInputElement | null>(null);

function openGo(): void {
  leftTab.value = 'listing';
  goOpen.value = true;
  goText.value = '';
  goError.value = null;
  void nextTick(() => goInput.value?.focus());
}

function closeGo(): void {
  goOpen.value = false;
  goError.value = null;
}

function submitGo(): void {
  const s = session.value;
  if (s === null) return;
  const r = resolveGoTo(s.analysis, goText.value);
  if (!r.ok) {
    goError.value = r.reason;
    return;
  }
  closeGo();
  go(r.addr);
  // A program label also fills the Symbol tab, as clicking it would.
  if (s.analysis.symbols.has(r.addr)) wb.symbolFocus.value = { kind: 'label', addr: r.addr };
}

/** Every workbench key binding, by `keyId`. Editing keys (C, D, W, S, T, N, ;, undo, redo) join in Task 12. */
const KEYS: Record<string, () => void> = {
  g: openGo,
  'alt+arrowleft': () => nav.back(),
  'alt+arrowright': () => nav.forward(),
};

function onKeydown(e: KeyboardEvent): void {
  if (session.value === null || isTyping(e.target) || e.defaultPrevented) return;
  const action = KEYS[keyId(e)];
  if (action === undefined) return;
  e.preventDefault();
  action();
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
  document.addEventListener('drop', onDocumentDrop);
  document.addEventListener('keydown', onKeydown);
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
  document.removeEventListener('drop', onDocumentDrop);
  document.removeEventListener('keydown', onKeydown);
  delete window.__fugloyTest;
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div v-if="session !== null" class="flex min-h-0 flex-1 flex-col" data-testid="workbench">
      <OpenProblem bar />
      <FacingPages>
        <template #left-name>Listing</template>
        <template #right-name>Details</template>
        <template #left>
          <PageTabs v-model="leftTab" :tabs="LEFT_TABS" label="Left page" id-prefix="left" />
          <div id="left-panel-listing" v-show="leftTab === 'listing'" role="tabpanel" aria-labelledby="left-tab-listing" class="flex min-h-0 flex-1 flex-col">
            <form v-if="goOpen" class="fg-goto" data-testid="goto-box" @submit.prevent="submitGo">
              <label for="goto-input" class="fg-muted">Go to</label>
              <input
                id="goto-input"
                ref="goInput"
                v-model="goText"
                class="fg-input fg-mono"
                placeholder="$4B9E or a label"
                autocomplete="off"
                spellcheck="false"
                data-testid="goto-input"
                :aria-invalid="goError !== null"
                aria-describedby="goto-error"
                @keydown.esc.stop.prevent="closeGo"
              />
              <span id="goto-error" class="fg-goto-error" role="alert" data-testid="goto-error">{{ goError }}</span>
            </form>
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
            <SymbolTab @go="go" />
          </div>
          <div id="right-panel-index" v-show="rightTab === 'index'" role="tabpanel" aria-labelledby="right-tab-index" class="fg-panel">
            <IndexTab @label="showLabel" @table="showTable" @go="go" />
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
    <FirstScreen v-else :reading="reading" @file="receive" />
    <ConfirmDialog
      :open="pendingReplace !== null"
      title="Replace the open program?"
      :message="`Open ${pendingReplace?.name ?? ''} in place of ${session?.name ?? 'the open program'}?`"
      confirm-label="Replace"
      @confirm="confirmReplace"
      @cancel="pendingReplace = null"
    />
  </div>
</template>
