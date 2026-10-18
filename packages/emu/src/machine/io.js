/**
 * TRS-80 Model III I/O System
 *
 * Non-disk machine port map:
 *   0xE0-0xE3  read: interrupt latch, active-low (pending bit reads 0)
 *              write: interrupt mask (bit set = source enabled)
 *   0xEC-0xEF  read: acknowledge/clear the RTC interrupt
 *              write: mode register (bit 1 = cassette motor,
 *                     bit 2 = 32-column mode, bit 3 = alt charset)
 *   0xE4-0xE7  read: NMI status, active-low (bit 7 = FDC INTRQ)
 *              write: NMI mask (bit 7 = FDC INTRQ raises NMI)
 *   0xF0-0xF3  WD1793 floppy controller; with no disk mounted anywhere it
 *              is absent and reads float to 0xFF
 *   0xF4       drive select (write): bits 0-3 drive, bit 4 side, bit 6
 *              WAIT, bit 7 MFM
 *   0xF8-0xFB  line printer (read: status, write: data byte)
 *   0xFF       cassette port (write bits 0-1 = output level,
 *              read: bit 7 = 500-baud pulse latch, bit 0 = 1500-baud
 *              level, bits 5-1 = port 0xEC's latch, bit 6 high)
 *
 * The Model 4 has the Model III's ports and, at 0x84-0x87, its memory-map
 * register (write only; reads float to 0xFF): MAME trs80m3.cpp maps
 * `port_84_w` over 0x84-0x87, and xtrs trs_io.c decodes 0x84-0x87 alike.
 * The byte goes to `onMapWrite` (Model4Memory.setMapRegister, which decodes
 * it), and a reset writes 0 there (MAME `machine_reset`: "port_84_w(0)";
 * xtrs `trs_reset`: z80_out(0x84, 0)).
 *
 * The RTC heartbeat interrupt fires at 30 Hz; its latch bit is RTC_IRQ_BIT.
 * The keyboard is memory-mapped at 0x3800-0x3BFF (see MemorySystem), not
 * an I/O port.
 *
 * The Model I has only port 0xFF (cassette, sound, and the video mode; its
 * own handler, initializeModel1CassettePort): its other devices are
 * memory-mapped by the Expansion Interface at 0x37E0-0x37EF
 * (src/machine/models.js), which MemorySystem hands to `readExpansion`,
 * `peekExpansion`, and `writeExpansion` here, so every other port floats to
 * 0xFF. With the Expansion Interface (`expansion`, the default) the Model I
 * has the interrupt latch at 0x37E0 (`latch`, devices/interrupt-latch.js),
 * the drive select at 0x37E1, the printer at 0x37E8, and the WD1771 at
 * 0x37EC-0x37EF (devices/fdc-wd1771.js, its INTRQ on the latch's bit 6);
 * without it `latch` is null and nothing interrupts. The controller object
 * exists on both models, clocked at the model's CPU clock (a WD1793 on the
 * Model III, a WD1771 on the Model I); the Model I does not reach it through
 * ports, and without the Expansion Interface not at all.
 */

import { CassetteSystem } from "../devices/cassette.js";
import { FDC1793 } from "../devices/fdc-wd1793.js";
import { FDC1771 } from "../devices/fdc-wd1771.js";
import { Printer } from "../devices/printer.js";
import { InterruptLatch } from "../devices/interrupt-latch.js";
import { MODEL_III } from "./models.js";
import { decodeModel1Select, decodeModel3Select } from "./drive-select.js";

export const RTC_IRQ_BIT = 0x04;
// Cassette-edge interrupt sources (from the ROM's ISR at 0x35C2: E0
// bit 0 dispatches to a handler expecting one input level, bit 1 the
// other; each reads the level back from port 0xFF bit 0). The 1500-baud
// reader masks in rises only (0xE0 write = 0x01) and counts full
// cycles between interrupts.
export const CASSETTE_RISE_IRQ_BIT = 0x01;
export const CASSETTE_FALL_IRQ_BIT = 0x02;

