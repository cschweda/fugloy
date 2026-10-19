// The Learn page's Run and sources, loaded on the page's first mount and kept for the visit (phase
// 6B Task 4), as utils/load-sources does for the workbench. One in-memory Sources (never the
// workbench's: nothing here is stored in IndexedDB) holds one source per lesson, made on the
// lesson's first visit; one Run on it, stub-only and with no listing. The page loads Run's module
// by dynamic import, so emu, asm and the debugger stay off the Learn page's first screen. Each
// lesson page is its own page instance (Nuxt keys a page by its path); they share these.
import type { Run } from '../../composables/useRun';
import type { Sources } from '../../composables/useSources';
import { createProgress } from './progress';
import type { Progress } from './progress';

export interface LearnParts {
  run: Run;
  sources: Sources;
  /** Each lesson's and chapter's source id, by progress id (utils/learn/page's progressId), once it has one. */
  ids: Map<string, string>;
}

let parts: Promise<LearnParts> | null = null;
let ready: LearnParts | null = null;

/** The Run and the sources if they are loaded, without loading them. */
export const loadedLearn = (): LearnParts | null => ready;

/** The Run and the lesson sources, loading their modules the first time (again after a failure). */
export function loadLearn(): Promise<LearnParts> {
  parts ??= Promise.all([import('../../composables/useRun'), import('../../composables/useSources')]).then(
    ([r, s]) => {
      const sources = s.createSources({ open: async () => null, starter: async () => '' });
      ready = { run: r.createRun({ sources, stubOnly: true, listing: false }), sources, ids: new Map() };
      return ready;
    },
    (err: unknown) => {
      parts = null;
      throw err;
    },
  );
  return parts;
}

let progress: Progress | null = null;
/** Each shown item's own program, by progress id: an edit equal to it is no edit (the pages load items one at a time). */
const ownPrograms = new Map<string, string>();

/** Tells the progress an item's own program, before its edits are read or kept; the page calls it with its item. */
export function knowProgram(id: string, program: string): void {
  ownPrograms.set(id, program);
}

/** The learner's edits and done marks (utils/learn/progress), in this browser, by progress id; call it in the browser only. */
export function learnProgress(): Progress {
  progress ??= createProgress((id) => ownPrograms.get(id) ?? '');
  return progress;
}
