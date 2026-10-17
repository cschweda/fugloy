<script setup lang="ts">
// A 64K strip: ROM, keyboard and video, then where the program loads and, if it
// moves itself, where it is copied to. Drawn as SVG rects scaled to 65,536 wide.
import { computed } from 'vue';
import { addr$, memorySegments, SEGMENT_NAME } from '../../utils/spec-sheet';
import type { SegmentKind } from '../../utils/spec-sheet';

const props = defineProps<{
  loads: readonly { start: number; end: number }[];
  relocations: readonly { run: number; length: number }[];
}>();

const segments = computed(() => memorySegments(props.loads, props.relocations));
const AXIS = [0x0000, 0x4000, 0x8000, 0xc000, 0xffff];
const legend = computed(() => {
  const present = new Set<SegmentKind>(segments.value.map((s) => s.kind));
  return (['rom', 'video', 'program', 'moved'] as const).filter((k) => present.has(k));
});
</script>

<template>
  <div data-testid="memory-map">
    <svg class="fg-map" viewBox="0 0 65536 16" preserveAspectRatio="none" role="img" aria-label="Memory map of the 64K address space">
      <rect v-for="s in segments" :key="s.start" :class="`fg-map-${s.kind}`" :x="s.start" y="0" :width="s.length" height="16">
        <title>{{ SEGMENT_NAME[s.kind] }} {{ addr$(s.start) }}–{{ addr$(s.start + s.length - 1) }}</title>
      </rect>
    </svg>
    <div class="fg-map-axis fg-mono" aria-hidden="true">
      <span v-for="a in AXIS" :key="a">{{ addr$(a) }}</span>
    </div>
    <ul class="fg-map-legend">
      <li v-for="k in legend" :key="k"><span :class="`fg-swatch fg-map-${k}`" aria-hidden="true"></span>{{ SEGMENT_NAME[k] }}</li>
    </ul>
  </div>
</template>
