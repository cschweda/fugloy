<script setup lang="ts">
// A lesson's text (phase 6B Task 4): the lesson format's blocks as plain markup, rendered on the
// server with the page. `## ` headings are h2 (the page's h1 is the lesson's title), paragraphs and
// `- ` lists as they are, and code in pre/code; a JavaScript block sits in a figure captioned
// "In JavaScript", so the aside reads as one. No lazy parts.
import type { Inline, LessonBlock } from '~/utils/learn/lesson-format';

defineProps<{ blocks: readonly LessonBlock[] }>();

/** A link out of the site opens beside it; the site's own links stay in the tab. */
const external = (i: Inline & { kind: 'link' }): boolean => /^https?:/.test(i.href);
</script>

<template>
  <div class="fg-lesson-text">
    <template v-for="(b, k) in blocks" :key="k">
      <h2 v-if="b.kind === 'h2'" :id="b.id">{{ b.text }}</h2>
      <p v-else-if="b.kind === 'p'">
        <template v-for="(i, n) in b.inlines" :key="n">
          <code v-if="i.kind === 'code'">{{ i.text }}</code>
          <em v-else-if="i.kind === 'em'">{{ i.text }}</em>
          <strong v-else-if="i.kind === 'strong'" class="fg-strong">{{ i.text }}</strong>
          <a v-else-if="i.kind === 'link'" :href="i.href" :target="external(i) ? '_blank' : undefined" :rel="external(i) ? 'noopener' : undefined">{{ i.text }}</a>
          <template v-else>{{ i.text }}</template>
        </template>
      </p>
      <ul v-else-if="b.kind === 'ul'">
        <li v-for="(item, n) in b.items" :key="n">
          <template v-for="(i, m) in item" :key="m">
            <code v-if="i.kind === 'code'">{{ i.text }}</code>
            <em v-else-if="i.kind === 'em'">{{ i.text }}</em>
            <strong v-else-if="i.kind === 'strong'" class="fg-strong">{{ i.text }}</strong>
            <a v-else-if="i.kind === 'link'" :href="i.href" :target="external(i) ? '_blank' : undefined" :rel="external(i) ? 'noopener' : undefined">{{ i.text }}</a>
            <template v-else>{{ i.text }}</template>
          </template>
        </li>
      </ul>
      <figure v-else-if="b.lang === 'js'" class="fg-lesson-js">
        <figcaption>In JavaScript</figcaption>
        <pre tabindex="0"><code>{{ b.text }}</code></pre>
      </figure>
      <pre v-else tabindex="0"><code>{{ b.text }}</code></pre>
    </template>
  </div>
</template>

<style scoped>
.fg-lesson-text { display: flex; flex-direction: column; gap: 10px; font-size: 14px; line-height: 1.6; }
.fg-lesson-text h2 { margin: 10px 0 0; font-size: 15px; font-weight: 700; color: var(--fg-text-strong); }
.fg-lesson-text p, .fg-lesson-text ul, .fg-lesson-text figure { margin: 0; }
.fg-lesson-text ul { padding-left: 1.4em; list-style: disc; }
.fg-lesson-text code { font-family: var(--fg-mono); font-size: 0.92em; }
.fg-lesson-text p code, .fg-lesson-text li code { padding: 0 3px; border-radius: 3px; background: var(--fg-surface); }
.fg-lesson-text pre { margin: 0; padding: 8px 10px; overflow-x: auto; border: 1px solid var(--fg-border); border-radius: 4px; background: var(--fg-surface); font-size: 12.5px; line-height: 1.5; }
.fg-lesson-text pre:focus-visible { outline: 2px solid var(--fg-accent); outline-offset: 1px; }
.fg-lesson-text figcaption { margin-bottom: 4px; font-size: 12px; font-weight: 600; color: var(--fg-muted); }
.fg-lesson-text a { color: var(--fg-accent); text-decoration: underline; }
</style>
