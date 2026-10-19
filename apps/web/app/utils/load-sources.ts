// Loads the Source tab's sources (composables/useSources) and Run (composables/useRun) on first
// use: for the workbench page (Write a program, Source ✎, Run ▶) and its first screen's
// "Continue". Only that page imports this, so those modules, and the parts of the disassembler
// they use, stay with that page. Once loaded, utils/store's loadedSources reaches the sources, and
// `loaded` hands both to the page when it mounts again (after a visit to another page).
import type { Run } from '../composables/useRun';
import type { Sources } from '../composables/useSources';

/** Run and the sources, once both are loaded. */
let both: { run: Run; sources: Sources } | null = null;

/** Run and the sources if they are loaded, without loading them. */
export const loaded = (): { run: Run; sources: Sources } | null => both;

/** Run and the page's sources, loading their modules the first time. */
export async function loadRun(): Promise<{ run: Run; sources: Sources }> {
  if (both !== null) return both;
  const [m, sources] = await Promise.all([import('../composables/useRun'), loadSources()]);
  both = { run: m.useRun(), sources };
  return both;
}

let loading: Promise<Sources> | null = null;

/** The page's sources, loading their module the first time. */
export function loadSources(): Promise<Sources> {
  loading ??= import('../composables/useSources').then(
    (m) => m.useSources(),
    (err: unknown) => {
      loading = null;
      throw err;
    },
  );
  return loading;
}
