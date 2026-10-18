/**
 * Emu phase 6, Task 3: the Model I Expansion Interface's WD1771 on synthetic images (Ruling 5).
 * Each difference from the WD1793 the FD1771-01 data sheet gives (single density only, no side
 * compare, the data mark read and written as it is, the b flag's lengths, the times at a 1 MHz
 * clock, the two-revolution search, Read Address's sector register, a command that overrides a
 * busy one, the restore at master reset), the drive select at $37E1, INTRQ on the interrupt
 * latch's bit 6, the controller's absence with no disk, a copy of the Level II ROM's disk boot
 * reading a synthetic JV1, the Model I's JV1 track counts and the FA directory mark, and the
 * debugger's old-value read of a watched $37EC write peeking (Task 2's review; the rest of that
 * fix is tested in model1-devices.test.js).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Machine } from '../../src/index.js';
import { IOSystem } from '../../src/machine/io.js';
import { MODEL_I } from '../../src/machine/models.js';
import { DiskImage, JV1_MODEL1_SD_TRACKS } from '../../src/devices/disk-image.js';
import { FDC1771 } from '../../src/devices/fdc-wd1771.js';
import { DISK_BIT } from '../../src/devices/interrupt-latch.js';
import { MODEL1_BOOT_ORG, bootSector, writeDmk, writeJv1, writeJv3 } from './disk-writers.js';
import { pattern } from './disk-samples.js';
import { rig as rig3, run as run3 } from './fdc-rig.js';

const HZ = 1774080;
const ms = (/** @type {number} */ n) => Math.round((n * HZ) / 1000);
const PERIOD = Math.round(HZ / 5); // one revolution at 300 rpm
const BYTE = Math.round((64 * HZ) / 1e6); // one FM byte at 125 kbit/s

/** A 35-track, 10-sector JV1 (the Model I's TRSDOS 2.3 geometry), each sector `pattern`. */
const jv1 = (opts = {}) => writeJv1({ tracks: 35, spt: 10, fill: pattern, ...opts });

/**
 * A Model I IOSystem (the Expansion Interface fitted) with `disk` in `drive`, selected through
 * $37E1, the disk at its index pulse.
 * @param {Uint8Array | DiskImage} disk
 */
function rig(disk, { drive = 0 } = {}) {
  const io = new IOSystem({ model: MODEL_I });
  io.fdc.attachDrive(drive, disk instanceof DiskImage ? disk : new DiskImage(disk, 'd', { jv1SdTracks: JV1_MODEL1_SD_TRACKS }));
  io.writeExpansion(0x37e1, 1 << drive);
  io.fdc.indexClock = 0;
  return io;
}

/**
 * fdc-rig.js's `run` through the Model I's addresses: load `command` at $37EC and tick until Busy
 * drops, answering each DRQ `lag` T-states after it (reading $37EF, or writing the next of
 * `write`). Returns the bytes read, the time Busy dropped, and the raw status and INTRQ.
 * @param {IOSystem} io
 * @param {number} command
 * @param {{ write?: ArrayLike<number>, serve?: boolean, lag?: number, limit?: number }} [opts]
 */
function run(io, command, { write, serve = true, lag = 8, limit = 8 * PERIOD } = {}) {
  const fdc = io.fdc;
  const bytes = [];
  let t = 0;
  let w = 0;
  io.writeExpansion(0x37ec, command);
  while (fdc.status & 0x01 && t < limit) {
    fdc.tick(lag);
    t += lag;
    if (fdc.commandType !== 1 && fdc.status & 0x02 && serve) {
      if (write) io.writeExpansion(0x37ef, write[w++] ?? 0);
      else bytes.push(io.readExpansion(0x37ef));
    }
  }
  return { bytes, t, status: fdc.status, intrq: fdc.intrq };
}

/** Seek to `track` (Seek, h = 1, r = 00) and settle there. */
function seek(io, track) {
  io.writeExpansion(0x37ef, track);
  return run(io, 0x18);
}

