// The lessons, read from content/learn/<NN-slug>/ at build time (Vite's import.meta.glob, as text)
// and parsed once, and (phase 6C) the Space Invaders chapters from content/learn/invaders/<NN-slug>/,
// in the same format. Only NN-slug folders are read, so invaders/ is not a lesson. A lesson or chapter
// that breaks the format fails the build and the tests with its sentence.
import { parseLesson } from './lesson-format';
import type { Lesson } from './lesson-format';

const lessonTexts = import.meta.glob<string>('../../../content/learn/*/lesson.md', { query: '?raw', eager: true, import: 'default' });
const lessonPrograms = import.meta.glob<string>('../../../content/learn/*/program.z', { query: '?raw', eager: true, import: 'default' });
const chapterTexts = import.meta.glob<string>('../../../content/learn/invaders/*/lesson.md', { query: '?raw', eager: true, import: 'default' });
const chapterPrograms = import.meta.glob<string>('../../../content/learn/invaders/*/program.z', { query: '?raw', eager: true, import: 'default' });

/** The folder name in a glob key: `../../../content/learn/01-white-out/lesson.md` → `01-white-out`. */
const slugOf = (path: string): string => path.split('/').at(-2)!;
const ITEM = /^\d\d-/;

function load(texts: Record<string, string>, programs: Record<string, string>, what: 'Lesson' | 'Chapter'): Lesson[] {
  const bySlug = new Map(Object.entries(programs).map(([path, text]) => [slugOf(path), text]));
  const out = Object.entries(texts)
    .filter(([path]) => ITEM.test(slugOf(path)))
    .map(([path, md]) => {
      const slug = slugOf(path);
      const program = bySlug.get(slug);
      if (program === undefined) throw new Error(`${what} ${slug}: its folder has no program.z.`);
      return parseLesson(slug, md, program);
    });
  out.sort((a, b) => a.number - b.number);
  out.forEach((item, i) => {
    if (i > 0 && item.number === out[i - 1]!.number) throw new Error(`${what} ${item.slug}: ${what.toLowerCase()} ${out[i - 1]!.slug} has the same number.`);
  });
  return out;
}

/** Every lesson, by number. */
export const LESSONS: readonly Lesson[] = load(lessonTexts, lessonPrograms, 'Lesson');

/** The lesson in folder `slug`, or null. */
export const lessonBySlug = (slug: string): Lesson | null => LESSONS.find((l) => l.slug === slug) ?? null;

/** Every chapter of Build Space Invaders, by number. */
export const CHAPTERS: readonly Lesson[] = load(chapterTexts, chapterPrograms, 'Chapter');

/** The chapter in folder `invaders/<slug>`, or null. */
export const chapterBySlug = (slug: string): Lesson | null => CHAPTERS.find((c) => c.slug === slug) ?? null;

/** The lesson or chapter a progress id names (utils/learn/page's progressId), or null. */
export const itemByProgressId = (id: string): Lesson | null => (id.startsWith('invaders/') ? chapterBySlug(id.slice('invaders/'.length)) : lessonBySlug(id));
