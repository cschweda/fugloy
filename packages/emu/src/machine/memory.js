/**
 * TRS-80 memory map, by model (src/machine/models.js holds the sources for the Model I facts):
 *
 *   Model III (non-disk machine):
 *     0x0000-0x37FF  14K ROM (write-protected)
 *     0x3800-0x3BFF  keyboard matrix (memory-mapped, read-only;
 *                    low 8 address bits select rows, A8/A9 undecoded)
 *     0x3C00-0x3FFF  1K video RAM (64 cols x 16 rows)
 *     0x4000-0xFFFF  48K RAM
 *
 *   Model I:
 *     0x0000-0x2FFF  12K Level II ROM (write-protected)
 *     0x3000-0x37DF  nothing: reads float to 0xFF, writes are lost
 *     0x37E0-0x37EF  the Expansion Interface (IOSystem.readExpansion and
 *                    writeExpansion: the interrupt latch at 0x37E0, the drive
 *                    select at 0x37E1, the printer at 0x37E8, the WD1771 at
 *                    0x37EC-0x37EF); without it, nothing, as 0x3000-0x37DF
 *     0x3800-0x3BFF  keyboard matrix, as on the Model III
 *     0x3C00-0x3FFF  1K video RAM, seven bits wide (below)
 *     0x4000-...     4, 16, 32, or 48K RAM; above it reads float to 0xFF
 *                    and writes are lost
 *
 *   The stock Model I's video RAM has no bit 6: "There are seven RAMs. Six
 *   are used for ASCII storage, and the seventh is used as a graphic/
 *   alphanumeric definition bit. ... Notice the line labeled Bit 6. It is
 *   sourced by NOR gate Z30 at pin 13. If Bit 5 ... and Bit 7 ... are low,
 *   then Bit 6 will be high" (TRS-80 Micro Computer Technical Reference
 *   Handbook, 2nd ed., 1982, p. 34, "Video RAMs"). A byte written there is
 *   kept as it reads back and displays: bit 6 = NOT (bit 5 OR bit 7). The
 *   lowercase modification (`lowercase: true`) fits the missing RAM, so all
 *   eight bits are kept.
 *
 *   Model 4 (Model4Memory, below): four memory maps chosen by port 0x84,
 *   64K or 128K of RAM in 32K banks, and 2K of video RAM.
 */

import { MODEL_III } from "./models.js";

const KEYBOARD_BASE = 0x3800;
const KEYBOARD_LIMIT = 0x3c00;
const RAM_BASE = 0x4000;
const EXPANSION_BASE = 0x37e0;
const EXPANSION_LIMIT = 0x37f0;

export class MemorySystem {
  /**
   * @param {{ model?: import('./models.js').Model, ram?: number, lowercase?: boolean }} [opts] the
   *   model (the Model III by default), its RAM in K (checked by the Machine against the model's
   *   sizes), and on the Model I whether the lowercase modification is fitted (not by default)
   */
  constructor({ model = MODEL_III, ram = model.defaultRam, lowercase = false } = {}) {
    this.model = model;

    // The stock Model I's seven-bit video RAM (above); the Model III's and a
    // lowercase-modified Model I's keep all eight bits.
    this.videoBit6Gate = model.id === 1 && !lowercase;

    // The Model I's Expansion Interface at 0x37E0-0x37EF: the IOSystem, set by
    // TRS80System when the interface is fitted; null, those addresses read 0xFF.
    /** @type {{ readExpansion(a: number): number, peekExpansion(a: number): number, writeExpansion(a: number, v: number): void } | null} */
    this.expansion = null;

    // ROM storage is 16K so padded 16K images can be loaded verbatim,
    // but only 0x0000 up to the model's ROM top is ever mapped as ROM.
    this.rom = new Uint8Array(0x4000);
    this.romLimit = model.romTop;

    // RAM from 0x4000: 48K reaches 0xFFFF
    this.ram = new Uint8Array(ram * 1024);
    this.ramLimit = RAM_BASE + this.ram.length;

    // 1K video RAM (0x3C00 - 0x3FFF)
    this.videoRam = new Uint8Array(0x400);

    // Set on every video RAM write so the renderer can skip idle frames
    this.videoDirty = false;

    // Keyboard matrix peripheral: { read(addrLow8) -> row bits } or null
    this.keyboard = null;

    this.romLoaded = false;

    // Kept for API compatibility with existing callers
    this.VIDEO_RAM_START = 0x3c00;
    this.VIDEO_RAM_END = 0x3fff;
  }

