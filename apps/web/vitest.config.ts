import { defineConfig } from 'vitest/config';
import { fugloyAliases } from './aliases';

// Plain node for pure utilities. Tests that need a Nuxt environment use
// `@nuxt/test-utils` and its own config when the first one arrives.
export default defineConfig({
  resolve: {
    alias: fugloyAliases,
  },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
