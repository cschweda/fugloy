import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { configPath, configuredRom } from './rom.js';

let dir;
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const config = (roms) => {
  dir = mkdtempSync(join(tmpdir(), 'fugloy-rom-'));
  const path = join(dir, 'fugloy.mcp.json');
  writeFileSync(path, JSON.stringify({ roms }));
  return path;
};

it('reads a ROM path relative to the config file, not the working directory', () => {
  const path = config({ model3: './roms/m3.rom' });
  mkdirSync(join(dir, 'roms'));
  writeFileSync(join(dir, 'roms', 'm3.rom'), new Uint8Array(14336).fill(0x11));
  const rom = configuredRom('model3', path);
  expect(rom?.length).toBe(14336);
  expect(rom?.[0]).toBe(0x11);
});

it('fails, rather than skipping, when the config names a ROM that is not there', () => {
  expect(() => configuredRom('model3', config({ model3: './missing.rom' }))).toThrow(/no such file/);
});

it('returns null with no config or no entry for the model, so the test skips', () => {
  expect(configuredRom('model3', null)).toBeNull();
  expect(configuredRom('model3', config({ model1: './l2.rom' }))).toBeNull();
});

it('fails on a FUGLOY_CONFIG that names a missing file, instead of falling back to another config', () => {
  dir = mkdtempSync(join(tmpdir(), 'fugloy-rom-'));
  const missing = join(dir, 'nowhere', 'fugloy.mcp.json');
  expect(configPath({ FUGLOY_CONFIG: missing })).toBe(missing);
  expect(() => configuredRom('model3', missing)).toThrow(/no config file/);
});
