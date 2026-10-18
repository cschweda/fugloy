/**
 * The WD1793 against the Western Digital FD179X data sheet (the FD179X-01 sheet of October 1979;
 * section names in quotes), one test per behaviour, on synthetic images through the ports. Times
 * are T-states at the Model III's 2.02752 MHz; each test starts with the disk at its index pulse.
 */
import { describe, expect, it } from 'vitest';
import { DiskImage } from '../../src/devices/disk-image.js';
import {
  BYTE_TSTATES_FM,
  BYTE_TSTATES_MFM,
  INDEX_PERIOD,
  SETTLE_TSTATES,
  STEP_TSTATES,
} from '../../src/devices/fdc-wd1793.js';
import { Machine } from '../../src/index.js';
import { crc16, writeDmk, writeJv1, writeJv3 } from './disk-writers.js';
import { rig, run, wait } from './fdc-rig.js';

const P = INDEX_PERIOD;
const B = BYTE_TSTATES_MFM;

/** Where the i-th of n evenly spaced IDs passes (JV1 and JV3 images). */
const idAt = (i, n) => Math.round(((i + 0.5) / n) * P);

/** The first data byte's DRQ for the i-th of n JV IDs, from a command loaded at the index pulse. */
const firstDrq = (i, n, mfm = true) => idAt(i, n) + ((mfm ? 45 : 25) + 1) * (mfm ? B : BYTE_TSTATES_FM);

/** A DMK track's raw bytes and the offsets of its ID marks (from the IDAM table). */
function dmkTrack(bytes, index) {
  const len = bytes[2] | (bytes[3] << 8);
  const base = 16 + index * len;
  const ids = [];
  for (let k = 0; k < 64; k++) {
    const p = bytes[base + 2 * k] | (bytes[base + 2 * k + 1] << 8);
    if (!p) break;
    ids.push(base + (p & 0x3fff));
  }
  return { base, ids };
}

