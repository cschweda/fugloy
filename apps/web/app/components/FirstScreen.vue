<script setup lang="ts">
// Before a program is open: a drop zone (drop or pick a .CMD, .BAS, or raw
// binary), and beside it one-click buttons for the four public-domain games.
// The format is detected from the bytes, never the file name. A drop anywhere
// on the page is handled by the page (index.vue); the zone only highlights.
import { ref } from 'vue';
import { EXAMPLES } from '~/data/examples';
import type { Example } from '~/data/examples';
import OpenProblem from '~/components/OpenProblem.vue';

defineProps<{ reading: boolean }>();
const emit = defineEmits<{ file: [file: File] }>();
const wb = useWorkbench();
/** dragenter/dragleave fire for every child crossed; count them so the highlight does not flicker. */
const depth = ref(0);
const picker = ref<HTMLInputElement | null>(null);

function onPick(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file !== undefined) emit('file', file);
  input.value = '';
}

function openBuild(e: Example, build: string, ev: Event): void {
  (ev.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
  void wb.openExample(e.id, build);
}

const credit = (e: Example): string => [e.authors, e.publisher, e.year].filter((x) => x !== undefined).join(' · ');
</script>

<template>
  <div class="fg-first">
    <section class="fg-first-drop" aria-labelledby="drop-title">
      <div
        class="fg-dropzone"
        :class="{ 'fg-dropzone-over': depth > 0 }"
        data-testid="drop-zone"
        @dragenter="depth++"
        @dragleave="depth = Math.max(0, depth - 1)"
        @drop="depth = 0"
      >
        <h1 id="drop-title" class="fg-strong text-lg font-bold">Open a TRS-80 program</h1>
        <p class="fg-muted text-sm">Drop a <span class="fg-mono">.CMD</span>, a <span class="fg-mono">.BAS</span>, or a raw binary here. It stays in your browser.</p>
        <button type="button" class="fg-button fg-button-primary" :disabled="reading" @click="picker?.click()">Choose a file…</button>
        <input ref="picker" type="file" class="sr-only" tabindex="-1" aria-hidden="true" data-testid="file-input" @change="onPick" />
      </div>

      <OpenProblem />
    </section>

    <section class="fg-first-games" aria-labelledby="games-title">
      <h2 id="games-title" class="fg-strong text-sm font-bold">Or open a public-domain game</h2>
      <p class="fg-muted text-xs">
        Four games by Wayne Westmoreland and Terry Gilman, released into the public domain in 1995. One click opens one.
      </p>
      <ul class="fg-games">
        <li v-for="e in EXAMPLES" :key="e.id" class="fg-game">
          <button
            type="button"
            class="fg-game-open"
            :data-testid="`open-${e.id}`"
            :disabled="wb.busy.value"
            @click="wb.openExample(e.id)"
          >
            <span class="fg-strong font-bold">{{ e.title }}</span>
            <span class="fg-muted text-xs">{{ credit(e) }}</span>
            <span class="fg-muted fg-mono text-xs">{{ e.mainBuild }}<template v-if="e.hints"> + {{ e.hints }}</template></span>
          </button>
          <details v-if="e.builds.length > 1" class="fg-builds">
            <summary :aria-label="`Other builds of ${e.title}`">{{ e.builds.length }} builds ▾</summary>
            <ul>
              <li v-for="b in e.builds" :key="b">
                <button type="button" class="fg-mono" :disabled="wb.busy.value" @click="openBuild(e, b, $event)">{{ b }}</button>
              </li>
            </ul>
          </details>
        </li>
      </ul>
    </section>

  </div>
</template>
