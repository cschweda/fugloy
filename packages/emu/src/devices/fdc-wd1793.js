/**
 * WD1793 floppy disk controller (the Model III disk subsystem).
 *
 * Ports (handled by IOSystem):
 *   0xF0 status (R) / command (W)     0xF2 sector register
 *   0xF1 track register               0xF3 data register
 *   0xF4 (W) drive select: bits 0-3 drive, bit 4 side, bit 6 WAIT, bit 7 MFM
 *
 * The authority is the Western Digital FD179X data sheet; the copy read for this model is the
 * FD179X-01 sheet of October 1979 (bitsavers, components/westernDigital), whose command, flag,
 * and status descriptions the -02 part shares. Comments name its sections in quotes. All time is
 * in CPU T-states, so the controller is as deterministic as the CPU: a command is a chain of
 * timed events (`pending`), advanced by tick(). The CPU clock is a constructor option (`cpuHz`,
 * the Model III's 2.02752 MHz by default); every time below is derived from it, and the exported
 * constants are the Model III's values.
 *
 * The drive-select latch is the machine's: the FDC takes a decoded `select(drive, side, mfm)`,
 * and each model's I/O decodes its own port (the Model III's port F4 in machine/io.js).
 *
 * The disk turns at 300 rpm, one index pulse per 405,504 T-states at 2.02752 MHz (`indexClock`
 * is the angle). IDs pass at the positions DiskImage.trackIds gives, and data bytes arrive one
 * byte time apart: 32 microseconds in MFM and 64 in FM at the 5.25" data rates (250 and 125
 * kbit/s), 65 and 130 T-states at 2.02752 MHz. A byte the CPU has not taken when the next arrives is lost (status bit 2), as on the
 * chip; the Model III's WAIT (port F4 bit 6) lets the ROM and DOSes keep up with INI loops.
 *
 * Model III wiring assumed and not verified against the Technical Reference Manual (spec §5):
 * the controller runs from a 1 MHz clock (the data sheet's "Floppy Disk Interface": 1 MHz for
 * mini-floppies in both densities), so the 1 MHz column of the step rates and 30 ms settling
 * apply; READY is true when the selected drive holds a disk; HLT is always true.
 */

import { decodeModel3Select } from "../machine/drive-select.js";

// Status bits (data sheet, "Status Register Summary", Table 6)
const ST_BUSY = 0x01;
const ST_INDEX = 0x02; // Type I: index pulse
const ST_DRQ = 0x02; // Type II/III: data request
const ST_TRACK0 = 0x04; // Type I
const ST_LOST_DATA = 0x04; // Type II/III
const ST_CRC_ERROR = 0x08;
const ST_SEEK_ERROR = 0x10; // Type I
const ST_RNF = 0x10; // Type II/III: record not found
const ST_HEAD_LOADED = 0x20; // Type I
const ST_RECORD_TYPE = 0x20; // Read Sector: deleted data mark
const ST_WRITE_PROTECT = 0x40;
const ST_NOT_READY = 0x80;

/** The Model III CPU clock (trs80-system.js CPU_CLOCK_HZ), the default `cpuHz`. */
export const MODEL3_CPU_HZ = 2027520;

/**
 * The controller's times in T-states of a CPU clocked at `cpuHz`: one revolution at 300 rpm
 * (0.2 s), the index pulse's width (5.25" drives: about 4 ms; 8,000 T-states at 2.02752 MHz),
 * "Stepping Rates" (Table 1) in the CLK = 1 MHz column for r1 r0 = 00, 01, 10, 11, "Head
 * Positioning"'s 15 ms of settling doubled to 30 ms with a 1 MHz clock, and one byte at 250
 * kbit/s (MFM) and 125 kbit/s (FM): 32 and 64 microseconds.
 * @param {number} cpuHz
 */
export function fdcTimes(cpuHz) {
  const ms = (/** @type {number} */ n) => Math.round((n * cpuHz) / 1000);
  return {
    indexPeriod: Math.round(cpuHz / 5),
    indexWidth: Math.round((8000 * cpuHz) / MODEL3_CPU_HZ),
    step: [6, 12, 20, 30].map(ms),
    settle: ms(30),
    byteMfm: Math.round((32 * cpuHz) / 1e6),
    byteFm: Math.round((64 * cpuHz) / 1e6),
  };
}

const MODEL3 = fdcTimes(MODEL3_CPU_HZ);
/** One revolution at 300 rpm on the Model III. */
export const INDEX_PERIOD = MODEL3.indexPeriod;
/** "Stepping Rates" (Table 1), the CLK = 1 MHz column, on the Model III. */
export const STEP_TSTATES = MODEL3.step;
/** "Head Positioning": 30 ms of settling with a 1 MHz clock, on the Model III. */
export const SETTLE_TSTATES = MODEL3.settle;
/** One byte at 250 kbit/s (MFM) and 125 kbit/s (FM), on the Model III. */
export const BYTE_TSTATES_MFM = MODEL3.byteMfm;
export const BYTE_TSTATES_FM = MODEL3.byteFm;

/**
 * How long an ID search runs before Record Not Found or Seek Error: the data sheet says "within
 * 5 revolutions" (Type I verify, "Head Positioning") and "5 index pulses" (side compare) in some
 * places and "four revolutions" in others ("Type I Commands", "Type II Commands"); the search ends
 * at the fifth index pulse, which satisfies both readings.
 */
