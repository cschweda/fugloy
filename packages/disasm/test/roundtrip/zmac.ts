/**
 * Round-trip harness: assemble emitted source with the pinned zmac (built by
 * scripts/install-zmac.sh into tools/zmac/, or named by FUGLOY_ZMAC), load
 * the resulting .cmd with our own loader, and compare images, never files.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { loadCmd } from '../../src/cmd.js';
import type { CmdModule } from '../../src/cmd.js';
import type { MemoryImage } from '../../src/memory.js';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));

export function findZmac(): string | null {
  const env = process.env['FUGLOY_ZMAC'];
  if (env !== undefined && env !== '' && existsSync(env)) return env;
  const local = join(repo, 'tools', 'zmac', 'zmac');
  return existsSync(local) ? local : null;
}

/** `it` when zmac is available, `it.skip` otherwise; CI sets FUGLOY_REQUIRE_ZMAC=1 to make absence a failure. */
export function skipIfNoZmac(): typeof it | typeof it.skip {
  if (findZmac() !== null) return it;
  if (process.env['FUGLOY_REQUIRE_ZMAC'] === '1') {
    throw new Error('zmac is required here (FUGLOY_REQUIRE_ZMAC=1) but was not found; run pnpm zmac:install');
  }
  return it.skip;
}

export interface Assembled {
  module: CmdModule;
  listing: string;
}

/** Assembles zmac source into a .cmd and loads it with our own loader. */
export function assemble(source: string): Assembled {
  const zmac = findZmac();
  if (zmac === null) throw new Error('zmac not found: run pnpm zmac:install or set FUGLOY_ZMAC');
  const dir = mkdtempSync(join(tmpdir(), 'fugloy-zmac-'));
  try {
    const src = join(dir, 'prog.z');
    writeFileSync(src, source);
    // zmac exits 0 on warnings, and "treated as label (instruction typo?)" is one: a line
    // that assembles to nothing. For a round trip every warning is a failure.
    const run = spawnSync(zmac, ['--od', dir, '--oo', 'cmd,lst', src], { encoding: 'utf8' });
    const output = `${run.stdout}${run.stderr}`;
    if (run.status !== 0 || /warning|error/i.test(output)) {
      throw new Error(`zmac failed (exit ${run.status}): ${output}\nsource:\n${source}`);
    }
    const module = loadCmd(new Uint8Array(readFileSync(join(dir, 'prog.cmd'))));
    const listing = readFileSync(join(dir, 'prog.lst'), 'utf8');
    return { module, listing };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');

/** Same loaded addresses and the same byte at every loaded address; the message names the first difference. */
export function expectSameImage(actual: MemoryImage, expected: MemoryImage): void {
  for (let a = 0; a < 0x10000; a++) {
    if (actual.loaded[a] !== expected.loaded[a]) {
      throw new Error(`bitmap differs at $${hex4(a)}: expected ${expected.loaded[a] === 1 ? 'loaded' : 'unloaded'}, got ${actual.loaded[a] === 1 ? 'loaded' : 'unloaded'}`);
    }
    if (expected.loaded[a] === 1 && actual.bytes[a] !== expected.bytes[a]) {
      throw new Error(`byte differs at $${hex4(a)}: expected ${hex4(expected.bytes[a]!).slice(2)}, got ${hex4(actual.bytes[a]!).slice(2)}`);
    }
  }
  expect(actual.runs()).toEqual(expected.runs());
}