describe('Type I commands', () => {
  it('Restore steps out one pulse per r1 r0 period until Track 00, and loads zero into the track register', () => {
    const io = rig(writeJv1());
    io.fdc.physicalTrack[0] = 5;
    io.writePort(0xf1, 9);
    const r = run(io, 0x0b, { lag: 1 }); // h = 1, r = 11 (30 ms)
    expect(r.t).toBe(5 * STEP_TSTATES[3]);
    expect(io.fdc.physicalTrack[0]).toBe(0);
    expect(io.readPort(0xf1)).toBe(0);
    expect(r.intrq).toBe(true);
    expect(io.readPort(0xf0) & 0x25).toBe(0x24); // head loaded, track 0, not busy
  });

  it('Restore at track 0 ends at once', () => {
    const io = rig(writeJv1());
    expect(run(io, 0x03, { lag: 1 }).t).toBe(1);
  });

  it('Restore gives up with Seek Error after 255 pulses without Track 00', () => {
    const io = rig(writeJv1());
    io.writePort(0xf4, 0x80); // no drive selected: no TR00 line
    const r = run(io, 0x00, { limit: 300 * STEP_TSTATES[0] });
    expect(r.status & 0x01).toBe(0);
    expect(io.readPort(0xf0) & 0x10).toBe(0x10);
    expect(r.t).toBeGreaterThanOrEqual(255 * STEP_TSTATES[0]);
  });

  it('the step rates are the data sheet’s 1 MHz column: 6, 12, 20, 30 ms', () => {
    expect(STEP_TSTATES).toEqual([12165, 24330, 40550, 60826]);
    for (const r of [0, 1, 2, 3]) {
      const io = rig(writeJv1());
      io.writePort(0xf3, 3);
      expect(run(io, 0x10 | r, { lag: 1 }).t).toBe(3 * STEP_TSTATES[r]);
    }
  });

  it('Seek steps from the track register to the data register, not to an absolute track', () => {
    const io = rig(writeJv1());
    io.writePort(0xf1, 10); // the DOS believes the head is on 10; it is on 0
    io.writePort(0xf3, 15);
    run(io, 0x10);
    expect(io.readPort(0xf1)).toBe(15);
    expect(io.fdc.physicalTrack[0]).toBe(5);
    // And back out: five pulses toward track 0.
    io.writePort(0xf3, 10);
    run(io, 0x10);
    expect(io.fdc.physicalTrack[0]).toBe(0);
  });

  it('Step, Step-In, Step-Out: one pulse; the track register follows only with u = 1', () => {
    const io = rig(writeJv1());
    run(io, 0x40); // Step-In, u = 0
    expect([io.fdc.physicalTrack[0], io.readPort(0xf1)]).toEqual([1, 0]);
    run(io, 0x50); // Step-In, u = 1
    expect([io.fdc.physicalTrack[0], io.readPort(0xf1)]).toEqual([2, 1]);
    run(io, 0x30); // Step, u = 1: the previous direction (in)
    expect([io.fdc.physicalTrack[0], io.readPort(0xf1)]).toEqual([3, 2]);
    run(io, 0x70); // Step-Out, u = 1
    expect([io.fdc.physicalTrack[0], io.readPort(0xf1)]).toEqual([2, 1]);
    run(io, 0x20); // Step, u = 0: the previous direction (out)
    expect([io.fdc.physicalTrack[0], io.readPort(0xf1)]).toEqual([1, 1]);
    expect(run(io, 0x63, { lag: 1 }).t).toBe(STEP_TSTATES[3]); // one pulse, then the r1 r0 delay
    expect(io.fdc.physicalTrack[0]).toBe(0);
    run(io, 0x60); // Step-Out at track 0: the head stays on the end stop
    expect(io.fdc.physicalTrack[0]).toBe(0);
  });

  it('a step outward with Track 00 active: no pulse, no r1 r0 delay, and 0 in the track register, whatever u is', () => {
    // "Type I Command Flow" (page 9): "Is head at track 0 and direction = 0?" leads to "0 to TR".
    const io = rig(writeJv1());
    io.writePort(0xf1, 3); // the DOS believes the head is on 3; it is on 0
    const out = run(io, 0x73, { lag: 1 }); // Step-Out, u = 1, 30 ms
    expect(out.t).toBe(1);
    expect([io.fdc.physicalTrack[0], io.readPort(0xf1)]).toEqual([0, 0]);
    io.writePort(0xf1, 3);
    expect(run(io, 0x63, { lag: 1 }).t).toBe(1); // u = 0 too
    expect(io.readPort(0xf1)).toBe(0);
    io.writePort(0xf1, 3);
    expect(run(io, 0x23, { lag: 1 }).t).toBe(1); // Step, the last direction (out)
    expect(io.readPort(0xf1)).toBe(0);
    // An outward Seek stops there too: TR = 0 although DR = 1.
    io.writePort(0xf1, 5);
    io.writePort(0xf3, 1);
    expect(run(io, 0x13, { lag: 1 }).t).toBe(1);
    expect(io.readPort(0xf1)).toBe(0);
    // Inward from track 0 steps as usual; and with no drive selected TR00 is not active.
    expect(run(io, 0x53, { lag: 1 }).t).toBe(STEP_TSTATES[3]);
    expect([io.fdc.physicalTrack[0], io.readPort(0xf1)]).toEqual([1, 1]);
    io.writePort(0xf4, 0x80);
    io.writePort(0xf1, 0);
    expect(run(io, 0x73, { lag: 1 }).t).toBe(STEP_TSTATES[3]);
    expect(io.readPort(0xf1)).toBe(255);
  });

  it('verify (V = 1): 30 ms settling, then the first ID with a good CRC must carry the track register', () => {
    const io = rig(writeJv1());
    io.writePort(0xf3, 5);
    const r = run(io, 0x14, { lag: 1 }); // Seek, verify, 6 ms
    const settled = 5 * STEP_TSTATES[0] + SETTLE_TSTATES;
    const next = idAt(Math.ceil((settled % P) / (P / 18) - 0.5), 18); // the next ID to pass
    expect(r.t).toBe(settled + (next - (settled % P)) + 7 * B);
    expect(io.readPort(0xf0) & 0x18).toBe(0); // no Seek Error, no CRC Error
    expect(io.readPort(0xf0) & 0x20).toBe(0x20); // V loads the head
  });

  it('verify sets Seek Error when the ID’s track differs from the track register', () => {
    const io = rig(writeJv1());
    io.writePort(0xf1, 2); // wrong belief: physical 0
    io.writePort(0xf3, 4);
    run(io, 0x1c);
    expect(io.fdc.physicalTrack[0]).toBe(2);
    expect(io.readPort(0xf0) & 0x10).toBe(0x10);
  });

  it('verify sets CRC Error for a bad ID CRC and, with no good ID in five index pulses, Seek Error', () => {
    const bytes = writeDmk({ tracks: 3, spt: 4 });
    for (const at of dmkTrack(bytes, 1).ids) bytes[at + 5] ^= 0xff;
    const io = rig(bytes);
    io.writePort(0xf3, 1);
    const r = run(io, 0x14, { lag: 16 });
    expect(io.readPort(0xf0) & 0x18).toBe(0x18);
    expect(r.t).toBeGreaterThan(4 * P);
  });

  it('verify finds no IDs in the other density: Seek Error', () => {
    const io = rig(writeDmk({ tracks: 3, spt: 4 }), { select: 0x01 }); // FM latch, MFM disk
    io.writePort(0xf3, 1);
    run(io, 0x14, { lag: 64 });
    expect(io.readPort(0xf0) & 0x10).toBe(0x10);
  });

  it('h = 0 and V = 0 unloads the head; h = 1 loads it at the start', () => {
    const io = rig(writeJv1());
    io.writePort(0xf0, 0x08);
    expect(io.readPort(0xf0) & 0x21).toBe(0x21); // busy, head loaded already
    wait(io, P);
    run(io, 0x00);
    expect(io.readPort(0xf0) & 0x20).toBe(0);
  });

  it('the head unloads after 15 index pulses idle', () => {
    const io = rig(writeJv1());
    run(io, 0x08);
    wait(io, 14 * P);
    expect(io.readPort(0xf0) & 0x20).toBe(0x20);
    wait(io, P);
    expect(io.readPort(0xf0) & 0x20).toBe(0);
  });

  it('Type I status is live while busy: Track 00 and Index copy the drive’s lines', () => {
    const io = rig(writeJv1());
    io.fdc.physicalTrack[0] = 2;
    io.writePort(0xf0, 0x03); // Restore, 30 ms a step
    wait(io, 1);
    expect(io.readPort(0xf0) & 0x07).toBe(0x03); // busy, index (at the pulse), not yet track 0
    wait(io, 2 * STEP_TSTATES[3] - 100);
    expect(io.readPort(0xf0) & 0x05).toBe(0x05); // busy and on track 0, before the last delay ends
    wait(io, 200);
    expect(io.readPort(0xf0) & 0x01).toBe(0);
  });

  it('the Index bit pulses once a revolution while a disk turns, and never without one', () => {
    const io = rig(writeJv1());
    const seen = [];
    for (let t = 0; t < 2 * P; t += 4000) {
      seen.push(io.readPort(0xf0) & 0x02 ? 1 : 0);
      wait(io, 4000);
    }
    expect(seen.join('').match(/1+/g)?.length).toBe(2);
    io.writePort(0xf4, 0x82); // drive 1, empty
    for (let t = 0; t < P; t += 4000) {
      expect(io.readPort(0xf0) & 0x82).toBe(0x80); // not ready, no index
      wait(io, 4000);
    }
  });

  it('Write Protect copies the drive’s line in Type I status', () => {
    expect(rig(writeJv3({ writeProtected: true })).readPort(0xf0) & 0x40).toBe(0x40);
    expect(rig(writeJv3()).readPort(0xf0) & 0x40).toBe(0);
  });
});

