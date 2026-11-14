/**
 * `pnpm census <program.cmd> --hints <file> --model 3 --sessions sea-dragon -o <trace.json>`: takes a
 * program's census (census.ts) on Fugløy's game stub ROM and writes the port trace
 * (docs/port-trace-format.md). M2 knows one set of sessions, Sea Dragon's, and the Model III.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { formatTrace } from '../src/trace.js';
import { SESSIONS as SEA_DRAGON_SESSIONS } from '../test/sessions/sea-dragon.js';
import type { Session } from '../test/sessions/sea-dragon.js';
import { census } from './census.js';

const SESSION_SETS: Readonly<Record<string, readonly Session[]>> = { 'sea-dragon': SEA_DRAGON_SESSIONS };
const USAGE = 'usage: pnpm census <program.cmd> --hints <file> --model 3 --sessions sea-dragon -o <trace.json>';

function fail(message: string): never {
  process.stderr.write(`census: ${message}\n${USAGE}\n`);
  process.exit(2);
}

let args: ReturnType<typeof parse>;
function parse() {
  return parseArgs({
    allowPositionals: true,
    options: { hints: { type: 'string' }, model: { type: 'string' }, sessions: { type: 'string' }, output: { type: 'string', short: 'o' } },
  });
}
try {
  args = parse();
} catch (e) {
  fail((e as Error).message);
}
const { values, positionals } = args;
if (positionals.length !== 1) fail('name one program');
if (values.hints === undefined) fail('--hints names the program\'s hint file, which gives its entry');
if (values.model !== '3') fail(`--model must be 3 (M2 runs the Model III), not ${values.model ?? 'missing'}`);
const sessions = SESSION_SETS[values.sessions ?? ''];
if (sessions === undefined) fail(`--sessions must be one of ${Object.keys(SESSION_SETS).join(', ')}`);
if (values.output === undefined) fail('-o names the trace file to write');

const program = positionals[0]!;
const trace = census({
  cmd: new Uint8Array(readFileSync(program)),
  name: basename(program),
  hints: readFileSync(values.hints, 'utf8'),
  model: 3,
  rom: 'game',
  sessions,
});
writeFileSync(values.output, formatTrace(trace));
const hex4 = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;
process.stdout.write(
  [
    `${values.output}: ${trace.program.name} on the game stub ROM, Model III`,
    ...trace.sessions.map((s) => `  session ${s.name}: ${s.cycles.toLocaleString('en-US')} T-states`),
    `  patches: ${trace.patches.map((p) => hex4(p.addr)).join(', ') || 'none'}`,
    `  entered: ${trace.entered.map(([a, b]) => `${hex4(a)}-${hex4(b)}`).join(', ') || 'none'}`,
    `  drops: ${trace.drops.map((d) => `${hex4(d.at)} (${d.count}×)`).join(', ') || 'none'}`,
    `  romReads: ${trace.romReads.map((r) => hex4(r.addr)).join(', ') || 'none'}`,
    '',
  ].join('\n'),
);
