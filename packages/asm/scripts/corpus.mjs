#!/usr/bin/env node
/**
 * `pnpm asm:corpus`: zmac as the referee for @fugloy/asm over every real program
 * on this machine. Each file under examples/, sample/, and fixtures/real/ that
 * is a .CMD or a tokenized BASIC program (by content, never by extension) is
 * disassembled as roundtrip/real.test.ts does it, emitted with emitZmac, and
 * assembled by @fugloy/asm and by the pinned zmac. A program with a committed
 * hint file (examples/<game>/<name>.hints, fixtures/hints/<name>.hints) gets a
 * second row with the hints applied, as the hint tests do.
 *
 * A row passes when asm assembles with no warning or error, zmac with no
 * warning or error, and asm's 64K image (bitmap and bytes), runs, and entry
 * match zmac's and the program that went in. It prints a table and exits 1 on
 * any mismatch. Without zmac (pnpm zmac:install) asm is checked against the
 * original program only, and the summary says so.
 *
 * Runs on the built packages: the root script builds first.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze, applyHints, detectFormat, emitZmac, loadBas, loadCmd, parseHints, programHash } from '../../disasm/dist/index.js';
import { assemble } from '../dist/index.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const ROOTS = ['examples', 'sample', 'fixtures/real'];

function findZmac() {
  const env = process.env.FUGLOY_ZMAC;
  if (env !== undefined && env !== '' && existsSync(env)) return env;
  const local = join(repo, 'tools', 'zmac', 'zmac');
  return existsSync(local) ? local : null;
}

/** Every program file, in root order then path order; identical files are counted once. */
function programs() {
  const out = [];
  const seen = new Set();
  const skipped = [];
  let duplicates = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      const bytes = new Uint8Array(readFileSync(path));
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (seen.has(hash)) {
        duplicates++;
        continue;
      }
      seen.add(hash);
      const format = detectFormat(bytes);
      if (format === 'raw') skipped.push(relative(repo, path));
      else out.push({ path, bytes, format });
    }
  };
  for (const root of ROOTS) if (existsSync(join(repo, root))) walk(join(repo, root));
  return { out, skipped, duplicates };
}

/** The committed hint file for a program, if any. */
function hintFile(path) {
  const name = basename(path).replace(/\.[^.]*$/, '');
  const beside = join(path, '..', `${name}.hints`);
  if (path.startsWith(join(repo, 'examples')) && existsSync(beside)) return beside;
  const fixture = join(repo, 'fixtures', 'hints', `${name}.hints`);
  return existsSync(fixture) ? fixture : null;
}

