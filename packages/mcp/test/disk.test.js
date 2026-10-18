/**
 * `load` of a disk image (docs/fugloy-mcp-spec.md §5, Lifecycle; the emu phase 5 plan's Ruling 4):
 * detected from its content (DMK header, JV3 sector table, JV1 size), put in drive 0 of a fresh
 * Model III, and booted until the ROM jumps to the boot sector at 4300h. CI runs these on a
 * synthetic disk-boot ROM and synthetic images (a JV1 built here, the committed DMK and JV3
 * samples in fixtures/synthetic/disk/); the last suite boots a local dual-boot DMK on the real
 * Model III ROM when fugloy.mcp.json names both, and skips without them. Properties only for the
 * real disk: a transcript would carry its screen text.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { diskContainer, formatOf } from '../src/tools/load.js';
import { bootJv1, buildCmd, connect, diskBootRom, syntheticRom, testConfig } from './helpers.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const samples = join(repo, 'fixtures/synthetic/disk');
const MESSAGE = 'FUGLOY MCP DISK BOOT';
const HALT = buildCmd([{ addr: 0x7000, data: [0x76] }], 0x7000);

let dir;
const at = (/** @type {string} */ name) => join(dir, name);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fugloy-mcp-disk-'));
  writeFileSync(at('disk.rom'), diskBootRom());
  writeFileSync(at('synthetic.rom'), syntheticRom());
  writeFileSync(at('boot.dsk'), bootJv1(MESSAGE));
  writeFileSync(at('halt.cmd'), HALT);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function server(rom = 'disk.rom') {
  return connect({ config: testConfig({ roms: { model3: at(rom) } }) });
}

async function ok(call, name, args) {
  const r = await call(name, args);
  if (r.isError) throw new Error(`${name} failed: ${r.text}`);
  return r.text;
}

describe('load with a disk image', () => {
  it('detects JV1, JV3, and DMK from the content, and still tells the programs apart', () => {
    expect(formatOf(bootJv1(MESSAGE))).toBe('dsk');
    expect(diskContainer(bootJv1(MESSAGE))).toBe('jv1');
    expect(diskContainer(readFileSync(join(samples, 'jv3-mixed.dsk')))).toBe('jv3');
    expect(diskContainer(readFileSync(join(samples, 'dmk-dd-ds.dmk')))).toBe('dmk');
    for (const f of readdirSync(samples)) expect(formatOf(new Uint8Array(readFileSync(join(samples, f))))).toBe('dsk');
    expect(formatOf(HALT)).toBe('cmd');
    expect(diskContainer(HALT)).toBe(null);
    // A JV1 is only a size, so one byte more is not a disk.
    expect(formatOf(new Uint8Array(40 * 18 * 256 + 1))).toBe(null);
    // Every committed example program stays a program.
    for (const sub of readdirSync(join(repo, 'examples'))) {
      const folder = join(repo, 'examples', sub);
      for (const f of existsSync(folder) ? readdirSync(folder).filter((n) => /\.cmd$/i.test(n)) : []) {
        expect(formatOf(new Uint8Array(readFileSync(join(folder, f)))), f).toBe('cmd');
      }
    }
  });

  it('mounts a JV1 in drive 0 and boots it', async () => {
    const { call, close } = await server();
    const lines = (await ok(call, 'load', { path: at('boot.dsk') })).split('\n');
    expect(lines[4]).toMatch(/^ROM: unrecognised \(SHA-256 [0-9a-f]{16}…\)$/);
    expect(lines[5]).toMatch(/^Boot: the ROM read the boot sector and jumped to 4300h after \d+\.\d{3} s emulated; the disk's loader reads the rest as the machine runs, so call run with until "settled" \(again if the screen is still loading: a disk can take 10 s emulated or more\)$/);
    expect(lines).toEqual([
      `Loaded BOOT from ${at('boot.dsk')}`,
      'Format: disk image (JV1, 40 tracks, 1 side, 18 sectors a track), in drive 0',
      "Blocks: none yet (the ROM and the disk's own loader read sectors into memory as the machine runs)",
      'Entry: none (the ROM boots from drive 0: track 0, sector 1 runs at 4300h)',
      lines[4],
      lines[5],
      `Sidecar: none yet; label writes ${at('boot.fugloy.json')}`,
      `Path: ${at('boot.dsk')}`,
    ]);
    expect((await ok(call, 'regs', {})).split('\n')[0]).toMatch(/^PC 4300  /);
    expect(await ok(call, 'status', {})).toContain(`Program: BOOT (${at('boot.dsk')})`);
    const settled = await ok(call, 'run', { until: 'settled' });
    expect(settled.split('\n')[0]).toMatch(/^stopped: settled \(/);
    expect(await ok(call, 'screen', {})).toContain(MESSAGE);
    // Coverage runs from the boot sector on; a disk loads no blocks, so its code counts as outside them.
    const coverage = await ok(call, 'coverage', {});
    expect(coverage).toContain("Loaded: no blocks (a disk image is read into memory by the ROM and the disk's own loader as the machine runs, not loaded as blocks, so what it ran counts as outside them)");
    expect(coverage).toMatch(/\nOutside the loaded blocks: \d+ bytes executed/);
    await close();
  });

  it('names the container and geometry of a DMK and a JV3', async () => {
    const { call, close } = await server();
    expect(await ok(call, 'load', { path: join(samples, 'dmk-dd-ds.dmk') })).toMatch(/\nFormat: disk image \(DMK, \d+ tracks, 2 sides, \d+ sectors a track\), in drive 0\n/);
    expect(await ok(call, 'load', { path: join(samples, 'jv3-mixed.dsk') })).toMatch(/\nFormat: disk image \(JV3, \d+ tracks, \d sides?, [^)]+\), in drive 0\n/);
    await close();
  });

  it('says so when the ROM never reaches the boot sector', async () => {
    const { call, close } = await server('synthetic.rom');
    const text = await ok(call, 'load', { path: at('boot.dsk') });
    expect(text).toContain('\nBoot: the ROM did not reach the boot sector at 4300h within 5 s emulated (the PC is 0003h); ');
    await close();
  });

  it('with reset: false puts the disk in drive 0 of the running machine, and reset boots it', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('halt.cmd') });
    const text = await ok(call, 'load', { path: at('boot.dsk'), reset: false });
    expect(text).toContain('\nBoot: none (reset: false puts the disk in drive 0 of the running machine; call reset to boot from it)\n');
    expect((await ok(call, 'regs', {})).split('\n')[0]).toMatch(/^PC 7000  /);
    await ok(call, 'reset', {});
    await ok(call, 'run', { until: 'settled' });
    expect(await ok(call, 'screen', {})).toContain(MESSAGE);
    await close();
  });

  it('refuses a file that is neither a program nor a disk image, naming both', async () => {
    const { call, close } = await server();
    writeFileSync(at('junk.bin'), new Uint8Array(1000).fill(0x99));
    expect((await call('load', { path: at('junk.bin') })).text).toBe(
      `${at('junk.bin')} is not a .CMD, .BAS, or .CAS program or a JV1, JV3, or DMK disk image as far as its content shows (the extension is not consulted); raw memory images cannot be loaded.`,
    );
    await close();
  });
});

