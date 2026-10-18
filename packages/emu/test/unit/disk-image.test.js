/**
 * .dsk container tests: JV1 geometry inference and sector addressing,
 * JV3 header parsing, in-memory writes; then (emu phase 5) each container
 * read exactly from the committed synthetic images, two IDs sharing a
 * sector number, DMK export through m.fdc.export (a program's writes
 * included), and detection refusing files that are not disk images.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { DiskImage } from "../../src/devices/disk-image.js";
import { Machine } from "../../src/index.js";
import { buildJV1, buildJV3 } from "./disk-builders.js";
import { DISK_SAMPLES, pattern } from "./disk-samples.js";
import { writeDmk, writeJv1, writeJv3 } from "./disk-writers.js";
import { rig, run } from "./fdc-rig.js";

describe("DiskImage - JV1", () => {
  it("infers 40x18 geometry from a 184,320-byte image", () => {
    const disk = new DiskImage(buildJV1({ tracks: 40, spt: 18 }), "trsdos13");

    expect(disk.format).toBe("jv1");
    expect(disk.sectorsPerTrack).toBe(18);
    expect(disk.trackCount()).toBe(40);
  });

  it("infers 35x10 geometry from a Model I-size image", () => {
    const disk = new DiskImage(buildJV1({ tracks: 35, spt: 10 }));

    expect(disk.sectorsPerTrack).toBe(10);
    expect(disk.trackCount()).toBe(35);
  });

  it("18-sector images default to 1-based numbering (TRSDOS style)", () => {
    const disk = new DiskImage(buildJV1({ spt: 18 }));

    const sec = disk.readSector(5, 0, 3);

    expect(sec[0]).toBe(5);
    expect(sec[1]).toBe(2); // sector 3 = third sector = index 2
    expect(disk.sectorBase).toBe(1);
  });

  it("10-sector images default to 0-based numbering (Model I style)", () => {
    const disk = new DiskImage(buildJV1({ tracks: 35, spt: 10 }));

    const sec = disk.readSector(5, 0, 3);

    expect(sec[1]).toBe(3); // sector 3 = index 3
    expect(disk.sectorBase).toBe(0);
  });

  it("the geometry fixes the numbering: no fallback to the other base", () => {
    const disk = new DiskImage(buildJV1({ spt: 18 }));

    // Sector 0 does not exist on a disk numbered 1-18, and asking for it changes nothing.
    expect(disk.readSector(2, 0, 0)).toBeNull();
    expect(disk.sectorBase).toBe(1);
    expect(disk.trackIds(2, 0).map((id) => id.sector)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it("returns null for a missing sector", () => {
    const disk = new DiskImage(buildJV1({ spt: 10 }));

    expect(disk.readSector(0, 0, 10)).toBeNull();
    expect(disk.readSector(99, 0, 0)).toBeNull();
  });

  it("writes sectors in memory", () => {
    const disk = new DiskImage(buildJV1());
    const data = new Uint8Array(256).fill(0xee);

    expect(disk.writeSector(1, 0, 2, data)).toBe(true);
    expect(disk.readSector(1, 0, 2)[10]).toBe(0xee);
  });

  it("honors write protection", () => {
    const disk = new DiskImage(buildJV1());
    disk.writeProtected = true;

    expect(disk.writeSector(0, 0, 0, new Uint8Array(256))).toBe(false);
  });

  it("rejects non-sector-multiple files", () => {
    expect(() => new DiskImage(new Uint8Array(1000))).toThrow(/Unrecognized/);
  });
});

describe("DiskImage - JV3", () => {
  it("parses headers and reads by CHS", () => {
    const disk = new DiskImage(buildJV3({ tracks: 3, spt: 10 }), "jv3disk");

    expect(disk.format).toBe("jv3");
    const sec = disk.readSector(2, 0, 7);
    expect(sec[0]).toBe(2);
    expect(sec[1]).toBe(7);
    expect(disk.trackCount()).toBe(3);
  });

  it("returns null for sectors not in the map", () => {
    const disk = new DiskImage(buildJV3());

    expect(disk.readSector(50, 0, 1)).toBeNull();
  });

  it("honors the write-protect byte (non-0xff = protected)", () => {
    const bytes = buildJV3();
    bytes[2901 * 3] = 0x00; // last header byte: 0xff = writable, else protected

    const disk = new DiskImage(bytes, "protected");

    expect(disk.writeProtected).toBe(true);
    expect(disk.writeSector(0, 0, 0, new Uint8Array(256))).toBe(false);
  });

  it("leaves the disk writable when the write-protect byte is 0xff", () => {
    const disk = new DiskImage(buildJV3());

    expect(disk.writeProtected).toBe(false);
    expect(disk.writeSector(0, 0, 0, new Uint8Array(256).fill(0xaa))).toBe(
      true
    );
  });
});

describe("DiskImage - data address marks", () => {
  // LDOS/TRSDOS-family DOSes mark directory sectors with 0xF8 deleted
  // DAMs and verify the record type on every directory read; the JV3
  // flags byte carries that mark (DD: 0x20 bit; SD: DAM code 0x20-0x60).
  const ddFlags = (dirTrack) => (t) => (t === dirTrack ? 0xa0 : 0x80);

  it("JV3 reports deleted DAM sectors via readSectorEx", () => {
    const disk = new DiskImage(
      buildJV3({ tracks: 22, spt: 10, flagFor: ddFlags(20) }),
      "ldos-style"
    );

    const dir = disk.readSectorEx(20, 0, 3);
    const data = disk.readSectorEx(5, 0, 3);

    expect(dir.deleted).toBe(true);
    expect(dir.data[0]).toBe(20); // stamped track: payload still correct
    expect(data.deleted).toBe(false);
    expect(disk.readSectorEx(50, 0, 0)).toBeNull();
  });

  it("JV3 treats any single-density non-FB DAM code as deleted", () => {
    // Model I TRSDOS 2.3 marks its directory 0xFA (SD flag 0x20)
    const disk = new DiskImage(
      buildJV3({ tracks: 18, spt: 10, flagFor: (t) => (t === 17 ? 0x20 : 0x00) })
    );

    expect(disk.readSectorEx(17, 0, 1).deleted).toBe(true);
    expect(disk.readSectorEx(3, 0, 1).deleted).toBe(false);
  });

  it("JV3 writes can set and clear the deleted DAM, updating the header", () => {
    const disk = new DiskImage(buildJV3({ tracks: 3, spt: 10 }));
    const data = new Uint8Array(256).fill(0x11);

    expect(disk.writeSector(1, 0, 4, data, { deleted: true })).toBe(true);
    expect(disk.readSectorEx(1, 0, 4).deleted).toBe(true);
    // The flag must live in the image bytes so an exported .dsk keeps it
    const reparsed = new DiskImage(disk.bytes, "roundtrip");
    expect(reparsed.readSectorEx(1, 0, 4).deleted).toBe(true);

    expect(disk.writeSector(1, 0, 4, data, { deleted: false })).toBe(true);
    expect(disk.readSectorEx(1, 0, 4).deleted).toBe(false);
    expect(new DiskImage(disk.bytes).readSectorEx(1, 0, 4).deleted).toBe(false);
  });

  it("JV1 synthesizes deleted DAMs on the boot sector's directory track", () => {
    const bytes = buildJV1({ tracks: 40, spt: 18 });
    bytes[2] = 20; // boot sector byte 2 names the directory cylinder

    const disk = new DiskImage(bytes, "jv1-dir20");

    expect(disk.readSectorEx(20, 0, 3).deleted).toBe(true);
    expect(disk.readSectorEx(17, 0, 3).deleted).toBe(false);
    expect(disk.readSectorEx(0, 0, 1).deleted).toBe(false);
  });

  it("JV1 falls back to track 17 when byte 2 is implausible", () => {
    const disk = new DiskImage(buildJV1({ tracks: 40, spt: 18 }));
    // buildJV1 stamps byte 2 with 0 (sector payload), which is no track

    expect(disk.readSectorEx(17, 0, 3).deleted).toBe(true);
    expect(disk.readSectorEx(20, 0, 3).deleted).toBe(false);
  });

  it("readSector keeps its plain-bytes contract", () => {
    const disk = new DiskImage(
      buildJV3({ tracks: 22, spt: 10, flagFor: ddFlags(20) })
    );

    const sec = disk.readSector(20, 0, 3);
    expect(sec).toBeInstanceOf(Uint8Array);
    expect(sec[0]).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Emu phase 5, Task 3: the three containers read exactly, and DMK export.
// The images are the committed samples of disk-samples.js (fixtures/synthetic/disk/).

const SAMPLE_DIR = fileURLToPath(new URL("../../../../fixtures/synthetic/disk/", import.meta.url));
const sample = (name) => new DiskImage(DISK_SAMPLES[name].build(), name);
const bytesOf = (a) => Array.from(a ?? []);

/** Every track side's IDs of a disk, with each sector's data read by the ID's place. */
function everySector(disk) {
  const out = [];
  for (let t = 0; t < disk.trackCount(); t++) {
    for (let side = 0; side < disk.sideCount(); side++) {
      for (const id of disk.trackIds(t, side)) {
        out.push({ t, side, id, read: disk.readSectorEx(t, side, id.sector, id.index) });
      }
    }
  }
  return out;
}

