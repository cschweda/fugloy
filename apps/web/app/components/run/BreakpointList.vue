<script setup lang="ts">
// The current source's breakpoints (phase 5C), in Run ▶: each "Line N: text", with Go to line
// (Source ✎ moves its cursor there, through Run's `reveal`, without taking the focus) and Remove.
// With F9 in the editor, this list is the keyboard's way to the gutter. After a Remove, focus moves
// to the next entry's Remove (or the previous one's, or the list), never to the page.
import { computed, nextTick, ref } from 'vue';
import type { Run } from '~/composables/useRun';
import type { Sources } from '~/composables/useSources';

const props = defineProps<{ run: Run; sources: Sources }>();
const debug = props.run.debug;
const list = ref<HTMLElement | null>(null);

const entries = computed(() => {
  const lines = (props.sources.current.value?.text ?? '').split('\n');
  const inactive = new Set(debug.inactive.value);
  return debug.breakpoints.value.map((line) => ({
    line,
    text: (lines[line - 1] ?? '').replace(/\s+/g, ' ').trim(),
    why: inactive.has(line) ? debug.inactiveWhy(line) : null,
  }));
});

function goTo(line: number): void {
  props.run.reveal.value = { line };
}

async function remove(line: number, k: number): Promise<void> {
  debug.toggleBreakpoint(line);
  await nextTick();
  const buttons = list.value?.querySelectorAll<HTMLButtonElement>('[data-testid="breakpoint-remove"]') ?? [];
  (buttons[Math.min(k, buttons.length - 1)] ?? list.value)?.focus();
}
</script>

<template>
  <section ref="list" class="fg-bps" aria-labelledby="run-bps-title" tabindex="-1" data-testid="breakpoints">
    <h2 id="run-bps-title" class="fg-strong">Breakpoints</h2>
    <p v-if="entries.length === 0" class="fg-muted">No breakpoints. Press F9 on a line in Source ✎, or click its gutter, to stop there.</p>
    <ul v-else>
      <li v-for="(e, k) in entries" :key="e.line" class="fg-bp-entry" data-testid="breakpoint">
        <span class="fg-mono fg-bp-text" data-testid="breakpoint-text">Line {{ e.line }}: {{ e.text }}</span>
        <span v-if="e.why !== null" class="fg-muted fg-bp-why">{{ e.why }}</span>
        <button type="button" class="fg-button" data-testid="breakpoint-go" :aria-label="`Go to line ${e.line} in Source`" @click="goTo(e.line)">Go to line</button>
        <button type="button" class="fg-button" data-testid="breakpoint-remove" :aria-label="`Remove the breakpoint on line ${e.line}`" @click="remove(e.line, k)">Remove</button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.fg-bps { display: flex; flex-direction: column; gap: 4px; font-size: 12px; border-radius: 3px; outline: none; }
/* Focus lands here (by script) after the last Remove: shown whatever the input was. */
.fg-bps:focus { outline: 2px solid var(--fg-accent); outline-offset: 2px; }
.fg-bps h2 { margin: 0; font-size: 13px; font-weight: 700; }
.fg-bps p { margin: 0; }
.fg-bps ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.fg-bp-entry { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.fg-bp-text { flex: 1 1 12rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fg-bp-why { flex-basis: 100%; }
</style>