// The real Model III ROM and a local dual-boot DMK (fixtures/real is gitignored); skipped without them.
const config = loadConfig({ cwd: repo, env: process.env, home: homedir() });
const rearGuard = config.fixtures === undefined || !existsSync(config.fixtures)
  ? undefined
  : readdirSync(config.fixtures, { recursive: true, encoding: 'utf8' }).find((f) => /rrgarddb\.dmk$/i.test(f));

describe.skipIf(config.roms.model3 === undefined || rearGuard === undefined)('load with a real disk on the Model III ROM', { timeout: 60_000 }, () => {
  it('boots the Rear Guard dual-boot DMK to its menu, and ENTER loads the game to its title', async () => {
    const { call, close } = await connect({ config });
    const path = join(/** @type {string} */ (config.fixtures), /** @type {string} */ (rearGuard));
    const manifest = await ok(call, 'load', { path });
    expect(manifest).toMatch(/\nFormat: disk image \(DMK, 40 tracks, 1 side, sectors a track varying\), in drive 0\n/);
    expect(manifest).toMatch(/\nBoot: the ROM read the boot sector and jumped to 4300h after \d+\.\d{3} s emulated; /);
    await ok(call, 'run', { until: 'settled' });
    expect(await ok(call, 'screen', {})).toContain('Duo-Loader');
    // The loader reads the keyboard slowly: hold ENTER half a second, as for Sea Dragon.
    await ok(call, 'key', { keys: ['ENTER'], cps: 1 });
    let title = '';
    for (let i = 0; i < 4 && !title.includes('to begin'); i++) {
      await ok(call, 'run', { until: 'settled' });
      title = await ok(call, 'screen', {});
    }
    expect(title).toContain('BY: Wayne Westmoreland & Terry Gilman');
    expect(title).toContain('to begin');
    await close();
  });
});