  /**
   * Get memory statistics
   */
  getStats() {
    return {
      romSize: this.rom.length,
      ramSize: this.ram.length,
      totalSize: this.rom.length + this.ram.length,
      romLoaded: this.romLoaded,
    };
  }

  /**
   * Load a ROM image of a size the model takes: the Model III's real 14K
   * (0x3800) ROM or a 16K (0x4000) padded image of it; the Model I's 12K
   * (0x3000) Level II ROM. Anything else is a wrong file — reject it
   * rather than guessing.
   */
  loadROM(romData) {
    if (!romData || romData.length === 0) {
      throw new Error("ROM data is required");
    }

    if (!this.model.romSizes.includes(romData.length)) {
      throw new Error(
        `Invalid ROM size: ${romData.length} bytes. ${this.model.romSizeText}`
      );
    }

    this.rom.fill(0);
    this.rom.set(romData, 0);

    this.romLoaded = true;
    return true;
  }

  /**
   * Read a byte from memory
   * Addresses are masked to 16 bits (0x0000 - 0xFFFF)
   */
  readByte(address) {
    address = address & 0xffff;

    if (address < this.romLimit) {
      return this.rom[address];
    }
    if (address < KEYBOARD_BASE) {
      // The Model I's 0x3000-0x37FF (models.js): the Expansion Interface, or nothing
      if (address >= EXPANSION_BASE && address < EXPANSION_LIMIT && this.expansion !== null) {
        return this.expansion.readExpansion(address);
      }
      return 0xff;
    }
    if (address < KEYBOARD_LIMIT) {
      // Keyboard matrix: reading with no keys down yields 0x00
      return this.keyboard ? this.keyboard.read(address & 0xff) : 0x00;
    }
    if (address < RAM_BASE) {
      return this.videoRam[address - KEYBOARD_LIMIT];
    }
    if (address < this.ramLimit) {
      return this.ram[address - RAM_BASE];
    }
    return 0xff; // above the fitted RAM (models.js)
  }

  /**
   * Read a byte as `readByte` does, without a device's read side effect: the
   * Model I's Expansion Interface addresses are peeked (reading the interrupt
   * latch at 0x37E0 does not clear it). For the debugger and `m.mem.read`.
   */
  peekByte(address) {
    address = address & 0xffff;
    if (address >= EXPANSION_BASE && address < EXPANSION_LIMIT && this.expansion !== null) {
      return this.expansion.peekExpansion(address);
    }
    return this.readByte(address);
  }

  /**
   * Write a byte to memory
   * ROM, the Model I's unmapped 0x3000-0x37FF, the keyboard region, and
   * addresses above the fitted RAM ignore writes; video RAM and RAM accept them,
   * and the Model I's Expansion Interface takes its own.
   */
  writeByte(address, value) {
    address = address & 0xffff;
    value = value & 0xff;

    if (address < KEYBOARD_LIMIT) {
      // ROM / keyboard matrix: not writable; the Model I's Expansion Interface
      if (this.expansion !== null && address >= EXPANSION_BASE && address < EXPANSION_LIMIT) {
        this.expansion.writeExpansion(address, value);
      }
      return;
    }
    if (address < RAM_BASE) {
      if (this.videoBit6Gate) value = (value & 0xbf) | (value & 0xa0 ? 0 : 0x40);
      this.videoRam[address - KEYBOARD_LIMIT] = value;
      this.videoDirty = true;
      return;
    }
    if (address < this.ramLimit) {
      this.ram[address - RAM_BASE] = value;
    }
  }

  /**
   * Read a 16-bit word (little-endian)
   */
  readWord(address) {
    address = address & 0xffff;
    const low = this.readByte(address);
    const high = this.readByte((address + 1) & 0xffff);
    return (high << 8) | low;
  }

  /**
   * Write a 16-bit word (little-endian)
   */
  writeWord(address, value) {
    address = address & 0xffff;
    value = value & 0xffff;
    const low = value & 0xff;
    const high = (value >> 8) & 0xff;
    this.writeByte(address, low);
    this.writeByte((address + 1) & 0xffff, high);
  }

