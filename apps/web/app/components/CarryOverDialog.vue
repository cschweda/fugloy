<script setup lang="ts">
// Another build of the same game: offer the hints saved for it.
import ConfirmDialog from '~/components/ConfirmDialog.vue';
import type { CarryCandidate } from '~/utils/carry-over';

defineProps<{ candidate: CarryCandidate | null; program: string }>();
defineEmits<{ accept: []; dismiss: [] }>();
const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
</script>

<template>
  <ConfirmDialog
    testid="carry-dialog"
    :open="candidate !== null"
    title="Carry over hints from another build?"
    :message="candidate === null ? '' : `The hints saved as ${candidate.name} match ${plural(candidate.matched, 'block')} of ${program} (of ${plural(candidate.blocks, 'block')} in the hint file). Carry them over? Hints for blocks that do not match are kept and listed in the Hints tab.`"
    confirm-label="Carry over"
    @confirm="$emit('accept')"
    @cancel="$emit('dismiss')"
  />
</template>
