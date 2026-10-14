/** Writes every synthetic fixture under fixtures/synthetic/. Run with `pnpm fixtures`. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CMD_FIXTURES } from '../test/fixtures.js';

const root = fileURLToPath(new URL('../../../fixtures/synthetic/', import.meta.url));

mkdirSync(`${root}cmd`, { recursive: true });
for (const [name, make] of Object.entries(CMD_FIXTURES)) writeFileSync(`${root}cmd/${name}.cmd`, make());
console.log(`wrote ${Object.keys(CMD_FIXTURES).length} .cmd fixtures to ${root}cmd/`);
