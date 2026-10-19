<script setup lang="ts">
// The TRS-80's screen (plan 5B, Rulings 4 and 9): a canvas one pixel per font pixel (384x192, or
// 480x240 for the Model 4's 80x24), shown 768x576 or 640x480 with pixelated scaling. The box
// around it is the focus element: keys reach the machine only while it has focus (attachKeyboard),
// Tab leaves it, and blur releases every key. While a program runs and the screen does not have
// focus, it says how to type to it.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Machine } from '@fugloy/emu';
import { attachKeyboard } from '~/utils/emulator/keyboard';
import { renderScreen, SCREEN_BG, screenSize, screenView } from '~/utils/emulator/screen';

const props = defineProps<{ machine: Machine | null; running: boolean }>();

const box = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const focused = ref(false);
const wide = ref(false);
let image: ImageData | null = null;
let detach: (() => void) | null = null;

function context(): CanvasRenderingContext2D | null {
  return canvas.value?.getContext('2d') ?? null;
}

/** Draws the machine's screen now (only what changed costs anything), or a blank tube with no machine. */
function draw(): void {
  const c = canvas.value;
  const ctx = context();
  if (c === null || ctx === null) return;
  const m = props.machine;
  if (m === null) {
    // No machine (a Run that did not start): a blank 64x16 tube.
    wide.value = false;
    image = null;
    c.width = 384;
    c.height = 192;
    ctx.fillStyle = `rgb(${SCREEN_BG[0]},${SCREEN_BG[1]},${SCREEN_BG[2]})`;
    ctx.fillRect(0, 0, c.width, c.height);
    return;
  }
  const view = screenView(m);
  const { width, height } = screenSize(view);
  wide.value = view.wide;
  if (image === null || c.width !== width || c.height !== height) {
    c.width = width;
    c.height = height;
    image = ctx.createImageData(width, height);
  }
  if (renderScreen(m.video.raw, view, image.data, width)) ctx.putImageData(image, 0, 0);
}

watch(
  () => props.machine,
  () => {
    image = null;
    draw();
  },
);

onMounted(() => {
  draw();
  if (box.value !== null) detach = attachKeyboard(box.value, () => props.machine);
});
onBeforeUnmount(() => detach?.());

defineExpose({
  draw,
  focus(): void {
    box.value?.focus();
  },
});
</script>

<template>
  <div
    ref="box"
    class="fg-trs"
    :class="{ 'fg-trs-wide': wide }"
    tabindex="0"
    role="application"
    aria-roledescription="TRS-80 screen"
    aria-label="TRS-80 screen. While it has focus, the keys you type go to the TRS-80; press Tab to leave."
    data-testid="trs-screen"
    @focus="focused = true"
    @blur="focused = false"
    @mousedown="box?.focus()"
  >
    <canvas ref="canvas" class="fg-trs-canvas" width="384" height="192" data-testid="trs-canvas" />
    <p v-if="running && !focused" class="fg-trs-hint" aria-hidden="true">Click the screen to type to the TRS-80</p>
  </div>
</template>

<style scoped>
.fg-trs { position: relative; width: min(100%, 768px); aspect-ratio: 4 / 3; background: rgb(16 18 16); border: 1px solid var(--fg-border); border-radius: 4px; outline: none; }
.fg-trs-wide { width: min(100%, 640px); }
.fg-trs:focus-visible, .fg-trs:focus { outline: 2px solid var(--fg-accent); outline-offset: 2px; }
.fg-trs-canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
.fg-trs-hint { position: absolute; right: 8px; bottom: 6px; margin: 0; padding: 2px 8px; border-radius: 3px; font-size: 12px; color: var(--fg-text-strong); background: rgb(13 17 23 / 0.85); pointer-events: none; }
</style>
