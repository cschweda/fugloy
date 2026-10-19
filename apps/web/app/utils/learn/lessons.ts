// The lessons, read from content/learn/<NN-slug>/ at build time (Vite's import.meta.glob, as text)
// and parsed once. A lesson that breaks the format fails the build and the tests with its sentence.
import { parseLesson } from './lesson-format';
import type { Lesson } from './lesson-format';

const texts = import.meta.glob<string>('../../../content/learn/*/lesson.md', { query: '?raw', eager: true, import: 'default' });
const programs = import.meta.glob<string>('../../../content/learn/*/program.z', { query: '?raw', eager: true, import: 'default' });

/** The folder name in a glob key: `../../../content/learn/01-white-out/lesson.md` → `01-white-out`. */
const slugOf = (path: string): string => path.split('/').at(-2)!;

function load(): Lesson[] {
  const bySlug = new Map(Object.entries(programs).map(([path, text]) => [slugOf(path), text]));
  const out = Object.entries(texts).map(([path, md]) => {
    const slug = slugOf(path);
    const program = bySlug.get(slug);
    if (program === undefined) throw new Error(`Lesson ${slug}: its folder has no program.z.`);
    return parseLesson(slug, md, program);
  });
  out.sort((a, b) => a.number - b.number);
  out.forEach((lesson, i) => {
    if (i > 0 && lesson.number === out[i - 1]!.number) throw new Error(`Lesson ${lesson.slug}: lesson ${out[i - 1]!.slug} has the same number.`);
  });
  return out;
}

/** Every lesson, by number. */
export const LESSONS: readonly Lesson[] = load();

/** The lesson in folder `slug`, or null. */
export const lessonBySlug = (slug: string): Lesson | null => LESSONS.find((l) => l.slug === slug) ?? null;