// NMI mask/status bits (port 0xE4)
export const NMI_INTRQ_BIT = 0x80;

// Mode register (port 0xEC write) bits
export const MODE_32COL_BIT = 0x04; // 32-character display mode

// The Model I's port 0xFF output latch (Z59), D0-D3: "D0 and D1 ... are used
// to output data that is recorded on tape during a CSAVE function. D2 ...
// controls the status of the Recorder's motor. D3 ... controls the status of
// MODESEL*" (TRS-80 Micro Computer Technical Reference Handbook, 2nd ed.,
// 1982, p. 45, "OUTSIG*"). On the Model I `modeRegister` holds this latch.
export const M1_MOTOR_BIT = 0x04;
export const M1_MODESEL_BIT = 0x08; // 32-character display mode

export { decodeModel1Select, decodeModel3Select } from "./drive-select.js";

export class IOSystem {
  /**
   * @param {{ model?: import('./models.js').Model, expansion?: boolean }} [opts] the model whose
   *   ports to install (the Model III by default), and on the Model I whether the Expansion
   *   Interface is fitted (by default it is)
   */
  constructor({ model = MODEL_III, expansion = true } = {}) {
    this.model = model;
    // The Expansion Interface's interrupt latch at 0x37E0: the one object the timer (bit 7) and
    // the disk controller (bit 6, emu phase 6 Task 3) raise and clear their bits in.
    /** @type {InterruptLatch | null} */
    this.latch = model.id === 1 && expansion ? new InterruptLatch() : null;
    this.cassette = new CassetteSystem();
    // A Model I recording decodes in Model III T-states (cassette.js)
    if (model.id !== 3) this.cassette.timeScale = MODEL_III.clockHz / model.clockHz;
    this.fdc = model.id !== 1 ? new FDC1793({ cpuHz: model.clockHz }) : new FDC1771({ cpuHz: model.clockHz, latch: this.latch });
    this.printer = new Printer();
    this.keyboardBuffer = []; // legacy internal buffer (not a Model III port)
    this.portHandlers = new Map();

    // Interrupt latch (pending sources) and mask (enabled sources)
    this.intLatch = 0;
    this.intMask = 0;

    // NMI mask (port 0xE4 write): bit 7 = FDC INTRQ triggers NMI
    this.nmiMask = 0;

    // Mode register (port 0xEC write); on the Model I, the port 0xFF
    // output latch, D0-D3 (M1_MOTOR_BIT, M1_MODESEL_BIT)
    this.modeRegister = 0;

    // Fired when a mode-register write changes the value (the display
    // reads bit 2, so the renderer must repaint even though video RAM
    // itself didn't change). Wired by TRS80System.
    this.onModeWrite = null;

    // Cassette output level (port 0xFF write, bits 0-1)
    this.cassetteOut = 0;

    // Cassette-out transitions for the sound driver: {t, level} stamped
    // in CPU T-states. getCycles is wired by TRS80System; the driver
    // drains the log every frame. Capped so an undrained log (sound off,
    // headless run) cannot grow without bound.
    this.getCycles = null;
    this.soundLog = [];
    this.SOUND_LOG_LIMIT = 100000;
    // Raw port 0xFF write sink (cycles, value): the Machine's sound ring.
    this.onSoundWrite = null;
    // Called when the timeline restarts (state restore): the Machine clears its sound ring.
    this.onSoundReset = null;
    // The Model III WAIT (port F4 bit 6): called with a function that runs the controller to
    // its next DRQ or INTRQ and returns the T-states that took, for the CPU to wait them; wired
    // by TRS80System. Unwired, port F4 does not wait.
    this.onWait = null;

    // The Model 4's port 0x84 sink, wired by TRS80System to the memory (Model4Memory).
    /** @type {((value: number) => void) | null} */
    this.onMapWrite = null;

    if (model.id !== 1) {
      this.initializeModelIIIPorts();
      this.initializeCassettePort();
      if (model.id === 4) this.initializeModel4Ports();
    } else {
      this.initializeModel1CassettePort();
      // The Model I interrupts through the Expansion Interface's latch alone, which has no mask
      // (none without the interface); the Model III's pendingInterrupt below is left as it was.
      const latch = this.latch;
      this.pendingInterrupt = latch === null ? () => false : () => latch.bits !== 0;
    }
  }

