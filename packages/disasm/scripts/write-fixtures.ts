/** Writes every synthetic fixture under fixtures/synthetic/. Run with `pnpm fixtures`. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { writeHints } from '../src/hints/format.js';
import { BAS_FIXTURES, CMD_FIXTURES, HINT_FIXTURES } from '../test/fixtures.js';

const root = fileURLToPath(new URL('../../../fixtures/synthetic/', import.meta.url));

mkdirSync(`${root}cmd`, { recursive: true });
for (const [name, make] of Object.entries(CMD_FIXTURES)) writeFileSync(`${root}cmd/${name}.cmd`, make());
mkdirSync(`${root}bas`, { recursive: true });
for (const [name, make] of Object.entries(BAS_FIXTURES)) writeFileSync(`${root}bas/${name}.bas`, make());
mkdirSync(`${root}hints`, { recursive: true });
for (const [name, make] of Object.entries(HINT_FIXTURES)) writeFileSync(`${root}hints/${name}.hints`, writeHints(make()));
console.log(`wrote ${Object.keys(CMD_FIXTURES).length} .cmd, ${Object.keys(BAS_FIXTURES).length} .bas, and ${Object.keys(HINT_FIXTURES).length} .hints fixtures to ${root}`);
