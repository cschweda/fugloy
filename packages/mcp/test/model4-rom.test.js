/**
 * The Model 4 through the MCP server on its real ROM (roms.model4 in the repository's
 * fugloy.mcp.json, gitignored; the suite skips without it), emu phase 6b, Task 3: Sea Dragon from
 * examples/ loads on a Model 4 booted to READY in Model III mode, reaches its title, and answers
 * ENTER; a Model III disk in fixtures/real boots to 4300h and on to its title; and a Model III ROM
 * named as roms.model4 is refused with a sentence saying which model it belongs to. Properties
 * only: a transcript would carry ROM text.
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { connect } from './helpers.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const config = loadConfig({ cwd: repo, env: process.env, home: homedir() });
const seaDragon = join(repo, 'examples/sea-dragon/seadrg01.cmd');

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

describe.skipIf(config.roms.model4 === undefined)('the MCP server on the Model 4 ROM', { timeout: 60_000 }, () => {
  it('Sea Dragon loads on the Model 4, reaches its title, and answers ENTER', async () => {
    const { call, session, close } = await connect({ config });
    const manifest = await ok(call, 'load', { path: seaDragon, model: 4 });
    expect(manifest).toContain('Model: Model 4 (128K; its ROM boots it in Model III mode: memory map 0, 2 MHz, 64 by 16)');
    expect(manifest).toContain('\nROM: model4-trs32\n');
    expect(manifest).toMatch(/\nBoot: READY after \d+\.\d{3} s emulated\n/);
    let screen = '';
    for (let i = 0; i < 4 && !screen.includes('Westmoreland'); i++) {
      await ok(call, 'run', { until: 'settled' });
      screen = await ok(call, 'screen', {});
    }
    expect(screen).toContain('BY: Wayne Westmoreland & Terry Gilman');
    await ok(call, 'key', { keys: ['ENTER'], cps: 1 });
    await ok(call, 'run', { seconds: 3 });
    expect(await ok(call, 'screen', {})).toContain('1 or 2 Players?');
    expect(session.machine?.model).toBe(4);
    await close();
  });

  it.skipIf(scarfman === undefined)('a Model III disk boots on the Model 4 to 4300h and on to its title', async () => {
    const { call, close } = await connect({ config });
    const manifest = await ok(call, 'load', { path: /** @type {string} */ (scarfman), model: 4 });
    expect(manifest).toContain('Entry: none (the ROM boots from drive 0: track 0, sector 1 runs at 4300h)');
    expect(manifest).toMatch(/\nBoot: the ROM read the boot sector and jumped to 4300h after \d+\.\d{3} s emulated;/);
    let screen = '';
    for (let i = 0; i < 6 && !screen.includes('PHILIP OLIVER'); i++) {
      await ok(call, 'run', { until: 'settled' });
      screen = await ok(call, 'screen', {});
    }
    expect(screen).toContain('WRITTEN BY PHILIP OLIVER');
    await close();
  });

  it.skipIf(config.roms.model3 === undefined)('a Model III ROM named as roms.model4 is refused naming its model', async () => {
    const wrong = { ...config, roms: { ...config.roms, model4: /** @type {string} */ (config.roms.model3) } };
    const { call, close } = await connect({ config: wrong });
    const r = await call('load', { path: seaDragon, model: 4 });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/^The configured roms\.model4 \S.* cannot run the Model 4: .*load with model 3, or fix roms\.model4 in .+\.$/);
    await close();
  });
});