  initializeModelIIIPorts() {
    // 0xE0-0xE3: interrupt latch (read, active-low) / mask (write)
    for (let port = 0xe0; port <= 0xe3; port++) {
      this.portHandlers.set(port, {
        read: () => ~this.intLatch & 0xff,
        write: (value) => {
          this.intMask = value & 0xff;
        },
      });
    }

    // 0xEC-0xEF: RTC acknowledge (read) / mode register (write)
    for (let port = 0xec; port <= 0xef; port++) {
      this.portHandlers.set(port, {
        read: () => {
          this.intLatch &= ~RTC_IRQ_BIT;
          return 0xff;
        },
        write: (value) => {
          const changed = this.modeRegister !== (value & 0xff);
          this.modeRegister = value & 0xff;
          // Mode register bit 1 drives the cassette motor relay;
          // CassetteSystem.control expects the motor state in bit 0.
          this.cassette.control(
            (value >> 1) & 0x01,
            this.getCycles ? this.getCycles() : 0
          );
          if (changed && this.onModeWrite) {
            this.onModeWrite(this.modeRegister);
          }
        },
      });
    }

    // 0xE4-0xE7: disk NMI mask (write) / status (read, active-low).
    // With no controller "present" (no disk mounted) the port floats.
    // Bit 7 is the FDC's INTRQ, read live. MAME's trs80m3 driver also
    // names bit 6 (motor timeout, its own NMI enable) and bit 5 (the reset
    // button); neither is modeled, and none of this is yet checked against
    // the Model III Technical Reference Manual (spec §5).
    for (let port = 0xe4; port <= 0xe7; port++) {
      this.portHandlers.set(port, {
        read: () => {
          if (!this.fdc.anyDiskMounted()) return 0xff;
          let value = 0xff;
          if (this.fdc.intrq) value &= ~NMI_INTRQ_BIT;
          return value;
        },
        write: (value) => {
          this.nmiMask = value & 0xff;
        },
      });
    }

    // 0xF0-0xF3: WD1793 FDC. The controller presents as absent (floating
    // bus) until a disk is mounted — that float is what sends the boot
    // ROM to cassette BASIC on a driveless machine.
    const fdcPresent = () => this.fdc.anyDiskMounted();
    this.portHandlers.set(0xf0, {
      read: () => (fdcPresent() ? this.fdc.readStatus() : 0xff),
      write: (v) => {
        if (fdcPresent()) this.fdc.writeCommand(v);
      },
    });
    this.portHandlers.set(0xf1, {
      read: () => (fdcPresent() ? this.fdc.readTrackReg() : 0xff),
      write: (v) => {
        if (fdcPresent()) this.fdc.writeTrackReg(v);
      },
    });
    this.portHandlers.set(0xf2, {
      read: () => (fdcPresent() ? this.fdc.readSectorReg() : 0xff),
      write: (v) => {
        if (fdcPresent()) this.fdc.writeSectorReg(v);
      },
    });
    this.portHandlers.set(0xf3, {
      read: () => (fdcPresent() ? this.fdc.readData() : 0xff),
      write: (v) => {
        if (fdcPresent()) this.fdc.writeData(v);
      },
    });

    // 0xF4: drive select / side / density latch. Bit 6 asserts WAIT
    // until the controller raises DRQ or INTRQ (MAME's trs80m3: only when
    // both are low); the ROM's boot read and the DOSes' INI loops rely on
    // it to take each byte as it arrives.
    this.portHandlers.set(0xf4, {
      read: () => 0xff,
      write: (v) => {
        if (!fdcPresent()) return;
        const sel = decodeModel3Select(v);
        this.fdc.select(sel.drive, sel.side, sel.mfm);
        if (sel.wait && this.onWait) this.onWait(() => this.fdc.waitForDrq());
      },
    });

    // 0xF8-0xFB: line printer. Status reads ready; data writes land on
    // the printout. Note io.reset() leaves the printout alone — paper
    // already printed survives a reboot on the real machine too.
    for (let port = 0xf8; port <= 0xfb; port++) {
      this.portHandlers.set(port, {
        read: () => this.printer.status(),
        write: (v) => this.printer.write(v),
      });
    }
  }

