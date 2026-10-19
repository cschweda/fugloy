<script setup lang="ts">
// The problems under a source editor (5B), shared by Source ✎ and the Learn page's program
// (6B): the count, then each problem with its severity and line, a button that takes the editor
// there, and a Fix button where asm has an exact rewrite. It is the keyboard's and the screen
// reader's way to every problem and its fix (the editor's marks and their tooltips are the
// mouse's). `prefix` names its ids and data-testids (`source` gives source-diag, source-diag-fix…).
import type { Diagnostic } from '@fugloy/asm';
import { severityWord } from '~/utils/source/diagnostics';
import type { AsmFix } from '~/utils/source/diagnostics';

defineProps<{ diagnostics: readonly Diagnostic[]; summary: string; prefix: string }>();
const emit = defineEmits<{ reveal: [line: number]; fix: [fix: AsmFix] }>();

const fixLabel = (fix: AsmFix): string => `Fix line ${fix.line}: write ${fix.replacement}`;
</script>

<template>
  <div class="fg-problems" :data-testid="`${prefix}-diags`">
    <h2 :id="`${prefix}-diags-title`" class="sr-only">Problems</h2>
    <p class="fg-problems-count" role="status" aria-live="polite" :data-testid="`${prefix}-diag-count`">{{ summary }}</p>
    <ul v-if="diagnostics.length > 0" :aria-labelledby="`${prefix}-diags-title`">
      <li v-for="(d, i) in diagnostics" :key="i" class="fg-problem" :class="`fg-problem-${d.severity}`" :data-testid="`${prefix}-diag`">
        <button type="button" class="fg-problem-go" :data-testid="`${prefix}-diag-go`" @click="emit('reveal', d.line)">
          <span class="fg-problem-sev">{{ severityWord(d.severity) }}</span>
          <span class="fg-problem-line fg-mono">Line {{ d.line }}</span>
          <span class="fg-problem-msg">{{ d.message }}</span>
        </button>
        <button v-if="d.fix" type="button" class="fg-button fg-problem-fix" :data-testid="`${prefix}-diag-fix`" :aria-label="fixLabel(d.fix)" @click="emit('fix', d.fix)">Fix</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.fg-problems { font-size: 12px; }
.fg-problems-count { margin: 0 0 4px; color: var(--fg-muted); }
.fg-problems ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.fg-problem { display: flex; align-items: flex-start; gap: 6px; }
.fg-problem-go { display: flex; flex: 1; gap: 8px; text-align: left; padding: 2px 4px; border-radius: 3px; color: var(--fg-text); background: none; border: 0; cursor: pointer; }
.fg-problem-go:hover { background: var(--fg-hover); }
.fg-problem-go:focus-visible { outline: 2px solid var(--fg-accent); outline-offset: 1px; }
.fg-problem-sev { flex: none; width: 4.5em; font-weight: 600; }
.fg-problem-error .fg-problem-sev { color: var(--fg-error); }
.fg-problem-warning .fg-problem-sev { color: var(--fg-string); }
.fg-problem-info .fg-problem-sev { color: var(--fg-register); }
.fg-problem-line { flex: none; width: 5em; color: var(--fg-line); }
.fg-problem-fix { flex: none; padding: 0 8px; }
</style>
