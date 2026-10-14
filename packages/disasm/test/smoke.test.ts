import { expect, it } from 'vitest';
import { VERSION, Z80_VERSION } from '../src/index.js';
import { VERSION as aliased } from '@fugloy/disasm';

it('exposes the disasm package version and reaches @fugloy/z80 through it', () => {
  expect(VERSION).toBe('0.1.0');
  expect(Z80_VERSION).toBe('0.1.0');
  expect(aliased).toBe(VERSION);
});
