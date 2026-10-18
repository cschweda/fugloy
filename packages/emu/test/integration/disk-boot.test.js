/**
 * Disk Boot Acceptance Test
 *
 * Mounts a synthesized JV1 floppy whose track-0 boot sector is real Z80
 * code (writes "DISK BOOT OK" into video RAM, then spins), and proves the
 * ROM's entire disk-boot handshake works against the WD1793 model:
 * controller detection, RESTORE, sector read via the DRQ pump, and the
 * jump into the loaded boot sector.
 *
 * Then the emu phase 5 done-criterion on the local disk images (the
 * plan's Ruling 1; fixtures/real is gitignored, and each image skips when
 * it is missing): the dual-boot DMKs boot to their loader's menu (the DOS
 * stand-in, as no TRSDOS 1.3 image is present), a game reaches its title
 * from disk, and a disk session repeats byte for byte.
 */

import path from "node:path";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { configuredFixtures, configuredRom, ROM_TEST_TIMEOUT } from "../rom.js";
import { Machine } from "../../src/index.js";
import { TRS80System, CPU_CLOCK_HZ } from "../../src/machine/trs80-system.js";
import { DiskImage } from "../../src/devices/disk-image.js";

// The ROM from fugloy.mcp.json; null without one, and the suite skips.
const romData = configuredRom("model3");

const BOOT_MSG = "DISK BOOT OK";

/**
 * A 40-track, 18-sector JV1 image whose first sector (the one the boot
 * ROM loads to 0x4200 and jumps to) copies BOOT_MSG to the top of the
 * screen and loops.
 */
function buildBootDisk() {
  const bytes = new Uint8Array(40 * 18 * 256);
  const org = 0x4300; // the Model III ROM loads the boot sector here
  const msgOffset = 0x20;
  const code = [
    0x21, (org + msgOffset) & 0xff, (org + msgOffset) >> 8, // LD HL, msg
    0x11, 0x00, 0x3c, // LD DE, 0x3C00
    0x01, BOOT_MSG.length, 0x00, // LD BC, len
    0xed, 0xb0, // LDIR
    0x18, 0xfe, // JR $
  ];
  bytes.set(code, 0);
  bytes.set(
    BOOT_MSG.split("").map((c) => c.charCodeAt(0)),
    msgOffset
  );
  return new DiskImage(bytes, "bootdisk");
}

function runUntilScreen(system, text, maxSeconds = 4) {
  const slice = Math.round(CPU_CLOCK_HZ / 20);
  const slices = Math.ceil((maxSeconds * CPU_CLOCK_HZ) / slice);
  for (let i = 0; i < slices; i++) {
    if (system.screenText().join("\n").includes(text)) return true;
    system.runTStates(slice);
  }
  return system.screenText().join("\n").includes(text);
}

describe.skipIf(romData === null)("Disk boot (drive 0)", { timeout: ROM_TEST_TIMEOUT }, () => {
  it("boots the synthesized floppy's boot sector via the real ROM", () => {
    const system = new TRS80System({ romData });
    system.cpu.strictMode = true;
    system.mountDisk(0, buildBootDisk());
    system.reset();

    const booted = runUntilScreen(system, BOOT_MSG);

    if (!booted) {
      console.log("Screen:\n" + system.screenText().join("\n"));
      console.log(
        "PC=0x" + system.cpu.registers.PC.toString(16).padStart(4, "0"),
        "FDC status=0x" + system.io.fdc.status.toString(16),
        "track=" + system.io.fdc.physicalTrack[0],
        "sector=" + system.io.fdc.sectorReg
      );
    }
    expect(booted).toBe(true);
  });

  it("still boots to cassette BASIC when no disk is mounted", () => {
    const system = new TRS80System({ romData });
    system.cpu.strictMode = true;
    system.reset();

    expect(runUntilScreen(system, "Cass?")).toBe(true);
  });
});

/** The one local image whose path matches `pattern`, or null (the test skips). */
const image = (pattern) => configuredFixtures(pattern)[0] ?? null;
const DISKS = {
  eliminatorDual: image(/elimn8db\.dmk$/i),
  rearGuardDual: image(/rrgarddb\.dmk$/i),
  eliminator: image(/ELIMATOR\.dsk$/),
  scarfman: image(/SCARFMAN\.DSK$/i),
};

/** A Model III on the configured ROM, booting from the image at `path` in drive 0. */
function bootFrom(path) {
  const m = new Machine({ roms: { level2: /** @type {Uint8Array} */ (romData) } });
  const manifest = m.load.dsk(new Uint8Array(readFileSync(path)));
  expect(manifest).toEqual({ format: "dsk", container: "dmk", drive: 0, boot: true, blocks: [] });
  return m;
}

