/**
 * TRS-80 System, Model III or Model I
 *
 * Owns and wires the machine: Z80 CPU, memory map, I/O ports, and the
 * keyboard matrix, laid out by the model description (models.js). Runs the
 * CPU in T-state-budgeted slices at the model's clock (the Model III's real
 * 2.02752 MHz) and raises the Model III's 30 Hz RTC heartbeat interrupt the
 * ROM's clock/cursor services depend on. The Model I's 40 Hz timer is not
 * delivered yet (its Expansion Interface latch is not built), so a Model I
 * takes no interrupts.
 *
 * Rendering is the caller's concern: read `memory.videoRam` (or
 * `screenText()`) and consult `memory.videoDirty`. Keyboard input goes
 * through `system.keyboard` (press and release keys directly).
 */

import { Z80CPU } from "../cpu/z80cpu.js";
import { MemorySystem } from "./memory.js";
import { IOSystem, MODE_32COL_BIT } from "./io.js";
import { KeyboardMatrix } from "../devices/keyboard.js";
import { MODEL_III, modelOf } from "./models.js";

/** The Model III's clock and RTC; a system's own are `clockHz` and `rtcInterval`. */
export const CPU_CLOCK_HZ = MODEL_III.clockHz;
export const RTC_HZ = MODEL_III.timerHz;
export const RTC_INTERVAL_TSTATES = CPU_CLOCK_HZ / RTC_HZ; // 67,584

export class TRS80System {
  /**
   * @param {{ romData: Uint8Array, log?: (level: string, text: string) => void,
   *   model?: 1 | 3 | import('./models.js').Model, ram?: number, expansion?: boolean, lowercase?: boolean }} opts
   *   the model (a number or a description; the Model III by default), its RAM in K (the model's
   *   default), and the Model I's Expansion Interface (fitted by default) and lowercase modification
   *   (not fitted by default); the Machine checks them
   */
  constructor({ romData, log, model = MODEL_III, ram, expansion = true, lowercase = false }) {
    const desc = typeof model === "number" ? modelOf(model) : model;
    this.model = desc;
    this.clockHz = desc.clockHz;
    this.rtcInterval = desc.clockHz / desc.timerHz;
    this.expansion = expansion;
    this.lowercase = lowercase;
    this.memory = new MemorySystem({ model: desc, ram: ram ?? desc.defaultRam });
    this.io = new IOSystem({ model: desc });
    this.keyboard = new KeyboardMatrix();
    this.cpu = new Z80CPU();
    if (log !== undefined) {
      this.cpu.log = log;
      this.io.cassette.log = log;
    }

    this.memory.keyboard = this.keyboard;

    this.cpu.readMemory = (addr) => this.memory.readByte(addr);
    this.cpu.writeMemory = (addr, value) => this.memory.writeByte(addr, value);
    this.cpu.readPort = (port) => this.io.readPort(port);
    this.cpu.writePort = (port, value) => this.io.writePort(port, value);

    // A mode-register change (e.g. the ROM handling CHR$(23)) redraws
    // the same video RAM in a different layout — force a repaint.
    this.io.onModeWrite = () => {
      this.memory.videoDirty = true;
    };

    // Cassette-out sound transitions are stamped in CPU T-states
    this.io.getCycles = () => this.cpu.cycles;

    // The Model III WAIT (port F4 bit 6): the controller runs ahead to its
    // next DRQ or INTRQ; the CPU's clock catches up, and stepInstruction
    // does not tick the controller for those T-states again. A port write
    // from outside an instruction (a debugger poke) does not wait.
    this._executing = false;
    this._fdcAhead = 0;
    this.io.onWait = (runToDrq) => {
      if (!this._executing) return;
      const held = runToDrq();
      this.cpu.cycles += held;
      this._fdcAhead += held;
    };

    this.memory.loadROM(romData);

    this.nextRtcAt = this.rtcInterval;
    this.reset();
  }

  /**
   * Hardware reset (the orange button): CPU restarts at 0x0000, interrupt
   * latches clear, screen blanks. RAM contents survive, as on the real
   * machine.
   */
  reset() {
    this.cpu.reset();
    this.io.reset();
    this.keyboard.reset();
    this.memory.clearVideoRAM();
    this.nextRtcAt = this.cpu.cycles + this.rtcInterval;
    this._nmiWasPending = false;
  }

  /**
   * Execute instructions until `budget` T-states have elapsed, raising
   * the RTC heartbeat on schedule and delivering pending interrupts
   * between instructions. Returns the T-states actually consumed (the
   * final instruction may overshoot slightly).
   */
  runTStates(budget) {
    const start = this.cpu.cycles;
    const target = start + budget;

    while (this.cpu.cycles < target) {
      this.stepInstruction();
    }

    return this.cpu.cycles - start;
  }

