/**
 * Locates the copyrighted sample programs, which are never committed. They
 * live in `sample/` (per the plan) or `fixtures/real/` (where they are today),
 * both gitignored, in any subfolder; tests skip when a file is absent.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const ROOTS = ['sample', 'fixtures/real'].map((d) => join(repo, d));

function findIn(dir: string, name: string): string | null {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      const hit = findIn(path, name);
      if (hit !== null) return hit;
    } else if (entry === name) {
      return path;
    }
  }
  return null;
}

/** Full path of a sample program by basename, or null when it is not on this machine. */
export function resolveSample(name: string): string | null {
  for (const root of ROOTS) {
    if (!existsSync(root)) continue;
    const hit = findIn(root, name);
    if (hit !== null) return hit;
  }
  return null;
}

export function readSample(name: string): Uint8Array {
  const path = resolveSample(name);
  if (path === null) throw new Error(`sample ${name} is not present`);
  return new Uint8Array(readFileSync(path));
}

/** `skipIfMissing('asylum1a.cmd')('decodes', () => ...)` runs the test only when the file is present. */
export function skipIfMissing(name: string): typeof it | typeof it.skip {
  return resolveSample(name) === null ? it.skip : it;
}

/** All sample files matching a basename predicate, for the Valkyrie set. */
export function listSamples(match: (name: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (match(entry)) out.push(entry);
    }
  };
  for (const root of ROOTS) if (existsSync(root)) walk(root);
  return out.sort();
}