  /** The Model 4's memory-map register at 0x84-0x87 (above). */
  initializeModel4Ports() {
    for (let port = 0x84; port <= 0x87; port++) {
      this.portHandlers.set(port, {
        write: (value) => {
          if (this.onMapWrite) this.onMapWrite(value & 0xff);
        },
      });
    }
  }

  /** Port 0xFF on the Model III. */
  initializeCassettePort() {
    // 0xFF: cassette data port. Reads return the input latch in bit 7
    // (set by tape transitions while the motor runs); ANY write clears
    // the latch — that's the Model III's latch circuit, and it's how
    // the ROM's read routines re-arm between pulses. Output level
    // changes are the machine's only sound source, so they're logged
    // for the audio driver, and they double as the recording the deck
    // can decode back into a .cas.
    this.portHandlers.set(0xff, {
      read: () => {
        const cycles = this.getCycles ? this.getCycles() : 0;
        // Two input bits, straight from the ROM's own readers:
        //   bit 0 — the tape signal's live LEVEL (the 1500-baud ISR
        //           does IN A,(0xFF) / AND 0x01 / CP E per edge);
        //   bit 7 — a rising-edge PULSE LATCH (the 500-baud reader
        //           polls it with RLA and resets it by OUT (0xFF),A).
        // Bits 5-1 read port 0xEC's latch back (DISWAIT, ENEXTIO, ENALTSET,
        // MODSEL, CASMOTORON), and bit 6 is undefined: Model III Technical
        // Reference Manual p. 22 (CASIN*). Undriven, bit 6 floats high, as
        // an absent port's bits do; trs80gp (and trsjs) read it as 1 too.
        // Reading also acks the edge interrupt sources: the ISR reads
        // 0xE0 then 0xFF and nothing else.
        this.intLatch &= ~(CASSETTE_RISE_IRQ_BIT | CASSETTE_FALL_IRQ_BIT);
        const level = this.cassette.tapeLevel(cycles);
        return (this.cassette.pulseLatch ? 0x80 : 0x00) | 0x40 | (this.modeRegister & 0x3e) | (level ? 0x01 : 0x00);
      },
      write: (value) => {
        const cycles = this.getCycles ? this.getCycles() : 0;
        const level = value & 0x03;
        if (this.onSoundWrite) this.onSoundWrite(cycles, value);
        if (level !== this.cassetteOut) {
          this.cassetteOut = level;
          if (this.getCycles && this.soundLog.length < this.SOUND_LOG_LIMIT) {
            this.soundLog.push({ t: cycles, level });
          }
          this.cassette.recordTransition(cycles, level);
        }
        this.cassette.clearPulseLatch(cycles);
      },
    });
  }