const SEARCH_INDEX_PULSES = 5;
/** "Type I Commands": idle (not busy) for 15 revolutions, the head is disengaged. */
const HEAD_UNLOAD_PULSES = 15;

// WRITE TRACK capture cap, a guard: one revolution of MFM is 6,238 byte times here.
const TRACK_WRITE_CAP = 20000;

/** CRC-CCITT preset FFFF, as the 179X writes it after ID and data fields. */
function crc16(bytes, crc = 0xffff) {
  for (const b of bytes) {
    crc ^= b << 8;
    for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/**
 * Turn the byte stream a formatting DOS sends during WRITE TRACK into
 * sectors. MFM control bytes: 0xF5 writes an A1 sync byte, 0xFE starts
 * an ID field (track, side, sector, size code), 0xFB/0xF8 start a
 * normal/deleted data field, 0xF7 writes the CRC. FM (single density)
 * uses the bare marks after a run of 0x00 sync bytes. The density latch
 * is only a guess about what the DOS meant, so a parse that finds no
 * sectors retries as the other density. With `fmMarks` (the WD1771) the FM
 * data marks FA and F9 start a data field too, and each sector carries
 * its mark as `dam` (FD1771-01 data sheet, "Control Bytes for
 * Initialization": F8, F9, FA, FB are data address marks).
 *
 * @returns {{track:number, side:number, sector:number, size:number,
 *            deleted:boolean, data:Uint8Array, mfm:boolean}[]}
 */
export function parseWriteTrackStream(bytes, mfmGuess = true, fmMarks = false) {
  const first = mfmGuess ? scanMfm(bytes) : scanFm(bytes, fmMarks);
  if (first.length) return first;
  return mfmGuess ? scanFm(bytes, fmMarks) : scanMfm(bytes);
}

function scanMfm(bytes) {
  const sectors = [];
  let i = 0;
  let id = null;
  while (i < bytes.length) {
    if (bytes[i] !== 0xf5) {
      i++;
      continue;
    }
    let j = i;
    while (j < bytes.length && bytes[j] === 0xf5) j++;
    const mark = bytes[j];
    if (mark === 0xfe && j + 4 < bytes.length) {
      id = {
        track: bytes[j + 1],
        side: bytes[j + 2],
        sector: bytes[j + 3],
        size: 128 << (bytes[j + 4] & 3),
      };
      i = j + 5;
    } else if ((mark === 0xfb || mark === 0xf8) && id) {
      sectors.push({
        ...id,
        deleted: mark === 0xf8,
        data: bytes.slice(j + 1, j + 1 + id.size),
        mfm: true,
      });
      i = j + 1 + id.size;
      id = null;
    } else {
      i = j + 1;
    }
  }
  return sectors;
}

function scanFm(bytes, fmMarks = false) {
  const sectors = [];
  let i = 0;
  let id = null;
  let zeros = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 0x00) {
      zeros++;
      i++;
      continue;
    }
    if (zeros >= 2) {
      if (b === 0xfe && i + 4 < bytes.length) {
        id = {
          track: bytes[i + 1],
          side: bytes[i + 2],
          sector: bytes[i + 3],
          size: 128 << (bytes[i + 4] & 3),
        };
        zeros = 0;
        i += 5;
        continue;
      }
      if ((b === 0xfb || b === 0xf8 || (fmMarks && (b === 0xfa || b === 0xf9))) && id) {
        sectors.push({
          ...id,
          deleted: b === 0xf8,
          ...(fmMarks ? { dam: b } : {}),
          data: bytes.slice(i + 1, i + 1 + id.size),
          mfm: false,
        });
        zeros = 0;
        i += 1 + id.size;
        id = null;
        continue;
      }
    }
    zeros = 0;
    i++;
  }
  return sectors;
}


/**
 * A synthesized raw track for READ TRACK on a container that keeps no raw bytes (JV1, JV3): the
 * data sheet's IBM System 34 layout in MFM ("IBM System 34 Format") or IBM 3740 in FM ("IBM 3740
 * Format"), sector data from the image, CRCs computed, padded with gap bytes to `length`. When the
 * IBM gaps do not fit a revolution (18 sectors of 256 bytes in MFM do not), the minimum gaps of
 * "Non-IBM Formats" are used, without the optional index mark.
 */
function synthesizeTrack(ids, dataOf, mfm, length) {
  const ibm = layTrack(ids, dataOf, mfm, true);
  const laid = ibm.length <= length ? ibm : layTrack(ids, dataOf, mfm, false);
  const out = new Uint8Array(length).fill(mfm ? 0x4e : 0xff);
  out.set(laid.slice(0, length));
  return out;
}

