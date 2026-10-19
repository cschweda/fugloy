<script setup lang="ts">
// The Program tab: a spec sheet for the open program. Every line but the
// history is computed from the program (programFacts), with the evidence shown;
// the history comes from the bundled example's README. Presentational: the
// parent passes the facts in and handles `symbol` (open a table entry in the
// Symbol tab) and `apply-hint-lines` (add a proposal's hint lines).
import { computed } from 'vue';
import type { Diagnostic, MoverProposal, ProgramFacts, TableEntry, TableProposal } from '@fugloy/disasm';
import type { Example } from '../../data/examples';
import MemoryMap from './MemoryMap.vue';
import { keyLabel } from '../../utils/symbol-info';
import { addr$, bytes$, ENTRY_HOW, FORMAT_NAME, proposalLines, proposalText, range$, splitEvidence } from '../../utils/spec-sheet';

const props = defineProps<{
  facts: ProgramFacts;
  /** The bundled game, for its history; null for a dropped file. */
  example: Example | null;
  /** The file's name, for a program with no example. */
  name?: string;
  diagnostics: readonly Diagnostic[];
  proposals: readonly (TableProposal | MoverProposal)[];
  /** Whether Open as source ✎ is offered: machine code, not a BASIC program. */
  canSource?: boolean;
}>();
const emit = defineEmits<{ symbol: [entry: TableEntry]; 'apply-hint-lines': [lines: string[]]; 'open-source': [] }>();

const FIT = {
  model1: { one: true, three: false },
  model3: { one: false, three: true },
  both: { one: true, three: true },
  conflict: { one: true, three: true },
  unknown: { one: false, three: false },
} as const;

const talks = (): { label: string; none: string; entries: readonly TableEntry[] }[] => [
  { label: 'Hardware', none: 'none found', entries: props.facts.hardware },
  { label: 'ROM calls', none: 'none found', entries: props.facts.romCalls },
  { label: 'DOS calls', none: 'none found', entries: props.facts.dosCalls },
];

const evidence = computed(() => splitEvidence(props.facts.machine.evidence));
</script>

