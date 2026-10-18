/**
 * Emu phase 6, Task 3, on the real Model I Level II ROM (roms.model1 in fugloy.mcp.json; the
 * suite skips without it): the ROM's disk boot (MDL1LEV2.Z80, BOOT at $069F) through the WD1771
 * reads a synthetic JV1's track 0, sector 0 to $4200 and runs it; and the local disk images in
 * fixtures/real (gitignored; each skips when missing) boot on the Model I: the dual-boot DMKs and
 * the Eliminator DMK to their Duo-Loader menu and on to the game's title, Scarfman to its title,
 * and a Model I disk session repeats byte for byte. The stock Model I shows no lowercase, so the
 * screens read in capitals where the Model III's show mixed case.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { configuredFixtures, configuredRom, ROM_TEST_TIMEOUT } from '../rom.js';
import { Machine } from '../../src/index.js';
import { MODEL1_BOOT_ORG, bootSector, writeJv1 } from '../unit/disk-writers.js';

const romData = configuredRom('model1');
const HZ = 1774080;

const image = (/** @type {RegExp} */ pattern) => configuredFixtures(pattern)[0] ?? null;
const DISKS = {
  eliminatorDual: image(/elimn8db\.dmk$/i),
  rearGuardDual: image(/rrgarddb\.dmk$/i),
  eliminator: image(/ELIMATOR\.dsk$/),
  scarfman: image(/SCARFMAN\.DSK$/i),
};

const model1 = () => new Machine({ model: 1, roms: { level2: /** @type {Uint8Array} */ (romData) } });
const text = (/** @type {Machine} */ m) => m.video.text().join('\n');

/** Run until the screen shows `want` or `seconds` pass, looking every 1/20 s; whether it showed. */
function runTo(m, want, seconds) {
  for (let t = 0; t < seconds * 20; t++) {
    if (text(m).includes(want)) return true;
    m.run({ cycles: HZ / 20 });
  }
  return text(m).includes(want);
}

/** A Model I booting from the image at `path` in drive 0. */
function bootFrom(path) {
  const m = model1();
  expect(m.load.dsk(new Uint8Array(readFileSync(path)))).toEqual({ format: 'dsk', container: 'dmk', drive: 0, boot: true, blocks: [] });
  return m;
}

/** The Duo-Loader menu, ENTER, then the game's title. */
function loadGame(path, title) {
  const m = bootFrom(path);
  expect(runTo(m, 'TO LOAD PROGRAM.', 6)).toBe(true);
  m.keyboard.type('\n', { cps: 1 });
  expect(runTo(m, title, 15)).toBe(true);
  m.run({ cycles: HZ / 2 });
  return m;
}

