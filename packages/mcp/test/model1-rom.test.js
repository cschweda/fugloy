/**
 * The Model I through the MCP server on the real Level II ROM (roms.model1 in the repository's
 * fugloy.mcp.json, gitignored; the suite skips without it), emu phase 6, Task 4: Eliminator's
 * Model I-only build from examples/ reaches its title and answers ENTER; BASIC typed at the key
 * tool's default rate (10 characters a second on the Model I) arrives whole; a Model I disk in
 * fixtures/real boots to 4200h; and a Model III ROM named as roms.model1 is refused with a
 * sentence saying which model it belongs to. Properties only: a transcript would carry ROM text.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { connect } from './helpers.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const config = loadConfig({ cwd: repo, env: process.env, home: homedir() });
const eliminator = join(repo, 'examples/eliminator/elimin8a.cmd');

/** A file under the config's fixtures folder whose name matches `pattern`, or undefined. */
function fixture(/** @type {RegExp} */ pattern) {
  if (config.fixtures === undefined || !existsSync(config.fixtures)) return undefined;
  const found = readdirSync(config.fixtures, { recursive: true, encoding: 'utf8' }).filter((f) => pattern.test(f)).sort()[0];
  return found === undefined ? undefined : join(config.fixtures, found);
}
const scarfman = fixture(/SCARFMAN\.DSK$/i);

async function ok(call, name, args) {
  const r = await call(name, args);
  if (r.isError) throw new Error(`${name} failed: ${r.text}`);
  return r.text;
}

describe.skipIf(config.roms.model1 === undefined)('the MCP server on the Model I Level II ROM', { timeout: 60_000 }, () => {
  it('Eliminator (elimin8a, Model I only) reaches its title and answers ENTER', async () => {
    const { call, close } = await connect({ config });
    const manifest = await ok(call, 'load', { path: eliminator, model: 1 });
    expect(manifest).toContain('Model: Model I (48K, with the Expansion Interface)');
    expect(manifest).toMatch(/\nROM: model1-level2-1\.[23]\n/);
    expect(manifest).toMatch(/\nBoot: READY after \d+\.\d{3} s emulated\n/);
    let screen = '';
    for (let i = 0; i < 4 && !screen.includes('WESTMORELAND'); i++) {
      await ok(call, 'run', { until: 'settled' });
      screen = await ok(call, 'screen', {});
    }
    // The stock Model I has no lowercase, so the title reads in capitals.
    expect(screen).toContain('BY: WAYNE WESTMORELAND & TERRY GILMAN');
    expect(screen).toContain('(C) COPYRIGHT 1981 ADVENTURE INTERNATIONAL');
    await ok(call, 'key', { keys: ['ENTER'], cps: 1 });
    await ok(call, 'run', { seconds: 3 });
    const next = await ok(call, 'screen', {});
    expect(next).toContain('1 OR 2 PLAYERS?');
    expect(next).not.toContain('ADVENTURE INTERNATIONAL');
    await close();
  });

  it('BASIC typed at the default rate arrives whole', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fugloy-mcp-m1-'));
    try {
      const program = join(dir, 'hello.bas');
      writeFileSync(program, '10 PRINT "FUGLOY ON A MODEL I"\r\n');
      const { call, close } = await connect({ config });
      expect(await ok(call, 'load', { path: program, model: 1 })).toContain('Format: .BAS (ascii)');
      await ok(call, 'run', { seconds: 2 });
      const typed = await ok(call, 'key', { text: 'LIST\nRUN\n' });
      expect(typed.split('\n')[0]).toBe('Typed 9 keys (matrix, 10 cps)');
      const screen = await ok(call, 'screen', {});
      expect(screen).toContain('10 PRINT "FUGLOY ON A MODEL I"');
      expect(screen.match(/^\|?FUGLOY ON A MODEL I/m)).not.toBeNull();
      await close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(scarfman === undefined)('a Model I disk boots to 4200h and on to its title', async () => {
    const { call, close } = await connect({ config });
    const manifest = await ok(call, 'load', { path: /** @type {string} */ (scarfman), model: 1 });
    expect(manifest).toContain('Entry: none (the ROM boots from drive 0: track 0, sector 0 runs at 4200h)');
    expect(manifest).toMatch(/\nBoot: the ROM read the boot sector and jumped to 4200h after \d+\.\d{3} s emulated;/);
    let screen = '';
    for (let i = 0; i < 6 && !screen.includes('PHILIP OLIVER'); i++) {
      await ok(call, 'run', { until: 'settled' });
      screen = await ok(call, 'screen', {});
    }
    expect(screen).toContain('WRITTEN BY PHILIP OLIVER');
    await close();
  });

  it.skipIf(config.roms.model3 === undefined)('a Model III ROM named as roms.model1 is refused naming its model', async () => {
    const wrong = { ...config, roms: { ...config.roms, model1: /** @type {string} */ (config.roms.model3) } };
    const { call, close } = await connect({ config: wrong });
    const r = await call('load', { path: eliminator, model: 1 });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/^The configured roms\.model1 \S.* cannot run the Model I: this ROM is the Model III ROM \(model3-[a-z0-9-]+\); it runs on the Model III, not the Model I; load with model 3, or fix roms\.model1 in .+\.$/);
    await close();
  });
});
