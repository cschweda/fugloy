import { expect, it } from 'vitest';

it('imports the @fugloy/mcp stub and resolves its @fugloy/emu dependency', async () => {
  const mcp = await import('../src/index.js');
  const emu = await import('@fugloy/emu');
  expect(typeof mcp).toBe('object');
  expect(typeof emu).toBe('object');
});