  /**
   * One instruction boundary, the only place the machine advances: raise
   * the RTC heartbeat when its T-state is due, deliver a pending
   * interrupt or NMI edge, then call `beforeExecute` (if given) and
   * execute one instruction, ticking the disk controller by its cost.
   * `runTStates` and the Machine facade both step through here, so the
   * RTC keeps one schedule however the machine is driven. Returns the
   * T-states consumed, an interrupt response included.
   * @param {() => boolean | 'stop' | void} [beforeExecute] called after interrupt delivery, with PC at the instruction about to run; returning true means it stood in for that instruction, which then does not execute; returning 'stop' means no instruction executes at all (a debugger break)
   * @returns {number}
   */
  stepInstruction(beforeExecute) {
    const start = this.cpu.cycles;
    if (this.cpu.cycles >= this.nextRtcAt) {
      if (this.model.id === 3) this.io.raiseRTC();
      this.nextRtcAt += this.rtcInterval;
    }
    if (this.io.pendingInterrupt()) {
      this.cpu.interrupt();
    }
    // FDC INTRQ -> NMI, edge-triggered so one assertion fires one NMI. The
    // CPU holds an NMI off after a lone DD/FD prefix, as it does a maskable
    // interrupt (Young §3.6); the edge then stays pending for the next
    // boundary.
    const nmiNow = this.io.nmiPending();
    if (nmiNow && !this._nmiWasPending) {
      if (this.cpu.nmi()) this._nmiWasPending = true;
    } else {
      this._nmiWasPending = nmiNow;
    }

    // The disk controller ticks by every T-state the boundary takes, an interrupt or NMI
    // response included, so its clock (the disk's angle) keeps step with the CPU's: the response
    // first, so an OUT that sets the WAIT finds the controller at the start of that OUT; then the
    // instruction, less the T-states the WAIT already ran it ahead for (`_fdcAhead`).
    const before = this.cpu.cycles;
    if (before !== start) this.io.fdc.tick(before - start);

    // beforeExecute returning true has executed the boundary's instruction itself (the
    // Machine's ROM keyboard-scan hook stands in for a RET), so the CPU does not run one.
    // Returning 'stop' runs nothing; the return value is then the response's T-states.
    // try/finally: a callback or an instruction that throws must not leave `_executing` set, or
    // a later debugger port poke would wait as if an instruction were running.
    this._executing = true;
    try {
      if (beforeExecute !== undefined) {
        const r = beforeExecute();
        if (r === 'stop') return before - start;
        if (r !== true) this.cpu.executeInstruction();
      } else {
        this.cpu.executeInstruction();
      }
    } catch (e) {
      this._fdcAhead = 0;
      throw e;
    } finally {
      this._executing = false;
    }
    this.io.fdc.tick(this.cpu.cycles - before - this._fdcAhead);
    this._fdcAhead = 0;
    return this.cpu.cycles - start;
  }

  /**
   * True when the machine is in 32-character mode (mode register bit 2,
   * set by the ROM for CHR$(23), cleared by CLS). The ROM lays 32-column
   * text at even video addresses; hardware shows them double-wide.
   */
  get columns32() {
    return (this.io.modeRegister & MODE_32COL_BIT) !== 0;
  }

  /** Mount a .dsk image (DiskImage) in drive 0-3. */
  mountDisk(driveNumber, image) {
    this.io.fdc.attachDrive(driveNumber, image);
  }

  /**
   * Eject every drive and reboot into cassette BASIC, answering the
   * ROM's Cass? and Memory Size? prompts. Cassette-world loaders (the
   * library, .cas tapes, paste-BASIC) need the machine at READY — under
   * a booted DOS their typed RUN goes to the DOS prompt instead. Runs
   * ~3.5 emulated seconds inline, a blink of wall clock.
   * @returns {boolean} true when the READY prompt was reached
   */
  bootToCassetteBasic() {
    for (let drive = 0; drive < 4; drive++) {
      this.ejectDisk(drive);
    }
    this.reset();
    const pressEnter = () => {
      this.keyboard.keyDown("Enter", "bootdance");
      this.runTStates(200000);
      this.keyboard.keyUp("bootdance");
      this.runTStates(100000);
    };
    this.runSeconds(1);
    pressEnter();
    this.runSeconds(0.5);
    pressEnter();
    this.runSeconds(2);
    return this.screenText().join("\n").includes("READY");
  }

  ejectDisk(driveNumber) {
    this.io.fdc.ejectDrive(driveNumber);
  }

  /** Convenience for tests: run N emulated seconds. */
  runSeconds(seconds) {
    return this.runTStates(Math.round(seconds * this.clockHz));
  }

  /**
   * Type text through the keyboard matrix at emulated speed ("turbo
   * paste"): each key is held long enough for the ROM's scan/debounce,
   * but the wall-clock cost is only the emulation time (~3 ms/char).
   * '\n' presses ENTER. Returns the number of characters that had no
   * matrix mapping and were skipped.
   *
   * After ENTER the ROM tokenizes and stores the line (cost grows with
   * program size) before it scans the keyboard again — give it room or
   * the first character of the next line gets eaten. The default suits
   * the small built-in classics; pass a larger `enterTStates` for
   * multi-KB listings (a 5.7 KB program needs ~1M).
   */
  typeText(text, { enterTStates = 400000 } = {}) {
    let skipped = 0;
    let seq = 0;
    for (const ch of text) {
      const key = ch === "\n" ? "Enter" : ch;
      const code = `typeText:${seq++}`;
      if (!this.keyboard.keyDown(key, code)) {
        skipped++;
        continue;
      }
      this.runTStates(70000); // held across several scans + debounce
      this.keyboard.keyUp(code);
      this.runTStates(ch === "\n" ? enterTStates : 50000);
    }
    return skipped;
  }

  /**
   * The 64x16 screen as strings, for tests and status displays.
   * Control bytes 0x00-0x1F display as their 0x40-0x5F fold (Model III
   * character generator); block-graphics bytes render as '.'.
   */
  screenText() {
    const rows = [];
    for (let row = 0; row < 16; row++) {
      let line = "";
      for (let col = 0; col < 64; col++) {
        let byte = this.memory.videoRam[row * 64 + col];
        if (byte < 0x20) {
          byte += 0x40;
        }
        line += byte >= 0x20 && byte < 0x80 ? String.fromCharCode(byte) : ".";
      }
      rows.push(line);
    }
    return rows;
  }
}
