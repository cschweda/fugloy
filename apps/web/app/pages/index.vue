<script setup lang="ts">
// The workbench. With no program open, the first screen (drop zone and the
// four games); with one, two facing pages: the listing on the left, the
// companion tabs on the right, and the status line under them.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { addressKey, withHintFile, withSelection } from '@fugloy/disasm';
import { download } from '~/utils/exports';
import { MODEL3_DEFAULT } from '~/composables/useWorkbench';
import type { Row, TableEntry } from '@fugloy/disasm';
import ListingView from '~/components/listing/ListingView.vue';
import InlineEdit from '~/components/listing/InlineEdit.vue';
import RowMenu from '~/components/listing/RowMenu.vue';
import HintsTab from '~/components/HintsTab.vue';
import FirstScreen from '~/components/FirstScreen.vue';
import ConfirmDialog from '~/components/ConfirmDialog.vue';
import CarryOverDialog from '~/components/CarryOverDialog.vue';
import OpenProblem from '~/components/OpenProblem.vue';
import StatusLine from '~/components/StatusLine.vue';
import IndexTab from '~/components/side/IndexTab.vue';
import ProgramTab from '~/components/side/ProgramTab.vue';
import SymbolTab from '~/components/side/SymbolTab.vue';
import ManualTab from '~/components/side/ManualTab.vue';
import type { ManualRequest } from '~/components/side/ManualTab.vue';
import { useManuals } from '~/composables/useManuals';
import { asHintText } from '~/utils/hint-drop';
import { GOTO_PLACEHOLDER, resolveGoTo } from '~/utils/goto';
import { followOf, stepCursor } from '~/utils/edit-targets';
import { cursorRowIndex, rowLookup } from '~/utils/row-lookup';
import type { KeyBinding } from '~/composables/useWorkbenchKeys';
import { entryOf } from '~/utils/symbol-info';
import type { FollowInfo } from '~/utils/xrefs';
import FacingPages from '~/components/workbench/FacingPages.vue';
import PageTabs from '~/components/workbench/PageTabs.vue';
import type { PageTab } from '~/components/workbench/PageTabs.vue';

usePageSeo({
  title: 'Fugløy',
  description: 'Open a TRS-80 .CMD or .BAS program and read it as Z80 assembly with named ROM and DOS routines, in your browser. Free, and your files never leave your machine.',
  path: '/',
});
useHead({
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'Fugløy',
        description: 'A TRS-80 Model I and III disassembler workbench that runs in the browser.',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Any (web browser)',
        url: `${SITE_ORIGIN}/`,
        image: `${SITE_ORIGIN}/og-image.png`,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        license: 'https://spdx.org/licenses/MIT.html',
        codeRepository: 'https://github.com/cschweda/fugloy',
      }),
    },
  ],
});

const wb = useWorkbench();
const { session, rows, cursor, selection, example, facts } = wb;

type LeftTab = 'listing' | 'hints' | 'source';
type RightTab = 'symbol' | 'index' | 'program' | 'manual' | 'run';
const LEFT_TABS: PageTab<LeftTab>[] = [
  { id: 'listing', label: 'Listing' },
  { id: 'hints', label: 'Hints' },
  { id: 'source', label: 'Source ✎', later: true },
];
const RIGHT_TABS: PageTab<RightTab>[] = [
  { id: 'symbol', label: 'Symbol' },
  { id: 'index', label: 'Index' },
  { id: 'program', label: 'Program' },
  { id: 'manual', label: 'Manual' },
  { id: 'run', label: 'Run ▶', later: true },
];
const leftTab = ref<LeftTab>('listing');
const rightTab = ref<RightTab>('program');
const persistence = usePersistence();
const nav = useNavigation(scrollTo);
const listing = ref<InstanceType<typeof ListingView> | null>(null);
const pages = ref<InstanceType<typeof FacingPages> | null>(null);