function layTrack(ids, dataOf, mfm, ibm) {
  const out = [];
  const run = (n, v) => {
    for (let k = 0; k < n; k++) out.push(v);
  };
  const sync = mfm ? [0xa1, 0xa1, 0xa1] : [];
  const gapByte = mfm ? 0x4e : 0xff;
  if (!ibm) run(mfm ? 32 : 16, gapByte); // Gap I
  else if (mfm) {
    run(80, 0x4e);
    run(12, 0x00);
    out.push(0xc2, 0xc2, 0xc2, 0xfc);
    run(50, 0x4e);
  } else {
    run(40, 0xff);
    run(6, 0x00);
    out.push(0xfc);
    run(26, 0xff);
  }
  for (const id of ids) {
    run(mfm ? 12 : 6, 0x00);
    const idField = [0xfe, id.track, id.side, id.sector, id.sizeCode];
    const idCrc = crc16([...sync, ...idField]);
    out.push(...sync, ...idField, idCrc >> 8, idCrc & 0xff);
    run(mfm ? 22 : 11, gapByte);
    run(mfm ? 12 : 6, 0x00);
    const data = [id.dam ?? (id.deleted ? 0xf8 : 0xfb), ...(dataOf(id) ?? new Uint8Array(id.size))];
    const dataCrc = crc16([...sync, ...data]);
    out.push(...sync, ...data, dataCrc >> 8, dataCrc & 0xff);
    run(ibm ? (mfm ? 54 : 27) : mfm ? 24 : 10, gapByte); // Gap III
  }
  return out;
}

export class FDC1793 {
  /** @param {{ cpuHz?: number }} [opts] the CPU clock the controller's times count in */
  constructor({ cpuHz = MODEL3_CPU_HZ } = {}) {
    this.cpuHz = cpuHz;
    const t = fdcTimes(cpuHz);
    this.indexPeriod = t.indexPeriod;
    this.indexWidth = t.indexWidth;
    this.stepTStates = t.step;
    this.settleTStates = t.settle;
    this.byteTStatesMfm = t.byteMfm;
    this.byteTStatesFm = t.byteFm;

    this.drives = [null, null, null, null]; // DiskImage or null
    this.selected = 0; // -1 when a port F4 write selected no drive
    this.side = 0;
    this.mfm = true; // port 0xF4 bit 7 density latch (Model III default DD)

    this.trackReg = 0;
    this.sectorReg = 0;
    this.dataReg = 0;
    this.physicalTrack = [0, 0, 0, 0];

    this.status = 0;
    this.intrq = false;
    this.commandType = 1;
    this.command = 0; // the last command byte loaded
    this.stepDir = 1; // +1 toward track 76 (in), -1 toward track 0 (out)
    this.headLoaded = false; // HLD (HLT is taken as always true)
    this.idlePulses = 0; // index pulses while idle with the head loaded
    this.intrqCond = 0; // Force Interrupt condition bits I3-I0

    // The command in flight: a plain object (it is serialized as it is) naming the next event,
    // the T-states until it, and what the command has to remember.
    this.pending = null;
    this.buffer = null; // sector, ID, or track bytes being read or written
    this.writeDeleted = false; // WRITE SECTOR bit a0: write an F8 data mark
    this.trackWrite = null; // WRITE TRACK capture (array of bytes)

    this.indexClock = 0;

    // What differs on the WD1771 (fdc-wd1771.js), at the WD1793's values: index pulses to an ID
    // search's end and to the head's unloading, the sector register's source in Read Address (0,
    // the ID's track), and whether Write Track takes the FM marks FA and F9.
    this.searchPulses = SEARCH_INDEX_PULSES;
    this.headUnloadPulses = HEAD_UNLOAD_PULSES;
    this.readAddressField = 0;
    this.fmMarks = false;
  }

  attachDrive(n, image) {
    const was = this._ready();
    this.drives[n & 3] = image;
    this._readyChanged(was);
  }

  ejectDrive(n) {
    const was = this._ready();
    this.drives[n & 3] = null;
    this._readyChanged(was);
  }

  anyDiskMounted() {
    return this.drives.some((d) => d !== null);
  }

  currentDisk() {
    return this.selected < 0 ? null : this.drives[this.selected];
  }

  /** Controller reset with the machine: no command, no interrupt; heads and registers stay. */
  reset() {
    this.intrq = false;
    this.intrqCond = 0;
    this.pending = null;
    this.buffer = null;
    this.trackWrite = null;
    this.status = 0;
    this.commandType = 1;
  }

  _ready() {
    return this.currentDisk() !== null;
  }

  /** "Force Interrupt": I0 fires on a not-ready-to-ready transition, I1 on ready-to-not-ready. */
  _readyChanged(was) {
    const now = this._ready();
    if (!was && now && this.intrqCond & 0x01) this.intrq = true;
    if (was && !now && this.intrqCond & 0x02) this.intrq = true;
  }

  get _track() {
    return this.selected < 0 ? 0 : this.physicalTrack[this.selected];
  }

  /**
   * The drive-select latch, decoded: `drive` 0-3, or -1 for none; `side` 0 or 1; `mfm` the density
   * (true double, false single). Each model's I/O decodes its own select port into this (the
   * Model III's port F4: machine/drive-select.js, decodeModel3Select, applied in machine/io.js).
   * @param {number} drive
   * @param {number} side
   * @param {boolean} mfm
   */
  select(drive, side, mfm) {
    const was = this._ready();
    this.selected = drive >= 0 && drive <= 3 ? drive : -1;
    this.side = side ? 1 : 0;
    this.mfm = !!mfm;
    this._readyChanged(was);
  }