describe.skipIf(romData === null)('the Model I boots from disk through the WD1771', { timeout: ROM_TEST_TIMEOUT }, () => {
  it("the Level II ROM boots a synthetic JV1's track 0, sector 0", () => {
    const m = model1();
    const disk = writeJv1({ tracks: 35, spt: 10, fill: (t, side, s) => (t === 0 && s === 0 ? bootSector('MODEL I DISK BOOT OK', MODEL1_BOOT_ORG) : null) });
    expect(m.load.dsk(disk)).toMatchObject({ container: 'jv1', boot: true });
    expect(runTo(m, 'MODEL I DISK BOOT OK', 4)).toBe(true);
    expect(m.cpu.regs.pc).toBeGreaterThanOrEqual(MODEL1_BOOT_ORG);
  });

  it('with no disk mounted it still starts Level II BASIC', () => {
    const m = model1();
    expect(runTo(m, 'MEM', 3)).toBe(true);
  });

  it.skipIf(DISKS.eliminatorDual === null)('the Eliminator dual-boot DMK boots to its Duo-Loader menu', () => {
    const m = bootFrom(DISKS.eliminatorDual);
    expect(runTo(m, 'PRESS <ENTER> TO LOAD PROGRAM.', 6)).toBe(true);
    expect(text(m)).toContain('MODEL I/III  DUO-LOADER (TM)');
    expect(text(m)).toContain('*****  E L I M I N A T O R  *****');
  });

  it.skipIf(DISKS.rearGuardDual === null)('the Rear Guard dual-boot DMK boots to its Duo-Loader menu', () => {
    const m = bootFrom(DISKS.rearGuardDual);
    expect(runTo(m, 'PRESS <ENTER> TO LOAD PROGRAM.', 6)).toBe(true);
    expect(text(m)).toContain('MODEL I/III  DUO-LOADER (TM)');
  });

  it.skipIf(DISKS.eliminator === null)('the Eliminator DMK boots to its Duo-Loader menu', () => {
    const m = bootFrom(DISKS.eliminator);
    expect(runTo(m, 'TO LOAD PROGRAM.', 6)).toBe(true);
    expect(text(m)).toContain('MODEL I/III  DUO-LOADER (TM)');
  });

  it.skipIf(DISKS.eliminatorDual === null)('Eliminator loads from its dual-boot disk to its title', () => {
    const m = loadGame(DISKS.eliminatorDual, 'BY: WAYNE WESTMORELAND & TERRY GILMAN');
    expect(text(m)).toContain('(C) COPYRIGHT 1981 ADVENTURE INTERNATIONAL');
    expect(runTo(m, 'PRESS <ENTER> TO START', 4)).toBe(true);
  });

  it.skipIf(DISKS.eliminator === null)('Eliminator loads from its DMK to its title', () => {
    const m = loadGame(DISKS.eliminator, 'BY: WAYNE WESTMORELAND & TERRY GILMAN');
    expect(text(m)).toContain('(C) COPYRIGHT 1981 ADVENTURE INTERNATIONAL');
  });

  it.skipIf(DISKS.rearGuardDual === null)('Rear Guard loads from its dual-boot disk to its title', () => {
    const m = loadGame(DISKS.rearGuardDual, 'BY: WAYNE WESTMORELAND & TERRY GILMAN');
    expect(text(m)).toContain('(C) COPYRIGHT 1982');
    expect(runTo(m, 'HIT <ENTER> TO BEGIN', 4)).toBe(true);
  });

  it.skipIf(DISKS.scarfman === null)('Scarfman boots from disk to its title', () => {
    const m = bootFrom(DISKS.scarfman);
    expect(runTo(m, 'WRITTEN BY PHILIP OLIVER', 15)).toBe(true);
    expect(text(m)).toContain('(C)(P) 1981 THE CORNSOFT GROUP');
  });

  it.skipIf(DISKS.scarfman === null)('a debug run equals a plain one: Scarfman for 6 s with coverage, a trace, a watch over $37E0-$37EF, and both memory hooks', () => {
    const session = (debug) => {
      const m = model1();
      let accesses = 0;
      if (debug) {
        m.debug.coverage.enable();
        m.debug.trace.enable({ depth: 10000 });
        m.debug.watch(0x37e0, 16, { read: true, write: true });
        m.debug.hooks.onMemRead = () => accesses++;
        m.debug.hooks.onMemWrite = () => accesses++;
      }
      m.load.dsk(new Uint8Array(readFileSync(/** @type {string} */ (DISKS.scarfman))));
      m.run({ cycles: 6 * HZ });
      if (debug) {
        expect(accesses).toBeGreaterThan(0);
        expect(m.debug.hits().length).toBeGreaterThan(0);
      }
      return JSON.stringify(m.debug.snapshot());
    };
    expect(session(true)).toBe(session(false));
  });

  it.skipIf(DISKS.scarfman === null)('a Model I disk session repeats byte for byte: Scarfman for 12 s, twice', () => {
    const session = () => {
      const m = bootFrom(DISKS.scarfman);
      m.run({ cycles: 12 * HZ });
      return JSON.stringify(m.debug.snapshot());
    };
    expect(session()).toBe(session());
  });
});
