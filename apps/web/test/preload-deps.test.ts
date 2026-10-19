// A dynamic import's preload list leaves out the files its importing chunk has already loaded
// (preload-deps.ts), and keeps the rest; without the bundle it changes nothing.
import { describe, expect, it } from 'vitest';
import { staticClosure, trimDeps } from '../preload-deps';

const bundle = {
  'page.js': { type: 'chunk', imports: ['vue.js', 'disasm.js'] },
  'disasm.js': { type: 'chunk', imports: ['z80.js'] },
  'z80.js': { type: 'chunk', imports: [] },
  'vue.js': { type: 'chunk', imports: [] },
  'editor.js': { type: 'chunk', imports: ['codemirror.js', 'disasm.js'] },
  'codemirror.js': { type: 'chunk', imports: [] },
  'editor.css': { type: 'asset' },
};

describe('preload lists', () => {
  it("drop what the importer's static imports already loaded, through every level", () => {
    expect([...staticClosure(bundle, 'page.js')].sort()).toEqual(['disasm.js', 'vue.js', 'z80.js']);
    expect(trimDeps(bundle, 'page.js', ['editor.js', 'codemirror.js', 'disasm.js', 'z80.js'])).toEqual(['editor.js', 'codemirror.js']);
  });

  it('change nothing before the bundle is known', () => {
    expect(trimDeps(null, 'page.js', ['editor.js', 'disasm.js'])).toEqual(['editor.js', 'disasm.js']);
  });
});
