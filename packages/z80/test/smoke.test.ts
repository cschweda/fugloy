import { expect, it } from 'vitest';
import { VERSION } from '../src/index.js';
import { VERSION as aliased } from '@fugloy/z80';

it('exposes the z80 package version through the relative path and the workspace alias', () => {
  expect(VERSION).toBe('1.3.0');
  expect(aliased).toBe(VERSION);
});
