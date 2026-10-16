import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import * as emu from '../src/index.js';

const index = fileURLToPath(new URL('../src/index.js', import.meta.url));

it('exports the extracted core', () => {
  for (const name of ['TRS80System', 'Z80CPU', 'MemorySystem', 'IOSystem', 'KeyboardMatrix', 'CassetteSystem', 'FDC1793', 'DiskImage', 'Printer', 'parseCas', 'parseCmd', 'serializeState', 'restoreState']) {
    expect(typeof emu[name], name).toBe('function');
  }
  expect(emu.CPU_CLOCK_HZ).toBe(2027520);
});

it('imports under plain Node, with no Vitest resolver in between', () => {
  const code = `const m = await import(${JSON.stringify(pathToFileURL(index).href)}); if (typeof m.TRS80System !== 'function') process.exit(3);`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
});
