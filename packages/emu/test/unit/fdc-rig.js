/**
 * A bench for the WD1793 through the IOSystem ports, with time under the test's control: the disk
 * starts at the index pulse, and `run` plays a CPU that answers each DRQ within `lag` T-states (or
 * not at all), the way the ROM and the DOSes drive the chip.
 */
import { IOSystem } from '../../src/machine/io.js';
import { DiskImage } from '../../src/devices/disk-image.js';
import { INDEX_PERIOD } from '../../src/devices/fdc-wd1793.js';

/**
 * An IOSystem with `disk` in `drive`, selected through port F4 (MFM by default), the disk at its
 * index pulse.
 * @param {Uint8Array | DiskImage} disk
 */
export function rig(disk, { select = 0x81, drive = 0 } = {}) {
  const io = new IOSystem();
  io.fdc.attachDrive(drive, disk instanceof DiskImage ? disk : new DiskImage(disk));
  io.writePort(0xf4, select);
  io.fdc.indexClock = 0;
  return io;
}

/**
 * Load `command` and run until Busy drops. Each DRQ is answered `lag` T-states after the tick that
 * raised it: by reading the data register, or by writing the next of `write`; `serve: false`
 * answers none. Returns the bytes read, the T-state (from the command) of each DRQ seen, the time
 * Busy dropped, and the raw status and INTRQ then (status read through `status`, which does not
 * clear INTRQ).
 * @param {IOSystem} io
 * @param {number} command
 * @param {{ write?: ArrayLike<number>, serve?: boolean, lag?: number, limit?: number }} [opts]
 */
export function run(io, command, { write, serve = true, lag = 8, limit = 8 * INDEX_PERIOD } = {}) {
  const fdc = io.fdc;
  const bytes = [];
  const drqAt = [];
  let t = 0;
  let w = 0;
  let before = false;
  io.writePort(0xf0, command);
  while (fdc.status & 0x01 && t < limit) {
    fdc.tick(lag);
    t += lag;
    const drq = fdc.commandType !== 1 && (fdc.status & 0x02) !== 0;
    if (drq && !before) drqAt.push(t);
    before = drq;
    if (drq && serve) {
      if (write) io.writePort(0xf3, write[w++] ?? 0);
      else bytes.push(io.readPort(0xf3));
      before = false;
    }
  }
  return { bytes, drqAt, t, status: fdc.status, intrq: fdc.intrq };
}

/** Tick the controller `n` T-states. */
export const wait = (io, n) => io.fdc.tick(n);
