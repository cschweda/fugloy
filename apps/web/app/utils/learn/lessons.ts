// The lessons (content/learn/NN-slug/) and, from phase 6C, the Space Invaders chapters
// (content/learn/invaders/NN-slug/), in the same format. Only NN-slug folders count, so invaders/ is
// not a lesson.
//
// Fix round 1 of 6C Task 1: the Learn pages no longer bundle every item's text. What the lists, ◀ ▶,
// the kicker and the SEO need is the small generated index (learn-index.generated.ts, from
// scripts/build-learn-index.ts); an item's lesson.md and program.z are loaded on their own, one chunk
// each (Vite's import.meta.glob, not eager, as text), by `loadItem`, which the pages await through
// useAsyncData, so a prerendered page's payload carries its item and hydration fetches nothing else.
import { parseLesson } from './lesson-format';
import type { Lesson, LessonEntry } from './lesson-format';
import { CHAPTER_INDEX, LESSON_INDEX } from './learn-index.generated';
import type { Course } from './page';

export { CHAPTER_INDEX, LESSON_INDEX };

const glob = {
  lessons: {
    md: import.meta.glob<string>('../../../content/learn/*/lesson.md', { query: '?raw', import: 'default' }),
    program: import.meta.glob<string>('../../../content/learn/*/program.z', { query: '?raw', import: 'default' }),
  },
  invaders: {
    md: import.meta.glob<string>('../../../content/learn/invaders/*/lesson.md', { query: '?raw', import: 'default' }),
    program: import.meta.glob<string>('../../../content/learn/invaders/*/program.z', { query: '?raw', import: 'default' }),
  },
};

const base = (course: Course): string => (course === 'invaders' ? '../../../content/learn/invaders/' : '../../../content/learn/');

/** A course's index. */
export const indexOf = (course: Course): readonly LessonEntry[] => (course === 'invaders' ? CHAPTER_INDEX : LESSON_INDEX);

/** The index entry for `slug` in `course`, or null (only NN-slug folders are items). */
export const entryOf = (course: Course, slug: string): LessonEntry | null => indexOf(course).find((e) => e.slug === slug) ?? null;

/** The entry before `slug` in its course, or null. */
export function entryBefore(course: Course, slug: string): LessonEntry | null {
  const list = indexOf(course);
  const i = list.findIndex((e) => e.slug === slug);
  return i > 0 ? list[i - 1]! : null;
}

/** An item's program alone, or null when the course has no such item. */
export async function loadProgram(course: Course, slug: string): Promise<string | null> {
  if (entryOf(course, slug) === null) return null;
  const load = glob[course].program[`${base(course)}${slug}/program.z`];
  return load === undefined ? null : load();
}

/** An item in full, parsed (its text and program), or null when the course has no such item. */
export async function loadItem(course: Course, slug: string): Promise<Lesson | null> {
  if (entryOf(course, slug) === null) return null;
  const md = glob[course].md[`${base(course)}${slug}/lesson.md`];
  const program = glob[course].program[`${base(course)}${slug}/program.z`];
  if (md === undefined || program === undefined) return null;
  const [text, code] = await Promise.all([md(), program()]);
  return parseLesson(slug, text, code);
}

/** What a page shows: its item, and for a chapter the program it is marked against (the chapter before's, '' for chapter 1). */
export interface PageItem {
  item: Lesson;
  /** null on a lesson, which has no marks. */
  marksAgainst: string | null;
}

/** A page's item and, for a chapter, the previous chapter's program: two items at most, never the whole course. */
export async function loadPageItem(course: Course, slug: string): Promise<PageItem | null> {
  const before = course === 'invaders' ? entryBefore(course, slug) : null;
  const [item, against] = await Promise.all([loadItem(course, slug), before === null ? Promise.resolve('') : loadProgram(course, before.slug)]);
  if (item === null) return null;
  return { item, marksAgainst: course === 'invaders' ? (against ?? '') : null };
}
