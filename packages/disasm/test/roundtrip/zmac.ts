/**
 * Round-trip harness: assemble emitted source with the pinned zmac (built by
 * scripts/install-zmac.sh into tools/zmac/, or named by FUGLOY_ZMAC), load
 * the resulting .cmd with our own loader, and compare images, never files.
 *
 * zmac is also the referee for @fugloy/asm: every `assemble()` runs both on the
 * same source, and asm must give zmac's 64K image (bitmap and bytes), runs, and
 * entry, with no warning and no error. Without zmac, asm alone assembles the
 * source and its image goes back to the caller, so the image the test already
 * expects (the program that went in) checks asm on its own.
 *
 * A source emitted with a machine's symbol tables is assembled by asm for that
 * machine and DOS (`AsmOptions`), so the table names asm predefines (Ruling 5)
 * meet the emitter's EQUs that define them again.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble as asmAssemble, toCmd } from '../../../asm/src/index.js';
import type { AsmOptions, AsmResult } from '../../../asm/src/index.js';
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

/**
 * For round trips, which `assemble()` can check with or without zmac: always `it`, except that
 * under FUGLOY_REQUIRE_ZMAC=1 (CI) a missing zmac is a failure, as with `skipIfNoZmac`.
 */
export function withAssembler(): typeof it {
  if (findZmac() === null && process.env['FUGLOY_REQUIRE_ZMAC'] === '1') {
    throw new Error('zmac is required here (FUGLOY_REQUIRE_ZMAC=1) but was not found; run pnpm zmac:install');
  }
  return it;
}

export interface Assembled {
  module: CmdModule;
  /** zmac's listing; empty when zmac is absent and asm alone assembled the source. */
  listing: string;
  /** Which assembler produced `module`: zmac (with asm checked against it) or asm alone. */
  by: 'zmac' | 'asm';
}

const describe = (r: AsmResult): string =>
  r.diagnostics.map((d) => `${d.line}:${d.column}: ${d.severity}: ${d.message}`).join('\n');

/** asm's result for an emitted source: ok, with no warning or error (an info note is fine). */
function cleanAsm(source: string, options: AsmOptions): AsmResult & { image: MemoryImage } {
  const result = asmAssemble(source, options);
  const loud = result.diagnostics.filter((d) => d.severity !== 'info');
  if (!result.ok || result.image === null || loud.length > 0) {
    const lines = source.split('\n');
    const at = loud.map((d) => `line ${d.line}: ${lines[d.line - 1] ?? ''}`).slice(0, 10).join('\n');
    throw new Error(`@fugloy/asm did not assemble the source cleanly:\n${describe(result)}\n${at}`);
  }
  return result as AsmResult & { image: MemoryImage };
}

/** Throws unless asm's result matches the program zmac produced: the 64K image, the runs, and the entry. */
function expectAsmAgrees(asm: AsmResult & { image: MemoryImage }, zmac: CmdModule): void {
  try {
    expectSameImage(asm.image, zmac.image);
  } catch (e) {
    throw new Error(`@fugloy/asm and zmac disagree: ${(e as Error).message} (zmac is expected, asm is got)`);
  }
  // zmac writes a transfer record only for END with an entry; without one loadCmd guesses the lowest address.
  const entry = zmac.entrySource === 'transfer' ? zmac.entry : null;
  if (asm.entry !== entry) {
    const show = (n: number | null): string => (n === null ? 'none' : `$${hex4(n)}`);
    throw new Error(`@fugloy/asm and zmac disagree on the entry: zmac ${show(entry)}, asm ${show(asm.entry)}`);
  }
}

/**
 * Assembles zmac source into a .cmd and loads it with our own loader, checking @fugloy/asm
 * against it (assembled for `options`' machine and DOS; the Model III unless told, named
 * explicitly, so the Model I/III note is info, not a warning). Without zmac, asm's own .cmd is
 * loaded instead (by: 'asm').
 */
export function assemble(source: string, given: AsmOptions = {}): Assembled {
  const options: AsmOptions = { model: 3, ...given };
  const zmac = findZmac();
  if (zmac === null) {
    const asm = cleanAsm(source, options);
    // Shape the file as zmac's: without an END entry zmac writes no end record at all, so
    // loadCmd guesses the lowest address, where toCmd's `03 00` would give no entry.
    let cmd = toCmd(asm, { entry: 'source' });
    if (asm.entry === null && cmd.at(-2) === 0x03 && cmd.at(-1) === 0x00) cmd = cmd.subarray(0, -2);
    return { module: loadCmd(cmd), listing: '', by: 'asm' };
  }
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
    expectAsmAgrees(cleanAsm(source, options), module);
    return { module, listing, by: 'zmac' };
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
