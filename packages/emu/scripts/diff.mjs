/**
 * Run a program in @fugloy/emu and in a reference machine in lockstep (or follow a recorded
 * trace) and report the first divergence no known class explains (emu phase 7;
 * test/diff/compare.js, test/diff/known.js).
 *
 *   pnpm diff <program> [--model 3|1] [--reference trsjs|xtrs] [--lowercase] [--keys <script.json>]
 *             [--instructions N] [--from-cycle C] [--rom <file>] [--strict | --strict-all]
 *   pnpm diff [<program>] --model 1 --reference mame --trace <file> [--instructions N] [--rom <file>] [--strict | --strict-all]
 *
 * The Model III (`--model 3`, the default) is compared against trsjs, the Model I (`--model 1`)
 * against xtrs (the default for it) or MAME. A lockstep run boots the model's ROM from
 * fugloy.mcp.json (roms.model3 or roms.model1) to READY, loads the program (.CMD or .BAS, told
 * apart by content; a .BAS is RUN by typing), runs our machine alone to `--from-cycle` T-states
 * after the load (default 0), then compares N instructions (default 1,000,000). `--keys` names a
 * JSON file of key presses, `[{ "at": <T-states after the load>, "key": "ENTER", "hold": <T-states> }]`
 * (keys as for m.keyboard.press), sent to both machines' matrices at the same boundary.
 * `--lowercase` fits the Model I's lowercase modification on both (video RAM then compares raw).
 * `--rom` names the ROM file in place of fugloy.mcp.json's.
 *
 * MAME is compared from a trace of its run from power-on (Ruling 4), recorded with
 * `pnpm mame:trace record <instructions> [--keys …]` (the ROM's boot and keys typed through MAME's
 * keyboard); our Model I follows it from power-on, with its 40 Hz on MAME's schedule (MAME's
 * 1,774,083 Hz clock; test/diff/mame-clock.js, test-only), which the report names. N defaults to
 * the trace's length. A trace that loaded a program (the tests record those:
 * test/diff/model1-fixtures.test.js) is compared with that program named as <program>; recording
 * one from the command line is not supported yet (emu spec §11, phase 7).
 *
 * `--strict` stops on a known difference as well, except flag bits 3 and 5 (which differ within a
 * few instructions in most programs); `--strict-all` stops on those too.
 *
 * Prints the report (the reference and model, the counts per class, the divergence with ten
 * instructions disassembled on each side). Exit status: 0 no divergence, 1 a divergence, 2 a
 * usage or setup error (an unexpected error, such as the ROM not reaching READY or the reference
 * failing, also exits 2, never 1), 3 a trace that ends before the instructions asked for (the
 * report says why; the run proves nothing past that point). Needs the reference installed
 * (`pnpm trsjs:install`, `pnpm xtrs:install`, `pnpm mame:install`); none is ever bundled.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectFormat } from '@fugloy/disasm';
import { Machine } from '../src/index.js';
import { configuredRom } from '../test/rom.js';
import { bootToReady, waitFor } from '../test/integration/boot-helpers.js';
import { compareRun, formatReport, keyEvents } from '../test/diff/compare.js';
import { loadTrsjs } from '../test/diff/trsjs-adapter.js';
import { loadXtrs } from '../test/diff/xtrs-adapter.js';
import { mameTimer } from '../test/diff/mame-clock.js';
import { MAME_CLOCK_HZ, openTrace } from '../test/diff/mame-trace.js';

const USAGE = [
  'usage: pnpm diff <program> [--model 3|1] [--reference trsjs|xtrs] [--lowercase] [--keys <script.json>] [--instructions N] [--from-cycle C] [--rom <file>] [--strict | --strict-all]',
  '       pnpm diff [<program>] --model 1 --reference mame --trace <file> [--instructions N] [--rom <file>] [--strict | --strict-all]',
].join('\n');

/**
 * Print `msg` and exit 2 (a usage or setup error; 1 means a divergence).
 * @param {string} msg
 * @returns {never}
 */
function fail(msg) {
  console.error(msg);
  process.exit(2);
}

