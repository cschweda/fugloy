/**
 * The machine state a generated port runs on: the Z80's registers as plain fields, the 64K with the
 * model's memory map, the keyboard matrix, the ports, and the T-state and R counters. A port holds no
 * Z80 interpreter; its statements read and write a `Z`.
 *
 * Everything here mirrors @fugloy/emu, the oracle the referee runs a port beside, so that a port and
 * emu see one machine. Where emu decides a thing, the line is cited (paths are packages/emu/src/...).
 * Where emu differs from the M1 plan's summary of it, emu wins: the Model I's video gate is applied on
 * the write, not the read, and its Expansion Interface is $37E0-$37EF, not $37E0-$37FF.
 *
 *   Memory, the Model I and the Model III (machine/memory.js, readByte :128-152, writeByte :173-193):
 *     $0000-$2FFF (Model I), $0000-$37FF (Model III)
 *                  ROM: a read returns `mem`, the image the host copied there (:131-133); a write is lost (:177-183)
 *     $3000-$37FF (Model I)
 *                  nothing: a read floats to $FF (:134-140) and a write is lost (:177-183); but
 *                  $37E0-$37EF (EXPANSION_BASE and EXPANSION_LIMIT, :42-43) is the Expansion Interface,
 *                  which the port does not model: a read or write there throws a sentence
 *     $3800-$3BFF  the keyboard: a read is the OR of the rows the address's low byte selects (:141-144,
 *                  devices/keyboard.js:111-120; A8 and A9 are not decoded); a write is lost
 *     $3C00-$3FFF  video RAM: `mem`. The stock Model I's has no bit 6, so a byte is stored as it will read
 *                  and show, bit 6 = NOT (bit 5 OR bit 7): the gate is on the WRITE (:185; the Technical
 *                  Reference Handbook, p. 34, as :23-31 cite it), and `mem` holds what emu's video RAM holds
 *     $4000-$FFFF  RAM: `mem` (48K, emu's default on both models)
 *   'flat' has none of this: all 64K is RAM.
 *
 *   Ports (machine/io.js; the port number is its low 8 bits, as readPort and writePort take it, :476-489):
 *     Model III $EC-$EF  read: $FF (the RTC acknowledge, :174-180; no interrupts are modelled);
 *                        write: the mode register (:183), bit 2 the 32-column mode (:74)
 *     Model III $FF      read: $40 | mode register & $3E (:308, with no tape in the deck);
 *                        write: the raw byte to `sound` (:313); the mode register is untouched
 *     Model I $FF        read: $7F, or $3F with the 32-column bit set (:351-355, no tape);
 *                        write: the raw byte to `sound` (:359), and D0-D3 to the mode register (:372-374),
 *                        whose bit 3 is MODESEL, the 32-column mode (:84)
 *   Any other port throws a sentence naming it. 'flat' has no ports: they float high and a write is lost,
 *   as on emu's bare test bus (packages/emu/test/unit/bare.js).
 */

import { KeyMatrix } from './keys.js';
import { modelOf } from './model.js';

// memory.js:39-43
const KEYBOARD_BASE = 0x3800;
const VIDEO_BASE = 0x3c00;
const EXPANSION_BASE = 0x37e0;
const EXPANSION_LIMIT = 0x37f0;

/** @param {number} n @param {number} width */
const hex = (n, width) => n.toString(16).toUpperCase().padStart(width, '0');

/**
 * The sentence for a read or write at an Expansion Interface address.
 * @param {number} addr
 */
const expansionError = (addr) => new Error(`the port does not model $${hex(addr, 4)} (the Model I's Expansion Interface)`);

/**
 * The sentence for an I/O port the port does not model.
 * @param {1 | 3} model
 * @param {number} port
 */
const portError = (model, port) =>
  new Error(`the port does not model $${hex(port, 2)} (an I/O port; on the ${model === 1 ? 'Model I it models $FF' : 'Model III it models $FF and $EC-$EF'})`);

