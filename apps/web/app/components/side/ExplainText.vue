<script setup lang="ts">
// Sentences of the Explain tab, one paragraph each: text, address links (go)
// and table-name links (table, which opens the Symbol tab).
import { computed } from 'vue';
import type { Sentence, TableEntry } from '@fugloy/disasm';
import { thinLinks } from '../../utils/explain-view';

const props = defineProps<{ sentences: readonly Sentence[]; /** The first sentence is the lead, set larger. */ lead?: boolean }>();
const emit = defineEmits<{ go: [addr: number]; table: [entry: TableEntry] }>();
/** An address linked twice in a row ("$5200 (L5200)") links once. */
const shown = computed(() => props.sentences.map(thinLinks));
</script>

<template>
  <p v-for="(s, i) in shown" :key="i" :class="{ 'fg-explain-first': lead === true && i === 0 }"><template v-for="(p, j) in s" :key="j"><button
    v-if="p.addr !== undefined"
    type="button"
    class="fg-inline-link"
    @click="emit('go', p.addr)"
  >{{ p.text }}</button><button
    v-else-if="p.entry !== undefined"
    type="button"
    class="fg-inline-link fg-explain-entry"
    :title="p.entry.purpose"
    @click="emit('table', p.entry)"
  >{{ p.text }}</button><template v-else>{{ p.text }}</template></template></p>
</template>