// An unexpected error is a setup error (2), never a divergence (1).
process.on('uncaughtException', (e) => fail(`diff: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`));

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ program: string | null, keys: string | null, instructions: number | null, fromCycle: number, strict: boolean | 'all', model: 1 | 3, reference: string | null, trace: string | null, lowercase: boolean, rom: string | null }} */
  const o = { program: null, keys: null, instructions: null, fromCycle: 0, strict: false, model: 3, reference: null, trace: null, lowercase: false, rom: /** @type {string | null} */ (null) };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    const value = () => {
      const v = argv[++k];
      if (v === undefined) fail(`${a} needs a value\n${USAGE}`);
      return v;
    };
    const count = (/** @type {string} */ v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) fail(`${a} takes a whole number, not ${v}\n${USAGE}`);
      return n;
    };
    if (a === '--keys') o.keys = value();
    else if (a === '--instructions') o.instructions = count(value());
    else if (a === '--from-cycle') o.fromCycle = count(value());
    else if (a === '--strict') o.strict = o.strict === 'all' ? 'all' : true;
    else if (a === '--strict-all') o.strict = 'all';
    else if (a === '--lowercase') o.lowercase = true;
    else if (a === '--trace') o.trace = value();
    else if (a === '--rom') o.rom = value();
    else if (a === '--model') {
      const v = value();
      if (v !== '1' && v !== '3') fail(`--model takes 1 (the Model I) or 3 (the Model III), not ${v}\n${USAGE}`);
      o.model = v === '1' ? 1 : 3;
    } else if (a === '--reference') {
      const v = value();
      if (v !== 'trsjs' && v !== 'xtrs' && v !== 'mame') fail(`--reference takes trsjs, xtrs or mame, not ${v}\n${USAGE}`);
      o.reference = v;
    } else if (a.startsWith('--')) fail(`unknown option ${a}\n${USAGE}`);
    else if (o.program === null) o.program = a;
    else fail(`one program only\n${USAGE}`);
  }
  o.reference ??= o.model === 1 ? 'xtrs' : 'trsjs';
  if (o.model === 3 && o.reference !== 'trsjs') fail(`the Model III is compared against trsjs; ${o.reference} runs the Model I (--model 1)`);
  if (o.model === 1 && o.reference === 'trsjs') fail('trsjs runs the Model III; the Model I is compared against xtrs or mame');
  if (o.lowercase && o.model !== 1) fail('--lowercase is the Model I\'s modification (--model 1)');
  if (o.reference === 'mame') {
    if (o.trace === null) fail(`MAME is compared from a trace of its run from power-on: record one with pnpm mame:trace record <instructions>, then pass it with --trace\n${USAGE}`);
    if (o.keys !== null || o.fromCycle !== 0) fail('a MAME trace brings its own keys and is compared from power-on: pass no --keys or --from-cycle (record a trace from the ROM\'s boot and typed keys with pnpm mame:trace record <instructions> --keys <script.json>; a trace that loaded a program is recorded by the tests, test/diff/model1-fixtures.test.js, and compared here with that program named)');
    if (o.lowercase) fail('MAME\'s trs80l2 is compared without the lowercase modification');
  } else {
    if (o.trace !== null) fail('--trace is for --reference mame');
    if (o.program === null) fail(USAGE);
  }
  return o;
}

// pnpm runs scripts from the package folder; a relative path is the caller's.
const cwd = process.env.INIT_CWD ?? process.cwd();
const opts = parseArgs(process.argv.slice(2));
const modelName = opts.model === 1 ? 'Model I' : 'Model III';
/** The ROM: --rom, else fugloy.mcp.json's for the model. */
const romFor = () => (opts.rom !== null ? new Uint8Array(readOrFail(opts.rom, 'ROM')) : configuredRom(opts.model === 1 ? 'model1' : 'model3'));

/** @param {string} path @param {string} what */
function readOrFail(path, what) {
  try {
    return readFileSync(resolve(cwd, path));
  } catch (e) {
    return fail(`cannot read the ${what} ${path}: ${/** @type {Error} */ (e).message}`);
  }
}

if (opts.reference === 'mame') {
  // The program a trace loaded, if one is named: openTrace checks it is that one.
  const program = opts.program === null ? undefined : new Uint8Array(readOrFail(opts.program, 'program'));
  let ref;
  try {
    ref = openTrace(resolve(cwd, /** @type {string} */ (opts.trace)), { program });
  } catch (e) {
    fail(/** @type {Error} */ (e).message);
  }
  if (program !== undefined && (ref.header.load ?? null) === null) fail(`${opts.trace} loaded no program (pnpm mame:trace record records the ROM's boot and typed keys); pass none`);
  const rom = romFor();
  if (rom === null) fail('no Model I ROM: name one as roms.model1 in fugloy.mcp.json (docs/fugloy-mcp-spec.md §3), or pass --rom');
  // Our 40 Hz on MAME's schedule, as the sessions run it (the controller's ruling on the clock).
  const m = mameTimer(new Machine({ model: 1, roms: { level2: rom } }));
  const instructions = opts.instructions ?? Math.max(1, ref.header.requested);
  const result = compareRun({ machine: m, reference: ref, instructions, strict: opts.strict, model: 1 });
  ref.close?.();
  const load = ref.header.load ?? null;
  process.stdout.write(`trace: ${opts.trace} (MAME ${ref.header.mame}, bios ${ref.header.bios || '?'}), compared from power-on${load === null ? '' : `, ${opts.program} loaded before instruction ${load.at}`}\n`);
  process.stdout.write(`our 40 Hz on MAME's clock (${MAME_CLOCK_HZ.toLocaleString('en-US')} Hz): test-only, test/diff/mame-clock.js\n`);
  process.stdout.write(formatReport(result));
  process.exit(result.divergence !== null ? 1 : result.ended !== undefined ? 3 : 0);
}