/** The machine state a port runs on; `createZ` builds one. The fields and methods are described above and in README.md. */
export class Z {
  /** @param {import('./model.js').Model} model */
  constructor(model) {
    /** @type {1 | 3 | 'flat'} The model built. */
    this.model = model.id;
    /** The CPU clock in Hz: the Model I's 1,774,080 or the Model III's 2,027,520 (emu's models.js). */
    this.clockHz = model.clockHz;

    // The registers. An 8-bit field holds 0-255 and a 16-bit one 0-65535: the generated code keeps them
    // so, as emu's register file masks every write (cpu/z80cpu.js:24-63). Their start is emu's reset
    // (:254-268), a register the reset leaves alone being 0 as in a new CPU.
    /** The accumulator, the flags, and the other 8-bit registers. */
    this.a = 0;
    this.f = 0;
    this.b = 0;
    this.c = 0;
    this.d = 0;
    this.e = 0;
    this.h = 0;
    this.l = 0;
    this.i = 0;
    this.r = 0;
    this.ixh = 0;
    this.ixl = 0;
    this.iyh = 0;
    this.iyl = 0;
    /** The stack pointer, and MEMPTR (WZ), the internal address latch BIT n,(HL) shows in flags 3 and 5. */
    this.sp = 0xffff;
    this.wz = 0;
    /** The alternate set, AF', BC', DE' and HL', as the 16-bit values EX AF,AF' and EXX swap. */
    this.af_ = 0;
    this.bc_ = 0;
    this.de_ = 0;
    this.hl_ = 0;
    /** The interrupt flip-flops (booleans) and mode (0-2). */
    this.iff1 = false;
    this.iff2 = false;
    this.im = 0;
    /**
     * Q for SCF and CCF: 1 when the last instruction of the block that just ended wrote the flags, 0 when
     * it left them alone (emu's `flagsWritten`, cpu/z80cpu.js:260 and :277). A reset starts as written.
     */
    this.q = 1;

    /** T-states since the start; `tick` adds to it, and a port $FF write is stamped with it. */
    this.cycles = 0;

    /**
     * The 64K the CPU sees, as bytes: the ROM image and the program's data go in by the host, directly
     * (a direct write skips the map below, which `write` applies). Never a sparse map. It starts zeroed
     * but for the video RAM, which a reset leaves blank, filled with spaces (emu's reset,
     * machine/trs80-system.js:137 and memory.js:270-273; the flat machine has none).
     */
    this.mem = new Uint8Array(0x10000);
    this.mem.fill(0x20, VIDEO_BASE, model.ramBase);

    /**
     * Every write to port $FF, raw, as { t, v }: `t` is `cycles` at the call (emu stamps the CPU's
     * T-state count, io.js:313 and :359, as its sound ring records it, devices/sound.js:23) and `v` the
     * byte. The host drains it.
     * @type {{ t: number, v: number }[]}
     */
    this.sound = [];

    /**
     * The mode register: port $EC's latch on the Model III (io.js:183), D0-D3 of port $FF on the Model I
     * (:372-374); 0 at reset (:117). `columns32` reads its width bit.
     */
    this.modeRegister = 0;

    /** The keys held down and the matrix they make. */
    this.keyboard = new KeyMatrix();
    /** The keyboard matrix, one byte a row, a set bit a key down: the same array `keyboard` rebuilds in place. */
    this.keys = this.keyboard.rows;

    // The model's description, which the memory map and the ports read (model.js)
    this.romTop = model.romTop;
    this.ramBase = model.ramBase;
    this.videoGate = model.videoGate;
    this.expansion = model.expansion;
    this.modeBit = model.modeBit;
  }

  // ---- the register pairs: a 16-bit value over two 8-bit fields, a setter taking the low 16 bits

  get af() {
    return (this.a << 8) | this.f;
  }
  set af(v) {
    this.a = (v >> 8) & 0xff;
    this.f = v & 0xff;
  }

  get bc() {
    return (this.b << 8) | this.c;
  }
  set bc(v) {
    this.b = (v >> 8) & 0xff;
    this.c = v & 0xff;
  }

  get de() {
    return (this.d << 8) | this.e;
  }
  set de(v) {
    this.d = (v >> 8) & 0xff;
    this.e = v & 0xff;
  }

  get hl() {
    return (this.h << 8) | this.l;
  }
  set hl(v) {
    this.h = (v >> 8) & 0xff;
    this.l = v & 0xff;
  }

  get ix() {
    return (this.ixh << 8) | this.ixl;
  }
  set ix(v) {
    this.ixh = (v >> 8) & 0xff;
    this.ixl = v & 0xff;
  }

  get iy() {
    return (this.iyh << 8) | this.iyl;
  }
  set iy(v) {
    this.iyh = (v >> 8) & 0xff;
    this.iyl = v & 0xff;
  }

  // ---- time

  /**
   * Count a block's T-states and its R increments. R's low seven bits count (one a fetched opcode byte,
   * so two for a prefixed instruction) and bit 7 is kept: only LD R,A sets it (emu's incrementR,
   * cpu/z80cpu.js:311-314).
   * @param {number} t T-states
   * @param {number} r R increments
   */
  tick(t, r) {
    this.cycles += t;
    this.r = (this.r & 0x80) | ((this.r + r) & 0x7f);
  }

  /**
   * Called at the start of each block, with the block's address. It does nothing, unless the referee
   * replaces it to watch the port run beside emu.
   * @param {number} addr
   */
  at(addr) {}

  // ---- memory