describe('Type II commands', () => {
  it('Read Sector: DRQ for each byte one byte time apart, INTRQ after the CRC', () => {
    const io = rig(writeJv1());
    io.writePort(0xf2, 4);
    const r = run(io, 0x80, { lag: 1 });
    expect(r.bytes.slice(0, 3)).toEqual([0, 0, 4]);
    expect(r.bytes).toHaveLength(256);
    expect(r.drqAt[0]).toBe(firstDrq(3, 18));
    expect(r.drqAt.every((t, k) => t === r.drqAt[0] + k * B)).toBe(true);
    expect(r.t).toBe(r.drqAt[255] + 2 * B);
    expect(r.intrq).toBe(true);
    expect(r.status & 0x1f).toBe(0);
  });

  it('Read Sector in FM: 64-microsecond bytes and the FM gaps', () => {
    const io = rig(writeJv3({ tracks: 2, spt: 10, dd: false, base: 0 }), { select: 0x01 });
    io.writePort(0xf2, 2);
    const r = run(io, 0x80, { lag: 1 });
    expect(r.bytes.slice(0, 3)).toEqual([0, 0, 2]);
    expect(BYTE_TSTATES_FM).toBe(130);
    expect(r.drqAt[0]).toBe(firstDrq(2, 10, false));
    expect(r.drqAt[1] - r.drqAt[0]).toBe(130);
  });

  it('E = 1 adds the 30 ms settling before the ID search', () => {
    const io = rig(writeJv1());
    io.writePort(0xf2, 18);
    const r = run(io, 0x84, { lag: 1 });
    expect(r.drqAt[0]).toBe(firstDrq(17, 18)); // sector 18 passes after the settle anyway
    io.fdc.indexClock = 0;
    io.writePort(0xf2, 1);
    const late = run(io, 0x84, { lag: 1 });
    expect(late.drqAt[0]).toBe(firstDrq(0, 18) + P); // sector 1 passed during the settle: next turn
  });

  it('Read Sector, multiple (m = 1): sector after sector until one is not found', () => {
    const io = rig(writeJv1({ tracks: 40, spt: 18 }));
    io.writePort(0xf2, 16);
    const r = run(io, 0x90, { lag: 4 });
    expect(r.bytes).toHaveLength(3 * 256);
    expect([r.bytes[2], r.bytes[258], r.bytes[514]]).toEqual([16, 17, 18]);
    expect(io.readPort(0xf2)).toBe(19);
    expect(r.status & 0x10).toBe(0x10); // the last search, for 19, ends in Record Not Found
  });

  it('Lost Data: a byte the computer has not read when the next arrives', () => {
    const io = rig(writeJv1());
    io.writePort(0xf2, 1);
    const r = run(io, 0x80, { serve: false, lag: 4 });
    expect(r.status & 0x05).toBe(0x04); // done, lost data
    expect(r.intrq).toBe(true);
    expect(io.readPort(0xf3)).toBe(0); // the last byte of the sector is what the DR holds
  });

  it('Record Not Found after five index pulses', () => {
    const io = rig(writeJv1());
    io.writePort(0xf2, 19);
    const r = run(io, 0x80, { lag: 1 });
    expect(r.t).toBe(5 * P);
    expect(r.status & 0x10).toBe(0x10);
  });

  it('the ID must carry the track register’s track, not the head’s position', () => {
    const io = rig(writeJv1());
    io.writePort(0xf1, 3); // head on 0, register says 3
    io.writePort(0xf2, 1);
    expect(run(io, 0x80, { lag: 64 }).status & 0x10).toBe(0x10);
  });

  it('C = 1 compares the ID’s side with S; C = 0 does not', () => {
    const io = rig(writeJv3({ tracks: 2, sides: 2 }));
    io.writePort(0xf4, 0x91 | 0x80); // drive 0, side 1, MFM
    io.writePort(0xf2, 1);
    expect(run(io, 0x8a).status & 0x10).toBe(0); // C = 1, S = 1: side 1's IDs say 1
    expect(run(io, 0x82, { lag: 64 }).status & 0x10).toBe(0x10); // C = 1, S = 0
    expect(run(io, 0x80).bytes.slice(0, 3)).toEqual([0, 1, 1]); // C = 0
  });

  it('the density latch must match the recording: an FM read of an MFM track finds nothing', () => {
    const io = rig(writeDmk({ tracks: 2, spt: 4 }), { select: 0x01 });
    io.writePort(0xf2, 1);
    expect(run(io, 0x80, { lag: 64 }).status & 0x10).toBe(0x10);
  });

  it('Record Type (bit 5) reports a deleted data mark', () => {
    const bytes = writeJv3({ tracks: 2, spt: 10 });
    bytes[2] |= 0x20; // track 0 sector 1: F8 in MFM
    const io = rig(bytes);
    io.writePort(0xf2, 1);
    expect(run(io, 0x80).status & 0x20).toBe(0x20);
    io.writePort(0xf2, 2);
    expect(run(io, 0x80).status & 0x20).toBe(0);
  });

  it('a data CRC error sets CRC Error and ends even a multiple read', () => {
    const bytes = writeDmk({ tracks: 2, spt: 4 });
    const { ids } = dmkTrack(bytes, 0);
    bytes[ids[1] + 45 + 10] ^= 0x55; // a byte in sector 2's data
    const io = rig(bytes);
    io.writePort(0xf2, 1);
    const r = run(io, 0x90);
    expect(r.bytes).toHaveLength(512);
    expect(r.status & 0x18).toBe(0x08);
    expect(io.readPort(0xf2)).toBe(2);
  });

  it('a matching ID with a bad CRC sets CRC Error, and with no good one Record Not Found', () => {
    const bytes = writeDmk({ tracks: 2, spt: 4 });
    bytes[dmkTrack(bytes, 0).ids[2] + 6] ^= 1;
    const io = rig(bytes);
    io.writePort(0xf2, 3);
    expect(run(io, 0x80, { lag: 64 }).status & 0x18).toBe(0x18);
  });

  it('Write Sector writes the bytes and the a0 data mark, DRQ for each', () => {
    const image = new DiskImage(writeJv3({ tracks: 2, spt: 10 }));
    const io = rig(image);
    io.writePort(0xf2, 3);
    const data = Array.from({ length: 256 }, (_, k) => (k * 7) & 0xff);
    const r = run(io, 0xa1, { write: data, lag: 2 }); // deleted data mark
    expect(r.status & 0x1d).toBe(0);
    expect(r.drqAt).toHaveLength(256);
    expect(r.drqAt[1] - r.drqAt[0]).toBeGreaterThanOrEqual(22 * B); // the 22-byte count before the gate
    expect(Array.from(image.readSector(0, 0, 3))).toEqual(data);
    expect(image.readSectorEx(0, 0, 3).deleted).toBe(true);
  });

  it('Write Sector: an unserved first DRQ ends the command with Lost Data and writes nothing', () => {
    const image = new DiskImage(writeJv3({ tracks: 2, spt: 10 }));
    const io = rig(image);
    io.writePort(0xf2, 1);
    const r = run(io, 0xa0, { serve: false });
    expect(r.status & 0x05).toBe(0x04);
    expect(Array.from(image.readSector(0, 0, 1).subarray(0, 3))).toEqual([0, 0, 1]);
  });

  it('Write Sector: a byte not loaded in time is written as zero, Lost Data set, the command goes on', () => {
    const image = new DiskImage(writeJv3({ tracks: 2, spt: 10 }));
    const io = rig(image);
    io.writePort(0xf2, 1);
    io.writePort(0xf0, 0xa0);
    const fdc = io.fdc;
    let k = 0;
    while (fdc.status & 1) {
      wait(io, 4);
      if (fdc.status & 2 && k !== 5) {
        io.writePort(0xf3, 0xaa);
        k++;
      } else if (fdc.status & 2) {
        wait(io, B); // byte 5 late: it goes out as 00
        k++;
      }
    }
    expect(fdc.status & 0x04).toBe(0x04);
    const sector = image.readSector(0, 0, 1);
    expect(sector[4]).toBe(0xaa);
    expect(sector[5]).toBe(0x00);
    expect(sector[6]).toBe(0xaa);
  });

  it('Write Sector on a protected disk: terminated at once with Write Protect, the image unchanged', () => {
    const image = new DiskImage(writeJv3({ tracks: 2, spt: 10, writeProtected: true }));
    const io = rig(image);
    const before = image.bytes.slice();
    io.writePort(0xf2, 1);
    io.writePort(0xf0, 0xa0);
    expect(io.fdc.status & 0x41).toBe(0x40);
    expect(io.fdc.intrq).toBe(true);
    for (let k = 0; k < 300; k++) io.writePort(0xf3, 0x55);
    wait(io, P);
    expect(image.bytes).toEqual(before);
  });

  it('a Type II command with the drive not ready is not executed and interrupts', () => {
    const io = rig(writeJv1());
    io.writePort(0xf4, 0x82); // drive 1, empty
    io.writePort(0xf0, 0x80);
    expect(io.fdc.intrq).toBe(true);
    expect(io.readPort(0xf0)).toBe(0x80);
  });
});

