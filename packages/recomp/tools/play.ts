/**
 * `pnpm play <program.cmd> --model 3 [--hints <file>] [--trace <file>] [--port <n>]`: ports the program,
 * writes the browser player's folder at `.play/<name>/` (gitignored) and serves it on localhost with the
 * two cross-origin isolation headers the player needs (player.ts), printing the URL. The folder is plain
 * static files: any host that sends those two headers can serve it. M2 plays the Model III.
 */
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { programHash } from '@fugloy/disasm';
import { parseTrace } from '../src/trace.js';
import { buildPlayer, servePlayer } from './player.js';

const USAGE = 'usage: pnpm play <program.cmd> --model 3 [--hints <file>] [--trace <file>] [--port <n>]';
/** The port `--port` defaults to. */
const DEFAULT_PORT = 4380;

function fail(message: string): never {
  process.stderr.write(`play: ${message}\n${USAGE}\n`);
  process.exit(2);
}

let args: ReturnType<typeof parse>;
function parse() {
  return parseArgs({
    allowPositionals: true,
    options: { model: { type: 'string' }, hints: { type: 'string' }, trace: { type: 'string' }, port: { type: 'string' } },
  });
}
try {
  args = parse();
} catch (e) {
  fail((e as Error).message);
}
const { values, positionals } = args;
if (positionals.length !== 1) fail('name one program');
if (values.model !== '3') fail(`--model must be 3 (M2 plays the Model III), not ${values.model ?? 'missing'}`);
const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`--port must be a port number, not ${values.port}`);

const file = positionals[0]!;
const read = (path: string, what: string): Buffer => {
  try {
    return readFileSync(path);
  } catch (e) {
    fail(`cannot read the ${what} ${path}: ${(e as Error).message}`);
  }
};
const cmd = new Uint8Array(read(file, 'program'));
const hints = values.hints === undefined ? undefined : read(values.hints, 'hint file').toString('utf8');
let trace;
try {
  trace = values.trace === undefined ? undefined : parseTrace(read(values.trace, 'trace').toString('utf8'), programHash(cmd));
} catch (e) {
  fail((e as Error).message);
}

const dir = join(process.cwd(), '.play', basename(file).replace(/\.[^.]*$/, ''));
let built;
try {
  built = buildPlayer({ cmd, file, dir, ...(hints === undefined ? {} : { hints }), ...(trace === undefined ? {} : { trace }) });
} catch (e) {
  process.stderr.write(`play: ${(e as Error).message}\n`);
  process.exit(1);
}
const served = await servePlayer(dir, port).catch((e: NodeJS.ErrnoException) =>
  fail(e.code === 'EADDRINUSE' ? `port ${port} is in use; give another with --port` : e.message),
);
process.stdout.write(
  [
    `${built.manifest.title}: ${dir}`,
    `  ${built.report.routines.length} routines, entry ${built.report.entry}; the folder is static files, served with`,
    '  Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp',
    `  play it at ${served.url}  (Ctrl+C stops the server)`,
    '',
  ].join('\n'),
);
