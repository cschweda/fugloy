/** Small helpers shared by the assembler's tests. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCmd } from '../../disasm/src/cmd.js';
import { findZmac } from '../../disasm/test/roundtrip/zmac.js';
import { assemble } from '../src/index.js';
import type { AsmResult } from '../src/index.js';

/** The loaded bytes of an image, in address order; throws with the diagnostics if the source has errors. */
export function bytesOf(source: string): number[] {
  const result = assemble(source);
  if (!result.ok || result.image === null) {
    throw new Error(`expected a clean assembly, got:\n${result.diagnostics.map((d) => `${d.line}:${d.column}: ${d.severity}: ${d.message}`).join('\n')}`);
  }
  const out: number[] = [];
  for (const run of result.image.runs()) for (let a = run.start; a <= run.end; a++) out.push(result.image.bytes[a]!);
  return out;
}

/** The bytes of instructions written at 6000H, one per line. */
export const at6000 = (...lines: string[]): number[] => bytesOf(['\tORG 6000H', ...lines.map((l) => `\t${l}`)].join('\n'));

/** The value of an expression, as `DW` stores it at 6000H. */
export function wordOf(expr: string): number {
  const b = at6000(`DW ${expr}`);
  return b[0]! | (b[1]! << 8);
}

/** The error diagnostics as `line: message`. */
export const errorsOf = (result: AsmResult): string[] =>
  result.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.line}: ${d.message}`);

/** Every diagnostic as `line:column-endColumn severity: message`. */
export const diagnosticsOf = (result: AsmResult): string[] =>
  result.diagnostics.map((d) => `${d.line}:${d.column}-${d.endColumn} ${d.severity}: ${d.message}`);

export interface ZmacRun {
  /** True only when zmac exits 0 and prints no warning and no error. */
  clean: boolean;
  output: string;
  /** Loaded bytes in address order, when zmac wrote a .cmd it was clean about. */
  bytes: number[] | null;
}

/** Runs the pinned zmac on `source` without throwing, for probes where an error is the expected answer. */
export function runZmac(source: string): ZmacRun {
  const zmac = findZmac();
  if (zmac === null) throw new Error('zmac not found: run pnpm zmac:install or set FUGLOY_ZMAC');
  const dir = mkdtempSync(join(tmpdir(), 'fugloy-asm-probe-'));
  try {
    const src = join(dir, 'probe.z');
    writeFileSync(src, source);
    const run = spawnSync(zmac, ['--od', dir, '--oo', 'cmd,lst', src], { encoding: 'utf8' });
    const output = `${run.stdout}${run.stderr}`;
    const clean = run.status === 0 && !/warning|error/i.test(output);
    let bytes: number[] | null = null;
    if (clean) {
      const { image } = loadCmd(new Uint8Array(readFileSync(join(dir, 'probe.cmd'))));
      bytes = [];
      for (const r of image.runs()) for (let a = r.start; a <= r.end; a++) bytes.push(image.bytes[a]!);
    }
    return { clean, output, bytes };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