const rom = romFor();
if (rom === null) fail(`no ${modelName} ROM: name one as roms.model${opts.model} in fugloy.mcp.json (docs/fugloy-mcp-spec.md §3), or pass --rom`);
let reference;
try {
  reference = opts.reference === 'xtrs' ? loadXtrs({ rom }) : loadTrsjs();
} catch (e) {
  fail(/** @type {Error} */ (e).message);
}

const bytes = new Uint8Array(readOrFail(/** @type {string} */ (opts.program), 'program'));
/** @type {{ at: number, key: string, hold?: number }[]} */
let script = [];
if (opts.keys !== null) {
  const text = readOrFail(opts.keys, 'key script').toString('utf8');
  try {
    script = JSON.parse(text);
  } catch (e) {
    fail(`${opts.keys} is not JSON: ${/** @type {Error} */ (e).message}`);
  }
  const ok = Array.isArray(script) && script.every((e) => e !== null && typeof e === 'object' && Number.isFinite(e.at) && e.at >= 0 && typeof e.key === 'string' && (e.hold === undefined || (Number.isFinite(e.hold) && e.hold > 0)));
  if (!ok) fail(`${opts.keys}: expected a JSON array of { "at": T-states, "key": "ENTER", "hold": T-states (optional) }`);
}

/** The Model I at READY: MEM SIZE? (Level II 1.3's wording; 1.2's MEMORY SIZE?) answered with ENTER. */
function bootModel1() {
  const m = new Machine({ model: 1, roms: { level2: /** @type {Uint8Array} */ (rom) }, lowercase: opts.lowercase });
  waitFor(m, 'SIZE?', 2);
  m.keyboard.type('\n');
  waitFor(m, 'READY', 5);
  m.run({ cycles: m.clockHz / 4 }); // let the cursor settle
  return m;
}

const m = opts.model === 1 ? bootModel1() : bootToReady(/** @type {Uint8Array} */ (rom));
const format = detectFormat(bytes);
if (format === 'cmd') m.load.cmd(bytes);
else if (format === 'bas') {
  m.load.bas(bytes);
  // RUN, typed at READY, ahead of the script's keys.
  script = [...[...'RUN'].map((key, k) => ({ at: k * 100_000, key, hold: 50_000 })), { at: 300_000, key: 'ENTER', hold: 50_000 }, ...script.map((e) => ({ ...e, at: e.at + 400_000 }))];
} else fail(`${opts.program}: not a .CMD or .BAS program (the format is told from the content)`);

// Times in the script count from the load.
const start = m.cycles;
/** @type {import('../test/diff/compare.js').KeyEvent[]} */
let events = [];
try {
  events = keyEvents(script.map((e) => ({ ...e, at: e.at + start })));
} catch (e) {
  fail(`${opts.keys}: ${/** @type {Error} */ (e).message}`);
}
let next = 0;
// Our machine alone up to --from-cycle, its keys straight into the matrix as compareRun sends them.
while (m.cycles - start < opts.fromCycle) {
  while (next < events.length && events[next].at <= m.cycles) {
    const e = events[next++];
    if (e.down) m.system.keyboard.pressKey(e.row, e.bit); else m.system.keyboard.releaseKey(e.row, e.bit);
  }
  m.step(1);
}

const from = m.cycles - start;
const result = compareRun({ machine: m, reference, instructions: opts.instructions ?? 1_000_000, keys: events.slice(next), strict: opts.strict, model: opts.model, lowercase: opts.model === 1 ? opts.lowercase : undefined });
reference.close?.();
process.stdout.write(`program: ${opts.program} (${format}), compared from T-state ${from} after the load\n`);
process.stdout.write(formatReport(result));
process.exit(result.divergence === null ? 0 : 1);
