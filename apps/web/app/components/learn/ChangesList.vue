<script setup lang="ts">
// A chapter's changes in words (phase 6C Task 1), under its program in the lesson editor: how many
// lines are new and changed since `against` (the chapter before, or the blank page), which the
// editor's gutter marks with + and ~, and the lines taken out, struck through, each named for a
// screen reader with the line it stood before ("Removed before line 12: …"). Once the learner's text
// differs from the chapter's own, the marks are hidden and a note says so instead.
import { computed } from 'vue';
import type { LineDiff } from '~/utils/learn/diff';

const props = defineProps<{ diff: LineDiff; against: string; hidden: boolean }>();

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const summary = computed(() => {
  let added = 0;
  let changed = 0;
  for (const m of props.diff.marks.values()) if (m === 'new') added++;
  else changed++;
  const parts = [`${plural(added, 'new line', 'new lines')} (+)`, `${plural(changed, 'changed line', 'changed lines')} (~)`, plural(props.diff.removed.length, 'line taken out', 'lines taken out')];
  return `Marked since ${props.against}: ${parts.join(', ')}.`;
});
</script>

<template>
  <p v-if="hidden" class="fg-chg-note" role="status" data-testid="lesson-marks-hidden">Your edits hide the chapter's marks. Reset to the lesson brings them back.</p>
  <template v-else>
    <p class="fg-chg-summary fg-muted" data-testid="lesson-marks-summary">{{ summary }}</p>
    <section v-if="diff.removed.length > 0" class="fg-chg-removed" aria-labelledby="lesson-removed-title" data-testid="lesson-removed">
      <h3 id="lesson-removed-title">What changed: lines taken out</h3>
      <ul>
        <li v-for="(r, k) in diff.removed" :key="k" data-testid="lesson-removed-line">
          <span class="sr-only">Removed before line {{ r.before }}: </span>
          <span class="fg-chg-where" aria-hidden="true">before {{ r.before }}</span>
          <del>{{ r.text.trim() === '' ? '(a blank line)' : r.text }}</del>
        </li>
      </ul>
    </section>
  </template>
</template>

<style scoped>
.fg-chg-note, .fg-chg-summary { margin: 0; font-size: 12px; }
.fg-chg-note { padding: 6px 10px; border: 1px solid var(--fg-border); border-left: 3px solid #e3b341; border-radius: 4px; }
.fg-chg-removed { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border: 1px solid var(--fg-border); border-left: 3px solid var(--fg-error); border-radius: 4px; }
.fg-chg-removed h3 { margin: 0; font-size: 13px; font-weight: 700; color: var(--fg-text-strong); }
.fg-chg-removed ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
.fg-chg-removed li { display: flex; gap: 8px; align-items: baseline; font-family: var(--fg-mono); font-size: 12.5px; }
.fg-chg-where { flex: none; min-width: 6.5em; color: var(--fg-muted); font-size: 11px; }
.fg-chg-removed del { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--fg-text); text-decoration-color: var(--fg-error); }
</style>
