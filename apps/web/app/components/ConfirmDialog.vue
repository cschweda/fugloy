<script setup lang="ts">
// A yes/no question in a native modal <dialog> (never window.confirm).
import { nextTick, ref, useId, watch } from 'vue';

const props = withDefaults(defineProps<{ open: boolean; title: string; message: string; confirmLabel: string; testid?: string }>(), { testid: 'confirm-dialog' });
// Several dialogs share the page, so each labels itself with its own ids.
const uid = useId();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const yes = ref<HTMLButtonElement | null>(null);

watch(
  () => props.open,
  async (open) => {
    const d = dialog.value;
    if (d === null) return;
    if (open && !d.open) {
      d.showModal();
      await nextTick();
      yes.value?.focus();
    } else if (!open && d.open) d.close();
  },
);
</script>

<template>
  <dialog ref="dialog" class="fg-dialog" :aria-labelledby="`${uid}-title`" :aria-describedby="`${uid}-message`" :data-testid="testid" @close="open && emit('cancel')">
    <div class="flex flex-col gap-3">
      <h2 :id="`${uid}-title`" class="fg-strong text-sm font-bold">{{ title }}</h2>
      <p :id="`${uid}-message`" class="fg-muted text-xs">{{ message }}</p>
      <div class="flex justify-end gap-2">
        <button type="button" class="fg-button" @click="emit('cancel')">Cancel</button>
        <button ref="yes" type="button" class="fg-button fg-button-primary" @click="emit('confirm')">{{ confirmLabel }}</button>
      </div>
    </div>
  </dialog>
</template>
