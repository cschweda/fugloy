import { expect, it } from 'vitest';
import { VERSION } from '../src/index.js';

it('exposes the cli package version', () => {
  expect(VERSION).toBe('0.1.0');
});
