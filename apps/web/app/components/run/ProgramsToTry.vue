<script setup lang="ts">
// Programs to try (5D), under the machine row, as trsjs lists them: the bundled public-domain games
// that reach their titles on the emulator (Armored Patrol does not, so it is left out), each with its
// year and a Run button. RunTab runs the one pressed (useRun's runExample) and says what it needs.
import { EXAMPLES } from '~/data/examples';
import type { ExampleId } from '~/data/examples';
import { MODEL_NAMES } from '~/utils/emulator/rom-ids';
import type { ModelId } from '~/utils/store';

const emit = defineEmits<{ run: [id: ExampleId] }>();

const PROGRAMS = EXAMPLES.filter((e) => e.id !== 'armored-patrol');
</script>

<template>
  <section class="fg-programs" aria-labelledby="run-programs-title">
    <h2 id="run-programs-title" class="fg-strong">Programs to try</h2>
    <ul data-testid="programs">
      <li v-for="p in PROGRAMS" :key="p.id">
        <button type="button" class="fg-button" :data-testid="`program-run-${p.id}`" @click="emit('run', p.id)">Run<span class="sr-only"> {{ p.title }}</span></button>
        <span class="fg-strong">{{ p.title }}</span>
        <span class="fg-muted">{{ p.year }}, {{ MODEL_NAMES[p.machine as ModelId] }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.fg-programs { margin: 0 12px; }
.fg-programs h2 { margin: 6px 0 4px; font-size: 13px; font-weight: 700; }
.fg-programs ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.fg-programs li { display: flex; align-items: center; gap: 8px; }
</style>
