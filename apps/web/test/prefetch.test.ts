// No page of the generated site prefetches or preloads a lazily loaded part
// (lazy-chunks.ts: Source ✎ now, Run ▶ later). Reads .output/public and the
// client manifest of the same build, so it runs after
// `pnpm --filter @fugloy/web generate`; `pnpm --filter @fugloy/web check:prefetch`
// does both. Without a build (or with one older than the manifest) it is
// skipped with a warning, unless FUGLOY_REQUIRE_PREFETCH=1 makes that a failure.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hintedFiles, lazyClosure, LAZY_ROOTS } from '../lazy-chunks';
import type { Manifest } from '../lazy-chunks';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, '.output', 'public');
/** Where Nuxt leaves the client manifest of the last build. */
const manifestPath = ['node_modules/.cache/nuxt/.nuxt/dist/server/client.manifest.mjs', '.nuxt/dist/server/client.manifest.mjs']
  .map((p) => join(web, p))
  .filter((p) => existsSync(p))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
const manifest: Manifest | null = manifestPath === undefined ? null : ((await import(pathToFileURL(manifestPath).href)) as { default: Manifest }).default;
const lazy = manifest === null ? null : lazyClosure(manifest);
// The build and the manifest must be the same build: the lazy roots' chunks are in the output.
const usable = existsSync(join(out, 'index.html')) && lazy !== null && lazy.files.size > 0 && [...lazy.files].every((f) => existsSync(join(out, '_nuxt', f)));
const why = 'run `pnpm --filter @fugloy/web generate` first (or `check:prefetch`)';
if (!usable && process.env.FUGLOY_REQUIRE_PREFETCH === '1') throw new Error(`FUGLOY_REQUIRE_PREFETCH=1 but the generated site or its client manifest is missing or from another build; ${why}.`);
if (!usable) console.warn(`prefetch.test: no current build; ${why}. Skipping.`);

const pages = (dir: string, at = ''): string[] =>
  readdirSync(join(dir, at), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '_nuxt' ? [] : pages(dir, join(at, e.name))) : e.name.endsWith('.html') ? [join(at, e.name)] : []));

describe.skipIf(!usable)('the generated site', () => {
  it('prefetches and preloads none of the lazily loaded chunks, on any page', () => {
    expect(LAZY_ROOTS.length).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const page of pages(out)) for (const f of hintedFiles(readFileSync(join(out, page), 'utf8'))) if (lazy!.files.has(f)) bad.push(`${page}: ${f}`);
    expect(bad).toEqual([]);
  });
});
