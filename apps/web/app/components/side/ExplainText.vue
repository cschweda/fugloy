<script setup lang="ts">
// Sentences of the Explain tab, one paragraph each: text, address links (go)
// and table-name links (table, which opens the Symbol tab).
import type { Sentence, TableEntry } from '@fugloy/disasm';

defineProps<{ sentences: readonly Sentence[]; /** The first sentence is the lead, set larger. */ lead?: boolean }>();
const emit = defineEmits<{ go: [addr: number]; table: [entry: TableEntry] }>();
</script>

<template>
  <p v-for="(s, i) in sentences" :key="i" :class="{ 'fg-explain-first': lead === true && i === 0 }"><template v-for="(p, j) in s" :key="j"><button
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
