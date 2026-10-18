/**
 * The MCP phase A done-criterion (docs/fugloy-mcp-spec.md §11): an agent loads a game and reaches
 * its title screen, here Sea Dragon from examples/ on the Model III ROM named by the repository's
 * fugloy.mcp.json (gitignored; the suite skips without it). The text asserted is what the emu
 * programs.test.js checks. Properties only: the transcript would carry ROM screen text.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { connect } from './helpers.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const config = loadConfig({ cwd: repo, env: process.env, home: homedir() });
const seaDragon = join(repo, 'examples/sea-dragon/seadrg01.cmd');

async function ok(call, name, args) {
  const r = await call(name, args);
  if (r.isError) throw new Error(`${name} failed: ${r.text}`);
  return r.text;
}

describe.skipIf(config.roms.model3 === undefined)('phase A on the Model III ROM', { timeout: 60_000 }, () => {
  it('Sea Dragon reaches its title screen', async () => {
    const { call, close } = await connect({ config });
    const manifest = await ok(call, 'load', { path: seaDragon });
    expect(manifest).toContain('Format: .CMD (load module)');
    expect(manifest).toMatch(/\nBoot: READY after \d+\.\d{3} s emulated\n/);
    expect(manifest).toMatch(/\nEntry: [0-9A-F]{4}h \(the PC is there now\)\n/);
    expect(manifest).toContain(`Path: ${seaDragon}`);

    // Sea Dragon opens with an animation that loops (settled stops when its cycle closes, about
    // 1.6 s in, before the title), then draws its title in pieces, animates it, and blinks
    // <ENTER>: the second settled stops when that cycle closes, with the title on screen.
    const intro = await ok(call, 'run', { until: 'settled' });
    expect(intro.split('\n')[0]).toMatch(/^stopped: settled \(/);
    expect(intro).toMatch(/\n\d+ cells? changed/);
    expect(await ok(call, 'screen', {})).not.toContain('Westmoreland');
    const settled = await ok(call, 'run', { until: 'settled' });
    expect(settled.split('\n')[0]).toBe('stopped: settled (video RAM returned to a state it held since it first changed: an animation or blink cycle closed)');

    const title = await ok(call, 'screen', {});
    expect(title).toContain('BY: Wayne Westmoreland & Terry Gilman');
    expect(title).toContain('(C) Copyright 1982');

    // ENTER held half a second answers the title, as in the emu test.
    await ok(call, 'key', { keys: ['ENTER'], cps: 1 });
    await ok(call, 'run', { seconds: 3 });
    const next = await ok(call, 'screen', {});
    expect(next).toContain('1 or 2 Players?');
    expect(next).not.toContain('(C) Copyright 1982');
    await close();
  });

  it('an ASCII .BAS program is typed in and runs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fugloy-mcp-rom-'));
    try {
      const program = join(dir, 'hello.bas');
      writeFileSync(program, '10 PRINT "FUGLOY SAYS HI"\r\n');
      const { call, close } = await connect({ config });
      const manifest = await ok(call, 'load', { path: program });
      expect(manifest).toContain('Format: .BAS (ascii)');
      await ok(call, 'run', { seconds: 1 });
      await ok(call, 'key', { text: 'RUN\n', mode: 'hook' });
      expect(await ok(call, 'screen', {})).toContain('FUGLOY SAYS HI');
      await close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
