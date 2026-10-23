/**
 * Record MAME's Model I as a trace, or print a trace in the spike's line format (emu phase 7,
 * Model I; test/diff/mame-trace.js). A trace is compared with
 * `pnpm diff --model 1 --reference mame --trace <file>` (scripts/diff.mjs).
 *
 *   pnpm mame:trace record <instructions> [--out <file>] [--keys <script.json>]
 *   pnpm mame:trace lines <file> [--count N] [--program <file>]
 *
 * record: runs MAME 0.289 (`pnpm mame:install` first) from power-on for N instructions and writes
 * the trace (default tools/mame/traces/trace-<N>.fmt, gitignored). `--keys` names a JSON file of
 * `[{ "at": <T-states from power-on>, "text": "\r" }]`, posted through MAME's natural keyboard.
 * lines: `index PC AF BC DE HL IX IY SP IFF1 cycles`, the state before each
 * instruction, as the spike's packages/emu/scripts/spike-model1/fielddiff.py reads it. A trace that
 * loaded a program (the tests record those) is read with that program, `--program` (openTrace
 * checks it is the one, by its SHA-256); the load's record shows the PC the load replaced, as MAME
 * wrote it (mame-trace.js, TraceLoad).
 *
 * Exit status: 0 done, 2 a usage or setup error, 3 a recording that ended before the instructions
 * asked for (it says why; the trace proves nothing past that point).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openTrace, recordMameTrace } from '../test/diff/mame-trace.js';

const USAGE = [
  'usage: pnpm mame:trace record <instructions> [--out <file>] [--keys <script.json>]',
  '       pnpm mame:trace lines <file> [--count N] [--program <file>]',
  '(compare a trace with pnpm diff --model 1 --reference mame --trace <file>)',
].join('\n');

/** @param {string} msg @returns {never} */
function fail(msg) {
  console.error(msg);
  process.exit(2);
}
process.on('uncaughtException', (e) => fail(`mame:trace: ${e instanceof Error ? e.message : String(e)}`));
process.on('unhandledRejection', (e) => fail(`mame:trace: ${e instanceof Error ? e.message : String(e)}`));

const cwd = process.env.INIT_CWD ?? process.cwd();
const [cmd, ...rest] = process.argv.slice(2);
/** @type {string[]} */
const pos = [];
/** @type {Record<string, string | true>} */
const opt = {};
for (let k = 0; k < rest.length; k++) {
  const a = rest[k];
  if (a === '--strict' || a === '--strict-all') opt[a.slice(2)] = true;
  else if (a.startsWith('--')) {
    const v = rest[++k];
    if (v === undefined) fail(`${a} needs a value\n${USAGE}`);
    opt[a.slice(2)] = v;
  } else pos.push(a);
}
/** @param {string} name @param {string | true | undefined} v */
const count = (name, v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) fail(`${name} takes a whole number above 0, not ${v}\n${USAGE}`);
  return n;
};

if (cmd === 'record') {
  if (pos.length !== 1) fail(USAGE);
  const instructions = count('instructions', pos[0]);
  let keys = [];
  if (typeof opt.keys === 'string') {
    try {
      keys = JSON.parse(readFileSync(resolve(cwd, opt.keys), 'utf8'));
    } catch (e) {
      fail(`cannot read the key script ${opt.keys}: ${/** @type {Error} */ (e).message}`);
    }
    if (!Array.isArray(keys) || !keys.every((e) => e && Number.isFinite(e.at) && e.at >= 0 && typeof e.text === 'string')) fail(`${opt.keys}: expected a JSON array of { "at": T-states, "text": "..." }`);
  }
  const out = typeof opt.out === 'string' ? resolve(cwd, opt.out) : undefined;
  const r = await recordMameTrace({ instructions, keys, out });
  const ref = openTrace(r.path);
  const h = ref.header;
  ref.close?.();
  console.log(`${r.path}: ${r.instructions} of ${instructions} instructions${h.complete ? ', verified against MAME\'s memory at the end' : ` (${h.reason})`}`);
  process.exit(h.complete ? 0 : 3);
} else if (cmd === 'compare') {
  fail('pnpm mame:trace compare moved: run pnpm diff --model 1 --reference mame --trace <file> [--instructions N]');
} else if (cmd === 'lines') {
  if (pos.length !== 1) fail(USAGE);
  let program;
  if (typeof opt.program === 'string') {
    try {
      program = new Uint8Array(readFileSync(resolve(cwd, opt.program)));
    } catch (e) {
      fail(`cannot read the program ${opt.program}: ${/** @type {Error} */ (e).message}`);
    }
  }
  const ref = openTrace(resolve(cwd, pos[0]), { program });
  const n = opt.count === undefined ? ref.header.records : count('--count', opt.count);
  const h2 = (/** @type {number} */ v) => v.toString(16).toUpperCase().padStart(2, '0');
  const h4 = (/** @type {number} */ v) => v.toString(16).toUpperCase().padStart(4, '0');
  const out = [];
  for (let k = 0; k < n; k++) {
    const r = ref.regs();
    out.push(`${k} ${h4(r.pc)} ${h2(r.a)}${h2(r.f)} ${h2(r.b)}${h2(r.c)} ${h2(r.d)}${h2(r.e)} ${h2(r.h)}${h2(r.l)} ${h4(r.ix)} ${h4(r.iy)} ${h4(r.sp)} ${r.iff1 ? 1 : 0} ${ref.cycles}`);
    if (out.length >= 65536) { process.stdout.write(`${out.join('\n')}\n`); out.length = 0; }
    if (!ref.follow.has(k)) break;
    ref.step();
  }
  if (out.length > 0) process.stdout.write(`${out.join('\n')}\n`);
  ref.close?.();
} else {
  fail(USAGE);
}
