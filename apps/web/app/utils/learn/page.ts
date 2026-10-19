// The Learn page's small pure helpers (phase 6B Task 4): where a lesson lives, its neighbours, its
// In a real game box's workbench link (Task 7, the URL utils/deep-link opens), the model switch's
// options, Explain's prompt, and the run message reworded for this page. The page has no Source ✎
// tab and never uses a ROM, so the sentences that point there ("Fix it in Source ✎", "Add a Model III ROM in the
// Run tab, …", the ROM-copy note's same advice, "Press Run to run the source") are said the lesson's way.
// No DOM, no Vue.
import type { GameBox, Lesson } from './lesson-format';

/** What a lesson line says before a clean Run (and after an edit since it). */
export const EXPLAIN_PROMPT = 'Run the program, then click a line to read what it does.';

/** A clicked line with no instruction on it. */
export const EXPLAIN_NO_CODE = (line: number): string => `Line ${line} has no instruction, so there is nothing to explain. Click a line with an instruction.`;

/** A lesson's page, as the site links it (with the slash of the directory it is generated as). */
export const lessonPath = (slug: string): string => `/learn/${slug}/`;

/** An In a real game box's link: the workbench on the game, the cursor at the box's run address. */
export const gameLink = (game: Pick<GameBox, 'example' | 'addr'>): string => `/?example=${game.example}&at=${game.addr.toString(16).toUpperCase().padStart(4, '0')}`;

/** The lessons before and after `slug` in `lessons`, or null at either end. */
export function lessonNeighbours<T extends Pick<Lesson, 'slug'>>(lessons: readonly T[], slug: string): { prev: T | null; next: T | null } {
  const i = lessons.findIndex((l) => l.slug === slug);
  return { prev: i > 0 ? lessons[i - 1]! : null, next: i >= 0 && i < lessons.length - 1 ? lessons[i + 1]! : null };
}

const MODEL_LABELS: Readonly<Record<1 | 3, string>> = { 1: 'Model I', 3: 'Model III' };

/** The model switch's options, in the lesson's order (its own model first); the switch shows only for two. */
export const modelOptions = (models: readonly (1 | 3)[]): { value: 1 | 3; label: string }[] => models.map((value) => ({ value, label: MODEL_LABELS[value] }));

/** A run message as the Learn page says it. */
export const lessonMessage = (text: string): string =>
  text
    .replace(/ in Source ✎/g, '')
    .replace(/Add a Model (?:I|III|4) ROM in the Run tab, or /g, 'Lessons run without one, so ')
    .replace(/Add a Model (?:I|III|4) ROM in the Run tab if the program means to read the ROM\./g, 'Lessons run without a ROM, so copy from your own data if the program needs those bytes.')
    .replace(/Press Run to run the source on this one\./g, "Press Run ▶ to run the lesson's program on this one.");
