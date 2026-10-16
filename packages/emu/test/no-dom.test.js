import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const script = fileURLToPath(new URL('../scripts/check-no-dom.mjs', import.meta.url));
const check = (...args) => spawnSync(process.execPath, ['--experimental-vm-modules', script, ...args], { encoding: 'utf8' });

it('links and runs the core in an empty vm context: no browser or Node global', () => {
  const r = check();
  expect(r.stdout + r.stderr).toContain('no platform globals: ok');
  expect(r.status).toBe(0);
});

it('fails on a module that touches a browser global, so the check is not vacuous', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fugloy-nodom-'));
  try {
    const bad = join(dir, 'bad.js');
    writeFileSync(bad, 'export const width = window.innerWidth;\n');
    const r = check(bad);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('window is not defined');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