describe('the WD1771 at $37EC-$37EF, the drive select at $37E1', () => {
  it('is a WD1771 on the Model I, clocked at its CPU, with the latch for its INTRQ', () => {
    const io = new IOSystem({ model: MODEL_I });
    expect(io.fdc).toBeInstanceOf(FDC1771);
    expect(io.fdc.latch).toBe(io.latch);
    expect(io.fdc.mfm).toBe(false);
    expect(io.fdc.indexPeriod).toBe(PERIOD);
    expect(new IOSystem().fdc).not.toBeInstanceOf(FDC1771);
  });

  it('selects drives 0-3 by bits 0-3 of a $37E1 write (the lowest set bit wins; none, no drive), one side, single density', () => {
    const io = rig(jv1());
    for (const [value, drive] of [[0x01, 0], [0x02, 1], [0x04, 2], [0x08, 3], [0x03, 0], [0x00, -1], [0xf0, -1], [0x81, 0]]) {
      io.writeExpansion(0x37e1, value);
      expect(io.fdc.selected, `select ${value}`).toBe(drive);
      expect(io.fdc.side).toBe(0);
      expect(io.fdc.mfm).toBe(false);
    }
  });

  it('reads the four registers at $37EC-$37EF and is absent, reading $FF and taking no write, with no disk mounted', () => {
    const io = new IOSystem({ model: MODEL_I });
    for (let a = 0x37ec; a <= 0x37ef; a++) expect(io.readExpansion(a)).toBe(0xff);
    io.writeExpansion(0x37ed, 7);
    io.writeExpansion(0x37ec, 0x03);
    expect(io.fdc.trackReg).toBe(0);
    expect(io.fdc.pending).toBeNull();
    io.fdc.attachDrive(0, new DiskImage(jv1()));
    io.writeExpansion(0x37ed, 7);
    io.writeExpansion(0x37ee, 3);
    io.writeExpansion(0x37ef, 9);
    expect([io.readExpansion(0x37ed), io.readExpansion(0x37ee), io.readExpansion(0x37ef)]).toEqual([7, 3, 9]);
    expect(io.readExpansion(0x37ec) & 0x80).toBe(0); // drive 0 ready
  });

  it('reads a sector of a JV1 at single density with the IBM length (b = 1)', () => {
    const io = rig(jv1());
    seek(io, 5);
    io.writeExpansion(0x37ee, 7);
    const r = run(io, 0x88); // Read, b = 1, E = 0
    expect(r.bytes).toEqual(pattern(5, 0, 7));
    expect(r.status).toBe(0x00);
  });
});

