<script setup lang="ts">
// The TRS-80 screen as text, for screen readers (phase 5C Ruling 13), under the screen: a "Screen
// text" disclosure, closed by default, holding the rows as a numbered list. Graphics read as
// spaces, trailing spaces are trimmed, and a blank row reads "blank". TrsScreen calls `refresh()`
// on every draw; while open, the list is read at most twice a second (the last change always
// shows) and replaced only when the text changed. No live region of its own: "Speak screen
// changes", off by default, speaks through the announcer at most once a second, up to 3 changed
// rows ("Row 4: SCORE 120."), otherwise how many changed.
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import type { Machine } from '@fugloy/emu';
import { screenView } from '~/utils/emulator/screen';
import { changedRows, screenAnnouncement, screenRows } from '~/utils/emulator/screen-text';
import { announcer } from '~/utils/running/announce';

const props = defineProps<{ machine: Machine | null }>();

/** At most two reads a second, and one sentence a second. */
const REFRESH_MS = 500;
const SPEAK_MS = 1000;

const open = ref(false);
const speak = ref(false);
const rows = shallowRef<string[]>([]);
let shownKey = '';
let readAt = -Infinity;
let readTimer: ReturnType<typeof setTimeout> | null = null;
/** The rows last spoken (the baseline changes are counted against), and when. */
let spoken: string[] | null = null;
let spokeAt = -Infinity;
let speakTimer: ReturnType<typeof setTimeout> | null = null;

function read(): void {
  readAt = Date.now();
  const m = props.machine;
  const next = m === null ? [] : screenRows(m.video.raw, screenView(m));
  const key = next.join('\n');
  if (key !== shownKey) {
    shownKey = key;
    rows.value = next;
  }
  if (speak.value) trySpeak();
}

function trySpeak(): void {
  if (spoken === null) {
    spoken = rows.value;
    return;
  }
  if (speakTimer !== null) return;
  const wait = SPEAK_MS - (Date.now() - spokeAt);
  if (wait > 0) {
    speakTimer = setTimeout(() => {
      speakTimer = null;
      if (speak.value) trySpeak();
    }, wait);
    return;
  }
  const text = screenAnnouncement(rows.value, changedRows(spoken, rows.value));
  if (text === null) return;
  spoken = rows.value;
  spokeAt = Date.now();
  announcer().say(text);
}

/** A frame was drawn: read the screen if it is due, else once it is (only while open or speaking). */
function refresh(): void {
  if ((!open.value && !speak.value) || readTimer !== null) return;
  const wait = REFRESH_MS - (Date.now() - readAt);
  if (wait <= 0) return read();
  readTimer = setTimeout(() => {
    readTimer = null;
    read();
  }, wait);
}

function onToggle(e: Event): void {
  open.value = (e.target as HTMLDetailsElement).open;
  if (open.value && readTimer === null) read();
}

watch(speak, (on) => {
  if (!on) return;
  // Changes count from now: switching it on does not read out the whole screen.
  if (!open.value) read();
  spoken = rows.value;
  spokeAt = -Infinity;
});

// A new Run: a new screen, with nothing spoken about it yet.
watch(
  () => props.machine,
  () => {
    shownKey = '';
    spoken = null;
    if (open.value || speak.value) read();
  },
);

onBeforeUnmount(() => {
  if (readTimer !== null) clearTimeout(readTimer);
  if (speakTimer !== null) clearTimeout(speakTimer);
});

defineExpose({ refresh });
</script>

<template>
  <details class="fg-screen-text" data-testid="screen-text" @toggle="onToggle">
    <summary data-testid="screen-text-summary">Screen text</summary>
    <label class="fg-screen-text-speak">
      <input type="checkbox" data-testid="screen-text-speak" :checked="speak" @change="speak = ($event.target as HTMLInputElement).checked" />
      Speak screen changes
    </label>
    <ol class="fg-mono" aria-label="The TRS-80 screen's rows">
      <li v-for="(r, k) in rows" :key="k" data-testid="screen-text-row">{{ r === '' ? 'blank' : r }}</li>
    </ol>
  </details>
</template>

<style scoped>
.fg-screen-text { margin-top: 6px; font-size: 12px; }
.fg-screen-text summary { cursor: pointer; width: fit-content; }
.fg-screen-text summary:focus-visible { outline: 2px solid var(--fg-accent); outline-offset: 2px; }
.fg-screen-text-speak { display: inline-flex; align-items: center; gap: 6px; margin: 4px 0; }
.fg-screen-text ol { margin: 0; padding-left: 3em; color: var(--fg-text); }
.fg-screen-text li { white-space: pre; }
</style>
