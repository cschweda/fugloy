/**
 * WRITE TRACK (DOS FORMAT) unit tests
 *
 * A formatting DOS streams a whole track image through the data
 * register: gap/sync filler plus WD1793 control bytes (MFM: 0xF5 = A1
 * sync, 0xFE = ID address mark, 0xFB/0xF8 = data marks, 0xF7 = write
 * CRC). parseWriteTrackStream turns that stream into sectors;
 * DiskImage.formatTrack makes them real; DiskImage.blank gives FORMAT
 * something to chew on.
 */

import { describe, it, expect } from "vitest";
import { FDC1793, parseWriteTrackStream } from "../../src/devices/fdc-wd1793.js";
import { DiskImage } from "../../src/devices/disk-image.js";

const ST_BUSY = 0x01;
const ST_DRQ = 0x02;
const ST_WRITE_PROTECT = 0x40;

/** Build a TRSDOS-style MFM format stream for one track. */
function mfmTrackStream(trackNo, sectors) {
  const out = [];
  const push = (...b) => out.push(...b);
  for (let i = 0; i < 60; i++) push(0x4e);
  for (let i = 0; i < 12; i++) push(0x00);
  push(0xf6, 0xf6, 0xf6, 0xfc); // index mark
  for (const s of sectors) {
    for (let i = 0; i < 30; i++) push(0x4e);
    for (let i = 0; i < 12; i++) push(0x00);
    push(0xf5, 0xf5, 0xf5, 0xfe, trackNo, 0, s.sector, s.sizeCode ?? 1, 0xf7);
    for (let i = 0; i < 22; i++) push(0x4e);
    for (let i = 0; i < 12; i++) push(0x00);
    push(0xf5, 0xf5, 0xf5, s.deleted ? 0xf8 : 0xfb);
    for (const b of s.data) push(b);
    push(0xf7);
  }
  while (out.length < 6250) push(0x4e);
  return new Uint8Array(out);
}

function fmTrackStream(trackNo, sectors) {
  const out = [];
  const push = (...b) => out.push(...b);
  for (let i = 0; i < 40; i++) push(0xff);
  for (const s of sectors) {
    for (let i = 0; i < 6; i++) push(0x00);
    push(0xfe, trackNo, 0, s.sector, s.sizeCode ?? 1, 0xf7);
    for (let i = 0; i < 11; i++) push(0xff);
    for (let i = 0; i < 6; i++) push(0x00);
    push(s.deleted ? 0xf8 : 0xfb);
    for (const b of s.data) push(b);
    push(0xf7);
  }
  while (out.length < 3125) push(0xff);
  return new Uint8Array(out);
}

function fill(size, byte) {
  return new Uint8Array(size).fill(byte);
}

describe("parseWriteTrackStream", () => {
  it("parses an 18-sector MFM format stream (TRSDOS 1.3 shape)", () => {
    const sectors = [];
    for (let n = 1; n <= 18; n++) {
      sectors.push({ sector: n, data: fill(256, 0xe5) });
    }
    const parsed = parseWriteTrackStream(mfmTrackStream(7, sectors), true);
    expect(parsed).toHaveLength(18);
    expect(parsed[0]).toMatchObject({ track: 7, side: 0, sector: 1, size: 256 });
    expect(parsed[17].sector).toBe(18);
    expect(parsed[5].data.every((b) => b === 0xe5)).toBe(true);
    expect(parsed.every((s) => s.deleted === false)).toBe(true);
  });

  it("keeps deleted data marks (0xF8) from the stream", () => {
    const parsed = parseWriteTrackStream(
      mfmTrackStream(17, [
        { sector: 1, data: fill(256, 0x00), deleted: true },
        { sector: 2, data: fill(256, 0xe5) },
      ]),
      true
    );
    expect(parsed[0].deleted).toBe(true);
    expect(parsed[1].deleted).toBe(false);
  });

  it("parses an FM (single-density) stream", () => {
    const parsed = parseWriteTrackStream(
      fmTrackStream(3, [
        { sector: 0, data: fill(256, 0x6d) },
        { sector: 1, data: fill(256, 0x6d) },
      ]),
      false
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ track: 3, sector: 0, size: 256 });
  });

  it("falls back to the other density when the latch guess finds nothing", () => {
    const stream = fmTrackStream(0, [{ sector: 1, data: fill(256, 0xe5) }]);
    const parsed = parseWriteTrackStream(stream, true); // wrong guess: MFM
    expect(parsed).toHaveLength(1);
    expect(parsed[0].sector).toBe(1);
  });
});

describe("DiskImage.blank", () => {
  it("mounts as an empty writable JV3 with no readable sectors", () => {
    const disk = DiskImage.blank("blank.dsk");
    expect(disk.format).toBe("jv3");
    expect(disk.writeProtected).toBe(false);
    expect(disk.readSector(0, 0, 1)).toBeNull();
    expect(disk.trackCount()).toBe(0);
  });

  it("round-trips through its own bytes (export/state restore path)", () => {
    const disk = DiskImage.blank("blank.dsk");
    const again = new DiskImage(disk.bytes, "blank.dsk");
    expect(again.format).toBe("jv3");
    expect(again.readSector(0, 0, 1)).toBeNull();
  });
});

