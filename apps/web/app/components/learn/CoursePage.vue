<script setup lang="ts">
// Learn Z80 assembly (phase 6B Task 4), as a course (phase 6C Task 1): one item, a lesson or a Space
// Invaders chapter, in three columns, item | program | TRS-80, a CSS grid from 1200 px wide, stacked
// in that order below it. The pages are thin: pages/learn/[[slug]].vue gives it the lessons
// (/learn/ and /learn/<slug>/), pages/learn/invaders/[[slug]].vue the chapters (/learn/invaders/ and
// /learn/invaders/<slug>/); nuxt.config prerenders them all from content/learn's folders.
//
// The item column (its text, Try it, In a real game, ◀ ▶, and the list with its done marks from its
// header) renders on the server. The program column (components/source/LessonEditor) and the TRS-80
// column (components/run/LessonMachine) are lazy roots, loaded with defineAsyncComponent once the page
// is in the browser, with the Run and the sources (utils/learn/learn-run), so CodeMirror, asm and emu
// are never on this page's first screen or preloaded by it.
//
// Nuxt keys a page by its path, so each item is its own instance of this component; the Run, the
// sources and the learner's progress are shared (learn-run), keyed by progress id (the lesson's slug,
// `invaders/<slug>` for a chapter, so a chapter never shares a lesson's edit or done mark). Leaving an
// item (◀ ▶, the list, the browser's Back, another page or the other course) turns the TRS-80 off,
// which stops the program or a Run still loading and clears its registers and running line (Review
// Focus 2; 6C's Review Focus 3); the next item selects its own source, made on its first visit from
// the saved edit or the item's program. A clean Run marks the item done. Open in the workbench copies
// the program into a workbench source (made current), marks the workbench as writing, and shows
// Source ✎ once the workbench page has finished loading. A chapter's program is marked against
// `previous`'s (the blank page for chapter 1) in the editor.
import { computed, defineAsyncComponent, h, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import LessonText from '~/components/learn/LessonText.vue';
import type { Lesson } from '~/utils/learn/lesson-format';
import { gameLink, itemPath, lessonNeighbours, progressId } from '~/utils/learn/page';
import type { Course, CourseBase } from '~/utils/learn/page';
import { learnProgress, loadedLearn, loadLearn } from '~/utils/learn/learn-run';
import type { LearnParts } from '~/utils/learn/learn-run';
import { loadFailed } from '~/utils/lazy';
import { openAsSourceRequests } from '~/utils/open-as-source';

const props = defineProps<{
  /** The course's lessons or chapters, in order. */
  items: readonly Lesson[];
  /** The one shown. */
  item: Lesson;
  basePath: CourseBase;
  course: Course;
  /** The chapter before, whose program the item's is marked against (null for chapter 1 and for lessons). */
  previous: Lesson | null;
}>();

// The props of a page instance never change: Nuxt makes a new one for each path.
const lesson = props.item;
const items = props.items;
const isChapter = props.course === 'invaders';
const id = progressId(props.course, lesson.slug);
const { prev, next } = lessonNeighbours(items, lesson.slug);
const pathOf = (slug: string): string => itemPath(props.basePath, slug);
/** The previous chapter's program, the blank page for chapter 1; null on a lesson, which has no marks. */
const marksAgainst = isChapter ? (props.previous?.program ?? '') : null;
const word = isChapter ? 'Chapter' : 'Lesson';
const courseName = isChapter ? 'Build Space Invaders' : 'Learn Z80 assembly';

usePageSeo({
  title: `${lesson.title} — ${courseName}`,
  description: isChapter
    ? `Chapter ${lesson.number} of Build Space Invaders with Fugløy: ${lesson.idea}. Read it, run the game so far on a TRS-80 in your browser, and change it.`
    : `Lesson ${lesson.number} of Learn Z80 assembly with Fugløy: ${lesson.idea}. Read it, run the program on a TRS-80 in your browser, and change it.`,
  // /learn/ opens lesson 1 and /learn/invaders/ chapter 1, and each names that item's URL as its canonical one.
  path: `${props.basePath}/${lesson.slug}`,
});

/** One sentence when a lazy column cannot be fetched after a second try (utils/lazy's words, with reloading next). */
const failed = (what: string) => () => h('p', { class: 'fg-learn-problem', role: 'alert' }, loadFailed(what, 'Reload the page'));
const lazyColumn = (loader: () => Promise<unknown>, what: string) =>
  defineAsyncComponent({
    loader: loader as () => Promise<{ default: never }>,
    errorComponent: { render: failed(what) },
    onError: (_err, retry, fail, attempts) => (attempts <= 1 ? retry() : fail()),
  });
const LessonEditor = lazyColumn(() => import('~/components/source/LessonEditor.vue'), `The ${word.toLowerCase()} editor`);
const LessonMachine = lazyColumn(() => import('~/components/run/LessonMachine.vue'), 'The TRS-80');

const parts = shallowRef<LearnParts | null>(null);
const partsError = ref<string | null>(null);
const done = ref<ReadonlySet<string>>(new Set());
const listOpen = ref(false);
const openError = ref<string | null>(null);
let gone = false;
/** The browser checks' hook this page set, in an E2E build. */
let hook: Window['__fugloyLearn'] = undefined;

/** The Run and the sources, then this item's source, made on its first visit and selected. */
async function start(): Promise<void> {
  partsError.value = null;
  let p: LearnParts;
  try {
    p = await loadLearn();
  } catch {
    if (!gone) partsError.value = loadFailed(`The ${word.toLowerCase()}'s program and its TRS-80`);
    return;
  }
  if (gone) return;
  const known = p.ids.get(id);
  if (known !== undefined) await p.sources.select(known);
  else {
    const src = await p.sources.create({ name: `${lesson.slug}.z`, text: learnProgress().edit(id) ?? lesson.program, model: lesson.models[0] ?? 3 });
    p.ids.set(id, src.id);
  }
  if (!gone) parts.value = p;
}

function onClean(): void {
  const progress = learnProgress();
  progress.markDone(id);
  done.value = progress.done();
}

const nuxtApp = useNuxtApp();
const router = useRouter();
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
    window.__fugloyLearn = hook = {
      keyboardRows: () => Array.from(machine()?.system.keyboard.rows ?? []),
      screenText: () => machine()?.video.text() ?? [],
      runnerState: () => loadedLearn()?.run.state.value ?? 'idle',
      debugMode: () => loadedLearn()?.run.debug.mode.value ?? 'idle',
      go: (path: string) => router.push(path),
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
  // Only this page's own: the next page's may already be in place.
  if (__FUGLOY_E2E__ && window.__fugloyLearn === hook) delete window.__fugloyLearn;
});

