import { access, readFile, writeFile } from 'node:fs/promises';
import { run } from './index.js';

// A reader that stops early (`fugloy game.cmd | head`) closes the pipe; end quietly, as Unix tools do.
process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});

process.exitCode = await run(process.argv.slice(2), {
  stdout: (s) => { process.stdout.write(s); },
  stderr: (s) => { process.stderr.write(s); },
  readFile: async (path) => new Uint8Array(await readFile(path)),
  writeFile: async (path, text) => { await writeFile(path, text); },
  fileExists: async (path) => { try { await access(path); return true; } catch { return false; } },
  stdoutIsTerminal: process.stdout.isTTY === true,
  env: process.env,
});
