<script setup lang="ts">
// Asks for the address to load a raw binary at, as the CLI's --base does.
import { nextTick, ref, watch } from 'vue';
import { parseBase } from '~/utils/pickers';

const props = defineProps<{ open: boolean; name: string }>();
const emit = defineEmits<{ load: [base: number]; close: [] }>();

const dialog = ref<HTMLDialogElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const text = ref('');
const problem = ref<string | null>(null);

watch(
  () => props.open,
  async (open) => {
    const d = dialog.value;
    if (d === null) return;
    if (open && !d.open) {
      problem.value = null;
      d.showModal();
      await nextTick();
      input.value?.select();
    } else if (!open && d.open) d.close();
  },
);

function submit(): void {
  const r = parseBase(text.value);
  if ('error' in r) {
    problem.value = r.error;
    return;
  }
  emit('load', r.base);
}
</script>

<template>
  <dialog ref="dialog" class="fg-dialog" aria-labelledby="raw-base-title" @close="emit('close')">
    <form method="dialog" class="flex flex-col gap-3" @submit.prevent="submit">
      <h2 id="raw-base-title" class="fg-strong text-sm font-bold">Load {{ name }} as raw binary</h2>
      <p class="fg-muted text-xs">A raw binary has no load address of its own. Where does its first byte go?</p>
      <label class="flex items-center gap-2 text-xs">
        <span>Load address (hex) $</span>
        <input
          ref="input"
          v-model="text"
          class="fg-input fg-mono w-24"
          inputmode="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="5200"
          aria-describedby="raw-base-problem"
          :aria-invalid="problem !== null"
        />
      </label>
      <p id="raw-base-problem" class="fg-error text-xs" role="alert">{{ problem ?? '' }}</p>
      <div class="flex justify-end gap-2">
        <button type="button" class="fg-button" @click="emit('close')">Cancel</button>
        <button type="submit" class="fg-button fg-button-primary">Load</button>
      </div>
    </form>
  </dialog>
</template>
