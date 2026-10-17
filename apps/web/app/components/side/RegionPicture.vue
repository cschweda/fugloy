<script setup lang="ts">
// A data region drawn in the TRS-80 character set: $20-$7E as characters,
// $80-$BF as the 2x3 block graphics, anything else (and $7F, DEL) as a dim dot,
// at a width the reader picks. Graphics, maps and title screens often show
// up this way. Drawn on a canvas, only the region's bytes (at most 16K).
import { nextTick, onMounted, ref, watch } from 'vue';
import { trsGlyph } from '@fugloy/disasm';

const props = defineProps<{ bytes: Uint8Array; name: string }>();

const WIDTHS = [8, 16, 32, 64] as const;
const MIN = 8;
const MAX = 256;
/** One character cell, in CSS pixels: 8 wide, 12 tall (each block sub-cell 4 by 4). */
const CW = 8;
const CH = 12;
/** The tallest canvas a browser reliably draws, in device pixels. */
const MAX_DEVICE = 32_000;

const width = ref(64);
const field = ref('64');
const canvas = ref<HTMLCanvasElement | null>(null);

function setWidth(w: number): void {
  width.value = w;
  field.value = String(w);
}

function onField(): void {
  const n = Number.parseInt(field.value, 10);
  if (Number.isFinite(n)) width.value = Math.min(MAX, Math.max(MIN, n));
}

function draw(): void {
  const el = canvas.value;
  if (el === null) return;
  const cols = width.value;
  const rows = Math.max(1, Math.ceil(props.bytes.length / cols));
  const cssW = cols * CW;
  const cssH = rows * CH;
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, Math.floor(MAX_DEVICE / cssH)));
  el.width = cssW * dpr;
  el.height = cssH * dpr;
  el.style.width = `${cssW}px`;
  el.style.height = `${cssH}px`;
  const g = el.getContext('2d');
  if (g === null) return;
  const css = getComputedStyle(el);
  const fg = css.getPropertyValue('--fg-text-strong').trim() || '#f0f6fc';
  const dim = css.getPropertyValue('--fg-muted').trim() || '#8b949e';
  const bg = css.getPropertyValue('--fg-bg').trim() || '#0d1117';
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = bg;
  g.fillRect(0, 0, cssW, cssH);
  g.font = `10px ${css.getPropertyValue('--fg-mono').trim() || 'monospace'}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < props.bytes.length; i++) {
    const x = (i % cols) * CW;
    const y = Math.floor(i / cols) * CH;
    const b = props.bytes[i]!;
    const glyph = b === 0x7f ? ({ kind: 'other' } as const) : trsGlyph(b);
    if (glyph.kind === 'text') {
      if (glyph.char === ' ') continue;
      g.fillStyle = fg;
      g.fillText(glyph.char, x + CW / 2, y + CH / 2 + 1);
    } else if (glyph.kind === 'block') {
      g.fillStyle = fg;
      glyph.cells.forEach((lit, c) => {
        if (lit) g.fillRect(x + (c % 2) * 4, y + Math.floor(c / 2) * 4, 4, 4);
      });
    } else {
      g.fillStyle = dim;
      g.globalAlpha = 0.5;
      g.fillRect(x + CW / 2 - 0.5, y + CH / 2 - 0.5, 1, 1);
      g.globalAlpha = 1;
    }
  }
}

watch([() => props.bytes, width], () => void nextTick(draw));
onMounted(draw);
</script>

<template>
  <div class="fg-picture" data-testid="region-picture">
    <div class="fg-picture-bar" role="group" aria-label="Picture width">
      <span class="fg-muted">Width</span>
      <button
        v-for="w in WIDTHS"
        :key="w"
        type="button"
        class="fg-button fg-picture-width"
        :aria-pressed="width === w"
        @click="setWidth(w)"
      >{{ w }}</button>
      <label class="fg-muted" for="fg-picture-width">Other</label>
      <input
        id="fg-picture-width"
        v-model="field"
        class="fg-input fg-mono fg-picture-field"
        type="number"
        :min="MIN"
        :max="MAX"
        inputmode="numeric"
        @input="onField"
      />
    </div>
    <div class="fg-picture-frame" tabindex="0" role="group" :aria-label="`Picture of ${name}`">
      <canvas
        ref="canvas"
        role="img"
        :aria-label="`${name} drawn in the TRS-80 character set, ${width} characters to a row`"
        data-testid="region-canvas"
      />
    </div>
    <p class="fg-muted fg-picture-note">Text bytes draw as characters, $80–$BF as block graphics, anything else as a dim dot.</p>
  </div>
</template>