describe('Type III commands', () => {
  it('Read Address: the next ID’s six bytes; its track goes to the sector register', () => {
    const io = rig(writeDmk({ tracks: 3, spt: 5 }));
    io.writePort(0xf3, 2);
    run(io, 0x10);
    io.fdc.indexClock = 0;
    const r = run(io, 0xc0, { lag: 1 });
    const crc = crc16([0xa1, 0xa1, 0xa1, 0xfe, 2, 0, 1, 1]);
    expect(r.bytes).toEqual([2, 0, 1, 1, crc >> 8, crc & 0xff]);
    expect(io.readPort(0xf2)).toBe(2);
    expect(r.status & 0x1c).toBe(0);
    expect(r.drqAt[1] - r.drqAt[0]).toBe(B);
  });

  it('Read Address with a bad ID CRC reports CRC Error; with no ID, Record Not Found', () => {
    const bytes = writeDmk({ tracks: 2, spt: 1 });
    bytes[dmkTrack(bytes, 0).ids[0] + 5] ^= 1;
    expect(run(rig(bytes), 0xc0).status & 0x18).toBe(0x08);
    expect(run(rig(writeDmk({ tracks: 2, spt: 0 })), 0xc0, { lag: 64 }).status & 0x10).toBe(0x10);
  });

  it('Read Track: from one index pulse to the next, gaps and marks included', () => {
    const bytes = writeDmk({ tracks: 2, spt: 3 });
    const io = rig(bytes);
    wait(io, 1000);
    const r = run(io, 0xe0, { lag: 4 });
    expect(r.drqAt[0]).toBeGreaterThanOrEqual(P - 1000);
    expect(r.bytes).toHaveLength(Math.floor(P / B));
    const { base, ids } = dmkTrack(bytes, 0);
    expect(r.bytes.slice(0, 64)).toEqual(Array.from(bytes.subarray(base + 128, base + 192)));
    expect(r.bytes[ids[0] - base - 128]).toBe(0xfe);
    expect(r.status & 0x1d).toBe(0);
  });

  it('Read Track synthesizes the IBM layout for a sector image', () => {
    const r = run(rig(writeJv1()), 0xe0, { lag: 4 });
    const text = r.bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(text).toContain('a1a1a1fe00000101');
    expect(text.match(/a1a1a1fb/g)).toHaveLength(18);
  });

  it('Write Track formats a DMK track: DRQ at once, writing from index to index', () => {
    const image = new DiskImage(writeDmk({ tracks: 2, spt: 0 }));
    const io = rig(image);
    io.writePort(0xf4, 0x81);
    const stream = [];
    const run_ = (n, v) => {
      for (let k = 0; k < n; k++) stream.push(v);
    };
    run_(80, 0x4e);
    for (let s = 1; s <= 10; s++) {
      run_(12, 0x00);
      stream.push(0xf5, 0xf5, 0xf5, 0xfe, 0, 0, s, 1, 0xf7);
      run_(22, 0x4e);
      run_(12, 0x00);
      stream.push(0xf5, 0xf5, 0xf5, 0xfb);
      run_(256, 0xe5 ^ s);
      stream.push(0xf7);
      run_(24, 0x4e);
    }
    io.writePort(0xf0, 0xf0);
    expect(io.fdc.status & 0x03).toBe(0x03); // busy, DRQ immediately
    let k = 0;
    let t = 0;
    while (io.fdc.status & 1 && t < 3 * P) {
      if (io.fdc.status & 2) io.writePort(0xf3, k < stream.length ? stream[k++] : 0x4e);
      wait(io, 8);
      t += 8;
    }
    expect(t).toBeGreaterThan(P); // the first index pulse, then a whole turn
    expect(t).toBeLessThan(2 * P + 100);
    expect(io.fdc.status & 0x04).toBe(0);
    expect(io.fdc.intrq).toBe(true);
    for (let s = 1; s <= 10; s++) expect(image.readSector(0, 0, s)[0]).toBe(0xe5 ^ s);
  });

  it('Write Track not loaded by the index pulse: terminated with Lost Data', () => {
    const image = new DiskImage(writeDmk({ tracks: 2, spt: 0 }));
    const io = rig(image);
    const before = image.bytes.slice();
    const r = run(io, 0xf0, { serve: false });
    expect(r.status & 0x05).toBe(0x04);
    expect(r.t).toBeLessThanOrEqual(P + 8);
    expect(image.bytes).toEqual(before);
  });

  it('Write Track on a protected disk: Write Protect at once', () => {
    const io = rig(writeDmk({ tracks: 2, spt: 2, writeProtected: true }));
    io.writePort(0xf0, 0xf0);
    expect(io.fdc.status & 0x41).toBe(0x40);
    expect(io.fdc.intrq).toBe(true);
  });
});

