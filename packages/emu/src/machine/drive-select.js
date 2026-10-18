/**
 * Each model's drive-select latch, decoded into the controller's neutral `select(drive, side,
 * mfm)` (devices/fdc-wd1793.js). A module of its own so the controllers and the I/O decode
 * (machine/io.js, which re-exports these) can import it without an import cycle.
 */

/**
 * Decode a Model III port F4 write: bits 0-3 select drive 0-3 (the lowest set bit wins; none set
 * selects no drive, -1), bit 4 the side, bit 6 WAIT, bit 7 MFM (1) or FM (0); bit 5, write
 * precompensation, does nothing here. Bits from MAME's trs80m3 driver and the ROM's use, not yet
 * checked against the Model III Technical Reference Manual (spec §5).
 * @param {number} value
 * @returns {{ drive: number, side: number, mfm: boolean, wait: boolean }}
 */
export function decodeModel3Select(value) {
  let drive = -1;
  if (value & 0x01) drive = 0;
  else if (value & 0x02) drive = 1;
  else if (value & 0x04) drive = 2;
  else if (value & 0x08) drive = 3;
  return { drive, side: value & 0x10 ? 1 : 0, mfm: (value & 0x80) !== 0, wait: (value & 0x40) !== 0 };
}

/**
 * Decode a write to the Model I Expansion Interface's drive-select latch at $37E1: "a 4-bit drive
 * select indicator sent to the drive" (Kitsz, The Custom TRS-80 and Other Mysteries, ch. 9,
 * pp. 205-206), bits 0-3 for drives 0-3; the Level II ROM selects drive 0 by writing 1
 * (MDL1LEV2.Z80, BOOT at $069F). The lowest set bit wins, as on the Model III (the hardware would
 * select every drive whose bit is set); none set selects no drive, -1. The stock interface is
 * single-sided and single-density, so bits 4-7 do nothing here (double-density and side-select
 * modifications used them; not modelled).
 * @param {number} value
 * @returns {{ drive: number }}
 */
export function decodeModel1Select(value) {
  let drive = -1;
  if (value & 0x01) drive = 0;
  else if (value & 0x02) drive = 1;
  else if (value & 0x04) drive = 2;
  else if (value & 0x08) drive = 3;
  return { drive };
}