describe('the WD1771\'s differences from the WD1793 (FD1771-01 data sheet)', () => {
  it('reports the data mark as written in status bits 6 and 5: FB 00, FA 01, F9 10, F8 11', () => {
    const marks = /** @type {Record<number, number>} */ ({ 1: 0xfa, 2: 0xf9, 3: 0xf8 });
    for (const disk of [
      writeJv3({ tracks: 2, spt: 10, base: 0, dd: false, fill: pattern, dam: (t, side, s) => marks[s] ?? 0xfb }),
      writeDmk({ tracks: 2, spt: 10, base: 0, fill: pattern, fm: () => true, dam: (t, side, s) => marks[s] ?? 0xfb }),
    ]) {
      const io = rig(disk);
      const status = [0, 1, 2, 3].map((s) => {
        io.writeExpansion(0x37ee, s);
        return run(io, 0x88).status & 0x60;
      });
      expect(status).toEqual([0x00, 0x20, 0x40, 0x60]);
    }
  });

  it('reads a 10-sector JV1\'s directory track as FA (record type 01), as Model I TRSDOS writes it', () => {
    const bytes = jv1();
    bytes[2] = 17;
    const io = rig(bytes);
    seek(io, 17);
    io.writeExpansion(0x37ee, 0);
    expect(run(io, 0x88).status & 0x60).toBe(0x20);
    seek(io, 16);
    expect(run(io, 0x88).status & 0x60).toBe(0x00);
  });

  it('writes the mark a1 a0 choose: 00 FB, 01 FA, 10 F9, 11 F8', () => {
    for (const make of [
      () => new DiskImage(writeJv3({ tracks: 2, spt: 10, base: 0, dd: false, fill: pattern })),
      () => new DiskImage(writeDmk({ tracks: 2, spt: 10, base: 0, fill: pattern, fm: () => true })),
    ]) {
      const disk = make();
      const io = rig(disk);
      const data = Array.from({ length: 256 }, (_, k) => k ^ 0x5a);
      for (const [a, mark] of [[0, 0xfb], [1, 0xfa], [2, 0xf9], [3, 0xf8]]) {
        io.writeExpansion(0x37ee, a + 4);
        expect(run(io, 0xa8 | a, { write: data }).status, `a1 a0 = ${a}`).toBe(0);
        expect(disk.readSectorEx(0, 0, a + 4)).toMatchObject({ dam: mark, data: Uint8Array.from(data) });
        expect(run(io, 0x88).status & 0x60).toBe(((~mark & 3) << 5));
      }
    }
  });

  it('is single density only: an MFM sector is not found; an FM one on the same track is', () => {
    // writeDmk's mixed track 0 as the dual-boot disks have it: sector 0 in FM, 1-3 in MFM
    const io = rig(writeDmk({ tracks: 1, spt: 4, base: 0, fill: pattern, fm: (t, side, s) => s === 0 }));
    io.writeExpansion(0x37ee, 0);
    const fm = run(io, 0x88);
    expect(fm.status).toBe(0);
    expect(fm.bytes).toEqual(pattern(0, 0, 0));
    io.writeExpansion(0x37ee, 1);
    expect(run(io, 0x88).status & 0x10).toBe(0x10); // Record Not Found
    // A JV3's double-density sectors likewise
    const jv3 = rig(writeJv3({ tracks: 2, spt: 10, base: 0, dd: (t) => t === 1, fill: pattern }));
    expect(run(jv3, 0x88).status).toBe(0);
    seek(jv3, 1);
    expect(run(jv3, 0x88).status & 0x10).toBe(0x10);
  });

  it('has no side compare: bits 1 and 3 of a Read are the WD1793\'s C and S, not the 1771\'s', () => {
    // 8AH: on the 1771, b = 1 and an unused bit 1; on the 1793, C = 1 with S = 1, which an ID of side 0 fails
    const io = rig(jv1());
    io.writeExpansion(0x37ee, 2);
    const r = run(io, 0x8a);
    expect(r.status).toBe(0);
    expect(r.bytes).toEqual(pattern(0, 0, 2));
    const io3 = rig3(new DiskImage(jv1()));
    io3.writePort(0xf2, 2);
    expect(run3(io3, 0x8a).status & 0x10).toBe(0x10);
  });

  it('reads 16 x N bytes with b = 0, and a length other than the sector\'s ends in a CRC error', () => {
    const io = rig(jv1());
    io.writeExpansion(0x37ee, 3);
    const r = run(io, 0x80); // b = 0: the ID's length code 1, 16 bytes
    expect(r.bytes).toEqual(pattern(0, 0, 3).slice(0, 16));
    expect(r.status & 0x08).toBe(0x08);
  });

  it('steps at the CLK = 1 MHz rates, 12, 12, 20, 40 ms, and settles 20 ms after a verify', () => {
    for (const [r, rate] of [[0, 12], [1, 12], [2, 20], [3, 40]]) {
      const io = rig(jv1());
      io.writeExpansion(0x37ef, 3);
      const res = run(io, 0x10 | r, { lag: 1 });
      expect(res.t, `r = ${r}`).toBeGreaterThanOrEqual(3 * ms(rate));
      expect(res.t).toBeLessThan(3 * ms(rate) + 10);
      expect(io.fdc.physicalTrack[0]).toBe(3);
    }
    const io = rig(jv1());
    io.writeExpansion(0x37ef, 1);
    const v = run(io, 0x14, { lag: 1 }); // Seek with verify, r = 00
    expect(v.t).toBeGreaterThanOrEqual(ms(12) + ms(20));
    expect(v.status & 0x18).toBe(0);
  });

  it('gives up an ID search after two revolutions: Record Not Found at the third index pulse', () => {
    const io = rig(jv1());
    io.writeExpansion(0x37ee, 12); // a 10-sector track numbers 0-9
    const r = run(io, 0x88, { lag: 1 });
    expect(r.status & 0x10).toBe(0x10);
    expect(r.t).toBe(3 * PERIOD);
    expect(r.intrq).toBe(true);
  });

  it('unloads the head at the third index pulse after the last command', () => {
    const io = rig(jv1());
    run(io, 0x88);
    expect(io.fdc.headLoaded).toBe(true);
    io.fdc.tick(PERIOD - io.fdc.indexClock + PERIOD); // two index pulses
    expect(io.fdc.headLoaded).toBe(true);
    io.fdc.tick(PERIOD);
    expect(io.fdc.headLoaded).toBe(false);
  });

  it('Read Address puts the ID\'s sector address in the sector register (the WD1793 puts the track)', () => {
    const io = rig(jv1());
    seek(io, 6);
    io.fdc.indexClock = Math.round(0.1 * PERIOD); // the next ID to pass is sector 1 (positions (i + 0.5) / 10)
    const r = run(io, 0xc0);
    expect(r.bytes.slice(0, 4)).toEqual([6, 0, 1, 1]);
    expect(io.fdc.sectorReg).toBe(1);
  });

  it('takes FA and F9 as data marks in a Write Track', () => {
    const disk = new DiskImage(writeDmk({ tracks: 2, spt: 10, base: 0, fill: pattern, fm: () => true }));
    const io = rig(disk);
    seek(io, 1);
    const stream = [...Array(16).fill(0xff), ...Array(6).fill(0)];
    for (const [sector, mark] of [[0, 0xfa], [1, 0xf9], [2, 0xfb]]) {
      stream.push(0xfe, 1, 0, sector, 1, 0xf7, ...Array(11).fill(0xff), ...Array(6).fill(0), mark, ...Array(256).fill(sector + 0x40), 0xf7, ...Array(10).fill(0xff), ...Array(6).fill(0));
    }
    const r = run(io, 0xf0, { write: stream });
    expect(r.status & 0x44).toBe(0);
    expect(disk.trackIds(1, 0).map((id) => [id.sector, id.dam])).toEqual([[0, 0xfa], [1, 0xf9], [2, 0xfb]]);
  });

  it('a command written while busy overrides the one running, and raises INTRQ', () => {
    const io = rig(jv1());
    io.writeExpansion(0x37ee, 0);
    io.writeExpansion(0x37ec, 0x88);
    while (!(io.fdc.status & 0x02)) io.fdc.tick(BYTE); // the read's first DRQ
    io.writeExpansion(0x37ef, 4);
    io.writeExpansion(0x37ec, 0x18); // Seek 4, while the read is busy
    expect(io.fdc.pending?.kind).toBe('type1');
    expect(io.fdc.intrq).toBe(true);
    expect(io.latch.bits & DISK_BIT).toBe(DISK_BIT);
    io.fdc.tick(5 * ms(12));
    expect(io.fdc.physicalTrack[0]).toBe(4);
    expect(io.fdc.status & 0x01).toBe(0);
    // The WD1793 ignores the same write
    const io3 = rig3(new DiskImage(jv1()));
    io3.writePort(0xf4, 0x01); // FM
    io3.writePort(0xf2, 0);
    io3.writePort(0xf0, 0x88);
    while (!(io3.fdc.status & 0x02)) io3.fdc.tick(130);
    io3.writePort(0xf0, 0x18);
    expect(io3.fdc.pending?.kind).toBe('read');
  });
});

