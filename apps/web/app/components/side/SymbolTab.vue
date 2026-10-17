<script setup lang="ts">
// The Symbol tab: what a name is and every place the program uses it. A ROM,
// hardware or DOS name shows its address or port, purpose, citations and uses;
// a program label shows its kind, comment and who calls, jumps to and reads it.
// Every address is a link into the listing (go).
import { computed } from 'vue';
import { hex4 } from '@fugloy/z80';
import type { Cite, TableEntry } from '@fugloy/disasm';
import Citation from './Citation.vue';
import type { ManualRequest } from './ManualTab.vue';
import { useManuals } from '../../composables/useManuals';
import { highlightTerms } from '../../utils/manuals';
import { keyLabel } from '../../utils/symbol-info';
import { callersOf, usesOf } from '../../utils/xrefs';
import type { Use } from '../../utils/xrefs';

const wb = useWorkbench();
const emit = defineEmits<{ go: [addr: number]; 'open-manual': [request: ManualRequest] }>();
const manuals = useManuals();

function openManual(e: TableEntry, cite: Cite): void {
  emit('open-manual', { cite, name: e.name, terms: highlightTerms(e) });
}

const KIND_NAME = { sub: 'routine', code: 'code label', data: 'data label', table: 'table' } as const;
const TABLE_KIND_NAME = { routine: 'routine', vector: 'vector', variable: 'variable', region: 'region', port: 'I/O port', svc: 'service call' } as const;

const label = computed(() => {
  const f = wb.symbolFocus.value;
  const s = wb.session.value;
  if (f?.kind !== 'label' || s === null) return null;
  const a = s.analysis;
  const sym = a.symbols.get(f.addr);
  if (sym === undefined) return null;
  const { callers, jumpers } = callersOf(a, f.addr);
  const uses = usesOf(a, wb.rows.value, { kind: 'addr', key: f.addr });
  const control = new Set([...callers, ...jumpers]);
  const readers = uses.filter((u) => !control.has(u.addr));
  const textAt = new Map<number, string>(uses.map((u) => [u.addr, u.text]));
  const named = (addr: number): Use => ({ addr, text: textAt.get(addr) ?? '' });
  return {
    sym,
    comment: sym.comment ?? a.annotations.comments.get(f.addr),
    callers: callers.map(named),
    jumpers: jumpers.map(named),
    readers,
  };
});

const table = computed(() => {
  const f = wb.symbolFocus.value;
  const s = wb.session.value;
  if (f?.kind !== 'table' || s === null) return null;
  const e: TableEntry = f.entry;
  const uses = usesOf(s.analysis, wb.rows.value, { kind: e.kind === 'port' ? 'port' : e.kind === 'svc' ? 'svc' : 'addr', key: e.key, length: e.length });
  return { e, tag: s.analysis.externals.machineTag(e), uses };
});

const $ = (n: number): string => `$${hex4(n)}`;
</script>

<template>
  <div data-testid="symbol-tab" class="flex flex-col gap-2">
    <template v-if="label">
      <h2 class="fg-strong fg-mono text-base font-bold" data-testid="symbol-name">{{ label.sym.name }}</h2>
      <p>
        {{ KIND_NAME[label.sym.kind] }} at
        <button type="button" class="fg-inline-link fg-mono" @click="emit('go', label.sym.addr)">{{ $(label.sym.addr) }}</button>
        <span class="fg-muted"> · {{ label.sym.source === 'user' ? 'named by you' : 'named by Fugløy' }}</span>
      </p>
      <p v-if="label.comment">{{ label.comment }}</p>
      <template v-for="group in [['Called from', label.callers], ['Jumped to from', label.jumpers], ['Read or written from', label.readers]] as const" :key="group[0]">
        <section v-if="group[1].length > 0" :data-testid="`uses-${group[0]}`">
          <h3 class="fg-strong font-bold">{{ group[0] }} ({{ group[1].length }})</h3>
          <ul class="fg-uses">
            <li v-for="u in group[1]" :key="u.addr">
              <button type="button" class="fg-inline-link fg-mono" @click="emit('go', u.addr)">{{ $(u.addr) }}</button>
              <span class="fg-mono fg-muted"> {{ u.text }}</span>
            </li>
          </ul>
        </section>
      </template>
      <p v-if="label.callers.length + label.jumpers.length + label.readers.length === 0" class="fg-muted">Nothing in the program refers to it.</p>
    </template>

    <template v-else-if="table">
      <h2 class="fg-strong fg-mono text-base font-bold" data-testid="symbol-name">{{ table.e.name }}</h2>
      <p>
        {{ TABLE_KIND_NAME[table.e.kind] }}
        <span class="fg-mono">{{ keyLabel(table.e) }}</span>
        <span v-if="table.tag" class="fg-muted" data-testid="machine-tag"> {{ table.tag }}</span>
        <span class="fg-muted"> · {{ table.e.table }}</span>
      </p>
      <p>{{ table.e.purpose }}</p>
      <p v-if="table.e.note" class="fg-muted">{{ table.e.note }}</p>
      <p v-if="table.e.coined" class="fg-muted">The sources do not name this one; Fugløy coined the name.</p>
      <section>
        <h3 class="fg-strong font-bold">Cited in</h3>
        <ul class="fg-uses"><Citation
            v-for="c in table.e.cite"
            :key="`${c.source}:${c.page}`"
            :cite="c"
            :openable="manuals.have(c.source)"
            @open-manual="openManual(table.e, $event)"
          /></ul>
      </section>
      <section data-testid="uses-table">
        <h3 class="fg-strong font-bold">Used by the program ({{ table.uses.length }})</h3>
        <ul v-if="table.uses.length > 0" class="fg-uses">
          <li v-for="u in table.uses" :key="u.addr">
            <button type="button" class="fg-inline-link fg-mono" @click="emit('go', u.addr)">{{ $(u.addr) }}</button>
            <span class="fg-mono fg-muted"> {{ u.text }}</span>
          </li>
        </ul>
        <p v-else class="fg-muted">The program does not use it.</p>
      </section>
    </template>

    <p v-else class="fg-muted">Select a name in the listing to see what it is and where it is used.</p>
  </div>
</template>
