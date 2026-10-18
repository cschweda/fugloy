import { expect, it } from 'vitest';

it('imports @fugloy/mcp and resolves its @fugloy/emu dependency', async () => {
  const mcp = await import('../src/index.js');
  const emu = await import('@fugloy/emu');
  expect(typeof mcp.createServer).toBe('function');
  expect(typeof mcp.loadConfig).toBe('function');
  expect(typeof emu.Machine).toBe('function');
});
