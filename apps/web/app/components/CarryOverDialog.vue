<script setup lang="ts">
// Another build of the same game: offer the hints saved for it.
import ConfirmDialog from '~/components/ConfirmDialog.vue';
import type { CarryCandidate } from '~/utils/carry-over';

const props = defineProps<{ candidate: CarryCandidate | null; program: string }>();
defineEmits<{ accept: []; dismiss: [] }>();
const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

const message = (c: CarryCandidate): string => {
  const unmatched = c.unmatched === 0 ? '' : ` ${plural(c.unmatched, 'hint block')} match nothing here and will be listed in the Hints tab, not applied.`;
  const problems = c.problems.length === 0 ? '' : ` ${plural(c.problems.length, 'problem')} in the file (${c.problems.slice(0, 3).join('; ')}${c.problems.length > 3 ? '; …' : ''}) will be listed in the Hints tab.`;
  return `The hints saved as ${c.name} match ${plural(c.matched, 'block')} of ${plural(c.blocks, 'block')} in its hint file.${unmatched}${problems} Carry them over to ${props.program}?`;
};
</script>

<template>
  <ConfirmDialog
    testid="carry-dialog"
    :open="candidate !== null"
    title="Carry over hints from another build?"
    :message="candidate === null ? '' : message(candidate)"
    confirm-label="Carry over"
    @confirm="$emit('accept')"
    @cancel="$emit('dismiss')"
  />
</template>
