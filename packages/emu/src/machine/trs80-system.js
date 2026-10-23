/**
 * TRS-80 System, Model III, Model I, or Model 4
 *
 * Owns and wires the machine: Z80 CPU, memory map, I/O ports, and the
 * keyboard matrix, laid out by the model description (models.js). Runs the
 * CPU in T-state-budgeted slices at the model's clock (the Model III's real
 * 2.02752 MHz) and raises the Model III's 30 Hz RTC heartbeat interrupt the
 * ROM's clock/cursor services depend on, or the Model I Expansion
 * Interface's 40 Hz clock, through its latch at $37E0
 * (devices/interrupt-latch.js); a Model I without the Expansion Interface
 * has no clock and takes no interrupts. The Model 4 starts at the Model
 * III's clock and timer and switches to 4.05504 MHz with a 60 Hz timer when
 * port $EC bit 6 is set (`selectClock`; models.js cites the sources).
 *
 * Rendering is the caller's concern: read `memory.videoRam` (or
 * `screenText()`) and consult `memory.videoDirty`. Keyboard input goes
 * through `system.keyboard` (press and release keys directly).
 */

import { Z80CPU } from "../cpu/z80cpu.js";
import { MemorySystem, Model4Memory } from "./memory.js";
import { IOSystem, MODE_32COL_BIT, M1_MODESEL_BIT } from "./io.js";
import { TIMER_BIT } from "../devices/interrupt-latch.js";
import { KeyboardMatrix } from "../devices/keyboard.js";
import { MODEL_III, modelOf } from "./models.js";

/** The Model III's clock and RTC; a system's own are `clockHz` and `rtcInterval`. */
export const CPU_CLOCK_HZ = MODEL_III.clockHz;
export const RTC_HZ = MODEL_III.timerHz;
export const RTC_INTERVAL_TSTATES = CPU_CLOCK_HZ / RTC_HZ; // 67,584

export class TRS80System {
  /**
   * @param {{ romData: Uint8Array, log?: (level: string, text: string) => void,
   *   model?: 1 | 3 | 4 | import('./models.js').Model, ram?: number, expansion?: boolean, lowercase?: boolean }} opts
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
    this.memory = desc.id === 4
      ? new Model4Memory({ model: desc, ram: ram ?? desc.defaultRam })
      : new MemorySystem({ model: desc, ram: ram ?? desc.defaultRam, lowercase });
    this.io = new IOSystem({ model: desc, expansion });
    // The Model 4's port $84 goes to its memory maps
    if (this.memory instanceof Model4Memory) {
      const memory = this.memory;
      this.io.onMapWrite = (value) => memory.setMapRegister(value);
      // and its port $EC bit 6 to the clock
      this.io.onClockSelect = (fast) => this.selectClock(fast);
    }
    /** True while the Model 4 runs at its 4 MHz clock (port $EC bit 6); always false on other models. */
    this.fast = false;
    // The Model I's Expansion Interface addresses go to the I/O decode
    if (this.io.latch !== null) this.memory.expansion = this.io;
    // The 32-column bit: port $EC bit 2 on the Model III, port $FF bit 3 (MODESEL) on the Model I
    this._mode32Bit = desc.id === 1 ? M1_MODESEL_BIT : MODE_32COL_BIT;
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
   * The Model 4's clock switch: `clockHz` and the timer go to the model's fast clock and timer
   * (4,055,040 Hz and 60 Hz) or back to its Model III ones (2,027,520 Hz and 30 Hz). The timer
   * ticks every 67,584 T-states at either clock, so its schedule (`nextRtcAt`) stands. What times
   * itself in T-states of the clock follows it: the disk controller (a disk turns in real time, so
   * at 4 MHz a revolution takes twice the T-states; `rescale` false, for a save state's restore,
   * leaves its counters as the state saved them) and the cassette recording's decode scale. A
   * tape already playing keeps the clock it was inserted at (spec §5). Other models ignore it.
   * @param {boolean} fast
   * @param {{ rescale?: boolean }} [opts]
   */
  selectClock(fast, { rescale = true } = {}) {
    const desc = this.model;
    if (desc.fastClockHz === undefined || desc.fastTimerHz === undefined) return;
    if (fast === this.fast) return;
    this.fast = fast;
    this.clockHz = fast ? desc.fastClockHz : desc.clockHz;
    this.rtcInterval = this.clockHz / (fast ? desc.fastTimerHz : desc.timerHz);
    this.io.fdc.setCpuHz(this.clockHz, { rescale });
    this.io.cassette.timeScale = MODEL_III.clockHz / this.clockHz;
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
      if (this.model.id !== 1) this.io.raiseRTC();
      else if (this.io.latch !== null) this.io.latch.raise(TIMER_BIT);
      this.nextRtcAt += this.rtcInterval;
    }
    // The Model I ties the CPU's HALT* output into the reset switch's NMI circuit: HALT* and the
    // switch S2 meet at Z53 (74LS132), and Z37 (74LS02) turns its output into NMI* (Z40 pin 17)
    // and SYSRES* (TRS-80 Micro Computer Technical Reference Handbook, 2nd ed., 1982, Figure 29
    // sheet 1, p. 113; pp. 15-16). So a HALT is answered at the next boundary by the NMI a press of
    // RESET makes, and the ROM's handler at $0066 takes over, as on MAME's trs80l2 (halt_cb to its
    // "nmigate") and xtrs (z80.c, case 0x76). SYSRES*'s reset of the Expansion Interface is not
    // modelled (MAME's note on that line: "TODO"). The NMI wins over a maskable request at the
    // same boundary (Zilog UM0080), which stays pending; the CPU leaves its halt as it takes the
    // NMI, so HALT* rises again and the next HALT is a new edge.
    const haltNmi = this.model.id === 1 && this.cpu.halted;
    if (!haltNmi && this.io.pendingInterrupt()) {
      this.cpu.interrupt();
    }
    // FDC INTRQ -> NMI (the Model III's), edge-triggered so one assertion fires one NMI. The
    // CPU holds an NMI off after a lone DD/FD prefix, as it does a maskable
    // interrupt (Young §3.6); the edge then stays pending for the next
    // boundary.
    const nmiNow = haltNmi || this.io.nmiPending();
    if (nmiNow && !this._nmiWasPending) {
      if (this.cpu.nmi()) this._nmiWasPending = !haltNmi || this.io.nmiPending();
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
   * True when the machine is in 32-character mode (on the Model III the
   * mode register's bit 2, on the Model I port $FF's MODESEL, bit 3; set by
   * the ROM for CHR$(23), cleared by CLS). The ROM lays 32-column text at
   * even video addresses; hardware shows them double-wide.
   */
  get columns32() {
    return (this.io.modeRegister & this._mode32Bit) !== 0;
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