describe('Type IV: Force Interrupt', () => {
  it('D0 while busy: the command stops, Busy resets, the other bits stay, no interrupt', () => {
    const io = rig(writeJv1());
    io.writePort(0xf2, 1);
    io.writePort(0xf0, 0x80);
    wait(io, firstDrq(0, 18) + 3 * B + 1); // four bytes in, none read: Lost Data
    expect(io.fdc.status & 0x07).toBe(0x07);
    io.writePort(0xf0, 0xd0);
    expect(io.fdc.status & 0x07).toBe(0x04);
    expect(io.fdc.intrq).toBe(false);
    wait(io, P);
    expect(io.fdc.intrq).toBe(false);
  });

  it('D0 while idle: the status reflects Type I', () => {
    const io = rig(writeJv1());
    io.writePort(0xf2, 99);
    run(io, 0x80, { lag: 64 }); // Record Not Found
    expect(io.readPort(0xf0) & 0x10).toBe(0x10);
    io.writePort(0xf0, 0xd0);
    expect(io.readPort(0xf0) & 0x34).toBe(0x24); // head loaded, track 0, no RNF
  });

  it('D8: an immediate interrupt that neither a status read nor a command clears, until a D0', () => {
    const io = rig(writeJv1());
    io.writePort(0xf0, 0xd8);
    expect(io.fdc.intrq).toBe(true);
    io.readPort(0xf0);
    expect(io.fdc.intrq).toBe(true);
    run(io, 0x00);
    io.readPort(0xf0);
    expect(io.fdc.intrq).toBe(true);
    io.writePort(0xf0, 0xd0);
    expect(io.fdc.intrq).toBe(true); // D0 only enables the clear
    io.readPort(0xf0);
    expect(io.fdc.intrq).toBe(false);
  });

  it('D4: an interrupt at every index pulse', () => {
    const io = rig(writeJv1());
    wait(io, 1000);
    io.writePort(0xf0, 0xd4);
    expect(io.fdc.intrq).toBe(false);
    wait(io, P - 1000);
    expect(io.fdc.intrq).toBe(true);
    io.readPort(0xf0);
    wait(io, P / 2);
    expect(io.fdc.intrq).toBe(false);
    wait(io, P / 2);
    expect(io.fdc.intrq).toBe(true);
  });

  it('D1 and D2: interrupts on the not-ready-to-ready and ready-to-not-ready transitions', () => {
    const io = rig(writeJv1());
    io.writePort(0xf0, 0xd2);
    io.fdc.ejectDrive(0);
    expect(io.fdc.intrq).toBe(true);
    const io2 = rig(writeJv1(), { drive: 1 });
    io2.writePort(0xf4, 0x81); // drive 0, empty: not ready
    io2.writePort(0xf0, 0xd1);
    io2.fdc.attachDrive(0, new DiskImage(writeJv1()));
    expect(io2.fdc.intrq).toBe(true);
  });

  it('INTRQ resets on a status read and on loading a command', () => {
    const io = rig(writeJv1());
    run(io, 0x00);
    expect(io.fdc.intrq).toBe(true);
    io.readPort(0xf0);
    expect(io.fdc.intrq).toBe(false);
    run(io, 0x00);
    io.writePort(0xf0, 0x00);
    expect(io.fdc.intrq).toBe(false);
  });

  it('a command loaded while busy is ignored (only Force Interrupt is taken)', () => {
    const io = rig(writeJv1());
    io.writePort(0xf2, 1);
    io.writePort(0xf0, 0x80);
    io.writePort(0xf0, 0x00);
    expect(io.fdc.commandType).toBe(2);
    expect(io.fdc.pending?.kind).toBe('read');
  });
});

