import { describe, expect, it } from 'vitest';
import { hintedFiles, lazyClosure, LAZY_ROOTS, unflagLazy } from '../lazy-chunks';
import type { Manifest } from '../lazy-chunks';

/** A manifest shaped like Nuxt's: the entry, a page, the Source tab and the chunks it shares. */
function manifest(): Manifest {
  return {
    'entry.js': { file: 'entry.js', isEntry: true, imports: ['_vue.js'], dynamicImports: ['pages/index.vue'] },
    '_vue.js': { file: 'vue.js' },
    'pages/index.vue': { file: 'index.js', isDynamicEntry: true, imports: ['entry.js', '_disasm.js'], dynamicImports: ['components/source/SourceTab.vue'], css: ['index.css'] },
    '_disasm.js': { file: 'disasm.js' },
    'components/source/SourceTab.vue': { file: 'source.js', isDynamicEntry: true, imports: ['entry.js', '_disasm.js', '_cm.js'], dynamicImports: ['_later.js'], css: ['SourceTab.css'] },
    // Split out of the tab (manualChunks, or shared with Run): no "components/source/" in its key.
    '_cm.js': { file: 'cm.js', imports: ['_vue.js'], css: ['cm.css'] },
    '_later.js': { file: 'later.js', isDynamicEntry: true },
    'SourceTab.css': { file: 'SourceTab.css' },
    'cm.css': { file: 'cm.css' },
    'index.css': { file: 'index.css' },
  };
}

describe('lazy chunks', () => {
  it('reach every chunk and stylesheet the lazy roots need, through imports and dynamic imports, and nothing the first screen needs', () => {
    const { keys, files } = lazyClosure(manifest(), ['components/source/']);
    expect([...keys].sort()).toEqual(['SourceTab.css', '_cm.js', '_later.js', 'cm.css', 'components/source/SourceTab.vue']);
    expect([...files].sort()).toEqual(['SourceTab.css', 'cm.css', 'cm.js', 'later.js', 'source.js']);
  });

  it('are unflagged for prefetch and preload; the rest keep their flags', () => {
    const m = manifest();
    for (const e of Object.values(m)) e.prefetch = e.preload = true;
    unflagLazy(m, ['components/source/']);
    expect(Object.keys(m).filter((k) => m[k]!.prefetch === false).sort()).toEqual(['SourceTab.css', '_cm.js', '_later.js', 'cm.css', 'components/source/SourceTab.vue']);
    expect(Object.keys(m).filter((k) => m[k]!.preload === true).sort()).toEqual(['_disasm.js', '_vue.js', 'entry.js', 'index.css', 'pages/index.vue']);
  });

  it('never reach a page, even when a lazy part imports a composable Rollup put in the page chunk (Run ▶ imports pages/index.vue)', () => {
    const m = manifest();
    m['pages/index.vue']!.dynamicImports!.push('components/run/RunTab.vue');
    m['components/run/RunTab.vue'] = { file: 'run.js', isDynamicEntry: true, imports: ['entry.js', 'pages/index.vue', '_disasm.js'] };
    for (const e of Object.values(m)) e.prefetch = e.preload = true;
    unflagLazy(m, ['components/source/', 'components/run/']);
    expect(m['pages/index.vue']!.preload).toBe(true);
    expect(m['index.css']!.preload).toBe(true);
    expect(m['components/run/RunTab.vue']!.preload).toBe(false);
  });

  it('refuse a root that matches nothing, so a moved folder cannot bring the prefetch back silently', () => {
    expect(() => unflagLazy(manifest(), ['components/gone/'])).toThrow('no client-manifest entry starts with components/gone/');
  });

  it("include 5C's utils/running/, and throw when nothing in the manifest is under it", () => {
    expect(LAZY_ROOTS).toContain('utils/running/');
    const m = manifest();
    for (const r of LAZY_ROOTS) if (r !== 'utils/running/') m[`${r}x.ts`] = { file: `${r.replace(/\W/g, '')}.js` };
    expect(() => unflagLazy(m)).toThrow('no client-manifest entry starts with utils/running/');
    m['utils/running/debug-keys.ts'] = { file: 'debug-keys.js' };
    expect(() => unflagLazy(m)).not.toThrow();
  });

  it('read the prefetch, preload and modulepreload hints from a page', () => {
    const html = '<link rel="modulepreload" as="script" crossorigin href="/_nuxt/a.js"><link rel="prefetch" as="style" href="/_nuxt/b.css"><link rel="stylesheet" href="/_nuxt/c.css"><link rel="icon" href="/favicon.svg"><link rel="preload" as="fetch" href="/_payload.json?x=1">';
    expect(hintedFiles(html)).toEqual(['a.js', 'b.css']);
  });
});
