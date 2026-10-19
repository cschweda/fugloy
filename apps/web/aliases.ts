import { fileURLToPath } from 'node:url';

// Workspace packages resolve to their source, so the site, its tests and its
// type check need no prior `pnpm build`. One definition serves Vite, Nitro, the
// generated tsconfig `paths`, and Vitest.
const pkg = (path: string): string => fileURLToPath(new URL(`../../packages/${path}`, import.meta.url));
const src = (name: string): string => pkg(`${name}/src/index.ts`);

export const fugloyAliases: Record<string, string> = {
  '@fugloy/z80': src('z80'),
  '@fugloy/disasm': src('disasm'),
  '@fugloy/asm': src('asm'),
  // Plain JavaScript; its types are app/types/fugloy-emu.d.ts, the subset the site uses.
  '@fugloy/emu': pkg('emu/src/index.js'),
  // asm's example programs, read as text (`?raw`): the starter for a new source.
  '@fugloy/asm-examples': pkg('asm/examples'),
};
