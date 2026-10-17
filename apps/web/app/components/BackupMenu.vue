<script setup lang="ts">
// "Your work" in the top bar: Back up and Restore. The file carries hints and
// per-program settings between machines; never manuals, ROMs or programs.
import { ref } from 'vue';
import ConfirmDialog from '~/components/ConfirmDialog.vue';

const b = useBackup();
const menu = ref<HTMLDetailsElement | null>(null);
const picker = ref<HTMLInputElement | null>(null);

function onPick(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (menu.value !== null) menu.value.open = false;
  if (file !== undefined) void b.restore(file);
}
</script>

<template>
  <details ref="menu" class="fg-menu" data-testid="backup-menu">
    <summary class="fg-link" data-testid="backup-summary">Your work</summary>
    <div class="fg-menu-panel" role="group" aria-label="Back up and restore your work">
      <button type="button" class="fg-button" data-testid="backup-save" @click="b.backUp()">Back up</button>
      <button type="button" class="fg-button" data-testid="backup-restore" @click="picker?.click()">Restore…</button>
      <p class="fg-muted text-xs">Your hints and machine settings, as one file to carry to another computer. Never manuals, ROMs or programs.</p>
      <input ref="picker" type="file" accept=".json,application/json" class="sr-only" tabindex="-1" aria-label="Choose a backup file" data-testid="backup-file" @change="onPick" />
    </div>
  </details>
  <p v-if="b.message.value !== null" class="fg-backup-note fg-muted text-xs" role="status" data-testid="backup-message">
    {{ b.message.value }}
    <button type="button" class="fg-inline-link" @click="b.message.value = null">Dismiss</button>
  </p>
  <ConfirmDialog
    testid="backup-confirm"
    :open="b.question.value !== null"
    title="Replace this program's saved work?"
    :message="`The backup has different hints for ${b.question.value?.name ?? ''}. Replace the hints saved in this browser with the ones in the backup?`"
    confirm-label="Replace"
    @confirm="b.answer(true)"
    @cancel="b.answer(false)"
  />
</template>