  /**
   * A Model III port F4 byte (bits 0-3 drive, bit 4 side, bit 7 MFM), for a bare controller driven
   * without the machine's I/O (tests, probes). The machine decodes port F4 in machine/io.js and
   * calls select(); the decoding is that module's, and this applies it.
   * @param {number} value
   */
  selectDrive(value) {
    const d = decodeModel3Select(value);
    this.select(d.drive, d.side, d.mfm);
  }

  /**
   * The Model III WAIT (port F4 bit 6): the CPU is held until DRQ or INTRQ rises. Runs the
   * controller forward to that moment and returns the T-states it took, which the caller adds to
   * the CPU's clock; 0 when DRQ or INTRQ is already up or no command is running (nothing would
   * release the line; real hardware would hang, and the model does not).
   *
   * The controller is ticked after each instruction, so when the OUT that sets WAIT runs, its clock
   * still stands at the start of that OUT: the wait runs ahead from there, and the OUT's own
   * T-states (11 for `OUT (n),A`) are ticked after the DRQ. A DRQ can thus release the CPU up to
   * 11 T-states before the OUT would have ended, well inside the 65 T-state MFM byte window, and
   * the ROM's `OUT`/`INI` loop takes every byte either way.
   */
  waitForDrq() {
    let total = 0;
    const cap = (this.searchPulses + 2) * this.indexPeriod;
    while (this.pending !== null && !(this.status & ST_DRQ && this.commandType !== 1) && !this.intrq && total < cap) {
      const d = Math.max(0, this.pending.delay);
      this.tick(d);
      total += d;
    }
    return total;
  }

  /** Advance emulated time by `cycles` T-states, running the command's events as they fall due. */
  tick(cycles) {
    const p = this.pending;
    if (p !== null) {
      if (p.delay <= cycles) {
        this._runEvents(cycles);
        return;
      }
      p.delay -= cycles;
    }
    this.indexClock += cycles;
    if (this.indexClock >= this.indexPeriod) this._advance(0);
  }

  _runEvents(cycles) {
    while (this.pending !== null && this.pending.delay <= cycles) {
      const d = Math.max(0, this.pending.delay);
      this._advance(d);
      cycles -= d;
      this.pending.delay = 0;
      this._event();
    }
    if (this.pending !== null) this.pending.delay -= cycles;
    this._advance(cycles);
  }

  _advance(d) {
    this.indexClock += d;
    while (this.indexClock >= this.indexPeriod) {
      this.indexClock -= this.indexPeriod;
      this._indexPulse();
    }
  }

  _indexPulse() {
    if (!this._ready()) return; // no disk turning, no index pulses
    if (!(this.status & ST_BUSY) && this.headLoaded && ++this.idlePulses >= this.headUnloadPulses) {
      this.headLoaded = false;
    }
    if (this.intrqCond & 0x04) this.intrq = true; // Force Interrupt I2: every index pulse
  }

  _byteTime() {
    return this.mfm ? this.byteTStatesMfm : this.byteTStatesFm;
  }

  /** T-states until the disk turns to `pos` (a fraction of a revolution after the index pulse). */
  _until(pos) {
    const d = Math.round(pos * this.indexPeriod) - this.indexClock;
    return d < 0 ? d + this.indexPeriod : d;
  }

  /** T-states until the fifth index pulse from now: where an ID search gives up. */
  _searchWindow() {
    return this.indexPeriod - this.indexClock + (this.searchPulses - 1) * this.indexPeriod;
  }

  /** The IDs the head can read now, in the order they pass: this track side, this density. */
  _passingIds() {
    const disk = this.currentDisk();
    if (!disk) return [];
    return disk
      .trackIds(this._track, this.side)
      .filter((id) => id.mfm === null || id.mfm === this.mfm)
      .map((id) => ({ id, at: this._until(id.pos) }))
      .sort((a, b) => a.at - b.at);
  }

  _finish() {
    this.status &= ~ST_BUSY;
    this.intrq = true;
    this.pending = null;
    this.buffer = null;
    this.trackWrite = null;
    this.idlePulses = 0;
  }

  _type1Status() {
    const disk = this.currentDisk();
    let s = this.status & (ST_BUSY | ST_SEEK_ERROR | ST_CRC_ERROR);
    if (!disk) s |= ST_NOT_READY;
    if (disk && disk.writeProtected) s |= ST_WRITE_PROTECT;
    if (this.headLoaded) s |= ST_HEAD_LOADED; // HLD and HLT, HLT taken as true
    if (this.selected >= 0 && this._track === 0) s |= ST_TRACK0;
    if (disk && this.indexClock < this.indexWidth) s |= ST_INDEX;
    return s;
  }

  /**
   * Port 0xF0 read. Reading status resets INTRQ ("General Disk Read Operations"), except an
   * immediate interrupt (Force Interrupt I3), which only a later D0 lets clear. Type I status is
   * live: Not Ready, Write Protect, Head Loaded, Track 00, and Index copy the drive's lines
   * ("Status for Type I Commands"); Type II and III report Not Ready live too.
   */
  readStatus() {
    if (!(this.intrqCond & 0x08)) this.intrq = false;
    return this.peekStatus();
  }

  /** The status register as a read returns it, leaving INTRQ alone (for the debugger). */
  peekStatus() {
    if (this.commandType === 1) return this._type1Status();
    return (this.status & ~ST_NOT_READY) | (this._ready() ? 0 : ST_NOT_READY);
  }

