<script setup lang="ts">
// The machine and DOS pickers. They change only the symbol tables: the listing
// re-renders with the other machine's names.
import { computed } from 'vue';
import { defaultDos } from '@fugloy/disasm';
import type { Dos, Machine } from '@fugloy/disasm';
import { dosChoices, MACHINES } from '~/utils/pickers';

const wb = useWorkbench();
const sel = computed(() => wb.session.value?.selection ?? null);
const doses = computed(() => (sel.value === null ? [] : dosChoices(sel.value.machine)));

function onMachine(e: Event): void {
  const machine = Number((e.target as HTMLSelectElement).value) as Machine;
  const keep = sel.value !== null && dosChoices(machine).some((d) => d.dos === sel.value!.dos);
  wb.setSelection({ machine, dos: keep ? sel.value!.dos : defaultDos(machine) });
}

function onDos(e: Event): void {
  if (sel.value === null) return;
  wb.setSelection({ machine: sel.value.machine, dos: (e.target as HTMLSelectElement).value as Dos });
}
</script>

<template>
  <template v-if="sel !== null">
    <label class="fg-pill-select">
      <span class="sr-only">Machine</span>
      <select data-testid="machine-picker" :value="sel.machine" @change="onMachine">
        <option v-for="m in MACHINES" :key="m.machine" :value="m.machine">{{ m.label }}</option>
      </select>
    </label>
    <label class="fg-pill-select">
      <span class="sr-only">DOS</span>
      <select data-testid="dos-picker" :value="sel.dos" :disabled="doses.length < 2" @change="onDos">
        <option v-for="d in doses" :key="d.dos" :value="d.dos">{{ d.label }}</option>
      </select>
    </label>
  </template>
</template>
