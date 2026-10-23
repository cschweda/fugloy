/**
 * The runtime runs in a page and in a Web Worker: no DOM, no Node APIs, no dependencies (the M1 plan's
 * Global Constraints). Two checks, as packages/emu/test/no-dom.test.js and platform-free.test.js make
 * of emu: its check-no-dom script links and evaluates the package in an empty vm context (the script
 * `pnpm --filter @fugloy/runtime check:no-dom` runs), and emu's platform scan reads every source file
 * for a browser or Node global, which also reaches the code the script's load does not run.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { platformHits } from '../../emu/test/platform-scan.js';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const script = fileURLToPath(new URL('../../emu/scripts/check-no-dom.mjs', import.meta.url));

it('links and loads in an empty vm context: no browser or Node global, nothing imported from outside the package', () => {
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', script, `${src}index.js`], { encoding: 'utf8' });
  expect(r.stdout + r.stderr).toContain('no platform globals: ok');
  expect(r.status).toBe(0);
});

it('names no browser or Node global anywhere in src', () => {
  const files = readdirSync(src).filter((f) => f.endsWith('.js'));
  expect(files).toEqual(expect.arrayContaining(['index.js', 'keys.js', 'model.js', 'ops.js', 'z.js']));
  const hits = files.flatMap((f) => platformHits(readFileSync(`${src}${f}`, 'utf8')).map((hit) => `${f}:${hit}`));
  expect(hits).toEqual([]);
});