  /** Port 0xF0 write */
  writeCommand(value) {
    value &= 0xff;
    const high = value >> 4;
    if (high === 0x0d) {
      this._forceInterrupt(value);
      return;
    }
    // "Command Description": a command other than Force Interrupt is loaded only when not busy.
    if (this.status & ST_BUSY) return;
    // Loading the command register resets INTRQ, unless an immediate interrupt holds it.
    if (!(this.intrqCond & 0x08)) this.intrq = false;
    this.intrqCond &= 0x08; // conditions I0-I2 end with a new command (unverified)
    this.command = value;
    this.idlePulses = 0;
    if (high <= 0x07) this._startType1(value);
    else if (high <= 0x0b) this._startType2(value);
    else this._startType3(value);
  }

  /**
   * "Force Interrupt": a running command stops, Busy resets, and the other status bits stay; with
   * none running, Busy resets and the status reflects Type I. I3 interrupts at once and holds
   * INTRQ ("requires reset": only a D0 lets a later status read or command load clear it); I2
   * interrupts at every index pulse; I0 and I1 on ready transitions; none of them: no interrupt.
   */
  _forceInterrupt(value) {
    if (this.status & ST_BUSY) {
      this.pending = null;
      this.buffer = null;
      this.trackWrite = null;
      // DRQ is cleared with Busy. The sheet ("Force Interrupt") says "the Busy status bit is
      // reset, and the rest of the status bits are unchanged", which read literally leaves DRQ
      // set; the model drops it because the stopped command will move no more bytes, so a DRQ
      // left up would request one nobody can take. Unverified: spec §5.
      this.status &= ~(ST_BUSY | (this.commandType === 1 ? 0 : ST_DRQ));
      this.idlePulses = 0;
    } else {
      this.commandType = 1;
      this.status = 0;
    }
    if (!(this.intrqCond & 0x08)) this.intrq = false; // a command load resets INTRQ
    this.intrqCond = value & 0x0f;
    if (this.intrqCond & 0x08) this.intrq = true;
  }

  // ---------------------------------------------------------------- Type I

  /**
   * Restore, Seek, Step, Step-In, Step-Out ("Type I Commands"). h loads the head at the start
   * (h = 0 unloads it); one step pulse per r1 r0 period, the head moving one track each; a step
   * outward with Track 00 active issues no pulse and ends with the track register 0 (the flow
   * chart, `_atTrack0Outward`); V verifies after the last step: the head loads, 30 ms
   * settle, then the first ID with a good CRC must carry the track register's number.
   */
  _startType1(value) {
    this.commandType = 1;
    this.status = ST_BUSY; // Seek Error and CRC Error "reset to 0 when updated"
    this.headLoaded = (value & 0x08) !== 0;
    const high = value >> 4;
    const op = high === 0 ? "restore" : high === 1 ? "seek" : "step";
    if (high >= 0x04) this.stepDir = high >= 0x06 ? -1 : 1;
    if (op === "restore") this.stepDir = -1;
    this.pending = {
      kind: "type1",
      phase: "step",
      delay: 0,
      op,
      // Restore issues at most 255 pulses; Step one; Seek until TR = DR.
      left: op === "restore" ? 255 : op === "step" ? 1 : 0,
      update: op === "step" ? (value & 0x10) !== 0 : true,
      verify: (value & 0x04) !== 0,
      rate: this.stepTStates[value & 3],
    };
  }

  _type1Event(p) {
    if (p.phase === "step") {
      if (p.op === "restore") {
        // "Restore": TR00 is sampled; when active the track register is loaded with zeroes.
        if (this._track === 0 && this.selected >= 0) {
          this.trackReg = 0;
          this._afterSteps(p);
          return;
        }
        if (p.left === 0) {
          // "If the TR00 input does not go active low after 255 stepping pulses ... sets the
          // Seek error status bit."
          this.status |= ST_SEEK_ERROR;
          this._finish();
          return;
        }
        p.left--;
        this._stepPulse(-1);
        p.delay = p.rate;
        return;
      }
      if (p.op === "seek") {
        // "Seek": the track register is updated and step pulses issued until TR = DR.
        if (this.trackReg === this.dataReg) {
          this._afterSteps(p);
          return;
        }
        this.stepDir = this.dataReg > this.trackReg ? 1 : -1;
        this.trackReg = (this.trackReg + this.stepDir) & 0xff;
        if (this._atTrack0Outward(p)) return;
        this._stepPulse(this.stepDir);
        p.delay = p.rate;
        return;
      }
      // Step, Step-In, Step-Out: one pulse; with u = 1 the track register follows it.
      if (p.left === 0) {
        this._afterSteps(p);
        return;
      }
      p.left = 0;
      if (p.update) this.trackReg = (this.trackReg + this.stepDir) & 0xff;
      if (this._atTrack0Outward(p)) return;
      this._stepPulse(this.stepDir);
      p.delay = p.rate;
      return;
    }
    if (p.phase === "settle") {
      this._verify(p);
      return;
    }
    if (p.phase === "verified") {
      this.status |= p.result;
      this._finish();
    }
  }