<template>
  <div data-testid="program-tab" class="fg-spec">
    <section v-if="example !== null || facts.name !== undefined || name !== undefined" data-testid="spec-history">
      <h2 class="fg-sec">History</h2>
      <template v-if="example !== null">
        <h3 class="fg-strong text-base font-bold">{{ example.title }}</h3>
        <p class="fg-muted">
          {{ [example.authors, example.publisher, example.year].filter((x) => x !== undefined).join(' · ') }}
          <span class="fg-badge fg-badge-rights">{{ example.rights }}</span>
        </p>
        <p class="fg-muted">
          “{{ example.rightsQuote }}” (<a :href="example.rightsUrl" class="fg-inline-link" rel="noopener" target="_blank">trs-80.org</a>)
        </p>
      </template>
      <template v-else>
        <h3 class="fg-strong fg-mono text-base font-bold">{{ name }}</h3>
        <p v-if="facts.name !== undefined" class="fg-muted">Name record: <span class="fg-mono">{{ facts.name }}</span></p>
      </template>
    </section>

    <section v-if="canSource" data-testid="spec-source">
      <h2 class="fg-sec">Source</h2>
      <p>
        <button type="button" class="fg-button" data-testid="open-as-source" @click="emit('open-source')">Open as source ✎</button>
        <span class="fg-muted"> Turns this disassembly into Z80 source you can edit, then run with Run ▶. The listing stays as it is.</span>
      </p>
    </section>

    <section data-testid="spec-machine">
      <h2 class="fg-sec">Machine</h2>
      <p>
        <span class="fg-badge" :class="facts.machine.fit === 'conflict' ? 'fg-badge-conflict' : FIT[facts.machine.fit].three ? 'fg-badge-on' : 'fg-badge-off'">Model III</span>
        <span class="fg-badge" :class="facts.machine.fit === 'conflict' ? 'fg-badge-conflict' : FIT[facts.machine.fit].one ? 'fg-badge-on' : 'fg-badge-off'">Model I</span>
        <span v-if="facts.machine.fit === 'unknown'" class="fg-muted">Nothing in it needs one machine or the other.</span>
        <span v-else-if="facts.machine.fit === 'both'" class="fg-muted">Everything it touches is on both machines.</span>
        <span v-else-if="facts.machine.fit === 'conflict'" class="fg-muted">It uses things only one machine has and things only the other has.</span>
      </p>
      <ul v-if="evidence.lines.length > 0" class="fg-uses fg-evidence" data-testid="evidence">
        <li v-for="e in evidence.lines" :key="`${e.kind}:${e.key}`" class="fg-muted">{{ e.text }}</li>
      </ul>
      <details v-if="evidence.shared.length > 0" class="fg-evidence fg-muted" data-testid="evidence-shared">
        <summary>{{ evidence.summary }}</summary>
        <ul class="fg-uses">
          <li v-for="e in evidence.shared" :key="`${e.kind}:${e.key}`">{{ e.text }}</li>
        </ul>
      </details>
    </section>

    <section data-testid="spec-loading">
      <h2 class="fg-sec">Loading</h2>
      <dl class="fg-dl">
        <dt>Format</dt>
        <dd>
          {{ FORMAT_NAME[facts.format] }}
          <template v-if="facts.records !== undefined"> · {{ facts.records }} records</template>
          <template v-if="facts.format === 'cmd'"> · {{ facts.name === undefined ? 'no name record' : `name record ${facts.name}` }}</template>
        </dd>
        <dt>Loads at</dt>
        <dd class="fg-mono">
          <span v-for="(l, i) in facts.loads" :key="l.start"><template v-if="i > 0">, </template>{{ range$(l.start, l.end) }}</span>
          <span class="fg-muted"> ({{ bytes$(facts.size) }})</span>
        </dd>
        <dt>Entry</dt>
        <dd v-if="facts.entry !== null"><span class="fg-mono">{{ addr$(facts.entry) }}</span> <span class="fg-muted">{{ ENTRY_HOW[facts.entryHow] }}</span></dd>
        <dd v-else class="fg-muted">none found</dd>
        <template v-for="r in facts.relocations" :key="`${r.file}:${r.run}`">
          <dt>Moves</dt>
          <dd>
            <span class="fg-mono">{{ range$(r.file, r.file + r.length - 1) }}</span> is copied to <span class="fg-mono">{{ range$(r.run, r.run + r.length - 1) }}</span>
          </dd>
        </template>
        <dt>Memory needed</dt>
        <dd>{{ facts.memoryNeeded }}K</dd>
      </dl>
      <MemoryMap :loads="facts.loads" :relocations="facts.relocations" />
    </section>

    <section data-testid="spec-talks">
      <h2 class="fg-sec">Talks to</h2>
      <dl class="fg-dl">
        <template v-for="g in talks()" :key="g.label">
          <dt>{{ g.label }}</dt>
          <dd v-if="g.entries.length === 0" class="fg-muted">{{ g.none }}</dd>
          <dd v-else>
            <template v-for="(e, i) in g.entries" :key="`${e.table}:${e.key}`">
              <span v-if="i > 0" class="fg-muted"> · </span>
              <button type="button" class="fg-inline-link fg-mono" :title="e.purpose" @click="emit('symbol', e)">{{ e.name }}</button>
              <span class="fg-muted fg-mono">{{ ` · ${keyLabel(e)}` }}</span>
            </template>
          </dd>
        </template>
      </dl>
    </section>

    <section data-testid="spec-code">
      <h2 class="fg-sec">Code</h2>
      <dl class="fg-dl">
        <dt>Decoded as code</dt>
        <dd>{{ facts.code.bytes.toLocaleString('en-US') }} of {{ facts.code.of.toLocaleString('en-US') }} bytes ({{ facts.code.percent }}%)</dd>
        <dt>Routines</dt>
        <dd>{{ facts.code.routines }}</dd>
      </dl>
    </section>

    <section data-testid="spec-analysis">
      <h2 class="fg-sec">Analysis</h2>
      <p v-if="diagnostics.length === 0 && proposals.length === 0" class="fg-muted">Nothing to report.</p>
      <ul v-if="diagnostics.length > 0" class="fg-uses" data-testid="diagnostics">
        <li v-for="(d, i) in diagnostics" :key="i" class="fg-muted">{{ d.message }}</li>
      </ul>
      <ul v-if="proposals.length > 0" class="fg-uses fg-proposals" data-testid="proposals">
        <li v-for="(p, i) in proposals" :key="i">
          <span>{{ proposalText(p) }}</span>
          <button type="button" class="fg-button" @click="emit('apply-hint-lines', proposalLines(p))">Apply</button>
        </li>
      </ul>
    </section>
  </div>
</template>
