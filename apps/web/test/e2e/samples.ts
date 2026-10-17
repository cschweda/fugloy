// Finds the copyrighted sample programs the local-only browser checks use. They
// are never committed: they live in the gitignored `sample/` (per the plan) or
// `fixtures/real/` (where they are today), in any subfolder. The same search as
// packages/disasm/test/real/samples.ts, without its Vitest helpers.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root. */
export const repo = fileURLToPath(new URL('../../../../', import.meta.url));

function findIn(dir: string, name: string): string | null {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const hit = statSync(path).isDirectory() ? findIn(path, name) : entry === name ? path : null;
    if (hit !== null) return hit;
  }
  return null;
}

/** Full path of a sample program by basename, or null when it is not on this machine. */
export function resolveSample(name: string): string | null {
  for (const root of ['sample', 'fixtures/real'].map((d) => join(repo, d))) {
    if (!existsSync(root)) continue;
    const hit = findIn(root, name);
    if (hit !== null) return hit;
  }
  return null;
}
