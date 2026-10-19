// The parts of the site loaded on first use (plan 5B: Source ✎, Run ▶, and
// the emulator runtime) must not be prefetched with the first screen. Nuxt's client
// manifest flags every dynamic import for `<link rel="prefetch">`, so the
// `build:manifest` hook (nuxt.config.ts) clears the flags of everything a lazy
// root reaches, through `imports` and `dynamicImports`, with its CSS, except
// what the static entry closure needs anyway. The walk never enters a page or
// layout. `test/prefetch.test.ts` (`check:prefetch`) checks the generated pages
// with the same walk.

/** Manifest keys (source paths relative to app/) of the lazily loaded parts: Source ✎, Run ▶, and the emulator runtime (the Run kit, and rom-ids for an added ROM). */
export const LAZY_ROOTS: readonly string[] = ['components/source/', 'components/run/', 'utils/emulator/'];

/** The fields of a Nuxt client-manifest entry this needs. */
export interface ManifestEntry {
  file: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
  assets?: string[];
  prefetch?: boolean;
  preload?: boolean;
}
export type Manifest = Record<string, ManifestEntry>;

function walk(manifest: Manifest, from: Iterable<string>, follow: (e: ManifestEntry) => string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...from];
  while (queue.length > 0) {
    const key = queue.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const e = manifest[key];
    if (e !== undefined) queue.push(...follow(e));
  }
  return seen;
}

/**
 * The manifest keys and output files that only the lazy roots need: their JS
 * chunks, CSS and assets. Kept out (left flagged) is the static closure of the
 * entry and of every other dynamic entry the roots do not reach, such as the
 * pages, whose shared chunks the first screen preloads.
 */
export function lazyClosure(manifest: Manifest, roots: readonly string[] = LAZY_ROOTS): { keys: Set<string>; files: Set<string> } {
  const starts = Object.keys(manifest).filter((k) => roots.some((r) => k.startsWith(r)));
  // The walk does not go through the entry's own static closure: every chunk imports the entry, whose dynamic imports are all the pages.
  const entries = Object.keys(manifest).filter((k) => manifest[k]!.isEntry === true);
  const entry = walk(manifest, entries, (e) => e.imports ?? []);
  // Nor through a page or layout (Nuxt's route components, or the entry's dynamic imports): a lazy part
  // may import one, when Rollup puts a composable both share in the page's chunk, and the page's own
  // preload must stay.
  const route = (k: string): boolean => /^(?:pages|layouts)\//.test(k);
  const pages = new Set([...Object.keys(manifest).filter(route), ...entries.flatMap((k) => manifest[k]!.dynamicImports ?? [])].filter((k) => !roots.some((r) => k.startsWith(r))));
  const reached = walk(manifest, starts, (e) => [...(e.imports ?? []), ...(e.dynamicImports ?? [])].filter((k) => !entry.has(k) && !pages.has(k)));
  const others = Object.keys(manifest).filter((k) => manifest[k]!.isEntry === true || (manifest[k]!.isDynamicEntry === true && !reached.has(k)));
  const statics = walk(manifest, others, (e) => e.imports ?? []);
  const staticFiles = new Set([...statics].flatMap((k) => (manifest[k] === undefined ? [] : [manifest[k]!.file, ...(manifest[k]!.css ?? [])])));
  const keys = new Set<string>();
  const files = new Set<string>();
  for (const k of reached) {
    const e = manifest[k];
    if (e === undefined || statics.has(k)) continue;
    keys.add(k);
    files.add(e.file);
    for (const f of [...(e.css ?? []), ...(e.assets ?? [])]) if (!staticFiles.has(f)) files.add(f);
  }
  // CSS and assets may have entries of their own, keyed by name or by file.
  for (const [k, e] of Object.entries(manifest)) if (!statics.has(k) && (files.has(k) || files.has(e.file))) keys.add(k);
  return { keys, files };
}

/**
 * Clears `prefetch` and `preload` on every entry only the lazy roots need,
 * returning their keys. Throws when a root matches no entry, so a renamed
 * folder cannot silently bring the prefetch back.
 */
export function unflagLazy(manifest: Manifest, roots: readonly string[] = LAZY_ROOTS): string[] {
  for (const r of roots) if (!Object.keys(manifest).some((k) => k.startsWith(r))) throw new Error(`lazy-chunks: no client-manifest entry starts with ${r}; update LAZY_ROOTS in apps/web/lazy-chunks.ts.`);
  const { keys } = lazyClosure(manifest, roots);
  for (const k of keys) {
    manifest[k]!.prefetch = false;
    manifest[k]!.preload = false;
  }
  return [...keys];
}

/** The `/_nuxt/` files a page's HTML prefetches or preloads (`prefetch`, `preload`, `modulepreload`). */
export function hintedFiles(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/g)) {
    const tag = m[0];
    if (!/\brel="(?:prefetch|preload|modulepreload)"/.test(tag)) continue;
    const href = /\bhref="\/_nuxt\/([^"?#]+)"/.exec(tag);
    if (href !== null) out.push(href[1]!);
  }
  return out;
}
