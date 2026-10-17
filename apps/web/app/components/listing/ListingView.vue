<script setup lang="ts">
// The listing, virtualized by hand: every row is ROW_HEIGHT tall, so the rows on
// screen follow from scrollTop alone, and only those (plus an overscan) are in
// the DOM. Clicks, follows, and context menus are handled here for all rows.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { Row } from '@fugloy/disasm';
import ListingRow from './ListingRow.vue';
import { ROW_HEIGHT, rowAddr } from '../../utils/row-classes';
import { cursorRowIndex, rowLookup } from '../../utils/row-lookup';
import type { FollowInfo } from '../../utils/xrefs';

const props = defineProps<{
  rows: readonly Row[];
  /** The cursor's address. */
  cursor: number | null;
  selection: { from: number; to: number } | null;
  /** The first row is the header's show/hide toggle. */
  headerToggle?: boolean;
  /** The line number of the first numbered row (the toggle has none): past the header lines while they are folded, so a line keeps its number either way. */
  firstLine?: number;
}>();

const emit = defineEmits<{
  select: [addr: number, extend: boolean];
  follow: [target: number, info: FollowInfo];
  context: [addr: number, x: number, y: number];
  /** The context menu was asked for from the keyboard (the ContextMenu key, Shift+F10): open it on the cursor row. */
  'context-key': [];
  'toggle-header': [];
  /** A mouse click on a row, not on a link in it (it also emits select): the page opens Explain on it. */
  'row-click': [row: Row];
}>();

/** Rows rendered above and below the visible ones, so a fast scroll does not show blank space before the next frame. */
const OVERSCAN = 30;

const scroller = ref<HTMLElement | null>(null);
/** Index of the first row at the top of the viewport; changes only when a whole row scrolls by. */
const top = ref(0);
const viewRows = ref(40);

const lookup = computed(() => rowLookup(props.rows));
/** The cursor's row: the instruction or data row holding the address, not the label row above it. */
const cursorRow = (addr: number | null): number | null => cursorRowIndex(props.rows, lookup.value, addr);
const cursorIndex = shallowRef<number | null>(cursorRow(props.cursor));

const first = computed(() => Math.max(0, top.value - OVERSCAN));
const last = computed(() => Math.min(props.rows.length, top.value + viewRows.value + OVERSCAN));
const shown = computed(() => props.rows.slice(first.value, last.value));
/** The line number shown beside row `index`, in the whole listing; none for the header toggle. */
const toggleRows = computed(() => (props.headerToggle === true ? 1 : 0));
const lineOf = (index: number): number | undefined => (index < toggleRows.value ? undefined : (props.firstLine ?? 1) + index - toggleRows.value);
/** The gutter is as wide as the last line number. */
const gutter = computed(() => `${String(Math.max(1, (props.firstLine ?? 1) + props.rows.length - toggleRows.value - 1)).length}ch`);
/** Row ids, by index in the listing, so the scroller can name the cursor row for assistive technology. */
const ROW_ID = 'fg-row-';
const rowId = (index: number): string => `${ROW_ID}${index}`;
/** The cursor row's id while it is rendered (aria-activedescendant must name an element in the document). */
const activeId = computed(() => {
  const i = cursorIndex.value;
  return i !== null && i >= first.value && i < last.value ? rowId(i) : undefined;
});
/** Empty room under the last row (two thirds of the view), so the last rows can scroll to a third of the way down like any other. */
const tail = ref(0);
const totalHeight = computed(() => `${props.rows.length * ROW_HEIGHT + tail.value}px`);
const offset = computed(() => `translateY(${first.value * ROW_HEIGHT}px)`);

const isSelected = (row: Row): boolean => {
  const sel = props.selection;
  const addr = rowAddr(row);
  return sel !== null && addr !== undefined && row.kind !== 'note' && addr >= sel.from && addr <= sel.to;
};

function onScroll(): void {
  const el = scroller.value;
  if (el === null) return;
  const t = Math.floor(el.scrollTop / ROW_HEIGHT);
  if (t !== top.value) top.value = t;
}

function setScrollTop(px: number): void {
  const el = scroller.value;
  if (el === null) return;
  el.scrollTop = Math.max(0, px);
  // Render the new window in this tick rather than waiting for the scroll event.
  top.value = Math.floor(el.scrollTop / ROW_HEIGHT);
}

/**
 * The address a scrollToAddr call asked for, not yet scrolled to. The scroll runs
 * after the next flush, so a call made in the same tick as new rows (whose props
 * have not reached this component yet) lands on the new rows, in place of the
 * re-render anchor.
 */
let pending: number | null = null;

function flushPending(): void {
  const addr = pending;
  pending = null;
  if (addr !== null) scrollNow(addr);
}

/**
 * Bring the row holding `addr` on screen, a third of the way down, unless it is
 * already in full view. When no row holds it, the row at the greatest address
 * below it (which may sit anywhere in the listing, after relocated pieces).
 * Scrolls after pending updates are flushed, before the next frame.
 */
function scrollToAddr(addr: number): void {
  pending = addr;
  void nextTick(flushPending);
}

function scrollNow(addr: number): void {
  const index = lookup.value(addr);
  const el = scroller.value;
  if (index === null || el === null) return;
  const y = index * ROW_HEIGHT;
  if (y >= el.scrollTop && y + ROW_HEIGHT <= el.scrollTop + el.clientHeight) return;
  setScrollTop(y - Math.floor(el.clientHeight / 3));
}