  /**
   * The "Type I Command Flow" chart (page 9 of the FD179X-01 sheet): after the track register is
   * updated, "Is head at track 0 and direction = 0?" (TR00 active, stepping out) leads to "0 to
   * TR" and on to the verify branch, with no step pulse and no r1 r0 delay. So a Step-Out or an
   * outward Seek with the head on track 0 ends at once with the track register 0, whatever u is.
   * Needs a selected drive: with none, TR00 is not active.
   */
  _atTrack0Outward(p) {
    if (this.stepDir !== -1 || this.selected < 0 || this._track !== 0) return false;
    this.trackReg = 0;
    this._afterSteps(p);
    return true;
  }

  _stepPulse(dir) {
    if (this.selected < 0) return;
    const t = this.physicalTrack[this.selected] + dir;
    this.physicalTrack[this.selected] = Math.min(255, Math.max(0, t));
  }

  _afterSteps(p) {
    if (!p.verify) {
      this._finish();
      return;
    }
    // "h = 0 and V = 1: HLD is set near the end of the command, an internal 15 ms [30 ms at
    // 1 MHz] occurs"; with h = 1 the same delay follows the last step.
    this.headLoaded = true;
    p.phase = "settle";
    p.delay = this.settleTStates;
  }

  /**
   * Type I verification ("Type I Commands"): IDs are read as they pass. A good CRC decides: the
   * track matches the track register (done) or it does not (Seek Error). A bad CRC sets CRC Error
   * and the next ID is read. With no good ID before the search window ends: Seek Error.
   */
  _verify(p) {
    const B = this._byteTime();
    let crc = 0;
    for (const { id, at } of this._passingIds()) {
      if (!id.idCrcOk) {
        crc = ST_CRC_ERROR;
        continue;
      }
      p.phase = "verified";
      p.result = crc | (id.track === this.trackReg ? 0 : ST_SEEK_ERROR);
      p.delay = at + 7 * B; // the ID field: mark, four bytes, two CRC bytes
      return;
    }
    p.phase = "verified";
    p.result = crc | ST_SEEK_ERROR;
    p.delay = this._searchWindow();
  }

  // ---------------------------------------------------------------- Type II

  /**
   * Read Sector, Write Sector ("Type II Commands"): 1 0 0 m S E C 0 and 1 0 1 m S E C a0. Ready is
   * sampled first (not ready: not executed, interrupt); a write to a protected disk is "immediately
   * terminated, an interrupt is generated and the Write Protect status bit is set" ("Disk Write
   * Operation"); the head loads, E adds the 30 ms settle, and the ID search begins.
   */
  _startType2(value) {
    this.commandType = 2;
    this.status = 0;
    const write = (value & 0x20) !== 0;
    if (!this._ready()) {
      this._finish();
      return;
    }
    if (write && this.currentDisk().writeProtected) {
      this.status = ST_WRITE_PROTECT;
      this._finish();
      return;
    }
    this.status = ST_BUSY;
    this.headLoaded = true;
    this.writeDeleted = write && (value & 0x01) !== 0;
    this.pending = {
      kind: write ? "write" : "read",
      phase: "search",
      delay: value & 0x04 ? this.settleTStates : 0,
      multiple: (value & 0x10) !== 0,
      compareSide: (value & 0x02) !== 0,
      sideFlag: (value >> 3) & 1,
      sector: 0, // the ID's sector number once found
      k: 0, // bytes transferred
    };
  }

  /**
   * The Type II ID search: the next ID with the track register's track, the sector register's
   * sector, the S flag's side when C = 1, and a good CRC. Matching IDs with bad CRCs set CRC Error
   * on the way; none found by the fifth index pulse: Record Not Found.
   */
  _search(p) {
    let crc = 0;
    for (const { id, at } of this._passingIds()) {
      if (id.track !== this.trackReg || id.sector !== this.sectorReg) continue;
      if (p.compareSide && (id.side & 1) !== p.sideFlag) continue;
      if (!id.idCrcOk) {
        crc = ST_CRC_ERROR;
        continue;
      }
      // "Read Sector": no data mark within 30 (FM) or 43 (MFM) bytes of the ID's CRC, and "the ID
      // field is searched for and verified again". Write Sector writes its own mark and needs none.
      if (id.noData && p.kind === "read") continue;
      this.status |= crc;
      return { id, at };
    }
    this.status |= crc;
    return null;
  }