describe("the committed synthetic disk images", () => {
  for (const [name, { build }] of Object.entries(DISK_SAMPLES)) {
    it(`${name} matches its writer`, () => {
      const file = join(SAMPLE_DIR, name);
      expect(existsSync(file), `${file} is missing: run pnpm fixtures`).toBe(true);
      if (!Buffer.from(build()).equals(readFileSync(file))) {
        throw new Error(`${file} differs from what its writer produces: run pnpm fixtures (or node packages/emu/scripts/write-disk-fixtures.mjs) and commit the result`);
      }
    });

    it(`${name}: every sector reads as the writer wrote it`, () => {
      const disk = new DiskImage(readFileSync(join(SAMPLE_DIR, name)), name);
      const all = everySector(disk);
      expect(all.length).toBeGreaterThan(0);
      for (const { t, side, id, read } of all) {
        expect(read, `track ${t} side ${side} sector ${id.sector}`).not.toBeNull();
        expect(bytesOf(read.data)).toEqual(pattern(t, side, id.sector));
        expect(read.dam).toBe(id.dam);
        expect(read.deleted).toBe(id.deleted);
      }
    });

    it(`${name}: the controller reads every sector of its first tracks the same, with the status the image calls for`, () => {
      const disk = new DiskImage(readFileSync(join(SAMPLE_DIR, name)), name);
      const io = rig(disk);
      for (const { t, side, id } of everySector(disk).filter((x) => x.t < 3)) {
        io.fdc.physicalTrack[0] = t;
        io.writePort(0xf1, id.track);
        io.writePort(0xf4, 0x01 | (side ? 0x10 : 0) | (id.mfm === false ? 0 : 0x80));
        io.writePort(0xf2, id.sector);
        const r = run(io, 0x80, { lag: 32 });
        const where = `track ${t} side ${side} sector ${id.sector}`;
        expect(r.bytes, where).toEqual(pattern(t, side, id.sector));
        expect(r.status & 0x3c, where).toBe((id.deleted ? 0x20 : 0) | (id.dataCrcOk ? 0 : 0x08));
      }
    });
  }
});