describe('ports F4 and E4', () => {
  it('F4 selects a drive (bits 0-3, none: no drive), the side (bit 4), and the density (bit 7)', () => {
    const io = rig(writeJv3({ tracks: 2, sides: 2 }), { drive: 2 });
    io.writePort(0xf4, 0x84);
    expect([io.fdc.selected, io.fdc.side, io.fdc.mfm]).toEqual([2, 0, true]);
    io.writePort(0xf4, 0x14);
    expect([io.fdc.selected, io.fdc.side, io.fdc.mfm]).toEqual([2, 1, false]);
    io.writePort(0xf4, 0x80);
    expect(io.fdc.selected).toBe(-1);
    expect(io.readPort(0xf0) & 0x80).toBe(0x80);
    io.writePort(0xf4, 0x08 | 0x80);
    expect(io.fdc.selected).toBe(3);
  });

  it('E4: bit 7 of the mask lets INTRQ raise the NMI; bit 7 of the status is INTRQ, active low', () => {
    const io = rig(writeJv1());
    run(io, 0x00);
    expect(io.readPort(0xe4) & 0x80).toBe(0);
    expect(io.nmiPending()).toBe(false);
    io.writePort(0xe4, 0x80);
    expect(io.nmiPending()).toBe(true);
    io.readPort(0xf0);
    expect(io.readPort(0xe4) & 0x80).toBe(0x80);
    expect(io.nmiPending()).toBe(false);
  });
});

