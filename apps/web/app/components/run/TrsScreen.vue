<script setup lang="ts">
// The TRS-80's screen (plan 5B, Rulings 4 and 9; 5D's tube; 6A's shape and full screen): a canvas
// one pixel per character generator pixel (384x192 on the Model I, 512x192 on the Model III and 4,
// 640x240 at the Model 4's 80x24), shown with pixelated scaling on a black tube at the model's
// picture shape (tubeAspect: 4:3 on the Model III and 4, about 0.952 on the Model I, from the two
// machines' dot clocks). Its size is panelFit's: the Model III's tube for the host's width (the
// largest 4:3 tube whose height is a whole multiple of the raster's rows, or the host's whole width
// when not even one step fits), every model at that height and its own shape, so the Model I is
// narrower, never taller, unless that would draw it narrower than its 384 dots: then the smallest
// whole-row height at least that wide, or the host's width at the shape (panelFit); each row is k
// screen pixels high and across the scale follows the shape. A ResizeObserver on the host keeps it
// so, and the shape follows the machine from its next frame. toggleFullscreen puts the box itself in full screen (the Fullscreen
// API; Esc leaves it too): the browser stretches the box over the whole window, black, and the
// canvas sits centred in it at tubeFit's size for the window. The box takes the focus going in and
// coming out, however full screen ends. RunTab's machine row holds the button. The box is the
// focus element: keys reach the machine only while it has focus (attachKeyboard), Tab leaves it,
// and blur releases every key. While a program runs and the screen does not have focus, it says how
// to type to it. With no machine and a `notice` (5D: no ROM for the model), the tube shows the
// notice's lines in the model's own font, and the box carries data-notice="no-rom".
// The screen as text (ScreenText, 5C) is RunTab's, in its Debugger.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Machine } from '@fugloy/emu';
import { attachKeyboard } from '~/utils/emulator/keyboard';
import { renderNotice, renderScreen, SCREEN_BG, screenSize, screenView, panelFit, tubeAspect, tubeFit } from '~/utils/emulator/screen';
import type { ScreenFont, ScreenView } from '~/utils/emulator/screen';
import type { ModelId } from '~/utils/store';

const props = defineProps<{
  machine: Machine | null;
  running: boolean;
  /** Lines the tube shows while there is no machine (the no-ROM notice); null for a blank tube. */
  notice?: readonly string[] | null;
  /** The model whose 64x16 tube and font show with no machine (the Model III's by default). */
  model?: ModelId;
}>();

const FONTS: Readonly<Record<ModelId, ScreenFont>> = { 1: 'model1', 3: 'model3', 4: 'model4' };
/** The tube with no machine: the model's 64x16. */
const blank = (): ScreenView => ({ columns: 64, rows: 16, wide: false, inverse: false, font: FONTS[props.model ?? 3], altCharset: false });
/** The canvas's size before its first draw: a Model III's. */
const BLANK_SIZE = screenSize({ columns: 64, rows: 16, wide: false, inverse: false, font: 'model3', altCharset: false });
const showingNotice = computed(() => props.machine === null && (props.notice ?? null) !== null);

const host = ref<HTMLElement | null>(null);
const box = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const focused = ref(false);
const rasterHeight = ref(BLANK_SIZE.height);
const rasterWidth = ref(BLANK_SIZE.width);
/** The character generator shown now, which sets the picture's shape. */
const font = ref<ScreenFont>('model3');
const hostWidth = ref(0);
/** Whether the box is in full screen, and the window's inside then. */
const fullscreen = ref(false);
const canFullscreen = ref(false);
const viewport = ref({ width: 0, height: 0 });
let image: ImageData | null = null;
let detach: (() => void) | null = null;
let resize: ResizeObserver | null = null;

const aspect = computed(() => tubeAspect(font.value));
/** The tube in the panel: its CSS width and height. */
const panelSize = computed(() => panelFit(rasterHeight.value, rasterWidth.value, aspect.value, hostWidth.value));
/** The tube in full screen, centred in the window. */
const fullSize = computed(() => tubeFit(rasterHeight.value, aspect.value, viewport.value.width, viewport.value.height));
// The height is set and the width follows from the aspect, so the rows stay whole on every model.
const boxStyle = computed(() => ({ height: `${panelSize.value.height}px`, aspectRatio: String(aspect.value) }));
const canvasStyle = computed(() => (fullscreen.value ? { width: `${fullSize.value.width}px`, height: `${fullSize.value.height}px` } : undefined));

function measure(): void {
  // The box's 1px border sits outside its content (content-box), so the canvas gets the whole width.
  if (host.value !== null) hostWidth.value = Math.max(0, host.value.clientWidth - 2);
  viewport.value = { width: window.innerWidth, height: window.innerHeight };
}