  _type2Event(p) {
    const B = this._byteTime();
    switch (p.phase) {
      case "search": {
        const found = this._search(p);
        if (!found) {
          p.phase = "rnf";
          p.delay = this._searchWindow();
          return;
        }
        const { id, at } = found;
        p.sector = id.sector;
        p.index = id.index; // which ID, when two on the track share the sector number
        p.size = id.size;
        p.k = 0;
        if (p.kind === "read") {
          // "Read Sector": the data mark's type goes to status bit 5; the first data byte is in
          // the DR one byte time after it has passed the head.
          const read = this.currentDisk().readSectorEx(this._track, this.side, id.sector, id.index);
          this.buffer = read ? read.data : new Uint8Array(id.size);
          p.crcOk = id.dataCrcOk;
          this.status = (this.status & ~ST_RECORD_TYPE) | (id.deleted ? ST_RECORD_TYPE : 0);
          p.phase = "data";
          p.delay = at + (id.dataGap + 1) * B;
        } else {
          // "Write Sector": DRQ once the ID field has passed.
          this.buffer = new Uint8Array(id.size);
          p.phase = "drq";
          p.delay = at + 7 * B;
        }
        return;
      }
      case "rnf":
        this.status |= ST_RNF;
        this._finish();
        return;
      case "data": {
        // A byte reaches the DR; if the computer has not read the last one it is lost.
        if (this.status & ST_DRQ) this.status |= ST_LOST_DATA;
        this.dataReg = this.buffer[p.k++];
        this.status |= ST_DRQ;
        if (p.k < this.buffer.length) p.delay = B;
        else {
          p.phase = "crc";
          p.delay = 2 * B;
        }
        return;
      }
      case "crc":
        // A bad data CRC ends the command, "even if it is a multiple record command".
        if (!p.crcOk) {
          this.status |= ST_CRC_ERROR;
          this._finish();
          return;
        }
        this._nextRecord(p);
        return;
      case "drq":
        this.status |= ST_DRQ;
        p.phase = "gate";
        p.delay = (this.mfm ? 22 : 11) * B;
        return;
      case "gate":
        // "counts off 11 bytes in single density and 22 bytes in double density ... If DRQ has
        // not been serviced, the command is terminated and the Lost Data status bit is set."
        if (this.status & ST_DRQ) {
          this.status = (this.status & ~ST_DRQ) | ST_LOST_DATA;
          this._finish();
          return;
        }
        // Then 6 (FM) or 12 (MFM) zeros, the A1s in MFM, and the data mark go out first.
        p.phase = "wbyte";
        p.delay = (this.mfm ? 12 + 3 + 1 : 6 + 1) * B;
        return;
      case "wbyte": {
        // The DR goes to the shift register; "If the DRQ is not serviced in time ... a byte of
        // zeros is written on the disk", Lost Data set, the command goes on.
        let byte = this.dataReg;
        if (p.k > 0 && this.status & ST_DRQ) {
          byte = 0;
          this.status |= ST_LOST_DATA;
        }
        this.buffer[p.k++] = byte;
        if (p.k < this.buffer.length) {
          this.status |= ST_DRQ;
          p.delay = B;
        } else {
          p.phase = "wcrc";
          p.delay = 3 * B; // two CRC bytes and one byte of ones
        }
        return;
      }
      case "wcrc":
        // `p.dam` is the WD1771's a1 a0 mark (fdc-wd1771.js); the WD1793 writes FB or F8 by a0
        this.currentDisk()?.writeSector(this._track, this.side, p.sector, this.buffer, {
          deleted: this.writeDeleted,
          dam: p.dam,
          index: p.index,
        });
        this._nextRecord(p);
        return;
      default:
        this._finish();
    }
  }

  /** "m = 1": the sector register counts up and the next record follows, until one is not found. */
  _nextRecord(p) {
    if (!p.multiple) {
      this._finish();
      return;
    }
    this.sectorReg = (this.sectorReg + 1) & 0xff;
    this.buffer = null;
    p.phase = "search";
    p.delay = 0;
  }

  // ---------------------------------------------------------------- Type III

  /**
   * Read Address (1 1 0 0 0 E 0 0), Read Track (1 1 1 0 0 E 0 0), Write Track (1 1 1 1 0 E 0 0)
   * ("Type III Commands"). Ready is sampled as for Type II; Write Track on a protected disk stops
   * at once with Write Protect.
   */
  _startType3(value) {
    this.commandType = 3;
    this.status = 0;
    const high = value >> 4;
    const kind = high === 0x0c ? "address" : high === 0x0e ? "track" : "format";
    if (!this._ready()) {
      this._finish();
      return;
    }
    if (kind === "format" && this.currentDisk().writeProtected) {
      this.status = ST_WRITE_PROTECT;
      this._finish();
      return;
    }
    this.status = ST_BUSY;
    this.headLoaded = true;
    this.pending = { kind, phase: "start", delay: value & 0x04 ? this.settleTStates : 0, k: 0 };
    // "Write Track": "The Data Request is activated immediately upon receiving the command".
    if (kind === "format") this.status |= ST_DRQ;
  }