/**
 * A ROM that reads track 0 sector 1 to $4300 the way the Model III ROM does ($34D9-$3516): the
 * INTRQ NMI ends the loop, whose OUT (F4H) with bit 6 waits for each DRQ; the NMI handler stores
 * the final status at $5000 and halts. `waitBit` false drops the WAIT.
 */
function readerRom(waitBit = true) {
  const rom = new Uint8Array(0x3800);
  const sel = waitBit ? 0xc1 : 0x81;
  rom.set([
    0xf3, 0x31, 0x00, 0x50, // DI / LD SP,5000H
    0x3e, 0x81, 0xd3, 0xf4, // drive 0, MFM
    0x3e, 0x80, 0xd3, 0xe4, // INTRQ raises NMI
    0x01, 0xf3, 0x00, 0x21, 0x00, 0x43, // LD BC,00F3H / LD HL,4300H
    0x3e, 0x01, 0xd3, 0xf2, // sector 1
    0x3e, 0x80, 0xd3, 0xf0, // READ SECTOR
    0x3e, sel, 0xd3, 0xf4, // 001A: LD A,sel / OUT (F4H),A: wait for DRQ
    0xed, 0xa2, // INI
    0x18, 0xf8, // JR 001AH
  ]);
  rom.set([0xdb, 0xf0, 0x32, 0x00, 0x50, 0x76], 0x66); // IN A,(F0H) / LD (5000H),A / HALT
  return rom;
}