describe('INTRQ on the interrupt latch, not an NMI', () => {
  it('raises the latch\'s bit 6 when a command ends; a $37E0 read leaves it; a status read or a command load clears it', () => {
    const io = rig(jv1());
    expect(io.latch.bits).toBe(0);
    run(io, 0x88);
    expect(io.latch.bits).toBe(DISK_BIT);
    expect(io.pendingInterrupt()).toBe(true);
    expect(io.nmiPending()).toBe(false);
    expect(io.readExpansion(0x37e0)).toBe(DISK_BIT);
    expect(io.latch.bits).toBe(DISK_BIT);
    expect(io.peekExpansion(0x37ec)).toBe(0); // a peek leaves INTRQ up
    expect(io.latch.bits).toBe(DISK_BIT);
    io.readExpansion(0x37ec);
    expect(io.latch.bits).toBe(0);
    expect(io.pendingInterrupt()).toBe(false);
    run(io, 0x88);
    expect(io.latch.bits).toBe(DISK_BIT);
    io.writeExpansion(0x37ec, 0x18);
    expect(io.latch.bits & DISK_BIT).toBe(0);
  });

  it('interrupts a Model I program in IM 1 until its handler reads the status', () => {
    // DI / IM 1 / LD SP,8000H / LD A,88H / LD (37ECH),A / EI / JR $
    const rom = new Uint8Array(0x3000);
    rom.set([0xf3, 0xed, 0x56, 0x31, 0x00, 0x80, 0x3e, 0x88, 0x32, 0xec, 0x37, 0xfb, 0x18, 0xfe], 0);
    // At $0038: PUSH AF / LD A,(37E0H) / AND 40H / JR Z,+7 / count at (5000H) / LD A,(37ECH) / POP AF / EI / RETI
    rom.set([0xf5, 0x3a, 0xe0, 0x37, 0xe6, 0x40, 0x28, 0x07, 0x3a, 0x00, 0x50, 0x3c, 0x32, 0x00, 0x50, 0x3a, 0xec, 0x37, 0xf1, 0xfb, 0xed, 0x4d], 0x38);
    const m = new Machine({ model: 1, roms: { level2: rom } });
    m.fdc.mount(0, jv1());
    m.reset(); // the restore at reset raises INTRQ before EI; the read's command load clears it
    m.run({ cycles: 2 * PERIOD });
    expect(m.mem.read(0x5000, 1)[0]).toBe(1); // the read's end, once: the handler's status read cleared it
    expect(m.system.io.latch.bits & DISK_BIT).toBe(0);
  });
});

