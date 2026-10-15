import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests run against TypeScript source, so workspace packages resolve to src/ here.
const src = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@fugloy/z80': src('z80'),
      '@fugloy/disasm': src('disasm'),
      '@fugloy/cli': src('cli'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.{ts,js}'],
  },
});
