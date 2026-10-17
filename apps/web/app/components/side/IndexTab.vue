<script setup lang="ts">
// The Index tab: every label, routine, table name and proposal, filterable. Each
// row is a link: labels and routines open in the Symbol tab and go to the
// listing; table names open in the Symbol tab; proposals go to where they apply.
import { computed, ref } from 'vue';
import { hex4 } from '@fugloy/z80';
import type { TableEntry } from '@fugloy/disasm';
import { keyLabel } from '../../utils/symbol-info';

const wb = useWorkbench();
const emit = defineEmits<{ label: [addr: number]; table: [entry: TableEntry]; go: [addr: number] }>();

/** Rows shown per group before "filter to narrow"; a program can name thousands of addresses. */
const LIMIT = 300;
const filter = ref('');
const $ = (n: number): string => `$${hex4(n)}`;

interface Item {
  key: string;
  text: string;
  detail: string;
  pick: () => void;
}
interface Group {
  id: string;
  title: string;
  items: Item[];
  shown: Item[];
}

const groups = computed<Group[]>(() => {
  const s = wb.session.value;
  if (s === null) return [];
  const a = s.analysis;
  const symbols = a.symbols.list();
  const label = (sym: (typeof symbols)[number]): Item => ({ key: `l${sym.addr}`, text: sym.name, detail: $(sym.addr), pick: () => emit('label', sym.addr) });
  const proposals: Item[] = a.proposals.map((p, i) =>
    p.kind === 'table'
      ? { key: `p${i}`, text: `table of ${p.count} at ${$(p.addr)}`, detail: p.hint, pick: () => emit('go', p.addr) }
      : { key: `p${i}`, text: `move of ${p.length} bytes, ${$(p.src)} to ${$(p.dst)}`, detail: `LDIR at ${$(p.ldir)}`, pick: () => emit('go', p.ldir) },
  );
  const defs: Omit<Group, 'shown'>[] = [
    { id: 'labels', title: 'Labels', items: symbols.filter((x) => x.kind !== 'sub').map(label) },
    { id: 'routines', title: 'Routines', items: symbols.filter((x) => x.kind === 'sub').map(label) },
    {
      id: 'tables',
      title: 'Table names',
      items: a.tablesUsed.map((e) => ({ key: `t${e.table}${e.key}`, text: e.name, detail: keyLabel(e), pick: () => emit('table', e) })),
    },
    { id: 'proposals', title: 'Proposals', items: proposals },
  ];
  const q = filter.value.trim().toLowerCase();
  return defs.map((g) => {
    const items = q === '' ? g.items : g.items.filter((i) => `${i.text} ${i.detail}`.toLowerCase().includes(q));
    return { ...g, items, shown: items.slice(0, LIMIT) };
  });
});
</script>

<template>
  <div data-testid="index-tab" class="flex flex-col gap-3">
    <label class="flex flex-col gap-1">
      <span class="fg-muted">Filter</span>
      <input v-model="filter" type="search" class="fg-input fg-mono" placeholder="name, address, or text" aria-label="Filter the index" data-testid="index-filter" />
    </label>
    <section v-for="g in groups" :key="g.id" :data-testid="`index-${g.id}`">
      <h3 class="fg-strong font-bold">{{ g.title }} ({{ g.items.length }})</h3>
      <ul v-if="g.items.length > 0" class="fg-uses">
        <li v-for="i in g.shown" :key="i.key">
          <button type="button" class="fg-inline-link fg-mono" @click="i.pick()">{{ i.text }}</button>
          <span class="fg-mono fg-muted"> {{ i.detail }}</span>
        </li>
        <li v-if="g.items.length > g.shown.length" class="fg-muted">{{ g.items.length - g.shown.length }} more; filter to narrow.</li>
      </ul>
      <p v-else class="fg-muted">None{{ filter.trim() === '' ? '' : ' match' }}.</p>
    </section>
  </div>
</template>
