// Every lesson and chapter in full, for the tests: the pages load one item at a time
// (utils/learn/lessons' loadItem), and the tests read all of them through the same loader and index.
import type { Lesson } from '../app/utils/learn/lesson-format';
import { CHAPTER_INDEX, LESSON_INDEX, loadItem } from '../app/utils/learn/lessons';
import type { Course } from '../app/utils/learn/page';

const all = async (course: Course, index: readonly { slug: string }[]): Promise<Lesson[]> =>
  Promise.all(
    index.map(async (e) => {
      const item = await loadItem(course, e.slug);
      if (item === null) throw new Error(`The index names ${e.slug}, which loadItem does not find.`);
      return item;
    }),
  );

export const LESSONS: readonly Lesson[] = await all('lessons', LESSON_INDEX);
export const CHAPTERS: readonly Lesson[] = await all('invaders', CHAPTER_INDEX);
export const lessonBySlug = (slug: string): Lesson | null => LESSONS.find((l) => l.slug === slug) ?? null;
