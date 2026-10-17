<script setup lang="ts">
// Inside Fugløy: the interactive explainer of how the disassembler works and how it was built. Its source
// is docs/technical-details/inside-fugloy.html, a page fragment (title, fonts, one stylesheet, markup, one
// script). The markup is rendered here, on the server too, so it is in the generated page for search
// engines. Its stylesheet is scoped to .fg-inside (see utils/scope-css.ts), so none of it reaches the
// workbench, and its script runs once the page is mounted.
import { onBeforeUnmount, onMounted } from 'vue';
import source from '../../../../docs/technical-details/inside-fugloy.html?raw';
import { parseExplainer } from '~/utils/explainer';
import { scopeCss } from '~/utils/scope-css';

usePageSeo({
  title: 'Technical details',
  description: 'How Fugløy takes a TRS-80 program apart into Z80 assembly and proves it can put it back together, byte for byte. An interactive tour for the curious.',
  path: '/technical-details',
});

const explainer = parseExplainer(source);
useHead({
  link: [
    ...explainer.preconnects.map((href) => ({ rel: 'preconnect' as const, href, ...(href.includes('gstatic') ? { crossorigin: '' as const } : {}) })),
    ...explainer.stylesheets.map((href) => ({ rel: 'stylesheet' as const, href })),
  ],
  style: [{ key: 'inside-fugloy', innerHTML: scopeCss(explainer.css, '.fg-inside') }],
});

// The explainer's `html { scroll-behavior: smooth }` can only apply to the whole page, so the page sets it
// itself while it is shown (and not for visitors who ask for reduced motion).
const smooth = (on: boolean): void => {
  document.documentElement.style.scrollBehavior = on ? 'smooth' : '';
};
onBeforeUnmount(() => smooth(false));

onMounted(() => {
  smooth(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  // A fresh function scope per visit: the script declares top-level constants.
  new Function(explainer.script)();
});
</script>

<template>
  <div class="fg-inside" data-testid="explainer" v-html="explainer.markup" />
</template>
