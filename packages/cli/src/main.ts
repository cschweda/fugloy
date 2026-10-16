import { access, readFile, writeFile } from 'node:fs/promises';
import { run } from './index.js';

process.exitCode = await run(process.argv.slice(2), {
  stdout: (s) => { process.stdout.write(s); },
  stderr: (s) => { process.stderr.write(s); },
  readFile: async (path) => new Uint8Array(await readFile(path)),
  writeFile: async (path, text) => { await writeFile(path, text); },
  fileExists: async (path) => { try { await access(path); return true; } catch { return false; } },
});
