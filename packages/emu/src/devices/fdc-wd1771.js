/**
 * WD1771 floppy disk controller: the Model I Expansion Interface's (emu phase 6, Ruling 5).
 *
 * Memory-mapped by the Expansion Interface (machine/io.js, readExpansion and writeExpansion):
 *   $37EC status (R) / command (W)     $37EE sector register
 *   $37ED track register               $37EF data register
 *   $37E1 (W) drive select: bits 0-3 drives 0-3 (machine/io.js, decodeModel1Select)
 * The addresses are CONSTANTS.Z80's "Memory Mapped Hardware, Model 1" (kiwisincebirth/TRS-80-ROMS)
 * and the Level II ROM's boot (MDL1LEV2.Z80, BOOT at $069F: drive 0 selected by writing 1 to $37E1,
 * Restore written to $37EC, the sector read through $37EF).
 *
 * The authority is the FD1771-01 data sheet (Western Digital), as reprinted in George Blank,
 * "Pathways Through the ROM" (1980), chapter 14, pp. 93-111 (OCR in
 * docs/reference/web-sources/archive-org/pathways_djvu.txt); comments name its sections in
 * quotes. The 1771 is the WD1793's predecessor, and this class is the phase 5 controller
 * (fdc-wd1793.js) with the 1771's differences:
 *
 * - Single density only: no density latch, every ID recorded in MFM is invisible to it ("The
 *   FD1771 is compatible with the IBM 3740 data entry system format"). The stock Expansion
 *   Interface drives one side; `select` takes no side.
 * - Read and Write Sector: 1 0 0 m b E 0 0 and 1 0 1 m b E a1 a0 (Table 2). No side compare (the
 *   WD1793's C and S flags do not exist). `b` = 1 is the IBM length, 128 x 2^n by the ID's length
 *   code; `b` = 0 is 16 x N bytes ("an indicator of all zeroes is interpreted as 256 sixteen byte
 *   groups"). A length other than the sector's own leaves the data CRC unmatched, which the
 *   command reports as a CRC error.
 * - The data address mark: Read Sector reports its type in status bits 6 and 5 (FB 00, FA 01,
 *   F9 10, F8 11: "At the end of the Read operation, the type of Data Address Mark encountered in
 *   the data field is recorded in the Status Register (Bits 5 and 6)"); Write Sector writes the
 *   mark a1 a0 choose (00 FB, 01 FA, 10 F9, 11 F8: Table 4). Write Track takes FA and F9 as data
 *   marks too ("Control Bytes for Initialization").
 * - Times: CLK is 1 MHz (the sheet's "may be 1.0 MHz for mini floppy": 1 MHz / 4 / 2 gives the
 *   125 kbit/s of a single-density 5.25" disk; unverified against the Expansion Interface
 *   schematic, spec §5). So the step rates are the 1771-X1, CLK = 1 MHz, TEST = 1 column of
 *   Table 1, 12, 12, 20, 40 ms for r1 r0 = 00, 01, 10, 11, and the head settles 20 ms ("IF TEST =
 *   1 AND CLK 1 MHz THERE IS A 20MS DELAY", the Type I and II flow charts). An ID search ends
 *   after two revolutions ("within two revolutions of the disk; otherwise, the Record Not Found
 *   status bit is set"; a verify likewise): at the third index pulse, the first at which two
 *   whole revolutions have passed. The head unloads at the third index pulse after the last
 *   command ("remains activated until the third index pulse following the last operation").
 * - Read Address: "The Sector Address of the ID field is written into the Sector Register" (the
 *   WD1793 writes the track address).
 * - INTRQ goes to the Expansion Interface's interrupt latch at $37E0, bit 6 (DISK_BIT), not to an
 *   NMI: the latch's bit follows INTRQ, so it clears when the status is read or a command is
 *   written, as INTRQ does ("The INTRQ signal remains active until reset by reading the Status
 *   Register to the processor or by the loading of the Command Register"; Kitsz, The Custom TRS-80
 *   and Other Mysteries, p. 137: reading 37EC resets the disk flip-flop).
 * - Master reset runs a Restore ("Note that the RESTORE command is executed when MR goes from an
 *   active to an inactive state"); the Model I's reset is taken to pulse MR (unverified, spec §5),
 *   which also returns the head to track 0 before the ROM's first status read.
 *
 * Kept from the WD1793 model and unverified for the 1771 (spec §5): the Force Interrupt
 * conditions and DRQ handling, READY true when the selected drive holds a disk (no motor
 * time-out), Lost Data timing, and the data mark window of a DMK (30 bytes in FM; the 1771's sheet
 * says 28).
 */