// New rows (a hint added, a symbol table changed): keep the cursor row where it was
// on screen, or, when it is off screen, the top row. An anchor names its row by
// address and by whether it was the label row there or the row after it.
let anchor: { addr: number; label: boolean; offset: number } | null = null;
/** The header toggle is the top row: expanding or folding the header leaves it there. */
let anchorTop = false;
/** The row an anchor names in the current rows: the label row at its address, or the row holding the address. */
const anchorRow = (a: { addr: number; label: boolean }): number | null => (a.label ? lookup.value(a.addr) : cursorRow(a.addr));
const ANCHORS = new Set<Row['kind']>(['label', 'code', 'data', 'basic']);
watch(
  () => props.rows,
  (_rows, old) => {
    const el = scroller.value;
    anchor = null;
    anchorTop = false;
    if (el === null) return;
    if (props.headerToggle === true && el.scrollTop < ROW_HEIGHT) {
      anchorTop = true;
      return;
    }
    const oldCursor = cursorIndex.value;
    const visible = (i: number): boolean => i * ROW_HEIGHT >= el.scrollTop && (i + 1) * ROW_HEIGHT <= el.scrollTop + el.clientHeight;
    if (props.cursor !== null && oldCursor !== null && visible(oldCursor)) {
      anchor = { addr: props.cursor, label: false, offset: oldCursor * ROW_HEIGHT - el.scrollTop };
      return;
    }
    for (let i = Math.floor(el.scrollTop / ROW_HEIGHT); i < old.length; i++) {
      const row = old[i]!;
      const addr = rowAddr(row);
      if (addr !== undefined && ANCHORS.has(row.kind)) {
        anchor = { addr, label: row.kind === 'label', offset: i * ROW_HEIGHT - el.scrollTop };
        return;
      }
    }
  },
  { flush: 'pre' },
);
watch(
  () => props.rows,
  () => {
    cursorIndex.value = cursorRow(props.cursor);
    const a = anchor;
    anchor = null;
    if (pending !== null) {
      flushPending();
      return;
    }
    if (anchorTop) {
      anchorTop = false;
      setScrollTop(0);
      return;
    }
    if (a === null) return;
    const index = anchorRow(a);
    if (index !== null) setScrollTop(index * ROW_HEIGHT - a.offset);
  },
  { flush: 'post' },
);
watch(
  () => props.cursor,
  (c) => {
    cursorIndex.value = cursorRow(c);
  },
);

function rowElement(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-addr]') : null;
}

function onClick(e: MouseEvent): void {
  if (e.target instanceof Element && e.target.closest('button.fg-header-toggle') !== null) {
    emit('toggle-header');
    return;
  }
  const link = e.target instanceof Element ? e.target.closest<HTMLElement>('a.fg-follow') : null;
  if (link !== null) {
    e.preventDefault();
    const d = link.dataset;
    emit('follow', Number(d.target), {
      span: d.span === 'table' ? 'table' : 'label',
      use: d.use === 'port' || d.use === 'svc' ? d.use : 'addr',
      ...(d.table === undefined ? {} : { table: d.table, key: Number(d.key) }),
    });
    return;
  }
  const row = rowElement(e.target);
  if (row === null) return;
  emit('select', Number(row.dataset.addr), e.shiftKey);
  const index = Number(row.id.slice(ROW_ID.length));
  const clicked = props.rows[index];
  if (clicked !== undefined) emit('row-click', clicked);
}

function onContextMenu(e: MouseEvent): void {
  const row = rowElement(e.target);
  if (row !== null) {
    e.preventDefault();
    emit('context', Number(row.dataset.addr), e.clientX, e.clientY);
  } else if (e.target === scroller.value) {
    // From the keyboard the event lands on the focused scroller, not on a row.
    e.preventDefault();
    emit('context-key');
  }
}

/** Shift-click extends the row selection; keep it from also selecting text. */
function onMouseDown(e: MouseEvent): void {
  if (e.shiftKey) e.preventDefault();
}

/** The box on screen of the cursor row's text (past the line, address and bytes columns), for an editor or menu placed at it; null while it is not rendered. */
function cursorRect(): DOMRect | null {
  return scroller.value?.querySelector('.fg-row-cursor')?.querySelector('.fg-col-text, .fg-col-full')?.getBoundingClientRect() ?? null;
}

let resize: ResizeObserver | null = null;
onMounted(() => {
  const el = scroller.value!;
  const measure = (): void => {
    viewRows.value = Math.ceil(el.clientHeight / ROW_HEIGHT) + 1;
    tail.value = Math.floor((el.clientHeight * 2) / 3);
  };
  measure();
  resize = new ResizeObserver(measure);
  resize.observe(el);
});
onBeforeUnmount(() => resize?.disconnect());

/** Puts keyboard focus on the listing, for after a box above it closes. */
function focus(): void {
  scroller.value?.focus({ preventScroll: true });
}

defineExpose({ scrollToAddr, focus, cursorRect });
</script>

<template>
  <div
    ref="scroller"
    class="fg-listing"
    role="group"
    aria-label="Listing"
    aria-roledescription="listing"
    :aria-activedescendant="activeId"
    tabindex="0"
    @scroll.passive="onScroll"
    @mousedown="onMouseDown"
    @click="onClick"
    @contextmenu="onContextMenu"
  >
    <div class="fg-listing-spacer" :style="{ height: totalHeight, '--fg-line-w': gutter }">
      <div class="fg-listing-window" :style="{ transform: offset }">
        <ListingRow
          v-for="(row, i) in shown"
          :id="rowId(first + i)"
          :key="first + i"
          :row="row"
          :line="lineOf(first + i)"
          :cursor="cursorIndex === first + i"
          :selected="isSelected(row)"
          :toggle="headerToggle === true && first + i === 0"
        />
      </div>
    </div>
  </div>
</template>