  _type3Event(p) {
    const B = this._byteTime();
    if (p.kind === "address") {
      if (p.phase === "start") {
        // "Read Address": the next ID field's six bytes, a DRQ for each.
        const next = this._passingIds()[0];
        if (!next) {
          p.phase = "rnf";
          p.delay = this._searchWindow();
          return;
        }
        const { id, at } = next;
        const crc = crc16([...(this.mfm ? [0xa1, 0xa1, 0xa1] : []), 0xfe, id.track, id.side, id.sector, id.sizeCode]);
        // A DMK ID with a bad CRC shows its own CRC bytes; the model keeps them good-looking but
        // flags the error, which is what the status reports.
        this.buffer = Uint8Array.from([id.track, id.side, id.sector, id.sizeCode, crc >> 8, crc & 0xff]);
        p.crcOk = id.idCrcOk;
        // No longer read (the sector register takes buffer[readAddressField]); kept so a Read
        // Address in flight serializes as it did before emu phase 6
        p.idTrack = id.track;
        p.phase = "data";
        p.delay = at + 2 * B;
        return;
      }
      if (p.phase === "data") {
        if (this.status & ST_DRQ) this.status |= ST_LOST_DATA;
        this.dataReg = this.buffer[p.k++];
        this.status |= ST_DRQ;
        if (p.k < this.buffer.length) {
          p.delay = B;
          return;
        }
        // "The Track Address of the ID field is written into the sector register" (the WD1771
        // writes the sector address: `readAddressField`); the CRC is checked.
        this.sectorReg = this.buffer[this.readAddressField];
        if (!p.crcOk) this.status |= ST_CRC_ERROR;
        this._finish();
        return;
      }
      this.status |= ST_RNF;
      this._finish();
      return;
    }

    const perRevolution = Math.floor(this.indexPeriod / B);
    if (p.phase === "start") {
      // Both start "with the leading edge of the first encountered index pulse".
      p.phase = "index";
      p.delay = this.indexPeriod - this.indexClock;
      return;
    }
    if (p.kind === "track") {
      if (p.phase === "index") {
        // The drive went empty or was deselected while the command waited for the index pulse
        // (an OUT to the select port, or m.fdc.unmount). With no disk turning there is no index
        // pulse and nothing to read; the chip would wait for one that never comes, and the model
        // ends the command instead, as Type II and III end when Ready is false at the start: Busy
        // reset, an interrupt, and Not Ready in the status, which reports it live (spec §5,
        // unverified).
        if (!this._ready()) {
          this._finish();
          return;
        }
        this.buffer = this._rawTrack(perRevolution);
        p.k = 0;
        p.phase = "data";
        p.delay = B;
        return;
      }
      // "Read Track": every byte, gaps included, no CRC check, until the next index pulse.
      if (this.status & ST_DRQ) this.status |= ST_LOST_DATA;
      this.dataReg = this.buffer[p.k++];
      this.status |= ST_DRQ;
      if (p.k < this.buffer.length) p.delay = B;
      else this._finish();
      return;
    }
    // "Write Track"
    if (p.phase === "index") {
      // No disk turning: no index pulse to start at; ended as Read Track's is (above).
      if (!this._ready()) {
        this.status &= ~ST_DRQ;
        this._finish();
        return;
      }
      // "If the DR has not been loaded by the time the index pulse is encountered the operation
      // is terminated making the device Not Busy, the Lost Data Status Bit is set".
      if (this.status & ST_DRQ) {
        this.status = (this.status & ~ST_DRQ) | ST_LOST_DATA;
        this._finish();
        return;
      }
      this.trackWrite = [];
      p.phase = "write";
      p.delay = 0;
      return;
    }
    if (p.k < perRevolution) {
      // "If a byte is not present in the DR when needed, a byte of zeros is substituted."
      let byte = this.dataReg;
      if (p.k > 0 && this.status & ST_DRQ) {
        byte = 0;
        this.status |= ST_LOST_DATA;
      }
      if (this.trackWrite.length < TRACK_WRITE_CAP) this.trackWrite.push(byte);
      p.k++;
      this.status |= ST_DRQ;
      p.delay = B;
      return;
    }
    // The next index pulse: the track is written. The byte stream becomes sectors on the image.
    const sectors = parseWriteTrackStream(new Uint8Array(this.trackWrite), this.mfm, this.fmMarks);
    const disk = this.currentDisk();
    if (disk && sectors.length) disk.formatTrack(this._track, this.side, sectors);
    this.status &= ~ST_DRQ;
    this._finish();
  }

  /** The bytes READ TRACK delivers in one revolution at the latched density. */
  _rawTrack(length) {
    const disk = this.currentDisk();
    if (!disk) return new Uint8Array(length).fill(this.mfm ? 0x4e : 0xff); // callers check Ready first
    const raw = disk.rawTrack(this._track, this.side);
    if (raw) {
      const step = !this.mfm && raw.doubled ? 2 : 1;
      const out = new Uint8Array(length).fill(this.mfm ? 0x4e : 0xff);
      for (let i = 0, j = 0; i < length && j < raw.bytes.length; i++, j += step) out[i] = raw.bytes[j];
      return out;
    }
    const ids = this._passingIds()
      .map((x) => x.id)
      .sort((a, b) => a.pos - b.pos);
    return synthesizeTrack(ids, (id) => disk.readSectorEx(this._track, this.side, id.sector, id.index)?.data, this.mfm, length);
  }

  _event() {
    const p = this.pending;
    if (p.kind === "type1") this._type1Event(p);
    else if (p.kind === "read" || p.kind === "write") this._type2Event(p);
    else if (p.kind === "address" || p.kind === "track" || p.kind === "format") this._type3Event(p);
    else this._finish(); // a command from a save state older than this model
  }

  readTrackReg() {
    return this.trackReg;
  }
  writeTrackReg(v) {
    this.trackReg = v & 0xff;
  }
  readSectorReg() {
    return this.sectorReg;
  }
  writeSectorReg(v) {
    this.sectorReg = v & 0xff;
  }

  /** Port 0xF3 read: the data register; reading it resets DRQ. */
  readData() {
    if (this.commandType !== 1) this.status &= ~ST_DRQ;
    return this.dataReg;
  }

  /** Port 0xF3 write: the data register; loading it resets DRQ on a write command. */
  writeData(v) {
    this.dataReg = v & 0xff;
    if (this.commandType !== 1) this.status &= ~ST_DRQ;
  }
}