import { FDC1793 } from "./fdc-wd1793.js";
import { DISK_BIT } from "./interrupt-latch.js";

/** Write Sector's a1 a0 (bits 1-0): the data address mark it writes (Table 4). */
const WRITE_MARKS = [0xfb, 0xfa, 0xf9, 0xf8];
const ST_RECORD_TYPE = 0x60; // Read Sector: bits 6 and 5

export class FDC1771 extends FDC1793 {
  /**
   * @param {{ cpuHz: number, latch?: import('./interrupt-latch.js').InterruptLatch | null }} opts the
   *   CPU clock the times count in, and the Expansion Interface's latch INTRQ drives (null: none)
   */
  constructor({ cpuHz, latch = null }) {
    super({ cpuHz });
    this.latch = latch;
    this.mfm = false;
    const ms = (/** @type {number} */ n) => Math.round((n * cpuHz) / 1000);
    this.stepTStates = [12, 12, 20, 40].map(ms);
    this.settleTStates = ms(20);
    this.searchPulses = 3;
    this.headUnloadPulses = 3;
    this.readAddressField = 2;
    this.fmMarks = true;
  }

  /** INTRQ, mirrored into the Expansion Interface latch's disk bit. */
  get intrq() {
    return this._intrq;
  }

  set intrq(v) {
    this._intrq = v;
    // The base constructor sets INTRQ before `latch` exists
    if (this.latch) {
      if (v) this.latch.raise(DISK_BIT);
      else this.latch.clear(DISK_BIT);
    }
  }

  /**
   * The drive-select latch at $37E1, decoded: a drive 0-3 or -1 for none. One side, single
   * density, whatever the caller passes.
   * @param {number} drive
   */
  select(drive) {
    super.select(drive, 0, false);
  }

  /**
   * Master reset with the machine's: the WD1793 model's reset, then the Restore MR starts (03,
   * as the FD179X loads it; the 1771's sheet names no rate), when a disk is mounted (with none the
   * controller is taken as absent, machine/io.js).
   */
  reset() {
    super.reset();
    if (this.anyDiskMounted()) this.writeCommand(0x03);
  }

  /**
   * A command written while Busy overrides the one running: "This register should not be loaded
   * when the device is busy unless the execution of the current command is to be overridden.
   * This latter action results in an interrupt" ("Command Register"; the WD1793's sheet allows
   * only Force Interrupt then, and the WD1793 model ignores the write). The running command stops
   * as Force Interrupt stops one (Busy and DRQ reset, a sector not yet written is not written),
   * the new one starts, and INTRQ is raised for the override and left up until a status read
   * (whether the new command's load resets it first is not said; unverified, spec §5). Model I
   * boot sectors rely on it: the dual-boot disks' loader writes its Seek about 190 T-states after
   * the ROM took the boot sector's last byte, while the controller is still reading the CRC.
   * @param {number} value
   */
  writeCommand(value) {
    value &= 0xff;
    if (value >> 4 === 0x0d || !(this.status & 0x01)) {
      super.writeCommand(value);
      return;
    }
    this.pending = null;
    this.buffer = null;
    this.trackWrite = null;
    this.status &= ~(0x01 | (this.commandType === 1 ? 0 : 0x02));
    super.writeCommand(value);
    this.intrq = true;
  }

  _startType2(value) {
    super._startType2(value);
    const p = this.pending;
    this.writeDeleted = false;
    if (p === null) return;
    p.compareSide = false;
    p.ibm = (value & 0x08) !== 0;
    if (p.kind === "write") p.dam = WRITE_MARKS[value & 3];
  }

  /** The data field's length the command's b flag and the ID's length code give. */
  _length(id, p) {
    if (p.ibm) return 128 << (id.sizeCode & 3);
    return 16 * (id.sizeCode === 0 ? 256 : id.sizeCode);
  }

  _type2Event(p) {
    const searching = p.phase === "search";
    super._type2Event(p);
    if (!searching || this.pending !== p || (p.phase !== "data" && p.phase !== "drq")) return;
    // The ID was found: the 1771's record type and length
    const id = this.currentDisk().trackIds(this._track, this.side)[p.index];
    const len = this._length(id, p);
    if (p.phase === "data") {
      this.status = (this.status & ~ST_RECORD_TYPE) | ((~(id.dam ?? 0xfb) & 3) << 5);
      if (len !== this.buffer.length) {
        const field = new Uint8Array(len);
        field.set(this.buffer.subarray(0, len));
        this.buffer = field;
        p.crcOk = false;
      }
    } else if (len !== this.buffer.length) {
      this.buffer = new Uint8Array(len);
    }
  }
}
