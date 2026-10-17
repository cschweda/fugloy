import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (name: string): string =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

// Plain node for pure utilities. Tests that need a Nuxt environment use
// `@nuxt/test-utils` and its own config when the first one arrives.
export default defineConfig({
  resolve: {
    alias: { '@fugloy/z80': src('z80'), '@fugloy/disasm': src('disasm') },
  },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