describe('master reset runs a Restore', () => {
  /** A Model I on a ROM that only spins with interrupts off, a JV1 in drive 0. */
  function machine() {
    const level2 = new Uint8Array(0x3000);
    level2.set([0xf3, 0x18, 0xfe]); // DI / JR $
    const m = new Machine({ model: 1, roms: { level2 } });
    m.fdc.mount(0, jv1());
    return m;
  }

  it('returns the head to track 0 at reset when a disk is mounted', () => {
    const m = machine();
    m.mem.write(0x37ef, [5]);
    m.mem.write(0x37ec, [0x18]); // Seek 5
    m.run({ cycles: 6 * ms(12) });
    expect(m.system.io.fdc.physicalTrack[0]).toBe(5);
    m.reset();
    m.run({ cycles: 6 * ms(40) });
    expect(m.system.io.fdc.physicalTrack[0]).toBe(0);
    expect(m.system.io.fdc.trackReg).toBe(0);
    expect(m.system.io.fdc.command).toBe(0x03);
  });

  it('starts nothing with no disk mounted', () => {
    const m = new Machine({ model: 1, roms: { level2: new Uint8Array(0x3000) } });
    m.reset();
    expect(m.system.io.fdc.pending).toBeNull();
    expect(m.system.io.latch.bits & DISK_BIT).toBe(0);
  });
});

/**
 * A 12K ROM holding a copy of the Level II ROM's disk boot (MDL1LEV2.Z80, $0693-$06C9, with
 * PAUSE at $0060): no controller ($37EC reads $FF or $00) jumps to a stub at $0040 that writes
 * "BASIC" to the screen; else drive 0 is selected, Restore, the pause, Busy waited out, and track
 * 0, sector 0 read to $4200 by polling DRQ, then a jump there.
 */
function bootRom() {
  const rom = new Uint8Array(0x3000);
  rom.set([
    0xf3, // 0000 DI
    0x31, 0x7d, 0x40, // 0001 LD SP,407DH
    0x3a, 0xec, 0x37, // 0004 LD A,(37ECH)
    0x3c, // 0007 INC A
    0xfe, 0x02, // 0008 CP 02H
    0xda, 0x40, 0x00, // 000A JP C,0040H
    0x3e, 0x01, // 000D LD A,01H
    0x32, 0xe1, 0x37, // 000F LD (37E1H),A
    0x21, 0xec, 0x37, // 0012 LD HL,37ECH
    0x11, 0xef, 0x37, // 0015 LD DE,37EFH
    0x36, 0x03, // 0018 LD (HL),03H
    0x01, 0x00, 0x00, // 001A LD BC,0000H
    0xcd, 0x60, 0x00, // 001D CALL 0060H
    0xcb, 0x46, // 0020 BIT 0,(HL)
    0x20, 0xfc, // 0022 JR NZ,0020H
    0xaf, // 0024 XOR A
    0x32, 0xee, 0x37, // 0025 LD (37EEH),A
    0x01, 0x00, 0x42, // 0028 LD BC,4200H
    0x3e, 0x8c, // 002B LD A,8CH
    0x77, // 002D LD (HL),A
    0xcb, 0x4e, // 002E BIT 1,(HL)
    0x28, 0xfc, // 0030 JR Z,002EH
    0x1a, // 0032 LD A,(DE)
    0x02, // 0033 LD (BC),A
    0x0c, // 0034 INC C
    0x20, 0xf7, // 0035 JR NZ,002EH
    0xc3, 0x00, 0x42, // 0037 JP 4200H
  ], 0);
  rom.set([0x21, 0x50, 0x00, 0x11, 0x00, 0x3c, 0x01, 0x05, 0x00, 0xed, 0xb0, 0x76], 0x40);
  rom.set([...'BASIC'].map((c) => c.charCodeAt(0)), 0x50);
  rom.set([0x0b, 0x78, 0xb1, 0x20, 0xfb, 0xc9], 0x60); // PAUSE: DEC BC / LD A,B / OR C / JR NZ / RET
  return rom;
}