describe("DiskImage.formatTrack", () => {
  const sectorsFor = (count, byte, opts = {}) => {
    const out = [];
    for (let n = 1; n <= count; n++) {
      out.push({
        sector: n,
        size: 256,
        deleted: opts.deletedAll ?? false,
        data: fill(256, byte),
      });
    }
    return out;
  };

  it("makes formatted sectors readable on a blank disk", () => {
    const disk = DiskImage.blank("blank.dsk");
    disk.formatTrack(0, 0, sectorsFor(18, 0xe5));
    const read = disk.readSectorEx(0, 0, 5);
    expect(read).not.toBeNull();
    expect(read.data).toHaveLength(256);
    expect(read.data[0]).toBe(0xe5);
    expect(read.deleted).toBe(false);
    expect(disk.trackCount()).toBe(1);
  });

  it("stores deleted marks and survives a bytes round-trip", () => {
    const disk = DiskImage.blank("blank.dsk");
    disk.formatTrack(17, 0, sectorsFor(18, 0x00, { deletedAll: true }));
    disk.formatTrack(0, 0, sectorsFor(18, 0xe5));
    const again = new DiskImage(disk.bytes, "blank.dsk");
    expect(again.readSectorEx(17, 0, 3).deleted).toBe(true);
    expect(again.readSectorEx(0, 0, 3).deleted).toBe(false);
  });

  it("reformatting a track replaces it without disturbing others", () => {
    const disk = DiskImage.blank("blank.dsk");
    disk.formatTrack(0, 0, sectorsFor(18, 0x11));
    disk.formatTrack(1, 0, sectorsFor(18, 0x22));
    disk.formatTrack(0, 0, sectorsFor(18, 0x33));
    expect(disk.readSector(0, 0, 9)[0]).toBe(0x33);
    expect(disk.readSector(1, 0, 9)[0]).toBe(0x22);
    expect(disk.readSector(0, 0, 18)).toHaveLength(256);
  });

  it("writes through to a matching-geometry JV1 in place", () => {
    // 35-track 10-sector JV1, sectors numbered from 0
    const jv1 = new DiskImage(new Uint8Array(35 * 10 * 256), "old.dsk");
    expect(jv1.format).toBe("jv1");
    const sectors = [];
    for (let n = 0; n < 10; n++) {
      sectors.push({ sector: n, size: 256, deleted: false, data: fill(256, 0x77) });
    }
    jv1.formatTrack(4, 0, sectors);
    expect(jv1.format).toBe("jv1");
    expect(jv1.readSector(4, 0, 3)[0]).toBe(0x77);
  });

  it("promotes a JV1 to JV3 when the new layout doesn't fit", () => {
    const jv1 = new DiskImage(new Uint8Array(35 * 10 * 256), "old.dsk");
    jv1.bytes.fill(0x55, 0, 256); // track 0 sector 0 recognizable
    const sectors = [];
    for (let n = 1; n <= 18; n++) {
      sectors.push({ sector: n, size: 256, deleted: false, data: fill(256, 0x99) });
    }
    jv1.formatTrack(35, 0, sectors); // beyond the JV1's 35 tracks: promote
    expect(jv1.format).toBe("jv3");
    expect(jv1.readSector(35, 0, 7)[0]).toBe(0x99);
    expect(jv1.readSector(0, 0, 0)[0]).toBe(0x55); // old data carried over
  });
});

describe("FDC WRITE TRACK command", () => {
  function formatOneTrack(fdc, trackNo, stream) {
    fdc.writeCommand(0xf4); // WRITE TRACK, E = 1
    expect(fdc.readStatus() & ST_BUSY).toBe(ST_BUSY);
    expect(fdc.readStatus() & ST_DRQ).toBe(ST_DRQ);
    // The DOS answers each DRQ as it comes, one byte per byte time, from index to index.
    let k = 0;
    for (let t = 0; fdc.status & ST_BUSY && t < 1_000_000; t += 8) {
      if (fdc.status & ST_DRQ) fdc.writeData(k < stream.length ? stream[k++] : 0x4e);
      fdc.tick(8);
    }
  }

  it("formats a blank disk track through the command interface", () => {
    const fdc = new FDC1793();
    const disk = DiskImage.blank("blank.dsk");
    fdc.attachDrive(0, disk);
    fdc.selectDrive(0x81); // drive 0, MFM latch

    const sectors = [];
    for (let n = 1; n <= 18; n++) {
      sectors.push({ sector: n, data: fill(256, 0xe5) });
    }
    formatOneTrack(fdc, 0, mfmTrackStream(0, sectors));

    expect(fdc.intrq).toBe(true);
    expect(fdc.readStatus() & ST_BUSY).toBe(0);
    expect(disk.readSector(0, 0, 12)[0]).toBe(0xe5);
  });

  it("refuses to format a write-protected disk", () => {
    const fdc = new FDC1793();
    const disk = DiskImage.blank("blank.dsk");
    disk.writeProtected = true;
    fdc.attachDrive(0, disk);
    fdc.selectDrive(0x81);

    fdc.writeCommand(0xf4);
    expect(fdc.readStatus() & ST_WRITE_PROTECT).toBe(ST_WRITE_PROTECT);
    expect(disk.readSector(0, 0, 1)).toBeNull();
  });
});
