<script setup lang="ts">
// The Block comment box (`:` or Use as comment): a multi-line field for the
// prose printed above an address, opened under the cursor row. Ctrl+Enter or
// Save applies, Esc cancels; a refused edit keeps the box open with the
// reason. When the cursor is inside a routine, a choice puts the comment above
// the routine or above the line.
import { nextTick, onMounted, ref } from 'vue';

const props = defineProps<{
  title: string;
  error: string | null;
  /** The routine the cursor is in, when the comment can go above it; null when there is no choice. */
  routine: { start: number; name: string } | null;
  /** Where the cursor row is on screen. */
  left: number;
  top: number;
}>();
const text = defineModel<string>({ required: true });
const scope = defineModel<'routine' | 'line'>('scope', { required: true });
const emit = defineEmits<{ submit: []; cancel: [] }>();

const form = ref<HTMLFormElement | null>(null);
const area = ref<HTMLTextAreaElement | null>(null);
const x = ref(props.left);
const y = ref(props.top);

/** Focus leaving the box altogether cancels it. */
function onFocusOut(e: FocusEvent): void {
  if (e.relatedTarget instanceof Node && form.value?.contains(e.relatedTarget) === true) return;
  emit('cancel');
}

onMounted(async () => {
  await nextTick();
  const r = form.value?.getBoundingClientRect();
  if (r !== undefined) {
    x.value = Math.max(4, Math.min(props.left, window.innerWidth - r.width - 4));
    y.value = Math.max(4, Math.min(props.top, window.innerHeight - r.height - 4));
  }
  area.value?.focus();
});
</script>

<template>
  <form
    ref="form"
    class="fg-notes-edit"
    data-testid="notes-edit"
    aria-labelledby="notes-edit-title"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @submit.prevent="emit('submit')"
    @keydown.esc.stop.prevent="emit('cancel')"
    @keydown.ctrl.enter.prevent="emit('submit')"
    @keydown.meta.enter.prevent="emit('submit')"
    @focusout="onFocusOut"
  >
    <span id="notes-edit-title" class="fg-muted">{{ title }}</span>
    <fieldset v-if="routine !== null" class="fg-notes-scope">
      <legend class="sr-only">Where the comment goes</legend>
      <label><input v-model="scope" type="radio" value="routine" data-testid="notes-scope-routine" /> Above the routine ({{ routine.name }})</label>
      <label><input v-model="scope" type="radio" value="line" data-testid="notes-scope-line" /> Above this line</label>
    </fieldset>
    <textarea
      ref="area"
      v-model="text"
      class="fg-input fg-mono"
      rows="6"
      aria-label="Block comment, one line per row"
      placeholder="Prose printed above the address; a blank line stays blank. Empty removes it."
      spellcheck="false"
      data-testid="notes-edit-input"
      :aria-invalid="error !== null"
      aria-describedby="notes-edit-error"
    />
    <span id="notes-edit-error" class="fg-inline-error" role="alert" data-testid="notes-edit-error">{{ error }}</span>
    <div class="fg-notes-actions">
      <button type="submit" class="fg-button fg-button-primary" data-testid="notes-edit-save">Save</button>
      <button type="button" class="fg-button" data-testid="notes-edit-cancel" @click="emit('cancel')">Cancel</button>
      <span class="fg-muted">Ctrl+Enter saves, Esc cancels</span>
    </div>
  </form>
</template>
