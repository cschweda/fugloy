<script setup lang="ts">
// A yes/no question in a native modal <dialog> (never window.confirm).
import { nextTick, ref, useId, watch } from 'vue';

const props = withDefaults(defineProps<{ open: boolean; title: string; message: string; confirmLabel: string; testid?: string; cancelLabel?: string; noEscape?: boolean; hideConfirm?: boolean; focusCancel?: boolean }>(), { testid: 'confirm-dialog', cancelLabel: 'Cancel', noEscape: false, hideConfirm: false, focusCancel: false });
// focusCancel: for a destructive confirm (Replace), the safe button takes the first focus, so Enter does not destroy.
// Several dialogs share the page, so each labels itself with its own ids.
const uid = useId();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const yes = ref<HTMLButtonElement | null>(null);
const no = ref<HTMLButtonElement | null>(null);

/** A close that did not come from a button: Esc (Chrome honours preventDefault on `cancel` only once per user activation). */
function onClose(): void {
  if (!props.open) return;
  if (!props.noEscape) {
    emit('cancel');
    return;
  }
  // Only the two buttons may resolve this dialog: bring it back.
  const d = dialog.value;
  if (d !== null && !d.open) d.showModal();
}

watch(
  () => props.open,
  async (open) => {
    const d = dialog.value;
    if (d === null) return;
    if (open && !d.open) {
      d.showModal();
      await nextTick();
      (props.focusCancel ? no : yes).value?.focus();
    } else if (!open && d.open) d.close();
  },
);
</script>

<template>
  <dialog ref="dialog" class="fg-dialog" :aria-labelledby="`${uid}-title`" :aria-describedby="`${uid}-message`" :data-testid="testid" @cancel="noEscape && $event.preventDefault()" @close="onClose">
    <div class="flex flex-col gap-3">
      <h2 :id="`${uid}-title`" class="fg-strong text-sm font-bold">{{ title }}</h2>
      <p :id="`${uid}-message`" class="fg-muted text-xs">{{ message }}</p>
      <div class="flex justify-end gap-2">
        <button ref="no" type="button" class="fg-button" @click="emit('cancel')">{{ cancelLabel }}</button>
        <button v-if="!hideConfirm" ref="yes" type="button" class="fg-button fg-button-primary" @click="emit('confirm')">{{ confirmLabel }}</button>
      </div>
    </div>
  </dialog>
</template>
