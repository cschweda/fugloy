import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';
import { fugloyAliases } from './aliases';

// Plain node for pure utilities and for components rendered with Vue's server
// renderer (no DOM needed). Browser checks live in test/e2e (Playwright).
export default defineConfig({
  plugins: [vue()],
  resolve: {
    // `~/` is Nuxt's app directory, for the components mounted in the tests.
    alias: { ...fugloyAliases, '~': fileURLToPath(new URL('./app', import.meta.url)) },
  },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
