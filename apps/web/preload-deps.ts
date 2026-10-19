// Shorter preload lists for dynamic imports (plan 5B's first-screen budget). For each dynamic
// import, Vite writes into the importing chunk the names of every file the imported part needs, so
// the browser can fetch them at once; that list includes files the importing chunk already
// imports, which are loaded by then (Vite's preload helper skips them at run time). This drops
// those from the list at build time, so they cost the first screen no bytes. What is fetched, and
// when, does not change. `preloadBundle` captures the bundle (its generateBundle runs before
// Vite's import analysis, a post plugin, writes the lists); `resolveDependencies` reads it.

/** The fields of an output chunk this needs. */
interface ChunkLike {
  type: string;
  imports?: string[];
}
type Bundle = Record<string, ChunkLike>;

/** The parts of a Vite plugin this uses (vite is not a direct dependency of the site). */
interface BundlePlugin {
  name: string;
  apply: 'build';
  renderStart(): void;
  generateBundle(options: unknown, bundle: Record<string, unknown>): void;
}

/** The files `host` imports statically, directly or through other chunks. */
export function staticClosure(bundle: Bundle, host: string): Set<string> {
  const seen = new Set<string>();
  const queue = [...(bundle[host]?.imports ?? [])];
  while (queue.length > 0) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const c = bundle[f];
    if (c?.type === 'chunk') queue.push(...(c.imports ?? []));
  }
  return seen;
}

/** `deps` without the files `host` has already loaded. */
export function trimDeps(bundle: Bundle | null, host: string, deps: string[]): string[] {
  if (bundle === null) return deps;
  const loaded = staticClosure(bundle, host);
  return deps.filter((d) => !loaded.has(d));
}

export function preloadDeps(): { plugin: BundlePlugin; resolveDependencies: (file: string, deps: string[], ctx: { hostId: string }) => string[] } {
  let bundle: Bundle | null = null;
  return {
    plugin: {
      name: 'fugloy:preload-bundle',
      apply: 'build',
      renderStart() {
        bundle = null;
      },
      generateBundle(_options: unknown, b: Record<string, unknown>) {
        bundle = b as unknown as Bundle;
      },
    },
    resolveDependencies: (_file, deps, { hostId }) => trimDeps(bundle, hostId, deps),
  };
}
