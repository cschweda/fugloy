<script setup lang="ts">
// The Hints tab: the hint file exactly as the CLI would read it (writeHints of
// the session's), read-only, with how its blocks matched this program, what
// applying it warned about, and undo and redo for the mouse.
import { computed } from 'vue';
import { writeHints } from '@fugloy/disasm';

const wb = useWorkbench();
const ed = useEditing();
const persistence = usePersistence();

const view = computed(() => {
  const s = wb.session.value;
  if (s === null) return null;
  const text = writeHints(s.hintFile);
  const lines = text.split('\n');
  const unmatched = s.applied.unmatched.map((u) => ({
    index: u.block.index,
    lines: lines.filter((l) => l.startsWith(`block ${u.block.index}:`)),
  }));
  return {
    text,
    count: s.hintFile.hints.length,
    blocks: s.hintFile.blocks.length,
    matched: s.applied.matched.length,
    unmatched,
    warnings: s.applied.warnings,
    source: s.hintSource,
  };
});
const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
</script>

<template>
  <div v-if="view !== null" class="fg-hints" data-testid="hints-tab">
    <div class="fg-hints-bar">
      <p class="fg-muted" data-testid="hints-summary">
        {{ plural(view.count, 'hint') }}<template v-if="view.source"> · from <span class="fg-mono">{{ view.source }}</span></template>
        · {{ view.matched }} of {{ plural(view.blocks, 'block') }} matched
      </p>
      <div class="fg-hints-actions">
        <button type="button" class="fg-button" :disabled="!ed.canUndo.value" data-testid="undo" @click="ed.undo()">Undo</button>
        <button type="button" class="fg-button" :disabled="!ed.canRedo.value" data-testid="redo" @click="ed.redo()">Redo</button>
      </div>
    </div>
    <section v-if="view.unmatched.length > 0" data-testid="hints-unmatched">
      <h2 class="fg-sec">Not applied: no block of this program matches</h2>
      <div v-for="u in view.unmatched" :key="u.index">
        <p class="fg-muted">block {{ u.index }}: {{ plural(u.lines.length, 'hint') }}</p>
        <pre class="fg-hints-text">{{ u.lines.join('\n') }}</pre>
      </div>
    </section>
    <section v-if="persistence.hintErrors.value.length > 0" data-testid="hints-errors">
      <h2 class="fg-sec">Carried over, but not read</h2>
      <ul class="fg-hints-warnings">
        <li v-for="(e, i) in persistence.hintErrors.value" :key="i">{{ e }}</li>
      </ul>
    </section>
    <section v-if="view.warnings.length > 0" data-testid="hints-warnings">
      <h2 class="fg-sec">Warnings</h2>
      <ul class="fg-hints-warnings">
        <li v-for="(w, i) in view.warnings" :key="i">{{ w }}</li>
      </ul>
    </section>
    <section>
      <h2 class="fg-sec">The hint file</h2>
      <pre class="fg-hints-text" tabindex="0" aria-label="The hint file" data-testid="hint-text">{{ view.text }}</pre>
    </section>
  </div>
</template>