  /**
   * Port 0xFF on the Model I. The port is the Z59 output latch and one input
   * flip-flop (Technical Reference Handbook, 2nd ed., p. 45, "OUTSIG*",
   * and pp. 50-51, "INSIG*"):
   *   write D0-D1  cassette output level (the only sound source; logged for
   *                the sound driver and m.sound, and recorded while the
   *                motor runs, as on the Model III)
   *   write D2     the cassette motor relay
   *   write D3     MODESEL: 32 characters a line when set
   *   any write    resets the cassette flip-flop ("set by cassette data and
   *                reset by OUTSIG*", p. 50)
   *   read  D7     the cassette flip-flop: the Level II ROM's bit reader
   *                (MDL1LEV2.Z80, CTBIT at $0241) polls it with RLA and resets
   *                it through CTSTAT ($021E), an OUT of the shadow copy CAST
   * The other read bits are MAME's (trs80 driver, port_ff_r: D6 is MODESEL
   * inverted, D0-D5 read 1); the handbook says only that INSIG* enables the
   * flip-flop's buffer, so they are unverified. The deck sets the flip-flop
   * on a rising edge of the tape signal (cassette.js); MAME takes the
   * falling edge, which for the 500-baud pulses moves nothing a reader sees.
   */
  initializeModel1CassettePort() {
    this.portHandlers.set(0xff, {
      read: () => {
        const cycles = this.getCycles ? this.getCycles() : 0;
        this.cassette.tapeLevel(cycles); // play the tape up to now
        return (
          (this.cassette.pulseLatch ? 0x80 : 0x00) |
          (this.modeRegister & M1_MODESEL_BIT ? 0x00 : 0x40) |
          0x3f
        );
      },
      write: (value) => {
        const cycles = this.getCycles ? this.getCycles() : 0;
        if (this.onSoundWrite) this.onSoundWrite(cycles, value);
        const motor = (value & M1_MOTOR_BIT) !== 0;
        if (motor !== this.cassette.motorOn) {
          this.cassette.control(motor ? 1 : 0, cycles);
        }
        const level = value & 0x03;
        if (level !== this.cassetteOut) {
          this.cassetteOut = level;
          if (this.getCycles && this.soundLog.length < this.SOUND_LOG_LIMIT) {
            this.soundLog.push({ t: cycles, level });
          }
          this.cassette.recordTransition(cycles, level);
        }
        const latch = value & 0x0f;
        const changed = (latch ^ this.modeRegister) & M1_MODESEL_BIT;
        this.modeRegister = latch;
        if (changed && this.onModeWrite) this.onModeWrite(this.modeRegister);
        this.cassette.clearPulseLatch(cycles);
      },
    });
  }

  /**
   * A CPU read of the Model I's Expansion Interface addresses 0x37E0-0x37EF
   * (MemorySystem calls it only on a Model I with the Expansion Interface):
   *   0x37E0-0x37E3  the interrupt latch, clearing its clock bit
   *                  (interrupt-latch.js; the mirrors are MAME's, unverified)
   *   0x37E4-0x37E7  0xFF (the cassette select at 0x37E4 is write-only, and a
   *                  second deck is not modelled)
   *   0x37E8-0x37EB  the printer's status: the Level II ROM's PRTAVL at $05D1
   *                  reads 0x37E8 and takes (status AND F0H) = 30H as ready
   *                  (MDL1LEV2.Z80); the mirrors are MAME's (unverified)
   *   0x37EC-0x37EF  the WD1771: status, track, sector, data (CONSTANTS.Z80,
   *                  "Memory Mapped Hardware, Model 1"); a status read clears
   *                  INTRQ and with it the latch's disk bit
   * With no disk mounted in any drive the controller is taken as absent, as on
   * the Model III, and 0x37EC-0x37EF read 0xFF: the ROM's test at $0696-$069C
   * (status + 1 < 2, that is $FF or $00: no disk controller) then sends it to
   * Level II BASIC instead of a boot that would wait for a disk forever.
   * @param {number} address
   */
  readExpansion(address) {
    if (address <= 0x37e3) return this.latch.read();
    if (address >= 0x37ec) {
      if (!this.fdc.anyDiskMounted()) return 0xff;
      switch (address) {
        case 0x37ec:
          return this.fdc.readStatus();
        case 0x37ed:
          return this.fdc.readTrackReg();
        case 0x37ee:
          return this.fdc.readSectorReg();
        default:
          return this.fdc.readData();
      }
    }
    if (address >= 0x37e8) return this.printer.status();
    return 0xff;
  }

  /**
   * What `readExpansion` would return, with no side effect (the latch keeps
   * its clock bit, the controller its INTRQ and DRQ).
   * @param {number} address
   */
  peekExpansion(address) {
    if (address <= 0x37e3) return this.latch.peek();
    if (address >= 0x37ec) {
      if (!this.fdc.anyDiskMounted()) return 0xff;
      if (address === 0x37ec) return this.fdc.peekStatus();
      if (address === 0x37ed) return this.fdc.trackReg;
      if (address === 0x37ee) return this.fdc.sectorReg;
      return this.fdc.dataReg;
    }
    if (address >= 0x37e8) return this.printer.status();
    return 0xff;
  }