describe("JV1 exactly", () => {
  it("10 single-density sectors numbered 0-9 on 35 tracks; JV1 records no density", () => {
    const disk = sample("jv1-sd-35x10.dsk");
    expect([disk.format, disk.trackCount(), disk.sideCount(), disk.sectorsPerTrack, disk.sectorBase]).toEqual(["jv1", 35, 1, 10, 0]);
    const ids = disk.trackIds(4, 0);
    expect(ids.map((id) => id.sector)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(ids.every((id) => id.mfm === null && id.size === 256 && id.sizeCode === 1 && id.idCrcOk && id.dataCrcOk)).toBe(true);
    expect(ids.map((id) => id.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(disk.readSector(4, 0, 10)).toBeNull(); // no sector 10, and no fallback to 1-10
    expect(disk.trackIds(0, 1)).toEqual([]); // single-sided
    expect(disk.trackIds(35, 0)).toEqual([]);
  });

  it("18 sectors are numbered 1-18", () => {
    const disk = new DiskImage(writeJv1({ tracks: 40, spt: 18, fill: pattern }));
    expect(disk.trackIds(0, 0).map((id) => id.sector)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(disk.readSector(0, 0, 0)).toBeNull();
    expect(bytesOf(disk.readSector(39, 0, 18))).toEqual(pattern(39, 0, 18));
  });
});

describe("JV3 exactly", () => {
  const disk = sample("jv3-mixed.dsk");

  it("reads the header table: two sides, single- and double-density tracks", () => {
    expect([disk.format, disk.trackCount(), disk.sideCount()]).toEqual(["jv3", 4, 2]);
    for (const [t, mfm] of [[0, false], [1, false], [2, true], [3, true]]) {
      for (const side of [0, 1]) {
        const ids = disk.trackIds(t, side);
        expect(ids.map((id) => id.sector)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(ids.every((id) => id.mfm === mfm && id.side === side && id.track === t)).toBe(true);
        expect(ids.every((id) => id.dataGap === (mfm ? 45 : 25))).toBe(true);
      }
    }
  });

  it("the data marks: single density FA, F9, F8 by flag code; double density F8", () => {
    const dams = disk.trackIds(1, 0).map((id) => id.dam);
    expect(dams.slice(2, 7)).toEqual([0xfb, 0xfa, 0xf9, 0xf8, 0xfb]);
    expect(disk.trackIds(1, 0).map((id) => id.deleted).slice(2, 7)).toEqual([false, true, true, true, false]);
    expect(disk.readSectorEx(3, 1, 2)).toMatchObject({ dam: 0xf8, deleted: true });
    expect(disk.readSectorEx(3, 1, 3)).toMatchObject({ dam: 0xfb, deleted: false });
  });

  it("free entries keep their data areas, so the sectors after them are where the header says", () => {
    // Free entries at header positions 5 and 47 own 1,024 bytes each; sector 5 of track 0 and
    // everything after it come after the first one.
    expect(bytesOf(disk.readSector(0, 0, 4))).toEqual(pattern(0, 0, 4));
    expect(bytesOf(disk.readSector(0, 0, 5))).toEqual(pattern(0, 0, 5));
    expect(bytesOf(disk.readSector(3, 1, 9))).toEqual(pattern(3, 1, 9));
    expect(disk.bytes.length).toBe(2901 * 3 + 1 + 80 * 256 + 2 * 1024);
  });

  it("flag bit 3 is a data CRC error, and a write clears it", () => {
    const copy = sample("jv3-mixed.dsk");
    const bad = copy.trackIds(2, 0).find((id) => id.sector === 7);
    expect([bad.idCrcOk, bad.dataCrcOk]).toEqual([true, false]);
    expect(copy.writeSector(2, 0, 7, new Uint8Array(256).fill(0x42))).toBe(true);
    expect(copy.trackIds(2, 0).find((id) => id.sector === 7).dataCrcOk).toBe(true);
  });

  it("a second header block follows the first block's data", () => {
    const big = writeJv3({ tracks: 80, spt: 20, sides: 2, base: 1, fill: pattern }); // 3,200 sectors
    const two = new DiskImage(big);
    expect([two.format, two.trackCount(), two.sideCount(), two.jv3Map.length]).toEqual(["jv3", 80, 2, 3200]);
    expect(bytesOf(two.readSector(79, 1, 20))).toEqual(pattern(79, 1, 20)); // in the second block
    expect(bytesOf(two.readSector(72, 1, 1))).toEqual(pattern(72, 1, 1)); // the block boundary: entry 2,900
    // A format rewrites the image, still in two blocks.
    expect(two.formatTrack(0, 0, [{ sector: 1, size: 256, data: new Uint8Array(256).fill(7) }])).toBe(true);
    const again = new DiskImage(two.bytes);
    expect(bytesOf(again.readSector(79, 1, 20))).toEqual(pattern(79, 1, 20));
    expect(again.readSector(0, 0, 1)[0]).toBe(7);
    expect(again.readSector(0, 0, 2)).toBeNull();
  });
});

describe("DMK exactly", () => {
  it("double density, both sides: IDAM pointers with bit 15, IDs in track order", () => {
    const disk = sample("dmk-dd-ds.dmk");
    expect([disk.format, disk.trackCount(), disk.sideCount()]).toEqual(["dmk", 3, 2]);
    const ids = disk.trackIds(1, 1);
    expect(ids.map((id) => id.sector)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(ids.every((id) => id.mfm === true && id.side === 1 && id.track === 1 && id.dataGap === 45)).toBe(true);
    // pos rises through the revolution as the pointers do
    expect(ids.every((id, i) => i === 0 || id.pos > ids[i - 1].pos)).toBe(true);
    expect(ids.find((id) => id.sector === 4)).toMatchObject({ dam: 0xf8, deleted: true });
    expect(disk.trackIds(1, 0).find((id) => id.sector === 4)).toMatchObject({ dam: 0xfb, deleted: false });
  });

  it("single density stored as doubled bytes, and stored once with header flag 40", () => {
    for (const name of ["dmk-sd.dmk", "dmk-sd-single.dmk"]) {
      const disk = sample(name);
      const ids = disk.trackIds(1, 0);
      expect(ids.map((id) => id.sector)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(ids.every((id) => id.mfm === false && id.dataGap === 25 && id.idCrcOk && id.dataCrcOk)).toBe(true);
    }
    expect(sample("dmk-sd.dmk").readSectorEx(2, 0, 9)).toMatchObject({ dam: 0xfa, deleted: true });
    expect(sample("dmk-sd.dmk").rawTrack(0, 0).doubled).toBe(true);
    expect(sample("dmk-sd-single.dmk").rawTrack(0, 0).doubled).toBe(false);
  });

  it("a track that mixes densities, as the dual-boot disks' track 0 does", () => {
    const disk = sample("dmk-mixed.dmk");
    expect(disk.trackIds(0, 0).map((id) => [id.sector, id.mfm])).toEqual([[0, false], [1, true], [2, true], [3, true]]);
    expect(disk.trackIds(1, 0).every((id) => id.mfm)).toBe(true);
  });

  it("a data CRC error and an ID CRC error are seen as the controller checks them", () => {
    const bytes = DISK_SAMPLES["dmk-dd-ds.dmk"].build();
    const at = (track, side, k) => {
      const base = 16 + (track * 2 + side) * 0x1900;
      return base + ((bytes[base + 2 * k] | (bytes[base + 2 * k + 1] << 8)) & 0x3fff);
    };
    bytes[at(0, 0, 2) + 6] ^= 1; // sector 3's ID CRC
    bytes[at(0, 0, 4) + 7 + 22 + 12 + 3 + 1 + 100] ^= 1; // a data byte of sector 5
    const ids = new DiskImage(bytes).trackIds(0, 0);
    expect([ids[2].idCrcOk, ids[2].dataCrcOk]).toEqual([false, true]);
    expect([ids[4].idCrcOk, ids[4].dataCrcOk]).toEqual([true, false]);
  });

  it("an MFM data mark needs its A1 sync, within 43 bytes of the ID's CRC", () => {
    const bytes = DISK_SAMPLES["dmk-mixed.dmk"].build();
    const base = 16 + 0x1900; // track 1
    const id = base + ((bytes[base] | (bytes[base + 1] << 8)) & 0x3fff);
    bytes[id + 7 + 22 + 12 + 2] = 0x00; // the A1 before sector 0's data mark
    expect(new DiskImage(bytes).trackIds(1, 0).map((x) => x.sector)).toEqual([1, 2, 3]);
  });
});

describe("two IDs with one sector number", () => {
  const twin = (fill) => [
    { sector: 1, size: 256, data: new Uint8Array(256).fill(fill) },
    { sector: 1, size: 256, data: new Uint8Array(256).fill(fill + 1) },
  ];

  for (const [container, make] of [
    ["dmk", () => new DiskImage(writeDmk({ tracks: 2, spt: 4 }))],
    ["jv3", () => DiskImage.blank()],
  ]) {
    it(`${container}: the ID's place picks which one is read and written`, () => {
      const disk = make();
      disk.formatTrack(1, 0, twin(0x10));
      const ids = disk.trackIds(1, 0);
      expect(ids.map((id) => [id.sector, id.index])).toEqual([[1, 0], [1, 1]]);
      expect(disk.readSectorEx(1, 0, 1, 1).data[0]).toBe(0x11);
      expect(disk.readSector(1, 0, 1)[0]).toBe(0x10); // without an index, the first
      expect(disk.writeSector(1, 0, 1, new Uint8Array(256).fill(0x77), { index: 1 })).toBe(true);
      expect([disk.readSectorEx(1, 0, 1, 0).data[0], disk.readSectorEx(1, 0, 1, 1).data[0]]).toEqual([0x10, 0x77]);
      expect(disk.readSectorEx(1, 0, 2, 1)).toBeNull(); // an index whose ID has another number
    });
  }

  it("the controller reads the ID it found, not the first with that number", () => {
    const disk = new DiskImage(writeDmk({ tracks: 2, spt: 4 }));
    disk.formatTrack(0, 0, twin(0x20));
    const io = rig(disk);
    io.fdc.indexClock = Math.round(((disk.trackIds(0, 0)[0].pos + disk.trackIds(0, 0)[1].pos) / 2) * 405504);
    io.writePort(0xf2, 1);
    const r = run(io, 0x80, { lag: 8 });
    expect(r.bytes[0]).toBe(0x21); // the first ID has passed: the second is the next to come
  });
});

describe("Write Track in FM on a DMK", () => {
  it("lays the track out in FM, so it reads back at that density", () => {
    const disk = new DiskImage(writeDmk({ tracks: 2, spt: 4 }));
    const sectors = Array.from({ length: 10 }, (_, s) => ({ sector: s, size: 256, mfm: false, data: Uint8Array.from(pattern(1, 0, s)) }));
    expect(disk.formatTrack(1, 0, sectors)).toBe(true);
    const ids = disk.trackIds(1, 0);
    expect(ids.map((id) => [id.sector, id.mfm])).toEqual(sectors.map((s) => [s.sector, false]));
    expect(ids.every((id) => id.idCrcOk && id.dataCrcOk)).toBe(true);
    expect(bytesOf(disk.readSector(1, 0, 9))).toEqual(pattern(1, 0, 9));
  });
});

/** The IDs of a disk as an export must keep them, with JV1's density as the export writes it. */
function idsOf(disk) {
  const jv1Mfm = disk.format === "jv1" ? disk.sectorsPerTrack === 18 : null;
  return everySector(disk).map(({ t, side, id, read }) => ({
    t,
    side,
    track: id.track,
    idSide: id.side,
    sector: id.sector,
    sizeCode: id.sizeCode,
    mfm: id.mfm ?? jv1Mfm,
    dam: id.dam,
    idCrcOk: id.idCrcOk,
    dataCrcOk: id.dataCrcOk,
    data: bytesOf(read.data),
  }));
}

describe("m.fdc.export: DMK bytes", () => {
  const m = () => new Machine({ roms: { level2: new Uint8Array(0x3800).fill(0x76) } });

  for (const name of Object.keys(DISK_SAMPLES)) {
    it(`${name} exports a DMK that mounts back with the same sectors`, () => {
      const machine = m();
      const info = machine.fdc.mount(1, DISK_SAMPLES[name].build());
      const out = machine.fdc.export(1);
      expect(out).toBeInstanceOf(Uint8Array);
      const back = new DiskImage(out);
      expect(back.format).toBe("dmk");
      expect(machine.fdc.mount(2, out)).toMatchObject({ container: "dmk", tracks: info.tracks, sides: info.sides, writeProtected: false });
      expect(idsOf(back)).toEqual(idsOf(new DiskImage(DISK_SAMPLES[name].build())));
      if (name.endsWith(".dmk")) expect(Buffer.from(out).equals(Buffer.from(DISK_SAMPLES[name].build()))).toBe(true);
    });
  }

  it("JV1's 10-sector tracks export in FM and its 18-sector tracks in MFM", () => {
    const sd = new DiskImage(new DiskImage(DISK_SAMPLES["jv1-sd-35x10.dsk"].build()).toDMK());
    expect(sd.trackIds(3, 0).every((id) => id.mfm === false)).toBe(true);
    expect(sd.trackIds(17, 0).every((id) => id.deleted)).toBe(true); // the synthesized directory marks
    const dd = new DiskImage(new DiskImage(writeJv1({ tracks: 40, spt: 18 })).toDMK());
    expect(dd.trackIds(3, 0).every((id) => id.mfm === true)).toBe(true);
    expect(dd.dmk.trackLen).toBe(0x1900);
  });

  it("keeps write protection, the mount's override included", () => {
    const machine = m();
    machine.fdc.mount(0, writeJv3({ tracks: 2, spt: 10, writeProtected: true }));
    expect(machine.fdc.export(0)[0]).toBe(0xff);
    machine.fdc.mount(0, writeDmk({ tracks: 2, spt: 4 }), { writeProtect: true });
    expect(new DiskImage(machine.fdc.export(0)).writeProtected).toBe(true);
  });

  it("an unformatted disk exports as a DMK with no tracks, which a format extends", () => {
    const blank = new DiskImage(DiskImage.blank().toDMK());
    expect([blank.format, blank.trackCount(), blank.sideCount()]).toEqual(["dmk", 0, 2]);
    expect(blank.formatTrack(0, 1, [{ sector: 1, size: 256, data: new Uint8Array(256).fill(9) }])).toBe(true);
    expect(new DiskImage(blank.bytes).readSector(0, 1, 1)[0]).toBe(9);
  });

  it("refuses an empty drive and a bad drive number", () => {
    const machine = m();
    expect(() => machine.fdc.export(0)).toThrow("fdc.export: drive 0 is empty");
    expect(() => machine.fdc.export(4)).toThrow(/fdc\.export: drive must be 0, 1, 2, or 3/);
  });
});

/**
 * A ROM that writes `data` to track 0 sector 3 of drive 0 the way the Model III ROM reads (with
 * the INTRQ NMI ending the loop and the port F4 WAIT holding OUTI until each DRQ), then stores
 * the final status at $5000 and halts. `deleted` writes an F8 data mark (a0 = 1).
 */
function writerRom(data, { deleted = false, mfm = true } = {}) {
  const rom = new Uint8Array(0x3800);
  const sel = mfm ? 0x81 : 0x01;
  rom.set([
    0xf3, 0x31, 0x00, 0x50, // DI / LD SP,5000H
    0x3e, sel, 0xd3, 0xf4, // drive 0
    0x3e, 0x80, 0xd3, 0xe4, // INTRQ raises NMI
    0x01, 0xf3, 0x00, 0x21, 0x00, 0x01, // LD BC,00F3H / LD HL,0100H
    0x3e, 0x03, 0xd3, 0xf2, // sector 3
    0x3e, deleted ? 0xa1 : 0xa0, 0xd3, 0xf0, // WRITE SECTOR
    0x3e, sel | 0x40, 0xd3, 0xf4, // 001A: wait for DRQ
    0xed, 0xa3, // OUTI
    0x18, 0xf8, // JR 001AH
  ]);
  rom.set([0xdb, 0xf0, 0x32, 0x00, 0x50, 0x76], 0x66); // IN A,(F0H) / LD (5000H),A / HALT
  rom.set(data, 0x100);
  return rom;
}

describe("a disk the program wrote exports with the change", () => {
  const data = Array.from({ length: 256 }, (_, k) => (k * 13 + 5) & 0xff);
  const images = {
    jv1: () => writeJv1({ tracks: 40, spt: 18, fill: pattern }),
    jv3: () => writeJv3({ tracks: 3, spt: 10, sides: 2, fill: pattern }),
    dmk: () => writeDmk({ tracks: 3, spt: 10, sides: 2, fill: pattern }),
    "dmk in FM": () => writeDmk({ tracks: 3, spt: 10, base: 0, fill: pattern, fm: () => true }),
  };

  for (const [container, make] of Object.entries(images)) {
    it(`${container}: Write Sector through the ports, then export and mount again`, () => {
      const fm = container === "dmk in FM";
      const m = new Machine({ roms: { level2: writerRom(data, { deleted: true, mfm: !fm }) } });
      m.fdc.mount(0, make());
      m.run({ cycles: 2_000_000 });
      expect(m.system.cpu.halted).toBe(true);
      expect(m.mem.read(0x5000, 1)[0] & 0x5c).toBe(0); // no write protect, RNF, CRC, or lost data
      const back = new DiskImage(m.fdc.export(0));
      expect(bytesOf(back.readSector(0, 0, 3))).toEqual(data);
      // JV1 has nowhere to keep a data mark (its directory track's are synthesized).
      expect(back.readSectorEx(0, 0, 3).deleted).toBe(container !== "jv1");
      expect(back.trackIds(0, 0).find((id) => id.sector === 3).dataCrcOk).toBe(true);
      // Every other sector as it was.
      const before = new DiskImage(make());
      for (const { t, side, id, read } of everySector(before)) {
        if (t === 0 && side === 0 && id.sector === 3) continue;
        expect(bytesOf(back.readSector(t, side, id.sector))).toEqual(bytesOf(read.data));
      }
    });
  }
});

describe("detection claims only disk images", () => {
  /** A seeded generator, so the buffers are the same every run. */
  function random(n, seed) {
    let x = seed >>> 0 || 1;
    return Uint8Array.from({ length: n }, () => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return x & 0xff;
    });
  }

  const EXAMPLES = fileURLToPath(new URL("../../../../examples/", import.meta.url));
  const cmds = readdirSync(EXAMPLES).flatMap((dir) =>
    readdirSync(join(EXAMPLES, dir)).filter((f) => /\.cmd$/i.test(f)).map((f) => join(EXAMPLES, dir, f))
  );

  it("refuses every committed .CMD in examples/", () => {
    expect(cmds.length).toBeGreaterThan(10);
    for (const file of cmds) expect(() => new DiskImage(readFileSync(file)), file).toThrow(/Unrecognized disk image/);
  });

  it("refuses random bytes of any length but a JV1 geometry's", () => {
    for (const [n, seed] of [[256, 1], [8704, 2], [9000, 3], [70416, 4], [261136, 5], [800000, 6]]) {
      expect(() => new DiskImage(random(n, seed)), `${n} random bytes`).toThrow(/Unrecognized disk image/);
    }
    // A JV1 has no header: a buffer of a JV1 size is a JV1, whatever it holds.
    expect(new DiskImage(random(35 * 10 * 256, 7)).format).toBe("jv1");
  });

  it("refuses a DMK header on garbage: the length fits, the IDAM pointers do not", () => {
    const bytes = random(16 + 3 * 0x1900, 8);
    bytes.set([0x00, 3, 0x00, 0x19, 0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(() => new DiskImage(bytes)).toThrow(/Unrecognized disk image/);
    bytes.fill(0, 16, 16 + 128); // track 0's table empty, track 1's still garbage
    expect(() => new DiskImage(bytes)).toThrow(/Unrecognized disk image/);
  });

  it("refuses a DMK header with an undefined write-protect value or flag", () => {
    const good = writeDmk({ tracks: 2, spt: 4 });
    for (const [at, v] of [[0, 0x01], [4, 0x11]]) {
      const bad = good.slice();
      bad[at] = v;
      expect(() => new DiskImage(bad)).toThrow(/Unrecognized disk image/);
    }
  });

  it("refuses zeros the length of a JV3 header and a little more", () => {
    // 2,901 entries of track 0 sector 0 would need 742,656 bytes of data.
    expect(() => new DiskImage(new Uint8Array(8704 + 4096))).toThrow(/Unrecognized disk image/);
  });
});

describe("a JV1 in a snapshot", () => {
  it("keeps its numbering, a snapshot from before phase 5 (sector base null) included", () => {
    const rom = new Uint8Array(0x3800).fill(0x76);
    const m = new Machine({ roms: { level2: rom } });
    m.fdc.mount(0, writeJv1({ tracks: 35, spt: 10 }));
    const snap = JSON.parse(JSON.stringify(m.debug.snapshot()));
    expect(snap.disks[0].sectorBase).toBe(0);
    snap.disks[0].sectorBase = null;
    const other = new Machine({ roms: { level2: rom } });
    other.debug.restore(snap);
    expect(other.system.io.fdc.drives[0].trackIds(0, 0).map((id) => id.sector)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