const doneCount = computed(() => items.filter((l) => done.value.has(progressId(props.course, l.slug))).length);
const isDone = (l: Lesson): boolean => done.value.has(progressId(props.course, l.slug));
</script>

<template>
  <div class="fg-learn" data-testid="learn">
    <section class="fg-learn-col fg-learn-lesson" aria-labelledby="lesson-title">
      <header class="fg-learn-head">
        <p class="fg-muted fg-learn-kicker">{{ courseName }} · {{ word }} {{ lesson.number }} of {{ items.length }}</p>
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
            {{ word }}s
          </button>
        </div>
        <p class="fg-learn-idea">{{ lesson.idea }}</p>
      </header>
      <nav v-show="listOpen" id="lesson-list" class="fg-learn-list" :aria-label="`${word}s`" data-testid="lesson-list">
        <p class="fg-muted">{{ doneCount }} of {{ items.length }} done in this browser.</p>
        <ol>
          <li v-for="l in items" :key="l.slug">
            <NuxtLink :to="pathOf(l.slug)" :aria-current="l.slug === lesson.slug ? 'page' : undefined">{{ l.number }}. {{ l.title }}</NuxtLink>
            <span v-if="isDone(l)" class="fg-learn-done" :data-testid="`lesson-done-${l.slug}`"><span aria-hidden="true">✓</span><span class="sr-only">, done</span></span>
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
        <p><NuxtLink :to="gameLink(lesson.game)" data-testid="lesson-game-open">Open Sea Dragon at {{ lesson.game.name }}</NuxtLink></p>
      </aside>
      <nav class="fg-learn-pager" :aria-label="`Previous and next ${word.toLowerCase()}`">
        <NuxtLink v-if="prev !== null" class="fg-button" :to="pathOf(prev.slug)" data-testid="lesson-prev">◀ {{ prev.number }}. {{ prev.title }}</NuxtLink>
        <span v-else />
        <NuxtLink v-if="next !== null" class="fg-button" :to="pathOf(next.slug)" data-testid="lesson-next">{{ next.number }}. {{ next.title }} ▶</NuxtLink>
      </nav>
    </section>

    <section class="fg-learn-col fg-learn-program" aria-label="Program" data-testid="lesson-program">
      <LessonEditor v-if="parts !== null" :run="parts.run" :sources="parts.sources" :lesson="lesson" :course="course" :marks-against="marksAgainst" @clean="onClean" @open-workbench="openInWorkbench" />
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
.fg-learn-box > p { margin: 0; font-size: 14px; }
.fg-learn-box > p a { color: var(--fg-accent); text-decoration: underline; }
.fg-learn-pager { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.fg-learn-problem { color: var(--fg-error); }
</style>
