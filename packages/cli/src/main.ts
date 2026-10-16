import { access, readFile, writeFile } from 'node:fs/promises';
import { run } from './index.js';
import { readerGone } from './pipes.js';

// A reader that stops early (`fugloy game.cmd | head`) closes the pipe; end quietly, as Unix tools do.
process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (readerGone(e)) process.exit(0);
  throw e;
});
// The same reader may hold stderr (`2>&1 | head`): stop writing to it, and keep the exit code.
let stderrOpen = true;
process.stderr.on('error', (e: NodeJS.ErrnoException) => {
  if (!readerGone(e)) throw e;
  stderrOpen = false;
});

process.exitCode = await run(process.argv.slice(2), {
  stdout: (s) => { process.stdout.write(s); },
  stderr: (s) => { if (stderrOpen) process.stderr.write(s); },
  readFile: async (path) => new Uint8Array(await readFile(path)),
  writeFile: async (path, text) => { await writeFile(path, text); },
  fileExists: async (path) => { try { await access(path); return true; } catch { return false; } },
  stdoutIsTerminal: process.stdout.isTTY === true,
  env: process.env,
});
