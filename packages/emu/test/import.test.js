import { expect, it } from 'vitest';

it('imports the @fugloy/emu stub as an ES module', async () => {
  const emu = await import('../src/index.js');
  expect(typeof emu).toBe('object');
});
