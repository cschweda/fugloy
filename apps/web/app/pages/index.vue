<script setup lang="ts">
// Temporary: a way to view the listing until Task 9 builds the first screen.
//   /?demo=seadrg01         a bundled example, with its hints when it has them
//   /?demo=raw48            seadrg01's loaded image repeated over 48K, loaded raw at $4000 (over 8,000 rows)
//   &at=499F                 put the cursor there and scroll to it (default: the first instruction)
// Only the fixed EXAMPLES below are fetched; nothing in the URL names a path. With a
// demo open, window.__fugloyDemo drives it for the Playwright perf check, which hands
// its own inputs (a local sample) to `load` rather than through the URL.
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue';
import { listingRows, basRows, openProgram, selectSymbols, withHintFile, withHintText, withSelection, addressKey } from '@fugloy/disasm';
import type { Row, Session, SymbolSelection } from '@fugloy/disasm';
import ListingView from '~/components/listing/ListingView.vue';

const EXAMPLES: Record<string, { file: string; hints?: string }> = {
  seadrg01: { file: 'sea-dragon/seadrg01.cmd', hints: 'sea-dragon/seadrg01.hints' },
  seadrg02: { file: 'sea-dragon/seadrg02.cmd' },
  reargrd1: { file: 'rear-guard/reargrd1.cmd' },
  elimin8a: { file: 'eliminator/elimin8a.cmd' },
  armour: { file: 'armored-patrol/ARMOUR.III' },
};
const MODEL3: SymbolSelection = { machine: 3, dos: 'trsdos' };
const route = useRoute();

const session = shallowRef<Session | null>(null);
const rows = shallowRef<readonly Row[]>([]);
const cursor = ref<number | null>(null);
const selection = ref<{ from: number; to: number } | null>(null);
const status = ref('');
const listing = ref<InstanceType<typeof ListingView> | null>(null);
const active = computed(() => session.value !== null);

function rowsOf(s: Session): Row[] {
  if (s.plainBasic && s.module.format === 'bas') return basRows(s.module, s.selection === undefined ? {} : { tables: selectSymbols(s.selection) });
  return listingRows(s.analysis, { source: s.name });
}

function firstCodeAddr(list: readonly Row[]): number | undefined {
  for (const r of list) if (r.kind === 'code') return r.addr;
  return undefined;
}

function show(s: Session): void {
  session.value = s;
  rows.value = Object.freeze(rowsOf(s));
}

async function fetchBytes(path: string): Promise<Uint8Array | null> {
  const res = await fetch(path);
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
}

async function open(): Promise<void> {
  // The router's query, not location.search: Nuxt can hold the bare path in the address bar while it hydrates.
  const param = (name: string): string | null => {
    const v = route.query[name];
    return typeof v === 'string' ? v : null;
  };
  const demo = param('demo');
  if (demo === 'raw48') {
    const bytes = await fetchBytes(`/examples/${EXAMPLES.seadrg01!.file}`);
    if (bytes === null) return;
    const image = openProgram(bytes).module.image;
    const loaded = image.runs().flatMap((r) => Array.from(image.bytes.subarray(r.start, r.end + 1)));
    const raw = new Uint8Array(0xc000);
    for (let i = 0; i < raw.length; i++) raw[i] = loaded[i % loaded.length]!;
    show(openProgram(raw, { name: 'seadrg01 x 48K (raw)', base: 0x4000, selection: MODEL3 }));
    return;
  }
  const example = demo === null || !Object.hasOwn(EXAMPLES, demo) ? undefined : EXAMPLES[demo];
  if (example === undefined) return;
  const bytes = await fetchBytes(`/examples/${example.file}`);
  if (bytes === null) {
    status.value = `could not load ${example.file}`;
    return;
  }
  let hints: string | undefined;
  if (example.hints !== undefined) {
    const res = await fetch(`/examples/${example.hints}`);
    if (res.ok) hints = await res.text();
  }
  load(bytes, example.file.split('/').pop()!, hints);
}

