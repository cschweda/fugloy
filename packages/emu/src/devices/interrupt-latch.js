/**
 * The Model I Expansion Interface's interrupt latch at $37E0: one object, owned by the Model I's
 * I/O decode (`IOSystem.latch`, null on the Model III and on a Model I built with
 * `expansion: false`), that every interrupting device of the Expansion Interface raises its bit in.
 *
 * - Bit 7 is the real-time clock: the Expansion Interface's 40 Hz pulse (a "25-millisecond pulse
 *   on the interrupt line", "this 40-times-per-second pulse": Kitsz, The Custom TRS-80 and Other
 *   Mysteries, p. 136; MAME's trs80 driver, `IRQ_M1_RTC` 0x80 and its 40 Hz periodic interrupt).
 *   TRS80System raises it on schedule (`raise(TIMER_BIT)`).
 * - Bit 6 is the disk controller's INTRQ (MAME, `IRQ_M1_FDC` 0x40). The WD1771 (emu phase 6,
 *   Task 3) drives it with `raise(DISK_BIT)` and `clear(DISK_BIT)` as its INTRQ rises and falls;
 *   reading the controller's status at $37EC is what drops it.
 *
 * Any bit set holds the CPU's INT line low; the Z80 takes it in IM 1 (or IM 0 with $FF on the bus)
 * at $0038 whenever its interrupts are enabled. There is no mask: every source interrupts.
 *
 * Reading $37E0 (and its mirrors $37E1-$37E3, as MAME maps them; the mirrors are unverified) returns
 * the latch and clears the clock bit: "reading 37EC (disk controller status) followed by reading
 * 37E0 (real-time clock) resets a flip-flop used to signal input from disk controller and real-time
 * clock, respectively. This must be done each time or the interrupt will continue to be 'on'"
 * (Kitsz, p. 137). The disk bit is left for the status read to clear. Bits 0-5 read 0
 * (unverified; MAME and xtrs return only the sources).
 *
 * The Level II ROM never reads it: its interrupt vector at $4012 is `EI / RET`
 * (MDL1LEV2.Z80, INITR at $06D2), and Level II BASIC runs with interrupts disabled (DI at $0000 and
 * no EI outside that vector), so the clock bit simply stays set until a DOS or a program enables
 * interrupts with a handler that reads $37E0.
 */

/** The real-time clock's bit. */
export const TIMER_BIT = 0x80;
/** The disk controller's INTRQ bit. */
export const DISK_BIT = 0x40;

export class InterruptLatch {
  /** @type {number} The pending sources (TIMER_BIT, DISK_BIT). */
  bits = 0;

  /**
   * Set source bits: the INT line goes (or stays) low.
   * @param {number} mask
   */
  raise(mask) {
    this.bits |= mask & 0xff;
  }

  /**
   * Clear source bits.
   * @param {number} mask
   */
  clear(mask) {
    this.bits &= ~mask & 0xff;
  }

  /** True while any source holds the INT line. */
  get pending() {
    return this.bits !== 0;
  }

  /** A CPU read of $37E0: the latch, after which the clock bit is cleared. */
  read() {
    const value = this.bits;
    this.bits &= ~TIMER_BIT;
    return value;
  }

  /** The latch as a read would return it, clearing nothing (for the debugger and `m.mem.read`). */
  peek() {
    return this.bits;
  }

  /** Power-on: nothing pending. */
  reset() {
    this.bits = 0;
  }
}