function onFullscreenChange(): void {
  const was = fullscreen.value;
  fullscreen.value = box.value !== null && document.fullscreenElement === box.value;
  measure();
  // The screen going in or out, by the button, Esc, or the browser: the keys stay with the TRS-80.
  if (was || fullscreen.value) box.value?.focus();
}

/** Puts the screen box in full screen, or takes it out. */
async function toggleFullscreen(): Promise<void> {
  const b = box.value;
  if (b === null) return;
  try {
    if (document.fullscreenElement === b) await document.exitFullscreen();
    else await b.requestFullscreen();
  } catch {
    // Refused (no user gesture, or the browser forbids it): the screen stays where it is.
  }
  b.focus();
}

function context(): CanvasRenderingContext2D | null {
  return canvas.value?.getContext('2d') ?? null;
}

/** Draws the machine's screen now (only what changed costs anything), or with no machine the notice or a blank tube. */
function draw(): void {
  const c = canvas.value;
  const ctx = context();
  if (c === null || ctx === null) return;
  const m = props.machine;
  if (m === null) {
    // No machine (off, or a Run that did not start): the model's 64x16 tube, blank or with the notice.
    const view = blank();
    const size = screenSize(view);
    rasterHeight.value = size.height;
    rasterWidth.value = size.width;
    font.value = view.font;
    image = null;
    c.width = size.width;
    c.height = size.height;
    const notice = props.notice ?? null;
    if (notice === null) {
      ctx.fillStyle = `rgb(${SCREEN_BG[0]},${SCREEN_BG[1]},${SCREEN_BG[2]})`;
      ctx.fillRect(0, 0, c.width, c.height);
      return;
    }
    const img = ctx.createImageData(size.width, size.height);
    renderNotice(notice, view, img.data, size.width);
    ctx.putImageData(img, 0, 0);
    return;
  }
  const view = screenView(m);
  const { width, height } = screenSize(view);
  rasterHeight.value = height;
  rasterWidth.value = width;
  font.value = view.font;
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
// The notice and the blank tube's model matter only with no machine.
watch([() => props.notice, () => props.model], () => {
  if (props.machine === null) draw();
});

onMounted(() => {
  draw();
  if (box.value !== null) detach = attachKeyboard(box.value, () => props.machine);
  canFullscreen.value = document.fullscreenEnabled === true && typeof HTMLElement.prototype.requestFullscreen === 'function';
  document.addEventListener('fullscreenchange', onFullscreenChange);
  window.addEventListener('resize', measure);
  measure();
  if (host.value !== null && typeof ResizeObserver !== 'undefined') {
    resize = new ResizeObserver(measure);
    resize.observe(host.value);
  }
});
onBeforeUnmount(() => {
  detach?.();
  resize?.disconnect();
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  window.removeEventListener('resize', measure);
  if (box.value !== null && document.fullscreenElement === box.value) void document.exitFullscreen().catch(() => undefined);
});

defineExpose({
  draw,
  fullscreen,
  canFullscreen,
  toggleFullscreen,
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
      :style="boxStyle"
      tabindex="0"
      role="application"
      aria-roledescription="TRS-80 screen"
      aria-label="TRS-80 screen. While it has focus, the keys you type go to the TRS-80; press Tab to leave."
      data-testid="trs-screen"
      :data-notice="showingNotice ? 'no-rom' : undefined"
      @focus="focused = true"
      @blur="focused = false"
      @mousedown="box?.focus()"
    >
      <canvas ref="canvas" class="fg-trs-canvas" :style="canvasStyle" v-bind="BLANK_SIZE" data-testid="trs-canvas" />
      <p v-if="running && !focused" class="fg-trs-hint" aria-hidden="true">Click the screen to type to the TRS-80.</p>
    </div>
  </div>
</template>

<style scoped>
.fg-trs { position: relative; box-sizing: content-box; max-width: calc(100% - 2px); background: #000; border: 1px solid #222; border-radius: 0; outline: none; }
.fg-trs:focus-visible, .fg-trs:focus { outline: 2px solid var(--fg-accent); outline-offset: 2px; }
.fg-trs-canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
/* Full screen: the browser stretches the box over the window; the tube sits centred in it on black. */
.fg-trs:fullscreen { display: flex; align-items: center; justify-content: center; border: 0; outline: none; background: #000; }
.fg-trs:fullscreen::backdrop { background: #000; }
.fg-trs-hint { position: absolute; right: 8px; bottom: 6px; margin: 0; padding: 2px 8px; border-radius: 3px; font-size: 12px; color: var(--fg-text-strong); background: rgb(13 17 23 / 0.85); pointer-events: none; }
</style>