  /**
   * Load a program into RAM
   * @param {Uint8Array|Array} program - Program data
   * @param {number} address - Load address (default: 0x4200)
   * @returns {number} The address where the program was loaded
   */
  loadProgram(program, address = 0x4200) {
    if (!program || program.length === 0) {
      return address;
    }

    // Convert to Uint8Array if needed
    let programData;
    if (program instanceof Uint8Array) {
      programData = program;
    } else if (Array.isArray(program)) {
      programData = new Uint8Array(program);
    } else {
      throw new Error("Program must be Uint8Array or Array");
    }

    address = address & 0xffff;

    // Check if program fits in memory
    if (address < RAM_BASE) {
      throw new Error("Cannot load program into ROM area");
    }

    const endAddress = (address + programData.length - 1) & 0xffff;
    if (endAddress < address) {
      // Wrapped around - program too large
      throw new Error("Program exceeds available memory");
    }

    // Load program into RAM
    for (let i = 0; i < programData.length; i++) {
      const addr = (address + i) & 0xffff;
      this.writeByte(addr, programData[i]);
    }

    return address;
  }

  /**
   * Clear all RAM (set to 0x00)
   */
  clearRAM() {
    this.ram.fill(0);
  }

  /**
   * Clear video RAM to spaces (what the ROM's CLS leaves behind)
   */
  clearVideoRAM() {
    this.videoRam.fill(0x20);
    this.videoDirty = true;
  }

  /**
   * Get a view of the entire memory space (for debugging)
   * Returns a Uint8Array representing the full 64K address space
   */
  getMemoryView() {
    const view = new Uint8Array(0x10000);
    // Unmapped addresses read 0xFF; the keyboard region reads as idle (0x00) in the debug view
    view.fill(0xff, this.romLimit, KEYBOARD_BASE);
    view.fill(0xff, this.ramLimit);
    view.set(this.rom.subarray(0, this.romLimit), 0);
    view.set(this.videoRam, KEYBOARD_LIMIT);
    view.set(this.ram, RAM_BASE);
    // The Model I's Expansion Interface, peeked, as m.mem.read shows it
    if (this.expansion !== null) {
      for (let a = EXPANSION_BASE; a < EXPANSION_LIMIT; a++) view[a] = this.expansion.peekExpansion(a);
    }
    return view;
  }
}


const BANK = 0x8000;

/**
 * The Model 4's memory: four maps, chosen by bits 0-1 of port 0x84, over 64K
 * or 128K of RAM and 2K of video RAM. No Model 4 Technical Reference Manual is
 * local; the layout is MAME's (src/mame/trs/trs80m3.cpp, `m4_banked_mem`, and
 * trs80m3_m.cpp, `port_84_w` and the bank setup in `machine_start`), which Tim
 * Mann's xtrs agrees with (trs_memory.c, `mem_read`/`mem_write`, cases
 * 0x40-0x43, and `mem_bank`; trs_io.c, port 0x84). Spec §5 lists what is
 * unverified.
 *
 *   map 0 (Model III mode, the map at reset):
 *     0x0000-0x37FF  14K ROM (writes lost)
 *     0x3800-0x3BFF  keyboard matrix
 *     0x3C00-0x3FFF  video RAM: one 1K page of the 2K, port 0x84 bit 7
 *     0x4000-0xFFFF  RAM
 *   map 1: as map 0, with RAM in place of the ROM at 0x0000-0x37FF
 *   map 2:
 *     0x0000-0xF3FF  RAM
 *     0xF400-0xF7FF  keyboard matrix (MAME: "Keyboard=F400-F7FF"; xtrs reads
 *                    trs_kb_mem_read there)
 *     0xF800-0xFFFF  all 2K of video RAM
 *   map 3: 0x0000-0xFFFF RAM
 *
 * RAM, `ram` (m.mem.ram), is laid out as 32K banks in physical order: bank n
 * is ram[n * 0x8000 .. n * 0x8000 + 0x7FFF]; 64K has banks 0-1, 128K banks
 * 0-3. With no page selected the CPU's 0x0000-0x7FFF is bank 0 and
 * 0x8000-0xFFFF bank 1, so in map 0 the CPU's address A (0x4000 and up) is
 * ram[A]; ram[0x0000-0x3FFF] is reached through maps 1-3. (The Model III's and
 * Model I's `ram` starts at 0x4000 instead.)
 *
 * The 128K page select, port 0x84 bits 4-6 (MAME's names: d4 Srcpage, d5
 * "Enable page mapping (1=enabled)", d6 Despage): with bit 5 set, bank
 * 2 + bit 4 takes the place of bank 1 (CPU 0x8000-0xFFFF) when bit 6 is clear,
 * or of bank 0 (CPU 0x0000-0x7FFF) when bit 6 is set; with bit 5 clear,
 * banks 0 and 1 (MAME's entries for 128K in `machine_start`; xtrs's
 * `mem_bank` has the same five settings, 0, 2, 3, 6, 7, and stops on 1, 4, and
 * 5, which MAME, followed here, takes as no paging). With 64K the page bits do
 * nothing (MAME configures every entry to banks 0 and 1).
 *
 * Bits 2 (80/64 columns) and 3 (inverse video) are kept in `mapRegister` for
 * the video (emu phase 6b, Task 2).
 */
