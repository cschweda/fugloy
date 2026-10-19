<script setup lang="ts">
// The TRS-80's screen (plan 5B, Rulings 4 and 9; 5D's tube): a canvas one pixel per character
// generator pixel (384x192 on the Model I, 512x192 on the Model III and 4, 640x240 at the Model 4's
// 80x24), shown at 4:3 on a black tube with pixelated scaling. Its width is tubeWidth's: the
// widest 4:3 tube that fits the host whose height is a whole multiple of the raster's rows (each
// row k screen pixels high on every model; across, the scale is k x 2/3 on the Model I and k / 2
// on the III and 4), or the host's whole width when not even one step fits; a ResizeObserver on
// the host keeps it so. The box around it is the focus element:
// keys reach the machine only while it has focus (attachKeyboard), Tab leaves it, and blur
// releases every key. While a program runs and the screen does not have
// focus, it says how to type to it. Under it, outside its application role, the screen as text
// (ScreenText, 5C), which each draw refreshes.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Machine } from '@fugloy/emu';
import ScreenText from './ScreenText.vue';
import { attachKeyboard } from '~/utils/emulator/keyboard';
import { renderScreen, SCREEN_BG, screenSize, screenView, tubeWidth } from '~/utils/emulator/screen';
import type { ScreenView } from '~/utils/emulator/screen';

const props = defineProps<{ machine: Machine | null; running: boolean }>();

/** The tube with no machine: a Model III's 64x16. */
const BLANK: ScreenView = { columns: 64, rows: 16, wide: false, inverse: false, font: 'model3', altCharset: false };
const BLANK_SIZE = screenSize(BLANK);

const host = ref<HTMLElement | null>(null);
const box = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const text = ref<InstanceType<typeof ScreenText> | null>(null);
const focused = ref(false);
const rasterHeight = ref(BLANK_SIZE.height);
const hostWidth = ref(0);
let image: ImageData | null = null;
let detach: (() => void) | null = null;
let resize: ResizeObserver | null = null;

/** The tube's CSS width (tubeWidth's), or the host's whole width when not even one step fits. */
const tubeCss = computed((): string => {
  const w = tubeWidth(rasterHeight.value, hostWidth.value);
  return w === null ? '100%' : `${w}px`;
});

function measure(): void {
  // The box's 1px border sits outside its content (content-box), so the canvas gets the whole width.
  if (host.value !== null) hostWidth.value = Math.max(0, host.value.clientWidth - 2);
}

function context(): CanvasRenderingContext2D | null {
  return canvas.value?.getContext('2d') ?? null;
}

/** Draws the machine's screen now (only what changed costs anything), or a blank tube with no machine; the text mirror follows. */
function draw(): void {
  paint();
  text.value?.refresh();
}

function paint(): void {
  const c = canvas.value;
  const ctx = context();
  if (c === null || ctx === null) return;
  const m = props.machine;
  if (m === null) {
    // No machine (a Run that did not start): a blank 64x16 tube.
    rasterHeight.value = BLANK_SIZE.height;
    image = null;
    c.width = BLANK_SIZE.width;
    c.height = BLANK_SIZE.height;
    ctx.fillStyle = `rgb(${SCREEN_BG[0]},${SCREEN_BG[1]},${SCREEN_BG[2]})`;
    ctx.fillRect(0, 0, c.width, c.height);
    return;
  }
  const view = screenView(m);
  const { width, height } = screenSize(view);
  rasterHeight.value = height;
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
  measure();
  if (host.value !== null && typeof ResizeObserver !== 'undefined') {
    resize = new ResizeObserver(measure);
    resize.observe(host.value);
  }
});
onBeforeUnmount(() => {
  detach?.();
  resize?.disconnect();
});

defineExpose({
  draw,
  focus(): void {
    box.value?.focus();
  },
});
</script>

<template>
  <div ref="host" class="fg-trs-host">
    <div
      ref="box"
      class="fg-trs"
      :style="{ width: tubeCss }"
      tabindex="0"
      role="application"
      aria-roledescription="TRS-80 screen"
      aria-label="TRS-80 screen. While it has focus, the keys you type go to the TRS-80; press Tab to leave."
      data-testid="trs-screen"
      @focus="focused = true"
      @blur="focused = false"
      @mousedown="box?.focus()"
    >
      <canvas ref="canvas" class="fg-trs-canvas" v-bind="BLANK_SIZE" data-testid="trs-canvas" />
      <p v-if="running && !focused" class="fg-trs-hint" aria-hidden="true">Click the screen to type to the TRS-80.</p>
    </div>
    <ScreenText ref="text" :machine="machine" />
  </div>
</template>

<style scoped>
.fg-trs { position: relative; box-sizing: content-box; max-width: calc(100% - 2px); aspect-ratio: 4 / 3; background: #000; border: 1px solid #222; border-radius: 0; outline: none; }
.fg-trs:focus-visible, .fg-trs:focus { outline: 2px solid var(--fg-accent); outline-offset: 2px; }
.fg-trs-canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
.fg-trs-hint { position: absolute; right: 8px; bottom: 6px; margin: 0; padding: 2px 8px; border-radius: 3px; font-size: 12px; color: var(--fg-text-strong); background: rgb(13 17 23 / 0.85); pointer-events: none; }
</style>
