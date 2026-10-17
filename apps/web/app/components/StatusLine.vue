<script setup lang="ts">
// Size and blocks, percent decoded as code, entry, machine and DOS, and the
// save state of the hints (composables/usePersistence).
import { computed } from 'vue';
import { hex4 } from '@fugloy/z80';
import { selectionLabel } from '~/utils/pickers';

const wb = useWorkbench();
const persistence = usePersistence();
const n = (v: number): string => v.toLocaleString('en-US');

const parts = computed(() => {
  const s = wb.session.value;
  const f = wb.facts.value;
  if (s === null || f === null) return [];
  // Blocks as the CLI header counts them.
  const blocks = s.module.image.blocks.length;
  return [
    `${n(f.size)} bytes · ${n(blocks)} ${blocks === 1 ? 'block' : 'blocks'}`,
    `${f.code.percent}% code`,
    f.entry === null ? 'no entry' : `entry $${hex4(f.entry)}`,
    s.selection === undefined ? 'no symbol tables' : selectionLabel(s.selection),
  ];
});
</script>

<template>
  <footer class="fg-status" data-testid="status-line" aria-label="Status">
    <span v-for="p in parts" :key="p">{{ p }}</span>
    <span class="fg-status-save" data-testid="save-state">{{ persistence.status.value }}</span>
    <span v-if="wb.cursor.value !== null" class="fg-status-cursor">cursor ${{ hex4(wb.cursor.value) }}</span>
  </footer>
</template>
