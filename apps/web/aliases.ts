import { fileURLToPath } from 'node:url';

// Workspace packages resolve to their TypeScript source, so the site, its tests
// and its type check need no prior `pnpm build`. One definition serves Vite,
// Nitro, the generated tsconfig `paths`, and Vitest.
const src = (name: string): string =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export const fugloyAliases: Record<string, string> = {
  '@fugloy/z80': src('z80'),
  '@fugloy/disasm': src('disasm'),
};
