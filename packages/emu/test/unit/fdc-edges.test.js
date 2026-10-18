/**
 * Emu phase 5's final review fixes: Read and Write Track when the disk goes away before the index
 * pulse, snapshots that restore each disk as the container it was (a blank disk formatted with few
 * sectors, a JV1 whose boot sector changed), a DMK ID with no data mark, the stepping state reset
 * when an instruction throws, and the controller's clock and drive-select latch as the machine
 * hands them over (phase 6 prep).
 */

import { describe, it, expect } from "vitest";
import { DiskImage } from "../../src/devices/disk-image.js";
import {
  BYTE_TSTATES_FM,
  BYTE_TSTATES_MFM,
  FDC1793,
  INDEX_PERIOD,
  SETTLE_TSTATES,
  STEP_TSTATES,
  fdcTimes,
} from "../../src/devices/fdc-wd1793.js";
import { decodeModel3Select } from "../../src/machine/io.js";
import { Machine } from "../../src/index.js";
import { writeDmk, writeJv1 } from "./disk-writers.js";
import { rig, run } from "./fdc-rig.js";

const rom = () => new Uint8Array(0x3800).fill(0x76);
const roundTrip = (m) => JSON.parse(JSON.stringify(m.debug.snapshot()));

describe("Read Track and Write Track with no disk at the index pulse", () => {
  for (const [what, lose] of [
    ["the drive is deselected", (io) => io.writePort(0xf4, 0x80)],
    ["the disk is unmounted", (io) => io.fdc.ejectDrive(0)],
  ]) {
    it(`Read Track ends Not Ready when ${what} before the pulse`, () => {
      const io = rig(writeDmk({ tracks: 2, spt: 4 }));
      io.fdc.indexClock = 1000;
      io.writePort(0xf0, 0xe4);
      io.fdc.tick(1000);
      lose(io);
      io.fdc.attachDrive(1, new DiskImage(writeDmk({ tracks: 2, spt: 4 }))); // keeps the FDC present
      expect(() => io.fdc.tick(2 * INDEX_PERIOD)).not.toThrow();
      expect(io.fdc.status & 0x01).toBe(0);
      expect(io.fdc.intrq).toBe(true);
      expect(io.fdc.readStatus() & 0x80).toBe(0x80);
    });

    it(`Write Track ends without writing when ${what} before the pulse`, () => {
      const io = rig(writeDmk({ tracks: 2, spt: 4 }));
      io.fdc.indexClock = 1000;
      io.writePort(0xf0, 0xf4);
      io.writePort(0xf3, 0x4e);
      lose(io);
      expect(() => io.fdc.tick(2 * INDEX_PERIOD)).not.toThrow();
      expect(io.fdc.status & 0x03).toBe(0);
      expect(io.fdc.intrq).toBe(true);
    });
  }
});

describe("disks in a snapshot restore as the container they were", () => {
  for (const [size, count] of [[1024, 5], [512, 8]]) {
    it(`a blank disk formatted with ${count} sectors of ${size} bytes`, () => {
      const m = new Machine({ roms: { level2: rom() } });
      const disk = DiskImage.blank();
      const sectors = Array.from({ length: count }, (_, i) => ({ sector: i + 1, size, data: new Uint8Array(size).fill(i + 1), mfm: true }));
      expect(disk.formatTrack(0, 0, sectors)).toBe(true);
      expect(() => new DiskImage(disk.bytes)).toThrow(/Unrecognized/); // detection's floor
      m.fdc.mount(0, disk);
      const snap = roundTrip(m);
      expect(snap.disks[0].format).toBe("jv3");
      const other = new Machine({ roms: { level2: rom() } });
      other.debug.restore(snap);
      const back = other.system.io.fdc.drives[0];
      expect(back.format).toBe("jv3");
      expect(back.trackIds(0, 0).map((id) => [id.sector, id.size])).toEqual(sectors.map((s) => [s.sector, size]));
      expect(back.readSector(0, 0, count)[0]).toBe(count);
    });
  }

  it("a JV1 keeps the directory track it was mounted with after its boot sector is rewritten", () => {
    const m = new Machine({ roms: { level2: rom() } });
    const disk = new DiskImage(writeJv1({ tracks: 40, spt: 18, fill: (t, _s, s) => (t === 0 && s === 1 ? [0, 0, 20] : null) }));
    expect(disk.dirTrack).toBe(20);
    m.fdc.mount(0, disk);
    disk.writeSector(0, 0, 1, new Uint8Array(256).fill(5)); // byte 2 now names track 5
    const snap = roundTrip(m);
    expect(snap.disks[0].dirTrack).toBe(20);
    const other = new Machine({ roms: { level2: rom() } });
    other.debug.restore(snap);
    const back = other.system.io.fdc.drives[0];
    expect(back.dirTrack).toBe(20);
    expect(back.trackIds(20, 0)[0].deleted).toBe(true);
    expect(back.trackIds(5, 0)[0].deleted).toBe(false);
  });

  it("a snapshot without formats (before these fixes) is still detected", () => {
    const m = new Machine({ roms: { level2: rom() } });
    m.fdc.mount(0, writeDmk({ tracks: 2, spt: 4 }));
    const snap = roundTrip(m);
    delete snap.disks[0].format;
    const other = new Machine({ roms: { level2: rom() } });
    other.debug.restore(snap);
    expect(other.system.io.fdc.drives[0].format).toBe("dmk");
  });

  it("a forced container that does not parse is refused", () => {
    expect(() => new DiskImage(new Uint8Array(100), "x", { format: "jv1" })).toThrow(/does not parse as jv1/);
  });
});