const text = (m) => m.video.text().join("\n");

/**
 * Run until the screen shows `want` or `seconds` of emulated time pass, looking every 1/20 s
 * (reading the screen after each instruction would cost more than running); whether it showed.
 */
function runTo(m, want, seconds) {
  const slice = CPU_CLOCK_HZ / 20;
  for (let t = 0; t < seconds * 20; t++) {
    if (text(m).includes(want)) return true;
    m.run({ cycles: slice });
  }
  return text(m).includes(want);
}

/** The Duo-Loader menu, then ENTER held half a second (the loader polls slowly), then the game's title. */
function loadGame(path, title) {
  const m = bootFrom(path);
  expect(runTo(m, "Press [ENTER] to load program.", 3)).toBe(true);
  m.keyboard.type("\n", { cps: 1 });
  expect(runTo(m, title, 15)).toBe(true);
  m.run({ cycles: CPU_CLOCK_HZ / 2 }); // the rest of a title drawn in pieces
  return m;
}

describe.skipIf(romData === null)("Booting the local disk images (phase 5 done-criterion)", { timeout: ROM_TEST_TIMEOUT }, () => {
  // The loader on Westmoreland and Gilman's dual-boot disks, the DOS stand-in of Ruling 1.
  it.skipIf(DISKS.eliminatorDual === null)("the Eliminator dual-boot DMK boots to its Duo-Loader menu", () => {
    const m = bootFrom(DISKS.eliminatorDual);
    expect(runTo(m, "Press [ENTER] to load program.", 3)).toBe(true);
    const screen = text(m);
    expect(screen).toContain("Model I/III  Duo-Loader (tm)");
    expect(screen).toContain("*****  E L I M I N A T O R  *****");
  });

  it.skipIf(DISKS.rearGuardDual === null)("the Rear Guard dual-boot DMK boots to its Duo-Loader menu", () => {
    const m = bootFrom(DISKS.rearGuardDual);
    expect(runTo(m, "Press [ENTER] to load program.", 3)).toBe(true);
    expect(text(m)).toContain("Model I/III  Duo-Loader (tm)");
  });

  it.skipIf(DISKS.eliminator === null)("the Eliminator DMK boots to its Duo-Loader menu", () => {
    const m = bootFrom(DISKS.eliminator);
    expect(runTo(m, "Press [ENTER] to load program.", 3)).toBe(true);
    expect(text(m)).toContain("Model I/III  Duo-Loader (tm)");
  });

  it.skipIf(DISKS.eliminatorDual === null)("Eliminator loads from its dual-boot disk to its title", () => {
    const screen = text(loadGame(DISKS.eliminatorDual, "BY: Wayne Westmoreland & Terry Gilman"));
    expect(screen).toContain("(C) Copyright 1981 Adventure International");
    expect(screen).toContain(" to Start ");
  });

  it.skipIf(DISKS.rearGuardDual === null)("Rear Guard loads from its dual-boot disk to its title", () => {
    const screen = text(loadGame(DISKS.rearGuardDual, "BY: Wayne Westmoreland & Terry Gilman"));
    expect(screen).toContain("(C) Copyright 1982");
    expect(screen).toContain(" to begin ");
  });

  it.skipIf(DISKS.scarfman === null)("Scarfman boots from disk to its title", () => {
    const m = bootFrom(DISKS.scarfman);
    expect(runTo(m, "WRITTEN BY PHILIP OLIVER", 15)).toBe(true);
    expect(text(m)).toContain("(C)(P) 1981 THE CORNSOFT GROUP");
  });

  it.skipIf(DISKS.scarfman === null)("a disk session repeats byte for byte: Scarfman for 16 s, twice", () => {
    const session = () => {
      const m = bootFrom(DISKS.scarfman);
      m.run({ cycles: 16 * CPU_CLOCK_HZ }); // past the title into the game's attract play
      return JSON.stringify(m.debug.snapshot());
    };
    expect(session()).toBe(session());
  });

  it.skipIf(DISKS.rearGuardDual === null)("a disk session with a key repeats byte for byte: Rear Guard to its title, twice", () => {
    const session = () => {
      const m = loadGame(DISKS.rearGuardDual, "BY: Wayne Westmoreland & Terry Gilman");
      m.run({ cycles: CPU_CLOCK_HZ });
      return { cycles: m.cycles, state: JSON.stringify(m.debug.snapshot()) };
    };
    expect(session()).toEqual(session());
  });
});
