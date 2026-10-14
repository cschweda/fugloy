/** The committed files under fixtures/synthetic/ must be exactly what the writers produce. */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BAS_FIXTURES, CMD_FIXTURES } from './fixtures.js';

const root = fileURLToPath(new URL('../../../fixtures/synthetic/', import.meta.url));

describe('committed synthetic fixtures match the writers', () => {
  it.each(Object.entries(CMD_FIXTURES))('cmd/%s.cmd', (name, make) => {
    const path = `${root}cmd/${name}.cmd`;
    expect(existsSync(path), `${path} is missing: run pnpm fixtures`).toBe(true);
    expect(Array.from(readFileSync(path))).toEqual(Array.from(make()));
  });
});

describe('committed BASIC fixtures match the tokenizer', () => {
  it.each(Object.entries(BAS_FIXTURES))('bas/%s.bas', (name, make) => {
    const path = `${root}bas/${name}.bas`;
    expect(existsSync(path), `${path} is missing: run pnpm fixtures`).toBe(true);
    expect(Array.from(readFileSync(path))).toEqual(Array.from(make()));
  });
});
