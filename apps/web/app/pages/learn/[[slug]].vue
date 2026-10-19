<script setup lang="ts">
// Learn Z80 assembly (phase 6B Task 4): one lesson in three columns, lesson | program | TRS-80, a
// CSS grid from 1200 px wide, stacked in that order below it. /learn/ shows lesson 1 and
// /learn/<slug>/ each lesson; nuxt.config prerenders them all from content/learn's folders.
//
// The lesson column (its text, Try it, In a real game, ◀ ▶, and the lesson list with its done marks
// from its header) renders on the server. The program column (components/source/LessonEditor) and
// the TRS-80 column (components/run/LessonMachine) are lazy roots, loaded with defineAsyncComponent
// once the page is in the browser, with the Run and the lesson sources (utils/learn/learn-run), so
// CodeMirror, asm and emu are never on this page's first screen or preloaded by it.
//
// Nuxt keys a page by its path, so each lesson is its own instance of this page; the Run, the
// sources and the learner's progress are shared (learn-run). Leaving a lesson (◀ ▶, the list, the
// browser's Back, another page) turns the TRS-80 off, which stops the program or a Run still
// loading and clears its registers and running line (Review Focus 2); the next lesson selects its
// own source, made on its first visit from the saved edit or the lesson's program. A clean Run marks
// the lesson done. Open in the workbench copies the program into a workbench source (made current),
// marks the workbench as writing, and shows Source ✎ once the workbench page has finished loading.
//
// The Learn link is in neither the header nor the sitemap yet (Task 8).
import { computed, defineAsyncComponent, h, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import LessonText from '~/components/learn/LessonText.vue';
import { LESSONS, lessonBySlug } from '~/utils/learn/lessons';
import { lessonNeighbours, lessonPath } from '~/utils/learn/page';
import { learnProgress, loadedLearn, loadLearn } from '~/utils/learn/learn-run';
import type { LearnParts } from '~/utils/learn/learn-run';
import { loadFailed } from '~/utils/lazy';
import { openAsSourceRequests } from '~/utils/open-as-source';

const route = useRoute();
const asked = typeof route.params.slug === 'string' ? route.params.slug : '';
const found = asked === '' ? (LESSONS[0] ?? null) : lessonBySlug(asked);
if (found === null) throw createError({ statusCode: 404, statusMessage: `There is no lesson called ${asked}. Open /learn/ for the first lesson.`, fatal: true });
const lesson = found;
const { prev, next } = lessonNeighbours(LESSONS, lesson.slug);

usePageSeo({
  title: `${lesson.title} — Learn Z80 assembly`,
  description: `Lesson ${lesson.number} of Learn Z80 assembly with Fugløy: ${lesson.idea}. Read it, run the program on a TRS-80 in your browser, and change it.`,
  path: `/learn/${lesson.slug}`,
});

/** One sentence when a lazy column cannot be fetched after a second try (utils/lazy's words, with reloading next). */
const failed = (what: string) => () => h('p', { class: 'fg-learn-problem', role: 'alert' }, loadFailed(what, 'Reload the page'));
const lazyColumn = (loader: () => Promise<unknown>, what: string) =>
  defineAsyncComponent({
    loader: loader as () => Promise<{ default: never }>,
    errorComponent: { render: failed(what) },
    onError: (_err, retry, fail, attempts) => (attempts <= 1 ? retry() : fail()),
  });
const LessonEditor = lazyColumn(() => import('~/components/source/LessonEditor.vue'), 'The lesson editor');
const LessonMachine = lazyColumn(() => import('~/components/run/LessonMachine.vue'), 'The TRS-80');

const parts = shallowRef<LearnParts | null>(null);
const partsError = ref<string | null>(null);
const done = ref<ReadonlySet<string>>(new Set());
const listOpen = ref(false);
const openError = ref<string | null>(null);
let gone = false;

/** The Run and the sources, then this lesson's source, made on its first visit and selected. */
async function start(): Promise<void> {
  partsError.value = null;
  let p: LearnParts;
  try {
    p = await loadLearn();
  } catch {
    if (!gone) partsError.value = loadFailed("The lesson's program and its TRS-80");
    return;
  }
  if (gone) return;
  const id = p.ids.get(lesson.slug);
  if (id !== undefined) await p.sources.select(id);
  else {
    const src = await p.sources.create({ name: `${lesson.slug}.z`, text: learnProgress().edit(lesson.slug) ?? lesson.program, model: lesson.models[0] ?? 3 });
    p.ids.set(lesson.slug, src.id);
  }
  if (!gone) parts.value = p;
}

function onClean(): void {
  const progress = learnProgress();
  progress.markDone(lesson.slug);
  done.value = progress.done();
}

const nuxtApp = useNuxtApp();
const wb = useWorkbench();
/** Open in the workbench: a workbench source with the program, current, shown in Source ✎. */
async function openInWorkbench(text: string, model: 1 | 3): Promise<void> {
  openError.value = null;
  try {
    const { useSources } = await import('~/composables/useSources');
    await useSources().create({ name: `${lesson.slug}.z`, text, model });
  } catch (err) {
    openError.value = err instanceof Error && /\.$/.test(err.message) ? err.message : loadFailed("The workbench's sources", 'Press Open in the workbench again');
    return;
  }
  wb.writing.value = true;
  // The workbench page shows Source ✎ when this count changes, which it watches from its setup on.
  nuxtApp.hooks.hookOnce('page:finish', () => {
    openAsSourceRequests.value++;
  });
  await navigateTo('/');
}

onMounted(() => {
  done.value = learnProgress().done();
  void start();
  // The browser checks' hook, only in a build made with NUXT_PUBLIC_E2E=1 (the minifier drops it otherwise).
  if (__FUGLOY_E2E__) {
    const machine = () => loadedLearn()?.run.runner.value?.machine ?? null;
    window.__fugloyLearn = {
      keyboardRows: () => Array.from(machine()?.system.keyboard.rows ?? []),
      screenText: () => machine()?.video.text() ?? [],
      runnerState: () => loadedLearn()?.run.state.value ?? 'idle',
      debugMode: () => loadedLearn()?.run.debug.mode.value ?? 'idle',
    };
  }
});
onBeforeUnmount(() => {
  gone = true;
  // Leaving the lesson: nothing of its program stays running, on screen, or in the registers.
  const p = loadedLearn();
  if (p !== null) {
    p.run.powerOff();
    p.run.message.value = null;
    p.run.problem.value = false;
  }
  if (__FUGLOY_E2E__) delete window.__fugloyLearn;
});

const doneCount = computed(() => LESSONS.filter((l) => done.value.has(l.slug)).length);
</script>

<template>
  <div class="fg-learn" data-testid="learn">
    <section class="fg-learn-col fg-learn-lesson" aria-labelledby="lesson-title">
      <header class="fg-learn-head">
        <p class="fg-muted fg-learn-kicker">Learn Z80 assembly · Lesson {{ lesson.number }} of {{ LESSONS.length }}</p>
        <div class="fg-learn-titlebar">
          <h1 id="lesson-title" class="fg-strong" data-testid="lesson-title">{{ lesson.title }}</h1>
          <button
            type="button"
            class="fg-button"
            data-testid="lesson-list-toggle"
            aria-controls="lesson-list"
            :aria-expanded="listOpen"
            @click="listOpen = !listOpen"
          >
            Lessons
          </button>
        </div>
        <p class="fg-learn-idea">{{ lesson.idea }}</p>
      </header>
      <nav v-show="listOpen" id="lesson-list" class="fg-learn-list" aria-label="Lessons" data-testid="lesson-list">
        <p class="fg-muted">{{ doneCount }} of {{ LESSONS.length }} done in this browser.</p>
        <ol>
          <li v-for="l in LESSONS" :key="l.slug">
            <NuxtLink :to="lessonPath(l.slug)" :aria-current="l.slug === lesson.slug ? 'page' : undefined">{{ l.number }}. {{ l.title }}</NuxtLink>
            <span v-if="done.has(l.slug)" class="fg-learn-done" :data-testid="`lesson-done-${l.slug}`"><span aria-hidden="true">✓</span><span class="sr-only">, done</span></span>
          </li>
        </ol>
      </nav>
      <LessonText :blocks="lesson.body" data-testid="lesson-text" />
      <aside class="fg-learn-box" aria-labelledby="lesson-try-title" data-testid="lesson-try">
        <h2 id="lesson-try-title">Try it</h2>
        <LessonText :blocks="lesson.tryIt" />
      </aside>
      <aside v-if="lesson.game !== null" class="fg-learn-box" aria-labelledby="lesson-game-title" data-testid="lesson-game">
        <h2 id="lesson-game-title">In a real game</h2>
        <LessonText :blocks="lesson.game.blocks" />
      </aside>
      <nav class="fg-learn-pager" aria-label="Previous and next lesson">
        <NuxtLink v-if="prev !== null" class="fg-button" :to="lessonPath(prev.slug)" data-testid="lesson-prev">◀ {{ prev.number }}. {{ prev.title }}</NuxtLink>
        <span v-else />
        <NuxtLink v-if="next !== null" class="fg-button" :to="lessonPath(next.slug)" data-testid="lesson-next">{{ next.number }}. {{ next.title }} ▶</NuxtLink>
      </nav>
    </section>

    <section class="fg-learn-col fg-learn-program" aria-label="Program" data-testid="lesson-program">
      <LessonEditor v-if="parts !== null" :run="parts.run" :sources="parts.sources" :lesson="lesson" @clean="onClean" @open-workbench="openInWorkbench" />
      <div v-else-if="partsError !== null" class="fg-learn-problem">
        <p role="alert">{{ partsError }}</p>
        <p><button type="button" class="fg-button" @click="start">Retry</button></p>
      </div>
      <p v-else class="fg-muted" role="status">Loading the program…</p>
      <p v-if="openError !== null" class="fg-learn-problem" role="alert">{{ openError }}</p>
    </section>

    <section class="fg-learn-col fg-learn-machine" aria-label="TRS-80" data-testid="lesson-machine">
      <LessonMachine v-if="parts !== null" :run="parts.run" :sources="parts.sources" :models="lesson.models" />
      <p v-else-if="partsError === null" class="fg-muted" role="status">Loading the TRS-80…</p>
    </section>
  </div>
</template>

<style scoped>
.fg-learn { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; width: 100%; max-width: 1800px; margin: 0 auto; padding: 16px; }
@media (min-width: 1200px) {
  .fg-learn { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.25fr); align-items: start; }
}
.fg-learn-col { display: flex; min-width: 0; flex-direction: column; gap: 12px; }
.fg-learn-head { display: flex; flex-direction: column; gap: 4px; }
.fg-learn-kicker { margin: 0; font-size: 12px; }
.fg-learn-titlebar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.fg-learn-titlebar h1 { margin: 0; font-size: 22px; font-weight: 700; }
.fg-learn-idea { margin: 0; color: var(--fg-muted); font-size: 13px; }
.fg-learn-list { padding: 8px 12px; border: 1px solid var(--fg-border); border-radius: 4px; background: var(--fg-surface); font-size: 13px; }
.fg-learn-list p { margin: 0 0 6px; }
.fg-learn-list ol { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
.fg-learn-list a { display: inline-flex; align-items: center; min-height: 24px; color: var(--fg-text); }
.fg-learn-list a[aria-current='page'] { font-weight: 700; color: var(--fg-text-strong); }
.fg-learn-done { margin-left: 6px; color: var(--fg-accent); }
.fg-learn-box { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--fg-border); border-left: 3px solid var(--fg-accent); border-radius: 4px; }
.fg-learn-box h2 { margin: 0; font-size: 15px; font-weight: 700; color: var(--fg-text-strong); }
.fg-learn-pager { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.fg-learn-problem { color: var(--fg-error); }
</style>