// The Manual tab: your own copy of a cited manual, opened from a citation.
const manuals = useManuals();
const manualRequest = ref<ManualRequest | null>(null);
function openManual(r: ManualRequest): void {
  manualRequest.value = r;
  rightTab.value = 'manual';
}
/** Back from the manual: the listing, where you were. */
function backToListing(): void {
  rightTab.value = 'symbol';
  leftTab.value = 'listing';
  pages.value?.show('left');
  void nextTick(() => listing.value?.focus());
}

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

// The header comment lines (block list, legend, proposals) are mostly on the
// Program tab now: past a few, the listing folds them behind one toggle row.
const HEADER_FOLD_MIN = 4;
const headerOpen = ref(false);
const headerLines = computed(() => {
  let n = 0;
  while (n < rows.value.length && rows.value[n]!.kind === 'header') n++;
  return n;
});
const foldable = computed(() => headerLines.value >= HEADER_FOLD_MIN);
const shownRows = computed<readonly Row[]>(() => {
  if (!foldable.value) return rows.value;
  const n = headerLines.value;
  const text = headerOpen.value ? `▾ hide ${n} header lines` : `▸ ${n} header lines`;
  return [{ kind: 'note', text }, ...(headerOpen.value ? rows.value : rows.value.slice(n))];
});

/** The line number of the first numbered listing row: past the header while it is folded. */
const firstLine = computed(() => (foldable.value && !headerOpen.value ? headerLines.value + 1 : 1));

/** A program just opened: put the cursor on its entry (else its first instruction), past the header. */
function showOpened(): void {
  if (session.value === null) return;
  leftTab.value = 'listing';
  headerOpen.value = false;
  const at = cursor.value ?? facts.value?.entry ?? firstCodeAddr(rows.value);
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
  // A hint file is told by its content: it goes to the open program.
  const hints = asHintText(bytes);
  if (hints !== null) {
    if (session.value === null) wb.report(`${file.name} is a hint file. Open the program it belongs to first, then drop it again.`);
    else dropHints(hints, file.name);
    return;
  }
  // Opening a program replaces the open one, so ask. Anything else fails
  // without replacing it (a PDF also points at the Manuals page).
  if (wb.wouldReplace(bytes)) pendingReplace.value = { bytes, name: file.name };
  else wb.openBytes(bytes, file.name);
}

