<script setup lang="ts">
// The inline editor N and ; open under the cursor row: one text field, and,
// when the row's instruction names addresses outside the program, a choice of
// which address to name. Enter applies, Esc cancels; a refused edit keeps the
// editor open with the reason under the field.
import { nextTick, onMounted, ref } from 'vue';

export interface InlineChoice {
  value: number;
  label: string;
}

const props = defineProps<{
  /** `Rename`, `Comment`. */
  title: string;
  placeholder: string;
  error: string | null;
  choices: readonly InlineChoice[];
  /** Where the cursor row is on screen. */
  left: number;
  top: number;
}>();
const text = defineModel<string>({ required: true });
const choice = defineModel<number>('choice', { required: true });
const emit = defineEmits<{ submit: []; cancel: [] }>();

const form = ref<HTMLFormElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const x = ref(props.left);

/** Focus leaving the editor altogether cancels it. */
function onFocusOut(e: FocusEvent): void {
  if (e.relatedTarget instanceof Node && form.value?.contains(e.relatedTarget) === true) return;
  emit('cancel');
}

onMounted(async () => {
  await nextTick();
  const r = form.value?.getBoundingClientRect();
  if (r !== undefined) x.value = Math.max(4, Math.min(props.left, window.innerWidth - r.width - 4));
  input.value?.focus();
  input.value?.select();
});
</script>

<template>
  <form
    ref="form"
    class="fg-inline-edit"
    data-testid="inline-edit"
    :style="{ left: `${x}px`, top: `${top}px` }"
    @submit.prevent="emit('submit')"
    @keydown.esc.stop.prevent="emit('cancel')"
    @focusout="onFocusOut"
  >
    <label for="inline-edit-input" class="fg-muted">{{ title }}</label>
    <select v-if="choices.length > 1" v-model="choice" class="fg-input fg-mono" aria-label="Address" data-testid="inline-edit-target">
      <option v-for="c in choices" :key="c.value" :value="c.value">{{ c.label }}</option>
    </select>
    <span v-else class="fg-mono fg-muted">{{ choices[0]?.label }}</span>
    <input
      id="inline-edit-input"
      ref="input"
      v-model="text"
      class="fg-input fg-mono"
      :placeholder="placeholder"
      autocomplete="off"
      spellcheck="false"
      data-testid="inline-edit-input"
      :aria-invalid="error !== null"
      aria-describedby="inline-edit-error"
    />
    <span id="inline-edit-error" class="fg-inline-error" role="alert" data-testid="inline-edit-error">{{ error }}</span>
  </form>
</template>