function runZmac(zmac, source) {
  const dir = mkdtempSync(join(tmpdir(), 'fugloy-corpus-'));
  try {
    const src = join(dir, 'prog.z');
    writeFileSync(src, source);
    const run = spawnSync(zmac, ['--od', dir, '--oo', 'cmd', src], { encoding: 'utf8' });
    const output = `${run.stdout}${run.stderr}`;
    if (run.status !== 0 || /warning|error/i.test(output)) return { error: output.trim().split('\n').slice(0, 3).join(' / ') };
    const mod = loadCmd(new Uint8Array(readFileSync(join(dir, 'prog.cmd'))));
    return { image: mod.image, entry: mod.entrySource === 'transfer' ? mod.entry : null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const hex4 = (n) => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

/** The first difference between two images (bitmap, then bytes, then runs), or null. */
function imageDiff(got, want) {
  for (let a = 0; a < 0x10000; a++) {
    if (got.loaded[a] !== want.loaded[a]) return `bitmap at ${hex4(a)}`;
    if (want.loaded[a] === 1 && got.bytes[a] !== want.bytes[a]) return `byte at ${hex4(a)}`;
  }
  if (JSON.stringify(got.runs()) !== JSON.stringify(want.runs())) return 'runs';
  return null;
}

function check(row, zmac) {
  const mod = row.format === 'bas' ? loadBas(row.bytes) : loadCmd(row.bytes);
  let annotations;
  if (row.hints !== undefined) {
    const parsed = parseHints(readFileSync(row.hints, 'utf8'));
    if (parsed.errors.length > 0) return { problem: `hint file: ${parsed.errors[0].message}` };
    const applied = applyHints(parsed.file, mod.image, programHash(row.bytes));
    if (applied.errors.length > 0) return { problem: `hints: ${applied.errors[0]}` };
    annotations = applied.annotations;
  }
  const a = analyze(mod, annotations === undefined ? {} : { annotations });
  const options = { source: basename(row.path), symbols: a.symbols, annotations: a.annotations };
  if (annotations !== undefined) options.space = a.space;
  const source = emitZmac(mod.image, a.pass1, a.transfer, options);
  const lines = source.split('\n').length;

  const t0 = performance.now();
  const asm = assemble(source);
  const asmMs = performance.now() - t0;
  const loud = asm.diagnostics.filter((d) => d.severity !== 'info');
  const result = { lines, bytes: mod.image.runs().reduce((n, r) => n + r.length, 0), asmMs };
  if (!asm.ok || asm.image === null || loud.length > 0) {
    const d = loud[0];
    return { ...result, problem: `asm: line ${d?.line}: ${d?.message}` };
  }
  const original = imageDiff(asm.image, mod.image);
  if (original !== null) return { ...result, problem: `asm vs the original: ${original}` };
  const wantEntry = mod.format === 'cmd' && mod.entrySource === 'transfer' ? mod.entry : null;
  if (mod.format === 'cmd' && asm.entry !== wantEntry) return { ...result, problem: `asm entry ${asm.entry === null ? 'none' : hex4(asm.entry)}, the original's ${wantEntry === null ? 'none' : hex4(wantEntry)}` };
  if (zmac === null) return { ...result, zmac: 'absent' };
  const t1 = performance.now();
  const z = runZmac(zmac, source);
  result.zmacMs = performance.now() - t1;
  if (z.error !== undefined) return { ...result, problem: `zmac: ${z.error}` };
  const vsZmac = imageDiff(asm.image, z.image);
  if (vsZmac !== null) return { ...result, problem: `asm vs zmac: ${vsZmac}` };
  if (asm.entry !== z.entry) return { ...result, problem: `entry: asm ${asm.entry === null ? 'none' : hex4(asm.entry)}, zmac ${z.entry === null ? 'none' : hex4(z.entry)}` };
  return { ...result, zmac: 'same' };
}

const zmac = findZmac();
const { out, skipped, duplicates } = programs();
const rows = [];
for (const p of out) {
  rows.push(p);
  const hints = hintFile(p.path);
  if (hints !== null) rows.push({ ...p, hints });
}

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
console.log(`${pad('program', 44)} ${pad('fmt', 4)} ${lpad('bytes', 6)} ${lpad('lines', 6)} ${lpad('asm ms', 7)} ${lpad('zmac ms', 8)}  result`);
let failed = 0;
const byRoot = new Map();
for (const row of rows) {
  const r = check(row, zmac);
  const name = relative(repo, row.path) + (row.hints === undefined ? '' : ' + hints');
  const root = ROOTS.find((x) => relative(repo, row.path).startsWith(x));
  byRoot.set(root, (byRoot.get(root) ?? 0) + 1);
  const ok = r.problem === undefined;
  if (!ok) failed++;
  const shown = name.length > 44 ? `…${name.slice(-43)}` : name;
  console.log(`${pad(shown, 44)} ${pad(row.format, 4)} ${lpad(r.bytes ?? '', 6)} ${lpad(r.lines ?? '', 6)} ${lpad(r.asmMs?.toFixed(0) ?? '', 7)} ${lpad(r.zmacMs?.toFixed(0) ?? '', 8)}  ${ok ? (r.zmac === 'same' ? 'same as zmac' : 'same as the original (no zmac)') : `MISMATCH ${r.problem}`}`);
}
const programCount = out.length;
const hinted = rows.length - programCount;
console.log('');
console.log(`${programCount} programs (${out.filter((p) => p.format === 'cmd').length} .CMD, ${out.filter((p) => p.format === 'bas').length} BASIC) and ${hinted} of them again with hints: ${rows.length} rows (${[...byRoot].map(([k, v]) => `${k} ${v}`).join(', ')}), ${rows.length - failed} match, ${failed} mismatch${failed === 1 ? '' : 'es'}.`);
console.log(`${skipped.length} other files are neither .CMD nor BASIC and were skipped: ${skipped.map((s) => basename(s)).join(', ')}.${duplicates > 0 ? ` ${duplicates} file${duplicates === 1 ? ' was a copy' : 's were copies'} of another and counted once.` : ''}`);
if (zmac === null) console.log('zmac is not installed (pnpm zmac:install), so asm was checked against the original programs only.');
process.exit(failed === 0 ? 0 : 1);
