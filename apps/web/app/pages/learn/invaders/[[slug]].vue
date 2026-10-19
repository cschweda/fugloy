<script setup lang="ts">
// Build Space Invaders (phase 6C Task 1): /learn/invaders/ shows chapter 1 and /learn/invaders/<slug>/
// each chapter, in components/learn/CoursePage, as the lessons are; each chapter's program is marked
// against the chapter before's (chapter 1's against the blank page).
import CoursePage from '~/components/learn/CoursePage.vue';
import { CHAPTERS, chapterBySlug } from '~/utils/learn/lessons';

const route = useRoute();
const asked = typeof route.params.slug === 'string' ? route.params.slug : '';
const found = asked === '' ? (CHAPTERS[0] ?? null) : chapterBySlug(asked);
if (found === null) throw createError({ statusCode: 404, statusMessage: `There is no chapter called ${asked}. Open /learn/invaders/ for the first chapter.`, fatal: true });
const chapter = found;
const at = CHAPTERS.indexOf(chapter);
const previous = at > 0 ? CHAPTERS[at - 1]! : null;
</script>

<template>
  <CoursePage :items="CHAPTERS" :item="chapter" base-path="/learn/invaders" course="invaders" :previous="previous" />
</template>
