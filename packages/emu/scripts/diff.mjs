/**
 * Run a program in @fugloy/emu and in trsjs in lockstep and report the first divergence no known
 * class explains (emu phase 7; test/diff/compare.js, test/diff/known.js).
 *
 *   pnpm diff <program> [--keys <script.json>] [--instructions N] [--from-cycle C] [--strict]
 *
 * Boots the Model III ROM from fugloy.mcp.json to READY, loads the program (.CMD or .BAS, told
 * apart by content; a .BAS is RUN by typing), runs our machine alone to `--from-cycle` T-states
 * after the load (default 0), then compares N instructions (default 1,000,000). `--keys` names a
 * JSON file of key presses, `[{ "at": <T-states after the load>, "key": "ENTER", "hold": <T-states> }]`
 * (keys as for m.keyboard.press), sent to both machines' matrices at the same boundary. `--strict`
 * stops on a known difference as well.
 *
 * Prints the report (the counts per class, the divergence with ten instructions disassembled on
 * each side). Exit status: 0 no divergence, 1 a divergence, 2 a usage or setup error.
 * Needs trsjs (`pnpm trsjs:install`); it is never bundled.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { detectFormat } from '@fugloy/disasm';
import { configuredRom } from '../test/rom.js';
import { bootToReady } from '../test/integration/boot-helpers.js';
import { compareRun, formatReport, keyEvents } from '../test/diff/compare.js';
import { loadTrsjs } from '../test/diff/trsjs-adapter.js';

const USAGE = 'usage: pnpm diff <program> [--keys <script.json>] [--instructions N] [--from-cycle C] [--strict]';

/** @param {string} msg */
function fail(msg) {
  console.error(msg);
  process.exit(2);
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ program: string | null, keys: string | null, instructions: number, fromCycle: number, strict: boolean }} */
  const o = { program: null, keys: null, instructions: 1_000_000, fromCycle: 0, strict: false };
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
    else if (a === '--strict') o.strict = true;
    else if (a.startsWith('--')) fail(`unknown option ${a}\n${USAGE}`);
    else if (o.program === null) o.program = a;
    else fail(`one program only\n${USAGE}`);
  }
  if (o.program === null) fail(USAGE);
  return o;
}

// pnpm runs scripts from the package folder; a relative path is the caller's.
const cwd = process.env.INIT_CWD ?? process.cwd();
const opts = parseArgs(process.argv.slice(2));
const rom = configuredRom('model3');
if (rom === null) fail('no Model III ROM: name one as roms.model3 in fugloy.mcp.json (docs/fugloy-mcp-spec.md §3)');
let reference;
try {
  reference = loadTrsjs();
} catch (e) {
  fail(/** @type {Error} */ (e).message);
}

const bytes = new Uint8Array(readFileSync(resolve(cwd, /** @type {string} */ (opts.program))));
/** @type {{ at: number, key: string, hold?: number }[]} */
let script = opts.keys === null ? [] : JSON.parse(readFileSync(resolve(cwd, opts.keys), 'utf8'));
if (!Array.isArray(script)) fail(`${opts.keys}: expected a JSON array of { at, key, hold }`);

const m = bootToReady(/** @type {Uint8Array} */ (rom));
const format = detectFormat(bytes);
if (format === 'cmd') m.load.cmd(bytes);
else if (format === 'bas') {
  m.load.bas(bytes);
  // RUN, typed at READY, ahead of the script's keys.
  script = [...[...'RUN'].map((key, k) => ({ at: k * 100_000, key, hold: 50_000 })), { at: 300_000, key: 'ENTER', hold: 50_000 }, ...script.map((e) => ({ ...e, at: e.at + 400_000 }))];
} else fail(`${opts.program}: not a .CMD or .BAS program (the format is told from the content)`);

// Times in the script count from the load.
const start = m.cycles;
const events = keyEvents(script.map((e) => ({ ...e, at: e.at + start })));
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
const result = compareRun({ machine: m, reference, instructions: opts.instructions, keys: events.slice(next), strict: opts.strict });
process.stdout.write(`program: ${opts.program} (${format}), compared from T-state ${from} after the load\n`);
process.stdout.write(formatReport(result));
process.exit(result.divergence === null ? 0 : 1);
