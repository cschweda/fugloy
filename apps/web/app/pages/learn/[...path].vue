<script setup lang="ts">
// The Learn page's routes, one page for both courses (phase 6C Task 1, fix round 1), drawn by
// components/learn/CoursePage:
//   /learn/ and /learn/<slug>/                    Learn Z80 assembly: lesson 1, and each lesson
//   /learn/invaders/ and /learn/invaders/<slug>/  Build Space Invaders: chapter 1, and each chapter
// One page file, as 6B had, so the workbench's route table and preload map carry one Learn page.
// The item, and for a chapter the previous chapter's program that its program is marked against (the
// blank page for chapter 1), are loaded on their own (utils/learn/lessons' loadPageItem) through
// useAsyncData: the prerendered page's payload carries them, and no other item's text is on the page.
import CoursePage from '~/components/learn/CoursePage.vue';
import { entryOf, indexOf, loadPageItem } from '~/utils/learn/lessons';
import type { Course } from '~/utils/learn/page';

const route = useRoute();
const parts = (Array.isArray(route.params.path) ? route.params.path : [route.params.path ?? '']).filter((p): p is string => typeof p === 'string' && p !== '');
const course: Course = parts[0] === 'invaders' ? 'invaders' : 'lessons';
const rest = course === 'invaders' ? parts.slice(1) : parts;
const what = course === 'invaders' ? 'chapter' : 'lesson';
const home = course === 'invaders' ? '/learn/invaders/' : '/learn/';
const notFound = (name: string) => createError({ statusCode: 404, statusMessage: `There is no ${what} called ${name}. Open ${home} for the first ${what}.`, fatal: true });
if (rest.length > 1) throw notFound(rest.join('/'));
const asked = rest[0] ?? '';
const entry = asked === '' ? (indexOf(course)[0] ?? null) : entryOf(course, asked);
if (entry === null) throw notFound(asked);
// Not awaited: the server waits for it before it renders (Nuxt's useAsyncData), hydration reads it
// from the payload, and a move from another page draws the page once it is there. A top-level await
// would add Vue's async-setup helper to the runtime chunk the workbench's first screen shares.
const { data: page } = useAsyncData(`learn:${course}:${entry.slug}`, () => loadPageItem(course, entry.slug));
const items = indexOf(course);
const basePath = course === 'invaders' ? '/learn/invaders' : '/learn';
</script>

<template>
  <CoursePage v-if="page" :items="items" :item="page.item" :base-path="basePath" :course="course" :marks-against="page.marksAgainst" />
</template>
