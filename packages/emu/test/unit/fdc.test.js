/**
 * WD1793 FDC tests, driven through the IOSystem ports the way the ROM
 * and a DOS would: command/status at 0xF0, track 0xF1, sector 0xF2,
 * data 0xF3, drive select 0xF4, NMI mask/status 0xE4. Commands run in
 * T-states (fdc-rig.js); the datasheet behaviours one by one are in
 * fdc-wd1793.test.js.
 */

import { describe, it, expect } from "vitest";
import { IOSystem } from "../../src/machine/io.js";
import { DiskImage } from "../../src/devices/disk-image.js";
import { buildJV1, buildJV3 } from "./disk-builders.js";
import { rig, run } from "./fdc-rig.js";

describe("FDC via ports", () => {
  it("presents as absent (floating bus) with no disk mounted", () => {
    const io = new IOSystem();
    expect(io.readPort(0xf0)).toBe(0xff);
    expect(io.readPort(0xe4)).toBe(0xff);
  });

  it("RESTORE homes the head and reports track 0 + head loaded", () => {
    const io = rig(new DiskImage(buildJV1()), { select: 0x01 });
    io.fdc.physicalTrack[0] = 3;
    run(io, 0x08); // RESTORE, h = 1

    const status = io.readPort(0xf0);
    expect(status & 0x01).toBe(0); // not busy
    expect(status & 0x04).toBe(0x04); // track 0
    expect(status & 0x20).toBe(0x20); // head loaded
    expect(status & 0x80).toBe(0); // ready
  });

  it("SEEK moves to the track in the data register", () => {
    const io = rig(new DiskImage(buildJV1()), { select: 0x01 });
    io.writePort(0xf3, 17); // target track via data register
    run(io, 0x10); // SEEK

    expect(io.readPort(0xf1)).toBe(17); // track register updated
    expect(io.fdc.physicalTrack[0]).toBe(17);
  });

  it("READ SECTOR delivers 256 bytes via DRQ and raises INTRQ at the end", () => {
    const io = rig(new DiskImage(buildJV1()), { select: 0x01 });
    io.writePort(0xf3, 5);
    run(io, 0x10); // seek track 5

    io.writePort(0xf2, 3); // sector 3
    const r = run(io, 0x80); // READ SECTOR

    expect(r.bytes.length).toBe(256);
    expect(r.bytes[0]).toBe(5); // stamped track
    expect(r.bytes[1]).toBe(2); // sector 3 on an 18-sector (1-based) disk = index 2
    expect(io.fdc.intrq).toBe(true);
    // Reading status clears INTRQ
    io.readPort(0xf0);
    expect(io.fdc.intrq).toBe(false);
  });

  it("READ SECTOR of a missing sector sets record-not-found", () => {
    const io = rig(new DiskImage(buildJV1({ spt: 10 })), { select: 0x01 });
    io.writePort(0xf2, 99);
    run(io, 0x80, { lag: 64 });
    expect(io.readPort(0xf0) & 0x10).toBe(0x10); // RNF
  });

  it("WRITE SECTOR commits the bytes to the image", () => {
    const image = new DiskImage(buildJV1());
    const io = rig(image, { select: 0x01 });
    io.writePort(0xf2, 2);
    run(io, 0xa0, { write: new Array(256).fill(0xcc) }); // WRITE SECTOR (track 0)

    expect(image.readSector(0, 0, 2)[0]).toBe(0xcc);
    expect(io.fdc.intrq).toBe(true);
  });

  it("WRITE SECTOR on a protected disk reports write-protect", () => {
    const image = new DiskImage(buildJV1());
    image.writeProtected = true;
    const io = rig(image, { select: 0x01 });
    io.writePort(0xf0, 0xa0);
    expect(io.readPort(0xf0) & 0x40).toBe(0x40);
  });

  it("drive select routes commands to the second drive", () => {
    const io = rig(new DiskImage(buildJV1()), { select: 0x02 });
    io.fdc.attachDrive(1, new DiskImage(buildJV1()));
    io.writePort(0xf3, 7);
    run(io, 0x10); // seek 7

    expect(io.fdc.physicalTrack[1]).toBe(7);
    expect(io.fdc.physicalTrack[0]).toBe(0);
  });

  it("FORCE INTERRUPT aborts a pending command", () => {
    const io = rig(new DiskImage(buildJV1()), { select: 0x01 });
    io.writePort(0xf0, 0x84); // read sector, E = 1: still settling

    io.writePort(0xf0, 0xd0); // force interrupt, no INTRQ

    expect(io.fdc.pending).toBe(null);
    expect(io.readPort(0xf0) & 0x01).toBe(0);
    expect(io.fdc.intrq).toBe(false);
  });

  it("READ SECTOR reports the deleted record type in status bit 5", () => {
    // Directory sectors on DOS disks carry 0xF8 deleted DAMs; the DOS
    // reads status after the transfer and checks bit 5 (record type).
    const image = new DiskImage(
      buildJV3({ tracks: 22, spt: 10, flagFor: (t) => (t === 20 ? 0xa0 : 0x80) })
    );
    const io = rig(image); // MFM, as the image's sectors are
    io.writePort(0xf3, 20);
    run(io, 0x10); // seek 20

    io.writePort(0xf2, 3);
    run(io, 0x80); // READ SECTOR (directory track)
    expect(io.readPort(0xf0) & 0x20).toBe(0x20); // deleted record type
    expect(io.readPort(0xf0) & 0x01).toBe(0); // completed

    io.writePort(0xf3, 5);
    run(io, 0x10); // seek 5 (data track)
    run(io, 0x80);
    expect(io.readPort(0xf0) & 0x20).toBe(0); // normal record type
  });

  it("WRITE SECTOR bit a0 writes a deleted DAM the image remembers", () => {
    const image = new DiskImage(buildJV3({ tracks: 3, spt: 10 }));
    const io = rig(image, { select: 0x01 }); // FM, as the image's sectors are
    io.writePort(0xf2, 4);

    run(io, 0xa1, { write: new Array(256).fill(0x42) }); // deleted DAM
    expect(image.readSectorEx(0, 0, 4).deleted).toBe(true);
    expect(image.readSectorEx(0, 0, 4).data[0]).toBe(0x42);

    run(io, 0xa0, { write: new Array(256).fill(0x43) }); // normal DAM
    expect(image.readSectorEx(0, 0, 4).deleted).toBe(false);
  });

  it("NMI line follows INTRQ gated by the 0xE4 mask", () => {
    const io = rig(new DiskImage(buildJV1()), { select: 0x01 });
    run(io, 0x00); // RESTORE
    expect(io.fdc.intrq).toBe(true);

    expect(io.nmiPending()).toBe(false); // masked off
    io.writePort(0xe4, 0x80); // enable FDC NMI
    expect(io.nmiPending()).toBe(true);
    expect(io.readPort(0xe4) & 0x80).toBe(0); // status active-low
  });
});
