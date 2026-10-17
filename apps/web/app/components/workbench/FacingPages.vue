<script setup lang="ts">
// Two facing pages, Inform 7 style, with a divider that drags (or moves with
// the arrow keys). On a narrow screen one page shows at a time, chosen by a
// switch above them; nothing scrolls sideways.
import { computed, ref } from 'vue';

const MIN = 25;
const MAX = 75;
/** The left page's share of the width, in percent. */
const left = ref(57);
const shown = ref<'left' | 'right'>('left');
const box = ref<HTMLElement | null>(null);
const dragging = ref(false);

const widths = computed(() => ({ '--fg-left': `${left.value}%` }));
const clamp = (v: number): number => Math.min(MAX, Math.max(MIN, v));

function onDown(e: PointerEvent): void {
  if (e.button !== 0) return;
  dragging.value = true;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  e.preventDefault();
}

function onMove(e: PointerEvent): void {
  if (!dragging.value || box.value === null) return;
  const r = box.value.getBoundingClientRect();
  left.value = clamp(((e.clientX - r.left) / r.width) * 100);
}

function onUp(e: PointerEvent): void {
  dragging.value = false;
  const el = e.currentTarget as HTMLElement;
  if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
}

function onKey(e: KeyboardEvent): void {
  const step = e.shiftKey ? 10 : 2;
  if (e.key === 'ArrowLeft') left.value = clamp(left.value - step);
  else if (e.key === 'ArrowRight') left.value = clamp(left.value + step);
  else if (e.key === 'Home') left.value = MIN;
  else if (e.key === 'End') left.value = MAX;
  else return;
  e.preventDefault();
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="fg-page-switch" role="group" aria-label="Page">
      <button type="button" :aria-pressed="shown === 'left'" @click="shown = 'left'"><slot name="left-name">Listing</slot></button>
      <button type="button" :aria-pressed="shown === 'right'" @click="shown = 'right'"><slot name="right-name">Details</slot></button>
    </div>
    <div ref="box" class="fg-pages" :class="{ 'fg-pages-dragging': dragging }" :style="widths">
      <section class="fg-page fg-page-left" :class="{ 'fg-page-hidden': shown !== 'left' }" aria-label="Left page">
        <slot name="left" />
      </section>
      <div
        class="fg-divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the pages"
        :aria-valuenow="Math.round(left)"
        :aria-valuemin="MIN"
        :aria-valuemax="MAX"
        tabindex="0"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
        @keydown="onKey"
      />
      <section class="fg-page fg-page-right" :class="{ 'fg-page-hidden': shown !== 'right' }" aria-label="Right page">
        <slot name="right" />
      </section>
    </div>
  </div>
</template>