describe('the Level II ROM\'s disk boot (a synthetic copy)', () => {
  it('boots a JV1\'s track 0, sector 0 at $4200', () => {
    const m = new Machine({ model: 1, roms: { level2: bootRom() } });
    const disk = jv1({ fill: (t, side, s) => (t === 0 && s === 0 ? bootSector('M1 DISK BOOT OK', MODEL1_BOOT_ORG) : pattern(t, side, s)) });
    expect(m.load.dsk(disk)).toEqual({ format: 'dsk', container: 'jv1', drive: 0, boot: true, blocks: [] });
    m.run({ cycles: 2 * HZ });
    expect(m.video.text()[0]).toMatch(/^M1 DISK BOOT OK/);
    expect(m.cpu.regs.pc).toBeGreaterThanOrEqual(MODEL1_BOOT_ORG);
  });

  it('goes to BASIC with no disk mounted (the controller reads $FF), and without the Expansion Interface', () => {
    for (const expansion of [true, false]) {
      const m = new Machine({ model: 1, roms: { level2: bootRom() }, expansion });
      m.run({ until: 'halt', cycles: HZ });
      expect(m.video.text()[0]).toMatch(/^BASIC/);
    }
  });
});

describe('Model I disk images', () => {
  const machine = (opts = {}) => new Machine({ model: 1, roms: { level2: new Uint8Array(0x3000) }, ...opts });

  it('mounts a 10-sector JV1 of 35 to 42, 77, or 80 tracks on a Model I', () => {
    const m = machine();
    for (const tracks of JV1_MODEL1_SD_TRACKS) {
      expect(m.fdc.mount(0, writeJv1({ tracks, spt: 10 }))).toMatchObject({ container: 'jv1', tracks, sectorsPerTrack: 10 });
    }
    expect(m.fdc.mount(0, writeJv1({ tracks: 40, spt: 18 }))).toMatchObject({ container: 'jv1', tracks: 40, sectorsPerTrack: 18 });
  });

  const REAR_GUARD_CMD = fileURLToPath(new URL('../../../../examples/rear-guard/reargrd4.cmd', import.meta.url));
  for (const [name, bytes] of /** @type {[string, () => Uint8Array][]} */ ([
    ['reargrd4.cmd', () => new Uint8Array(readFileSync(REAR_GUARD_CMD))],
    ['43 tracks of 10 sectors', () => new Uint8Array(43 * 2560)],
    ['34 tracks of 10 sectors', () => new Uint8Array(34 * 2560)],
    ['one 10-sector track', () => new Uint8Array(2560)],
    ['39 tracks of 18 sectors', () => new Uint8Array(39 * 18 * 256)],
  ])) {
    it(`refuses ${name} on a Model I too, naming the Model I's sizes`, () => {
      const m = machine();
      const b = bytes();
      const sentence = `Unrecognized disk image (${b.length} bytes): no DMK header, no JV3 sector table, and not a JV1 size (35, 40, 77, 80 tracks of 18 256-byte sectors, or 35-42, 77, 80 tracks of 10)`;
      expect(() => m.fdc.mount(0, b)).toThrow(`fdc.mount: ${sentence}`);
      expect(() => m.load.dsk(b)).toThrow(`load.dsk: ${sentence}`);
      expect(m.fdc.drives).toEqual([null, null, null, null]);
    });
  }

  it('a Model III still refuses a 36-track 10-sector JV1, with its own sentence', () => {
    const m = new Machine({ roms: { level2: new Uint8Array(0x3800) } });
    expect(() => m.fdc.mount(0, new Uint8Array(36 * 2560))).toThrow(/not a JV1 size \(35, 40, 77, 80 tracks of 18 or 10 256-byte sectors\)$/);
  });

  it('refuses a mount on a Model I without the Expansion Interface', () => {
    const m = machine({ expansion: false });
    const sentence = 'this Model I has no Expansion Interface, so no disk controller; construct the Machine with expansion: true (the default) to mount a disk';
    expect(() => m.fdc.mount(0, jv1())).toThrow(`fdc.mount: ${sentence}`);
    expect(() => m.load.dsk(jv1())).toThrow(`load.dsk: ${sentence}`);
  });

  it('a 36-track JV1 survives a snapshot and restore', () => {
    const m = machine();
    m.fdc.mount(1, writeJv1({ tracks: 36, spt: 10, fill: pattern }));
    const snap = JSON.parse(JSON.stringify(m.debug.snapshot()));
    const n = machine();
    n.debug.restore(snap);
    expect(n.fdc.drives[1]).toMatchObject({ container: 'jv1', tracks: 36 });
    expect(n.system.io.fdc.drives[1].readSector(35, 0, 9)).toEqual(Uint8Array.from(pattern(35, 0, 9)));
  });

  it('exports a 10-sector JV1\'s directory track with FA marks, an 18-sector one\'s with F8', () => {
    const sd = jv1();
    sd[2] = 17;
    const back = new DiskImage(new DiskImage(sd).toDMK());
    expect(back.trackIds(17, 0).every((id) => id.dam === 0xfa && id.mfm === false)).toBe(true);
    expect(back.trackIds(16, 0).every((id) => id.dam === 0xfb)).toBe(true);
    const ddBytes = writeJv1({ tracks: 40, spt: 18 });
    ddBytes[2] = 17;
    const dd = new DiskImage(new DiskImage(ddBytes).toDMK());
    expect(dd.trackIds(17, 0).every((id) => id.dam === 0xf8)).toBe(true);
    // The WD1793 model reads FA as deleted, as it read the F8 the export used to write
    expect(new DiskImage(sd).readSectorEx(17, 0, 0)).toMatchObject({ dam: 0xfa, deleted: true });
  });

  it('a snapshot mid-command restores the WD1771, its INTRQ, and the latch', () => {
    const m = machine();
    m.fdc.mount(0, jv1());
    const fdc = m.system.io.fdc;
    m.mem.write(0x37ee, [4]);
    m.mem.write(0x37ec, [0x88]);
    m.run({ cycles: PERIOD / 2 });
    const snap = JSON.parse(JSON.stringify(m.debug.snapshot()));
    expect(snap.fdc.mfm).toBe(false);
    const n = machine();
    n.debug.restore(snap);
    m.run({ cycles: PERIOD });
    n.run({ cycles: PERIOD });
    expect(n.system.io.fdc.intrq).toBe(fdc.intrq);
    expect(n.system.io.latch.bits).toBe(m.system.io.latch.bits);
    expect(JSON.stringify(n.debug.snapshot())).toBe(JSON.stringify(m.debug.snapshot()));
  });
});