describe('the Model III WAIT, through the machine', () => {
  const disk = () => writeJv1({ fill: (t, s, n) => Array.from({ length: 256 }, (_, k) => (k + n + t) & 0xff) });

  it('port F4 bit 6 holds the CPU until each DRQ, so an INI loop takes every byte', () => {
    const m = new Machine({ roms: { level2: readerRom() } });
    m.fdc.mount(0, disk());
    m.run({ cycles: 200_000 });
    expect(m.system.cpu.halted).toBe(true);
    expect(Array.from(m.mem.read(0x4300, 256))).toEqual(Array.from({ length: 256 }, (_, k) => (k + 1) & 0xff));
    expect(m.mem.read(0x5000, 1)[0] & 0x1c).toBe(0); // no lost data, CRC, or RNF
  });

  it('without the WAIT the same loop outruns the controller and the status shows Lost Data or garbage', () => {
    const m = new Machine({ roms: { level2: readerRom(false) } });
    m.fdc.mount(0, disk());
    m.run({ cycles: 200_000 });
    expect(Array.from(m.mem.read(0x4300, 256))).not.toEqual(Array.from({ length: 256 }, (_, k) => (k + 1) & 0xff));
  });

  it('a port F4 write from outside an instruction (a debugger poke) does not wait', () => {
    const m = new Machine({ roms: { level2: readerRom() } });
    m.fdc.mount(0, disk());
    m.run({ until: (mm) => mm.system.io.fdc.pending?.phase === 'data', cycles: 200_000 });
    m.io.in(0xf3); // DRQ down
    const cycles = m.cycles;
    const angle = m.system.io.fdc.indexClock;
    m.io.out(0xf4, 0xc1);
    expect(m.cycles).toBe(cycles);
    expect(m.system.io.fdc.indexClock).toBe(angle);
  });

  it('snapshot mid-command: a restore in the middle of a sector read continues identically', () => {
    const m = new Machine({ roms: { level2: readerRom() } });
    m.fdc.mount(0, disk());
    m.run({ until: (mm) => mm.system.io.fdc.pending?.phase === 'data' && mm.system.io.fdc.pending.k === 100, cycles: 200_000 });
    expect(m.system.io.fdc.status & 0x01).toBe(0x01);
    const snap = JSON.parse(JSON.stringify(m.debug.snapshot()));
    const other = new Machine({ roms: { level2: readerRom() } });
    other.debug.restore(snap);
    m.run({ cycles: 100_000 });
    other.run({ cycles: 100_000 });
    expect(other.debug.snapshot()).toEqual(m.debug.snapshot());
    expect(Array.from(other.mem.read(0x4300, 256))).toEqual(Array.from({ length: 256 }, (_, k) => (k + 1) & 0xff));
  });
});