  /**
   * The byte the CPU reads at `addr` (taken to 16 bits), through the memory map above.
   * @param {number} addr
   * @returns {number}
   */
  read(addr) {
    addr &= 0xffff;
    // ROM (the image in mem), video RAM and RAM; all 64K on the flat machine, whose ROM ends past it
    if (addr < this.romTop || addr >= VIDEO_BASE) return this.mem[addr];
    if (addr >= KEYBOARD_BASE) return this.keyboard.read(addr & 0xff);
    // The Model I's $3000-$37FF: the Expansion Interface, or nothing (memory.js:134-140)
    if (this.expansion && addr >= EXPANSION_BASE && addr < EXPANSION_LIMIT) throw expansionError(addr);
    return 0xff;
  }

  /**
   * Store `v` (taken to a byte) at `addr` (taken to 16 bits), through the memory map above: a write to
   * ROM, the keyboard, or the Model I's empty space is lost, and a Model I video byte takes its bit 6.
   * @param {number} addr
   * @param {number} v
   */
  write(addr, v) {
    addr &= 0xffff;
    v &= 0xff;
    if (addr >= this.ramBase) {
      this.mem[addr] = v;
      return;
    }
    if (addr >= VIDEO_BASE) {
      // memory.js:185: bit 6 = NOT (bit 5 OR bit 7) on the stock Model I
      this.mem[addr] = this.videoGate ? (v & 0xbf) | (v & 0xa0 ? 0 : 0x40) : v;
      return;
    }
    if (this.expansion && addr >= EXPANSION_BASE && addr < EXPANSION_LIMIT) throw expansionError(addr);
    // ROM, the keyboard, the Model I's empty space (memory.js:177-183): lost
  }

  /**
   * A 16-bit read, low byte first, each byte through `read` (emu's readWord, memory.js:198-203).
   * @param {number} addr
   * @returns {number}
   */
  read16(addr) {
    return this.read(addr) | (this.read(addr + 1) << 8);
  }

  /**
   * A 16-bit write, low byte first, each byte through `write` (emu's writeWord, memory.js:208-215).
   * @param {number} addr
   * @param {number} v
   */
  write16(addr, v) {
    this.write(addr, v);
    this.write(addr + 1, v >> 8);
  }

  // ---- ports

  /**
   * IN: the byte the CPU reads from `port` (its low 8 bits), through the port map above.
   * @param {number} port
   * @returns {number}
   */
  in(port) {
    port &= 0xff;
    switch (this.model) {
      case 3:
        if (port === 0xff) return 0x40 | (this.modeRegister & 0x3e); // io.js:308
        if (port >= 0xec && port <= 0xef) return 0xff; // io.js:177-180
        break;
      case 1:
        if (port === 0xff) return (this.modeRegister & this.modeBit ? 0x00 : 0x40) | 0x3f; // io.js:351-355
        break;
      default:
        return 0xff; // the flat machine's ports float
    }
    throw portError(this.model, port);
  }

  /**
   * OUT: the CPU writes `v` (taken to a byte) to `port` (its low 8 bits), through the port map above.
   * @param {number} port
   * @param {number} v
   */
  out(port, v) {
    port &= 0xff;
    v &= 0xff;
    switch (this.model) {
      case 3:
        if (port === 0xff) {
          this.sound.push({ t: this.cycles, v });
          return;
        }
        if (port >= 0xec && port <= 0xef) {
          this.modeRegister = v; // io.js:183
          return;
        }
        break;
      case 1:
        if (port === 0xff) {
          this.sound.push({ t: this.cycles, v });
          this.modeRegister = v & 0x0f; // io.js:372-374
          return;
        }
        break;
      default:
        return; // the flat machine's ports float, and a write is lost
    }
    throw portError(this.model, port);
  }

  /**
   * True in the 32-column mode: the mode register's width bit, port $EC bit 2 on the Model III and
   * port $FF bit 3 (MODESEL) on the Model I (emu's columns32, machine/trs80-system.js:63 and :242-244).
   * @returns {boolean}
   */
  get columns32() {
    return (this.modeRegister & this.modeBit) !== 0;
  }

  // ---- the keyboard

  /**
   * Hold a key down until `release` with the same name. The names are `@fugloy/emu`'s `m.keyboard.press`:
   * see KEY_TABLE.
   * @param {string} name
   */
  press(name) {
    this.keyboard.press(name);
  }

  /**
   * Let go of a key `press` holds.
   * @param {string} name the name it was pressed with
   */
  release(name) {
    this.keyboard.release(name);
  }
}

/**
 * Build the machine state for a model: a Z in emu's reset state, which reads, address by address, as a
 * new emu Machine with a blank ROM does (but for the Model I's Expansion Interface, which it does not model).
 * @param {{ model: 1 | 3 | 'flat' }} opts `model` 1 (the Model I), 3 (the Model III), or 'flat' (64K of
 *   plain RAM and no map, for the per-opcode tests)
 * @returns {Z}
 */
export function createZ({ model } = /** @type {any} */ ({})) {
  return new Z(modelOf(model));
}