function dropHints(text: string, name: string): void {
  const refused = useEditing().loadHints(text, name);
  if (refused === null) {
    editMessage.value = null;
    leftTab.value = 'hints';
  } else {
    leftTab.value = 'listing';
    editMessage.value = refused;
  }
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

/** Where a shift-extended selection started; the cursor is its other end. */
let anchor: number | null = null;

/** Moves the cursor to a row; `extend` selects from the anchor (the cursor before the first extend) to it. */
function onSelect(addr: number, extend: boolean): void {
  if (extend && cursor.value !== null) {
    if (selection.value === null || anchor === null) anchor = cursor.value;
    selection.value = { from: Math.min(anchor, addr), to: Math.max(anchor, addr) };
  } else {
    selection.value = null;
    anchor = null;
  }
  cursor.value = addr;
}

/** ↑ and ↓ (with Shift, extending the selection). */
function step(dir: 1 | -1, extend: boolean): void {
  const to = stepCursor(rows.value, cursor.value, dir);
  if (to === null) return;
  onSelect(to, extend);
  scrollTo(to);
}

/** Enter: follow the cursor row's first link, as clicking it would. */
function followCursor(): void {
  const list = rows.value;
  const row = list[cursorRowIndex(list, rowLookup(list), cursor.value) ?? -1];
  const f = row === undefined ? null : followOf(row);
  if (f !== null) onFollow(f.target, f.info);
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

// Editing: marks, the inline editor, the right-click menu (composables/useListingEditor).
const editor = useListingEditor({
  listing,
  select: (addr) => onSelect(addr, false),
  showListing: () => {
    leftTab.value = 'listing';
  },
});
const { editMessage, inline, inlineValue, inlineChoice, menu } = editor;

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
  void nextTick(() => listing.value?.focus());
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
  if (s.analysis.symbols.has(r.addr)) {
    wb.symbolFocus.value = { kind: 'label', addr: r.addr };
    rightTab.value = 'symbol';
  }
}

/** Esc: clear the selection and any message. */
function escape(): void {
  editMessage.value = null;
  selection.value = null;
  anchor = null;
}

/** Every workbench key binding, by `keyId` (utils/keys). */
const KEYS: Record<string, KeyBinding> = {
  g: { run: openGo },
  'alt+arrowleft': { run: () => nav.back() },
  'alt+arrowright': { run: () => nav.forward() },
  ...editor.keys,
  escape: { run: escape },
  arrowdown: { run: () => step(1, false), listing: true },
  arrowup: { run: () => step(-1, false), listing: true },
  'shift+arrowdown': { run: () => step(1, true), listing: true },
  'shift+arrowup': { run: () => step(-1, true), listing: true },
  enter: { run: followCursor, listing: true },
};

useWorkbenchKeys({
  keys: KEYS,
  active: () => session.value !== null && !editor.busy.value,
  inListing: (target) => target instanceof Element && target.closest('.fg-listing') !== null,
});

// The saved hints that no longer apply, after the user's first edit: download them, or replace them.
const blockedDownloaded = ref(false);
watch(persistence.blockedAsk, () => (blockedDownloaded.value = false));
function downloadBlocked(): void {
  const b = persistence.blocked.value;
  if (b === null) return;
  download({ filename: b.name, mime: 'text/plain', bytes: new TextEncoder().encode(b.text), warnings: [] });
  blockedDownloaded.value = true;
}

/** Re-renders the open program with new rows, for the browser checks: tables toggled, or label names added above the cursor. */
function rerender(kind: 'tables' | 'names'): void {
  const s = session.value;
  if (s === null) return;
  if (kind === 'tables') {
    session.value = withSelection(s, s.selection === undefined ? MODEL3_DEFAULT : undefined);
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
  void manuals.refresh();
  editor.isMac.value = /Mac|iPhone|iPad/.test(navigator.platform);
  // Back from another page with a program still open: show it where it was.
  if (session.value !== null) showOpened();
  // The browser checks' hook exists only in a build made with NUXT_PUBLIC_E2E=1 (Playwright's web server):
  // the define is false otherwise, and the minifier drops this block from the site.
  if (__FUGLOY_E2E__) installTestHook();
});

function installTestHook(): void {
  window.__fugloyTest = {
    rowCount: () => rows.value.length,
    scrollToAddr: scrollTo,
    setCursor: (addr) => {
      cursor.value = addr;
    },
    rerender,
    load: (bytes, name, hints, base) =>
      wb.openBytes(Uint8Array.from(bytes), name, {
        selection: MODEL3_DEFAULT,
        ...(hints === undefined ? {} : { hintText: hints, hintSource: name.replace(/\.[^.]+$/, '.hints') }),
        ...(base === undefined ? {} : { base }),
      }),
    loadedBytes: () => {
      const image = session.value?.module.image;
      return image === undefined ? [] : image.runs().flatMap((r) => Array.from(image.bytes.subarray(r.start, r.end + 1)));
    },
  };
}
onBeforeUnmount(() => {
  document.removeEventListener('drop', onDocumentDrop);
  if (__FUGLOY_E2E__) delete window.__fugloyTest;
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div v-if="session !== null" class="flex min-h-0 flex-1 flex-col" data-testid="workbench">
      <h1 class="sr-only">{{ session.name }}, disassembled</h1>
      <OpenProblem bar />
      <FacingPages ref="pages">
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
                :placeholder="GOTO_PLACEHOLDER"
                title="Hex: $4B9E or 4B9E. Decimal: #19358. Or a label name."
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
              :rows="shownRows"
              :header-toggle="foldable"
              :first-line="firstLine"
              :cursor="cursor"
              :selection="selection"
              @select="onSelect"
              @follow="onFollow"
              @context="editor.onContext"
              @context-key="editor.menuAtCursor"
              @toggle-header="headerOpen = !headerOpen"
            />
            <p v-if="editMessage !== null" class="fg-edit-message" role="alert" data-testid="edit-message">{{ editMessage }}</p>
          </div>
          <div id="left-panel-hints" v-show="leftTab === 'hints'" role="tabpanel" aria-labelledby="left-tab-hints" class="fg-panel">
            <HintsTab />
          </div>
        </template>
        <template #right>
          <PageTabs v-model="rightTab" :tabs="RIGHT_TABS" label="Right page" id-prefix="right" />
          <div id="right-panel-symbol" v-show="rightTab === 'symbol'" role="tabpanel" aria-labelledby="right-tab-symbol" class="fg-panel">
            <SymbolTab @go="go" @open-manual="openManual" />
          </div>
          <div id="right-panel-index" v-show="rightTab === 'index'" role="tabpanel" aria-labelledby="right-tab-index" class="fg-panel">
            <IndexTab @label="showLabel" @table="showTable" @go="go" />
          </div>
          <div id="right-panel-program" v-show="rightTab === 'program'" role="tabpanel" aria-labelledby="right-tab-program" class="fg-panel" data-testid="program-panel">
            <ProgramTab
              v-if="facts !== null"
              :facts="facts"
              :example="example"
              :name="session.name"
              :diagnostics="session.analysis.pass1.diagnostics"
              :proposals="session.analysis.proposals"
              @symbol="showTable"
              @apply-hint-lines="editor.applyHintLines"
            />
          </div>
          <div id="right-panel-manual" v-show="rightTab === 'manual'" role="tabpanel" aria-labelledby="right-tab-manual" class="fg-panel" data-testid="manual-panel">
            <ManualTab :request="manualRequest" @back="backToListing" />
          </div>
        </template>
      </FacingPages>
      <StatusLine />
    </div>
    <FirstScreen v-else :reading="reading" @file="receive" />
    <RowMenu v-if="menu !== null && session !== null" :items="editor.menuItems.value" :x="menu.x" :y="menu.y" @pick="editor.pickMenu" @close="editor.closeMenu()" />
    <InlineEdit
      v-if="inline !== null && session !== null"
      v-model="inlineValue"
      v-model:choice="inlineChoice"
      :title="inline.op === 'name' ? 'Rename' : 'Comment'"
      :placeholder="editor.inlinePlaceholder.value"
      :error="inline.error"
      :choices="editor.inlineChoices.value"
      :left="inline.left"
      :top="inline.top"
      @submit="editor.submitInline"
      @cancel="editor.closeInline"
    />
    <ConfirmDialog
      testid="saved-work-dialog"
      :open="persistence.conflict.value !== null"
      title="This program has saved work from before"
      :message="persistence.conflictError.value ?? 'Load it (your last change is undone), or keep your change and replace the saved work?'"
      :hide-confirm="persistence.conflictError.value !== null"
      confirm-label="Load the saved work"
      cancel-label="Keep my change and replace it"
      no-escape
      @confirm="persistence.resolveConflict('load')"
      @cancel="persistence.resolveConflict('keep')"
    />
    <ConfirmDialog
      testid="blocked-hints-dialog"
      :open="persistence.blockedAsk.value"
      title="Replace the saved hints that no longer apply?"
      :message="`${blockedDownloaded ? `Downloaded ${persistence.blocked.value?.name ?? ''}. ` : ''}The hints saved for ${session?.name ?? 'this program'} (${persistence.blocked.value?.name ?? ''}) no longer apply: ${persistence.blocked.value?.reason ?? ''}. Saving your change replaces them.`"
      confirm-label="Replace them"
      cancel-label="Download the saved hints"
      no-escape
      focus-cancel
      @confirm="persistence.replaceBlocked()"
      @cancel="downloadBlocked"
    />
    <CarryOverDialog :candidate="persistence.carry.value" :program="session?.name ?? ''" @accept="persistence.acceptCarry()" @dismiss="persistence.dismissCarry()" />
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
