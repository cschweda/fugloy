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
 *              read bit 7 = tape input)
 *
 * The RTC heartbeat interrupt fires at 30 Hz; its latch bit is RTC_IRQ_BIT.
 * The keyboard is memory-mapped at 0x3800-0x3BFF (see MemorySystem), not
 * an I/O port.
 *
 * The Model I has only port 0xFF (cassette, sound, and the video mode): its
 * other devices are memory-mapped by the Expansion Interface at
 * 0x37E0-0x37EF (src/machine/models.js), so a Model I gets port 0xFF alone,
 * and every other port floats to 0xFF. The controller object exists on both
 * models, clocked at the model's CPU clock; the Model I does not reach it
 * through ports.
 */

import { CassetteSystem } from "../devices/cassette.js";
import { FDC1793 } from "../devices/fdc-wd1793.js";
import { Printer } from "../devices/printer.js";
import { MODEL_III } from "./models.js";

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

export class IOSystem {
  /** @param {{ model?: import('./models.js').Model }} [opts] the model whose ports to install (the Model III by default) */
  constructor({ model = MODEL_III } = {}) {
    this.model = model;
    this.cassette = new CassetteSystem();
    this.fdc = new FDC1793({ cpuHz: model.clockHz });
    this.printer = new Printer();
    this.keyboardBuffer = []; // legacy internal buffer (not a Model III port)
    this.portHandlers = new Map();

    // Interrupt latch (pending sources) and mask (enabled sources)
    this.intLatch = 0;
    this.intMask = 0;

    // NMI mask (port 0xE4 write): bit 7 = FDC INTRQ triggers NMI
    this.nmiMask = 0;

    // Mode register (port 0xEC write)
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

    if (model.id === 3) {
      this.initializeModelIIIPorts();
    }
    this.initializeCassettePort();
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

  /**
   * Port 0xFF, on both models. The Model III's bits are modeled; the Model
   * I's own layout (its motor and 32-column bits) is not yet, so it gets the
   * same handler for now.
   */
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
        // Reading also acks the edge interrupt sources: the ISR reads
        // 0xE0 then 0xFF and nothing else.
        this.intLatch &= ~(CASSETTE_RISE_IRQ_BIT | CASSETTE_FALL_IRQ_BIT);
        const level = this.cassette.tapeLevel(cycles);
        return (this.cassette.pulseLatch ? 0x80 : 0x00) | (level ? 0x01 : 0x00);
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
    this.intLatch = 0;
    this.intMask = 0;
    this.nmiMask = 0;
    this.modeRegister = 0;
    this.cassetteOut = 0;
    this.soundLog = [];
    this.fdc.reset();
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