export class Model4Memory extends MemorySystem {
  /** @param {{ model: import('./models.js').Model, ram?: number }} opts */
  constructor(opts) {
    super(opts);
    // 2K of video RAM (MAME: m_p_videoram, banked by 1K at 0x3C00, all 2K at 0xF800)
    this.videoRam = new Uint8Array(0x800);
    /** The last byte written to port 0x84 (0 at reset). */
    this.mapRegister = 0;
    /** The memory map, 0-3: port 0x84 bits 0-1. */
    this.map = 0;
    /** Where in `ram` the CPU's 0x0000-0x7FFF and 0x8000-0xFFFF start. */
    this.lowBase = 0;
    this.highBase = BANK;
    /** Where in `videoRam` the 1K page shown at 0x3C00 in maps 0-1 starts: port 0x84 bit 7. */
    this.videoBase = 0;
    this.setMapRegister(0);
  }

  /**
   * Take a write to port 0x84 (the IOSystem's handler, and reset with 0).
   * @param {number} value
   */
  setMapRegister(value) {
    value &= 0xff;
    this.mapRegister = value;
    this.map = value & 0x03;
    this.videoBase = value & 0x80 ? 0x400 : 0;
    this.lowBase = 0;
    this.highBase = BANK;
    if (this.ram.length > 2 * BANK && (value & 0x20) !== 0) {
      const bank = (2 + ((value >> 4) & 1)) * BANK;
      if (value & 0x40) this.lowBase = bank;
      else this.highBase = bank;
    }
  }

  /**
   * The 128K page select as a number, port 0x84 bits 4-6 (0 with 64K, whose
   * page bits do nothing), for save states and coverage.
   */
  get page() {
    return this.ram.length > 2 * BANK ? (this.mapRegister >> 4) & 0x07 : 0;
  }

  /** @param {number} address */
  readByte(address) {
    address &= 0xffff;
    switch (this.map) {
      case 0:
        if (address < KEYBOARD_BASE) return this.rom[address];
      // falls through: 0x3800-0x3FFF as in map 1
      case 1:
        if (address >= KEYBOARD_BASE && address < RAM_BASE) {
          if (address >= KEYBOARD_LIMIT) return this.videoRam[this.videoBase + address - KEYBOARD_LIMIT];
          return this.keyboard ? this.keyboard.read(address & 0xff) : 0x00;
        }
        break;
      case 2:
        if (address >= 0xf400) {
          if (address >= 0xf800) return this.videoRam[address - 0xf800];
          return this.keyboard ? this.keyboard.read(address & 0xff) : 0x00;
        }
        break;
    }
    return this.ram[(address < BANK ? this.lowBase : this.highBase) + (address & 0x7fff)];
  }

  /** @param {number} address */
  peekByte(address) {
    return this.readByte(address);
  }

  /**
   * @param {number} address
   * @param {number} value
   */
  writeByte(address, value) {
    address &= 0xffff;
    value &= 0xff;
    switch (this.map) {
      case 0:
        if (address < KEYBOARD_BASE) return; // ROM
      // falls through
      case 1:
        if (address >= KEYBOARD_BASE && address < RAM_BASE) {
          if (address >= KEYBOARD_LIMIT) {
            this.videoRam[this.videoBase + address - KEYBOARD_LIMIT] = value;
            this.videoDirty = true;
          }
          return;
        }
        break;
      case 2:
        if (address >= 0xf400) {
          if (address >= 0xf800) {
            this.videoRam[address - 0xf800] = value;
            this.videoDirty = true;
          }
          return;
        }
        break;
    }
    this.ram[(address < BANK ? this.lowBase : this.highBase) + (address & 0x7fff)] = value;
  }

  /** The 64K the CPU sees in the current map; the keyboard reads idle (0x00), as in the base view. */
  getMemoryView() {
    const view = new Uint8Array(0x10000);
    const saved = this.keyboard;
    this.keyboard = null;
    try {
      for (let a = 0; a < 0x10000; a++) view[a] = this.readByte(a);
    } finally {
      this.keyboard = saved;
    }
    return view;
  }
}
