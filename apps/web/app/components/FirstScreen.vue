<script setup lang="ts">
// Before a program is open: a drop zone (drop or pick a .CMD, .BAS, or raw
// binary), and beside it one-click buttons for the four public-domain games.
// The format is detected from the bytes, never the file name.
import { ref } from 'vue';
import { EXAMPLES } from '~/data/examples';
import type { Example } from '~/data/examples';
import RawBaseDialog from '~/components/RawBaseDialog.vue';

const wb = useWorkbench();
const over = ref(false);
const picker = ref<HTMLInputElement | null>(null);
const askBase = ref(false);
const reading = ref(false);

async function openFile(file: File | undefined): Promise<void> {
  if (file === undefined) return;
  reading.value = true;
  try {
    wb.openBytes(new Uint8Array(await file.arrayBuffer()), file.name);
  } catch (err) {
    wb.error.value = `${file.name} could not be read: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    reading.value = false;
  }
}

function onDrop(e: DragEvent): void {
  over.value = false;
  void openFile(e.dataTransfer?.files[0]);
}

function onPick(e: Event): void {
  const input = e.target as HTMLInputElement;
  void openFile(input.files?.[0]);
  input.value = '';
}

function openBuild(e: Example, build: string, ev: Event): void {
  (ev.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
  void wb.openExample(e.id, build);
}

function onRawBase(base: number): void {
  askBase.value = false;
  wb.openRaw(base);
}

const credit = (e: Example): string => [e.authors, e.publisher, e.year].filter((x) => x !== undefined).join(' · ');
</script>

<template>
  <div class="fg-first">
    <section class="fg-first-drop" aria-labelledby="drop-title">
      <div
        class="fg-dropzone"
        :class="{ 'fg-dropzone-over': over }"
        data-testid="drop-zone"
        @dragenter.prevent="over = true"
        @dragover.prevent="over = true"
        @dragleave="over = false"
        @drop.prevent="onDrop"
      >
        <h1 id="drop-title" class="fg-strong text-lg font-bold">Open a TRS-80 program</h1>
        <p class="fg-muted text-sm">Drop a <span class="fg-mono">.CMD</span>, a <span class="fg-mono">.BAS</span>, or a raw binary here. It stays in your browser.</p>
        <button type="button" class="fg-button fg-button-primary" :disabled="reading" @click="picker?.click()">Choose a file…</button>
        <input ref="picker" type="file" class="sr-only" tabindex="-1" aria-hidden="true" data-testid="file-input" @change="onPick" />
      </div>

      <div v-if="wb.error.value !== null" class="fg-problem" role="alert" data-testid="open-error">
        <p class="fg-strong">{{ wb.error.value }}</p>
        <ul v-if="wb.errorDetails.value.length > 0" class="fg-muted fg-mono text-xs">
          <li v-for="d in wb.errorDetails.value" :key="d">{{ d }}</li>
        </ul>
        <p v-if="wb.rawCandidate.value !== null" class="fg-muted text-xs">
          Fugløy reads <span class="fg-mono">.CMD</span> load modules and tokenized BASIC by their contents.
          <button type="button" class="fg-inline-link" data-testid="load-raw" @click="askBase = true">Load as raw binary at…</button>
        </p>
        <p v-if="wb.suggestManuals.value" class="fg-muted text-xs">
          This looks like a PDF. Manuals go on the <NuxtLink to="/manuals" class="fg-inline-link">Manuals</NuxtLink> page.
        </p>
      </div>
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

    <RawBaseDialog :open="askBase" :name="wb.rawCandidate.value?.name ?? ''" @load="onRawBase" @close="askBase = false" />
  </div>
</template>
