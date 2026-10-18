/**
 * Emu phase 6b, Task 3: Model III disks boot on the Model 4. Its ROM (roms.model4 in
 * fugloy.mcp.json, gitignored) starts it in Model III mode, memory map 0 at 2 MHz, and boots drive
 * 0 as the Model III ROM does (track 0, sector 1 to $4300). The local images are in the gitignored
 * fixtures/real, found as disk-boot.test.js finds them (the config's `fixtures` folder); each test
 * skips when its image or the ROM is missing. The dual-boot DMKs reach their Duo-Loader menu and
 * load the game to its title; Scarfman reaches its title. The machine stays in Model III mode
 * throughout (map 0, 2 MHz), as these programs never touch ports $84 or $EC bit 6.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Machine } from '../../src/index.js';
import { configuredFixtures, configuredRom, ROM_TEST_TIMEOUT } from '../rom.js';

const romData = configuredRom('model4');
const HZ = 2027520;

/** The one local image whose path matches `pattern`, or null (the test skips). */
const image = (pattern) => configuredFixtures(pattern)[0] ?? null;
const DISKS = {
  eliminatorDual: image(/elimn8db\.dmk$/i),
  rearGuardDual: image(/rrgarddb\.dmk$/i),
  scarfman: image(/SCARFMAN\.DSK$/i),
};

/** A Model 4 on the configured ROM, booting from the image at `path` in drive 0. */
function bootFrom(path) {
  const m = new Machine({ model: 4, roms: { level2: /** @type {Uint8Array} */ (romData) } });
  const manifest = m.load.dsk(new Uint8Array(readFileSync(path)));
  expect(manifest).toMatchObject({ format: 'dsk', drive: 0, boot: true, blocks: [] });
  return m;
}

const text = (m) => m.video.text().join('\n');

/** Run until the screen shows `want` or `seconds` of emulated time pass, looking every 1/20 s. */
function runTo(m, want, seconds) {
  const slice = HZ / 20;
  for (let t = 0; t < seconds * 20; t++) {
    if (text(m).includes(want)) return true;
    m.run({ cycles: slice });
  }
  return text(m).includes(want);
}

/** Still in Model III mode: memory map 0, the 2 MHz clock, 64 by 16. */
function inModel3Mode(m) {
  expect(m.system.memory.map).toBe(0);
  expect(m.clockHz).toBe(HZ);
  expect(m.video.columns).toBe(64);
}

/** The Duo-Loader menu, then ENTER held half a second, then the game's title. */
function loadGame(path, title) {
  const m = bootFrom(path);
  expect(runTo(m, 'Press [ENTER] to load program.', 3)).toBe(true);
  expect(text(m)).toContain('Model I/III  Duo-Loader (tm)');
  m.keyboard.type('\n', { cps: 1 });
  expect(runTo(m, title, 15)).toBe(true);
  m.run({ cycles: HZ / 2 });
  return m;
}

describe.skipIf(romData === null)('Model III disks boot on the Model 4 (its ROM, in Model III mode)', { timeout: ROM_TEST_TIMEOUT * 2 }, () => {
  it.skipIf(DISKS.eliminatorDual === null)('Eliminator loads from its dual-boot disk to its title', () => {
    const m = loadGame(DISKS.eliminatorDual, 'BY: Wayne Westmoreland & Terry Gilman');
    expect(text(m)).toContain('(C) Copyright 1981 Adventure International');
    inModel3Mode(m);
  });

  it.skipIf(DISKS.rearGuardDual === null)('Rear Guard loads from its dual-boot disk to its title', () => {
    const m = loadGame(DISKS.rearGuardDual, 'BY: Wayne Westmoreland & Terry Gilman');
    expect(text(m)).toContain('(C) Copyright 1982');
    inModel3Mode(m);
  });

  it.skipIf(DISKS.scarfman === null)('Scarfman boots from disk to its title', () => {
    const m = bootFrom(DISKS.scarfman);
    expect(runTo(m, 'WRITTEN BY PHILIP OLIVER', 15)).toBe(true);
    expect(text(m)).toContain('(C)(P) 1981 THE CORNSOFT GROUP');
    inModel3Mode(m);
  });
});
