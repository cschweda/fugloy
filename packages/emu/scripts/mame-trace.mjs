/**
 * Record MAME's Model I as a trace, compare our Model I against a trace, or print a trace in the
 * spike's line format (emu phase 7, Model I; test/diff/mame-trace.js).
 *
 *   pnpm mame:trace record <instructions> [--out <file>] [--keys <script.json>]
 *   pnpm mame:trace compare <file> [--instructions N] [--rom <file>] [--strict | --strict-all]
 *   pnpm mame:trace lines <file> [--count N]
 *
 * record: runs MAME 0.289 (`pnpm mame:install` first) from power-on for N instructions and writes
 * the trace (default tools/mame/traces/trace-<N>.fmt, gitignored). `--keys` names a JSON file of
 * `[{ "at": <T-states from power-on>, "text": "\r" }]`, posted through MAME's natural keyboard.
 * compare: runs our Model I (the ROM from fugloy.mcp.json's roms.model1, or `--rom`) from power-on
 * following the trace (its interrupts and keyboard bytes) and prints the report; N defaults to the
 * trace's length. lines: `index PC AF BC DE HL IX IY SP IFF1 cycles`, the state before each
 * instruction, as the spike's packages/emu/scripts/spike-model1/fielddiff.py reads it.
 *
 * Exit status: 0 no divergence, 1 a divergence, 2 a usage or setup error, 3 the trace ends before
 * the instructions asked for (the report says why; the run proves nothing past that point).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Machine } from '../src/index.js';
import { configuredRom } from '../test/rom.js';
import { compareRun, formatReport } from '../test/diff/compare.js';
import { openTrace, recordMameTrace } from '../test/diff/mame-trace.js';

const USAGE = [
  'usage: pnpm mame:trace record <instructions> [--out <file>] [--keys <script.json>]',
  '       pnpm mame:trace compare <file> [--instructions N] [--rom <file>] [--strict | --strict-all]',
  '       pnpm mame:trace lines <file> [--count N]',
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
  if (pos.length !== 1) fail(USAGE);
  const ref = openTrace(resolve(cwd, pos[0]));
  const instructions = opt.instructions === undefined ? Math.max(1, ref.header.requested) : count('--instructions', opt.instructions);
  let rom;
  if (typeof opt.rom === 'string') rom = new Uint8Array(readFileSync(resolve(cwd, opt.rom)));
  else {
    rom = configuredRom('model1');
    if (rom === null) fail('no Model I ROM: name one as roms.model1 in fugloy.mcp.json (docs/fugloy-mcp-spec.md §3), or pass --rom');
  }
  const m = new Machine({ model: 1, roms: { level2: rom } });
  const strict = opt['strict-all'] ? 'all' : opt.strict ? true : false;
  const result = compareRun({ machine: m, reference: ref, instructions, strict });
  ref.close?.();
  process.stdout.write(`trace: ${pos[0]} (MAME ${ref.header.mame}, bios ${ref.header.bios || '?'}), compared from power-on\n`);
  process.stdout.write(formatReport(result));
  process.exit(result.divergence !== null ? 1 : result.ended !== undefined ? 3 : 0);
} else if (cmd === 'lines') {
  if (pos.length !== 1) fail(USAGE);
  const ref = openTrace(resolve(cwd, pos[0]));
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