  /**
   * A CPU write to 0x37E0-0x37EF:
   *   0x37E0-0x37E3  the drive select (decodeModel1Select; written at 0x37E1,
   *                  the mirrors are MAME's, unverified). The latch is the
   *                  Expansion Interface's, not the controller's, so it takes
   *                  a write with no disk mounted too, and a disk mounted
   *                  later finds the drive the program last selected
   *   0x37E8-0x37EB  a byte to the printer (the ROM's `LD (37E8H),A` at $05BB)
   *   0x37EC-0x37EF  the WD1771: command, track, sector, data
   * The controller's registers ignore writes while no disk is mounted
   * (absent, as above).
   * @param {number} address
   * @param {number} value
   */
  writeExpansion(address, value) {
    if (address <= 0x37e3) {
      this.fdc.select(decodeModel1Select(value).drive, 0, false);
      return;
    }
    if (address >= 0x37ec) {
      if (!this.fdc.anyDiskMounted()) return;
      switch (address) {
        case 0x37ec:
          this.fdc.writeCommand(value);
          return;
        case 0x37ed:
          this.fdc.writeTrackReg(value);
          return;
        case 0x37ee:
          this.fdc.writeSectorReg(value);
          return;
        default:
          this.fdc.writeData(value);
      }
      return;
    }
    if (address >= 0x37e8) this.printer.write(value);
  }

  readPort(port) {
    port &= 0xff;
    const handler = this.portHandlers.get(port);
    return handler?.read ? handler.read() : 0xff;
  }

  writePort(port, value) {
    port &= 0xff;
    value &= 0xff;
    const handler = this.portHandlers.get(port);
    if (handler?.write) {
      handler.write(value);
    }
  }

  /** Raise the 30 Hz real-time clock interrupt line. */
  raiseRTC() {
    this.intLatch |= RTC_IRQ_BIT;
  }

  /** True when an enabled interrupt source is pending. */
  pendingInterrupt() {
    // The cassette edge is a live source: advance the pulse deck to
    // "now" so an edge that just played raises the latch bit without
    // waiting for a port access. Guarded, so machines without a tape
    // playing pay one property check.
    if (this.cassette.pulseTape && this.cassette.motorOn && this.getCycles) {
      const edges = this.cassette.consumeEdges(this.getCycles());
      if (edges.rise) this.intLatch |= CASSETTE_RISE_IRQ_BIT;
      if (edges.fall) this.intLatch |= CASSETTE_FALL_IRQ_BIT;
    }
    return (this.intLatch & this.intMask) !== 0;
  }

  /** True when the FDC's INTRQ should raise an NMI. */
  nmiPending() {
    return this.fdc.intrq && (this.nmiMask & NMI_INTRQ_BIT) !== 0;
  }

  /** Hand the accumulated cassette-out transitions to the sound driver. */
  drainSound() {
    if (this.soundLog.length === 0) return this.soundLog;
    const log = this.soundLog;
    this.soundLog = [];
    return log;
  }

  /** Clear interrupt state (system reset). Mounted disks stay mounted. */
  reset() {
    this.latch?.reset();
    this.intLatch = 0;
    this.intMask = 0;
    this.nmiMask = 0;
    this.modeRegister = 0;
    this.cassetteOut = 0;
    this.soundLog = [];
    this.fdc.reset();
    if (this.model.id === 4 && this.onMapWrite) this.onMapWrite(0);
  }

  readKeyboard() {
    return this.keyboardBuffer.length > 0 ? this.keyboardBuffer.shift() : 0x00;
  }

  addKey(keyCode) {
    if (this.keyboardBuffer.length < 256) {
      this.keyboardBuffer.push(keyCode & 0xff);
    }
  }

  clearKeyboardBuffer() {
    this.keyboardBuffer = [];
  }
}
