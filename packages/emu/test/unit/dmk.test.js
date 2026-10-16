/**
 * DMK disk image unit tests
 *
 * DMK stores raw track bytes behind a 16-byte header (WP, track count,
 * track length LE, flags) and a 128-byte IDAM pointer table per track
 * (pointer = offset of the 0xFE ID byte from track start, bit 15 set
 * for MFM). The builders here are written from that spec by hand; the
 * real-world check is the TRSDOS-boot acceptance test, where the DOS's
 * own reads have to succeed.
 */

import { describe, it, expect } from "vitest";
import { DiskImage } from "../../src/devices/disk-image.js";

function crc16(bytes, init = 0xffff) {
  let crc = init;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

const TRACK_LEN = 0x1900; // 6400: raw track + the 128-byte IDAM table

/** One DD track: returns {bytes: Uint8Array(TRACK_LEN)} */
function buildDmkTrack(cyl, sectors) {
  const raw = [];
  const idamPtrs = [];
  const push = (...b) => raw.push(...b);
  for (let i = 0; i < 32; i++) push(0x4e);
  for (let i = 0; i < 12; i++) push(0x00);
  push(0xc2, 0xc2, 0xc2, 0xfc);
  for (const s of sectors) {
    for (let i = 0; i < 24; i++) push(0x4e);
    for (let i = 0; i < 12; i++) push(0x00);
    push(0xa1, 0xa1, 0xa1);
    idamPtrs.push((128 + raw.length) | 0x8000); // points at the 0xFE
    const id = [0xfe, cyl, 0, s.sector, 0x01];
    push(...id);
    const idCrc = crc16([0xa1, 0xa1, 0xa1, ...id]);
    push(idCrc >> 8, idCrc & 0xff);
    for (let i = 0; i < 22; i++) push(0x4e);
    for (let i = 0; i < 12; i++) push(0x00);
    push(0xa1, 0xa1, 0xa1);
    const mark = s.deleted ? 0xf8 : 0xfb;
    push(mark, ...s.data);
    const dCrc = crc16([0xa1, 0xa1, 0xa1, mark, ...s.data]);
    push(dCrc >> 8, dCrc & 0xff);
  }
  while (raw.length < TRACK_LEN - 128) push(0x4e);

  const bytes = new Uint8Array(TRACK_LEN);
  idamPtrs.forEach((p, i) => {
    bytes[i * 2] = p & 0xff;
    bytes[i * 2 + 1] = p >> 8;
  });
  bytes.set(raw.slice(0, TRACK_LEN - 128), 128);
  return bytes;
}

/** Single-sided DD DMK from [{track, sectors:[{sector,data,deleted}]}] */
export function buildDmk(tracks, { writeProtected = false } = {}) {
  const count = Math.max(...tracks.map((t) => t.track)) + 1;
  const bytes = new Uint8Array(16 + count * TRACK_LEN);
  bytes[0] = writeProtected ? 0xff : 0x00;
  bytes[1] = count;
  bytes[2] = TRACK_LEN & 0xff;
  bytes[3] = TRACK_LEN >> 8;
  bytes[4] = 0x10; // single-sided
  for (const t of tracks) {
    bytes.set(buildDmkTrack(t.track, t.sectors), 16 + t.track * TRACK_LEN);
  }
  return bytes;
}

const fill = (size, byte) => new Uint8Array(size).fill(byte);

function twoTrackDisk() {
  return new DiskImage(
    buildDmk([
      {
        track: 0,
        sectors: [
          { sector: 1, data: fill(256, 0x11) },
          { sector: 2, data: fill(256, 0x22) },
          { sector: 3, data: fill(256, 0x33), deleted: true },
        ],
      },
      {
        track: 1,
        sectors: [
          { sector: 1, data: fill(256, 0x44) },
          { sector: 2, data: fill(256, 0x55) },
        ],
      },
    ]),
    "test.dmk"
  );
}

describe("DMK parsing and reads", () => {
  it("detects the format and geometry", () => {
    const disk = twoTrackDisk();
    expect(disk.format).toBe("dmk");
    expect(disk.writeProtected).toBe(false);
    expect(disk.trackCount()).toBe(2);
  });

  it("reads sector data and deleted marks", () => {
    const disk = twoTrackDisk();
    expect(disk.readSector(0, 0, 2)[0]).toBe(0x22);
    expect(disk.readSector(1, 0, 1)[0]).toBe(0x44);
    expect(disk.readSectorEx(0, 0, 3).deleted).toBe(true);
    expect(disk.readSectorEx(0, 0, 1).deleted).toBe(false);
    expect(disk.readSector(0, 0, 9)).toBeNull();
    expect(disk.readSector(5, 0, 1)).toBeNull();
  });

  it("lists a track's ID fields for READ ADDRESS", () => {
    const disk = twoTrackDisk();
    expect(disk.sectorsOn(0, 0).map((s) => s.sector)).toEqual([1, 2, 3]);
    expect(disk.sectorsOn(1, 0)).toHaveLength(2);
    expect(disk.sectorsOn(7, 0)).toEqual([]);
  });

  it("honors the header write-protect byte", () => {
    const disk = new DiskImage(
      buildDmk([{ track: 0, sectors: [{ sector: 1, data: fill(256, 0xaa) }] }], {
        writeProtected: true,
      }),
      "wp.dmk"
    );
    expect(disk.writeProtected).toBe(true);
    expect(disk.writeSector(0, 0, 1, fill(256, 0xbb))).toBe(false);
  });
});

describe("DMK writes", () => {
  it("writes a sector in place, persisting in the image bytes", () => {
    const disk = twoTrackDisk();
    expect(disk.writeSector(0, 0, 2, fill(256, 0x99))).toBe(true);
    expect(disk.readSector(0, 0, 2)[0]).toBe(0x99);
    // bytes are the exportable truth: a reparse sees the write
    const again = new DiskImage(disk.bytes, "again.dmk");
    expect(again.readSector(0, 0, 2)[0]).toBe(0x99);
    expect(again.readSector(0, 0, 1)[0]).toBe(0x11); // neighbors intact
  });

  it("records the deleted mark written by WRITE SECTOR bit a0", () => {
    const disk = twoTrackDisk();
    disk.writeSector(0, 0, 1, fill(256, 0x00), { deleted: true });
    expect(disk.readSectorEx(0, 0, 1).deleted).toBe(true);
    const again = new DiskImage(disk.bytes, "again.dmk");
    expect(again.readSectorEx(0, 0, 1).deleted).toBe(true);
  });
});

describe("DMK formatTrack", () => {
  const sectorsFor = (count, byte) => {
    const out = [];
    for (let n = 1; n <= count; n++) {
      out.push({ sector: n, size: 256, deleted: false, data: fill(256, byte) });
    }
    return out;
  };

  it("rebuilds one track without disturbing the others", () => {
    const disk = twoTrackDisk();
    disk.formatTrack(0, 0, sectorsFor(18, 0xe5));
    expect(disk.sectorsOn(0, 0)).toHaveLength(18);
    expect(disk.readSector(0, 0, 18)[0]).toBe(0xe5);
    expect(disk.readSector(1, 0, 2)[0]).toBe(0x55);
    const again = new DiskImage(disk.bytes, "again.dmk");
    expect(again.readSector(0, 0, 7)[0]).toBe(0xe5);
  });

  it("extends the image when formatting past the last track", () => {
    const disk = twoTrackDisk();
    disk.formatTrack(4, 0, sectorsFor(18, 0x77));
    expect(disk.trackCount()).toBe(5);
    expect(disk.readSector(4, 0, 3)[0]).toBe(0x77);
    expect(disk.readSector(0, 0, 1)[0]).toBe(0x11);
    const again = new DiskImage(disk.bytes, "again.dmk");
    expect(again.trackCount()).toBe(5);
  });
});