describe('the debugger peeks at the WD1771', () => {
  const rom = (bytes) => {
    const r = new Uint8Array(0x3000);
    r.set(bytes, 0);
    return r;
  };

  it('a watched write to $37EC does not read the status register, so it cannot drop INTRQ', () => {
    // LD SP,8000H / DI / wait for (5100H) <> 0 / LD A,18H / LD (37ECH),A / HALT
    const m = new Machine({ model: 1, roms: { level2: rom([0x31, 0x00, 0x80, 0xf3, 0x3a, 0x00, 0x51, 0xb7, 0x28, 0xfa, 0x3e, 0x18, 0x32, 0xec, 0x37, 0x76]) } });
    m.fdc.mount(0, jv1());
    const fdc = m.system.io.fdc;
    let statusReads = 0;
    const readStatus = fdc.readStatus.bind(fdc);
    fdc.readStatus = () => {
      statusReads++;
      return readStatus();
    };
    m.reset();
    m.run({ cycles: 1000 }); // the reset's restore has ended: INTRQ up
    expect(fdc.intrq).toBe(true);
    const seen = [];
    m.debug.hooks.onMemWrite = (addr, value, prev) => seen.push([addr, value, prev]);
    m.debug.watch(0x37ec, 1, { write: true });
    m.mem.write(0x5100, [1]);
    m.run({ until: 'halt', cycles: 10000 });
    expect(statusReads).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0].slice(0, 2)).toEqual([0x37ec, 0x18]);
    expect(seen[0][2] & 0x04).toBe(0x04); // the old value is the Type I status (Track 00), peeked
  });
});