/** Open bytes (and hint text) the page was handed: a fixed example, or the perf check's own input. */
function load(bytes: Uint8Array, name: string, hints?: string): void {
  let s = openProgram(bytes, { name, selection: MODEL3 });
  if (hints !== undefined) s = withHintText(s, hints, name.replace(/\.[^.]+$/, '.hints'));
  cursor.value = null;
  selection.value = null;
  show(s);
}

/** The perf check's re-render: the same program with new rows, by symbol tables toggled or label names added. */
function rerender(kind: 'tables' | 'names'): void {
  const s = session.value;
  if (s === null) return;
  if (kind === 'tables') {
    show(withSelection(s, s.selection === undefined ? MODEL3 : undefined));
    return;
  }
  // Name every 40th unnamed data or code row's address before the cursor: label rows appear above it.
  const named = new Set(s.analysis.symbols.list().map((sym) => sym.addr));
  const hints = [...s.hintFile.hints];
  let n = 0;
  rows.value.forEach((row, i) => {
    if ((row.kind !== 'code' && row.kind !== 'data') || i % 40 !== 0 || named.has(row.addr)) return;
    if (cursor.value !== null && row.addr >= cursor.value) return;
    const key = addressKey(s, row.addr);
    if (key === null) return;
    hints.push({ directive: 'name', name: `DEMO_${++n}`, block: key.block, offset: key.offset, line: 0 });
  });
  show(withHintFile(s, { ...s.hintFile, hints }, s.hintSource));
}

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

function onContext(addr: number, x: number, y: number): void {
  status.value = `context menu at $${addr.toString(16).toUpperCase().padStart(4, '0')} (${x}, ${y})`;
}

declare global {
  interface Window {
    __fugloyDemo?: {
      rowCount: () => number;
      scrollToAddr: (addr: number) => void;
      setCursor: (addr: number | null) => void;
      rerender: (kind: 'tables' | 'names') => void;
      load: (bytes: number[], name: string, hints?: string) => void;
    };
  }
}

onMounted(async () => {
  try {
    await open();
  } catch (err) {
    status.value = err instanceof Error ? err.message : String(err);
  }
  if (!active.value) return;
  // Open at ?at=<hex>, or at the first instruction, past the header.
  const at = typeof route.query.at === 'string' ? Number.parseInt(route.query.at, 16) : firstCodeAddr(rows.value);
  if (at !== undefined && !Number.isNaN(at)) {
    await nextTick();
    cursor.value = at;
    listing.value?.scrollToAddr(at);
  }
  window.__fugloyDemo = {
    rowCount: () => rows.value.length,
    scrollToAddr: (addr) => listing.value?.scrollToAddr(addr),
    setCursor: (addr) => {
      cursor.value = addr;
    },
    rerender,
    load: (bytes, name, hints) => load(Uint8Array.from(bytes), name, hints),
  };
});
</script>

<template>
  <section v-if="active" class="flex min-h-0 flex-1 flex-col">
    <ListingView
      ref="listing"
      class="min-h-0 flex-1"
      :rows="rows"
      :cursor="cursor"
      :selection="selection"
      @select="onSelect"
      @follow="onFollow"
      @context="onContext"
    />
    <p class="fg-bar fg-muted px-3 py-1 text-xs" data-testid="demo-status">
      {{ session?.name }} · {{ rows.length.toLocaleString('en-US') }} rows<template v-if="cursor !== null"> · cursor ${{ cursor.toString(16).toUpperCase().padStart(4, '0') }}</template><template v-if="status"> · {{ status }}</template>
    </p>
  </section>
  <section v-else class="p-6">
    <h1 class="fg-strong text-xl font-bold">Workbench</h1>
    <p class="fg-muted mt-2">The listing and the drop zone arrive in later tasks.</p>
    <p v-if="status" class="fg-muted mt-2">{{ status }}</p>
  </section>
</template>