/** A 2-track, 4-sector MFM DMK whose track 0, sector 2 has its data mark and A1s wiped. */
function dmkWithoutMark() {
  const bytes = writeDmk({ tracks: 2, spt: 4 });
  const probe = new DiskImage(bytes);
  const hit = probe._dmkSectors(0, 0).find((s) => s.sector === 2);
  const base = probe._dmkTrackBase(0, 0);
  for (let k = 1; k <= 4; k++) bytes[base + hit.dataOff - k] = 0x4e; // the mark and three A1s
  return bytes;
}

describe("a DMK ID with no data mark in the window", () => {
  it("is kept as an ID: no data field, a bad data CRC", () => {
    const disk = new DiskImage(dmkWithoutMark());
    const ids = disk.trackIds(0, 0);
    expect(ids.map((id) => id.sector)).toEqual([1, 2, 3, 4]);
    expect(ids[1]).toMatchObject({ noData: true, dataGap: null, dam: null, dataCrcOk: false, idCrcOk: true });
    expect(disk.readSector(0, 0, 2)).toBeNull();
  });

  it("Read Address reads it", () => {
    const io = rig(dmkWithoutMark());
    run(io, 0xc0); // sector 1's ID
    const r = run(io, 0xc0);
    expect(r.bytes.slice(0, 4)).toEqual([0, 0, 2, 1]);
    expect(r.status & 0x18).toBe(0);
  });

  it("Read Sector finds no record", () => {
    const io = rig(dmkWithoutMark());
    io.writePort(0xf2, 2);
    const r = run(io, 0x80);
    expect(r.status & 0x10).toBe(0x10);
    expect(r.bytes).toEqual([]);
  });

  it("Write Sector lays the data field, which Read Sector then reads", () => {
    const disk = new DiskImage(dmkWithoutMark());
    const io = rig(disk);
    io.writePort(0xf2, 2);
    const data = Array.from({ length: 256 }, (_, i) => (i * 7) & 0xff);
    const w = run(io, 0xa0, { write: data });
    expect(w.status & 0x5c).toBe(0);
    expect(disk.trackIds(0, 0)[1].noData).toBe(false);
    const r = run(io, 0x80);
    expect(r.status & 0x1c).toBe(0);
    expect(r.bytes).toEqual(data);
  });
});

describe("an instruction that throws", () => {
  it("leaves the machine out of an instruction, so a later port poke does not wait", () => {
    const m = new Machine({ roms: { level2: rom() } });
    const sys = m.system;
    expect(() =>
      sys.stepInstruction(() => {
        throw new Error("boom");
      })
    ).toThrow("boom");
    expect(sys._executing).toBe(false);
    expect(sys._fdcAhead).toBe(0);
  });
});

describe("the controller's clock and select latch (phase 6 prep)", () => {
  it("defaults to the Model III clock, whose times the exported constants are", () => {
    const fdc = new FDC1793();
    expect(fdc.cpuHz).toBe(2027520);
    expect(fdc.indexPeriod).toBe(INDEX_PERIOD);
    expect(fdc.stepTStates).toEqual(STEP_TSTATES);
    expect(fdc.settleTStates).toBe(SETTLE_TSTATES);
    expect([fdc.byteTStatesMfm, fdc.byteTStatesFm]).toEqual([BYTE_TSTATES_MFM, BYTE_TSTATES_FM]);
  });

  it("scales every time to another CPU clock (the Model I's 1.77408 MHz)", () => {
    const t = fdcTimes(1774080);
    expect(t.indexPeriod).toBe(354816);
    expect(t.step).toEqual([10644, 21289, 35482, 53222]);
    expect(t.settle).toBe(53222);
    expect([t.byteMfm, t.byteFm]).toEqual([57, 114]);
    const fdc = new FDC1793({ cpuHz: 1774080 });
    expect(fdc.indexPeriod).toBe(354816);
    // A Restore from track 3 at r1 r0 = 00: three steps at the Model I's 6 ms.
    fdc.attachDrive(0, new DiskImage(writeDmk({ tracks: 4, spt: 4 })));
    fdc.select(0, 0, true);
    fdc.physicalTrack[0] = 3;
    fdc.writeCommand(0x00);
    let t0 = 0;
    while (fdc.status & 0x01 && t0 < 10 * 354816) {
      fdc.tick(10);
      t0 += 10;
    }
    expect(t0).toBeGreaterThanOrEqual(3 * 10644);
    expect(t0).toBeLessThan(3 * 10644 + 20);
  });

  it("takes a decoded select; the Model III's port F4 decoding is io.js's", () => {
    expect(decodeModel3Select(0x81)).toEqual({ drive: 0, side: 0, mfm: true, wait: false });
    expect(decodeModel3Select(0x52)).toEqual({ drive: 1, side: 1, mfm: false, wait: true });
    expect(decodeModel3Select(0x0c)).toMatchObject({ drive: 2 });
    expect(decodeModel3Select(0x80)).toMatchObject({ drive: -1 });
    const fdc = new FDC1793();
    fdc.select(3, 1, false);
    expect([fdc.selected, fdc.side, fdc.mfm]).toEqual([3, 1, false]);
    fdc.select(-1, 0, true);
    expect(fdc.selected).toBe(-1);
    fdc.selectDrive(0x92); // the bare-controller convenience applies io.js's decoding
    expect([fdc.selected, fdc.side, fdc.mfm]).toEqual([1, 1, true]);
  });
});
