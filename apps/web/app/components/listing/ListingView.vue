<script setup lang="ts">
// The listing, virtualized by hand: every row is ROW_HEIGHT tall, so the rows on
// screen follow from scrollTop alone, and only those (plus an overscan) are in
// the DOM. Clicks, follows, and context menus are handled here for all rows.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { Row } from '@fugloy/disasm';
import ListingRow from './ListingRow.vue';
import { ROW_HEIGHT, rowAddr } from '../../utils/row-classes';
import { rowLookup } from '../../utils/row-lookup';
import type { FollowInfo } from '../../utils/xrefs';

const props = defineProps<{
  rows: readonly Row[];
  /** The cursor's address. */
  cursor: number | null;
  selection: { from: number; to: number } | null;
}>();

const emit = defineEmits<{
  select: [addr: number, extend: boolean];
  follow: [target: number, info: FollowInfo];
  context: [addr: number, x: number, y: number];
}>();

/** Rows rendered above and below the visible ones, so a fast scroll does not show blank space before the next frame. */
const OVERSCAN = 30;

const scroller = ref<HTMLElement | null>(null);
/** Index of the first row at the top of the viewport; changes only when a whole row scrolls by. */
const top = ref(0);
const viewRows = ref(40);

const lookup = computed(() => rowLookup(props.rows));
/** The cursor's row: the instruction or data row holding the address, not the label row above it. */
function cursorRow(addr: number | null): number | null {
  if (addr === null) return null;
  let i = lookup.value(addr);
  while (i !== null && props.rows[i]?.kind === 'label' && i + 1 < props.rows.length && rowAddr(props.rows[i + 1]!) === addr) i++;
  return i;
}
const cursorIndex = shallowRef<number | null>(cursorRow(props.cursor));

const first = computed(() => Math.max(0, top.value - OVERSCAN));
const last = computed(() => Math.min(props.rows.length, top.value + viewRows.value + OVERSCAN));
const shown = computed(() => props.rows.slice(first.value, last.value));
const totalHeight = computed(() => `${props.rows.length * ROW_HEIGHT}px`);
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
/** The row an anchor names in the current rows: the label row at its address, or the row holding the address. */
const anchorRow = (a: { addr: number; label: boolean }): number | null => (a.label ? lookup.value(a.addr) : cursorRow(a.addr));
const ANCHORS = new Set<Row['kind']>(['label', 'code', 'data', 'basic']);
watch(
  () => props.rows,
  (_rows, old) => {
    const el = scroller.value;
    anchor = null;
    if (el === null) return;
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
  if (row !== null) emit('select', Number(row.dataset.addr), e.shiftKey);
}

function onContextMenu(e: MouseEvent): void {
  const row = rowElement(e.target);
  if (row === null) return;
  e.preventDefault();
  emit('context', Number(row.dataset.addr), e.clientX, e.clientY);
}

let resize: ResizeObserver | null = null;
onMounted(() => {
  const el = scroller.value!;
  const measure = (): void => {
    viewRows.value = Math.ceil(el.clientHeight / ROW_HEIGHT) + 1;
  };
  measure();
  resize = new ResizeObserver(measure);
  resize.observe(el);
});
onBeforeUnmount(() => resize?.disconnect());

defineExpose({ scrollToAddr });
</script>

<template>
  <div
    ref="scroller"
    class="fg-listing"
    role="region"
    aria-label="Listing"
    tabindex="0"
    @scroll.passive="onScroll"
    @click="onClick"
    @contextmenu="onContextMenu"
  >
    <div class="fg-listing-spacer" :style="{ height: totalHeight }">
      <div class="fg-listing-window" :style="{ transform: offset }">
        <ListingRow
          v-for="(row, i) in shown"
          :key="first + i"
          :row="row"
          :cursor="cursorIndex === first + i"
          :selected="isSelected(row)"
        />
      </div>
    </div>
  </div>
</template>
