<script setup lang="ts">
// Learn Z80 assembly (phase 6B Task 4): /learn/ shows lesson 1 and /learn/<slug>/ each lesson, in
// components/learn/CoursePage (phase 6C moved the page's body there, to serve the chapters too).
import CoursePage from '~/components/learn/CoursePage.vue';
import { LESSONS, lessonBySlug } from '~/utils/learn/lessons';

const route = useRoute();
const asked = typeof route.params.slug === 'string' ? route.params.slug : '';
const found = asked === '' ? (LESSONS[0] ?? null) : lessonBySlug(asked);
if (found === null) throw createError({ statusCode: 404, statusMessage: `There is no lesson called ${asked}. Open /learn/ for the first lesson.`, fatal: true });
const lesson = found;
</script>

<template>
  <CoursePage :items="LESSONS" :item="lesson" base-path="/learn" course="lessons" :previous="null" />
</template>
