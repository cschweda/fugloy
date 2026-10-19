/**
 * The spec §3 `Machine`: the public face of the emulator, over a TRS80System. It builds the
 * Model III with 48K, (emu phase 6) the Model I with 4, 16, 32, or 48K, or (emu phase 6b) the
 * Model 4 with 64 or 128K, as the model descriptions in models.js lay them out; execution, state access, ROM identification, the
 * devices, the loaders, and the debugger live here.
 */
import { TRS80System } from './trs80-system.js';
import { ROM_HASHES } from './rom-hashes.js';
import { modelOf, ramProblem, romModelProblem } from './models.js';
import { sha256Hex } from './sha256.js';
import { Video } from '../devices/video.js';
import { Sound } from '../devices/sound.js';
import { loadBas } from '../loaders/bas.js';
import { cassetteDeck, diskDrives, loadCas, loadCmd, loadDsk } from '../loaders/load.js';
import { Debugger } from '../debug/debugger.js';
import { KeyQueue, romKeyReturn } from '../devices/key-queue.js';

/**
 * @typedef {{ a: number, f: number, b: number, c: number, d: number, e: number, h: number, l: number,
 *   a2: number, f2: number, b2: number, c2: number, d2: number, e2: number, h2: number, l2: number,
 *   ix: number, iy: number, sp: number, pc: number, i: number, r: number,
 *   iff1: boolean, iff2: boolean, im: number }} Regs
 * @typedef {{ s: boolean, z: boolean, h: boolean, pv: boolean, n: boolean, c: boolean }} Flags
 * @typedef {'halt' | ((m: Machine) => boolean)} Until
 */

export class Machine {
  /** @type {TRS80System} The wrapped system: an escape hatch to the devices, outside the stable API. */
  system;
  /** @type {{ bytes: number, sha256: string, recognized: string | null }} */
  rom;
  /** @type {{ readonly regs: Regs, readonly flags: Flags }} */
  cpu;
  /**
   * @type {{ read(addr: number, len: number): Uint8Array, write(addr: number, bytes: ArrayLike<number>): void, readonly ram: Uint8Array,
   *   readonly map: { map: number, page: number, register: number } | null }}
   */
  mem;
  /** @type {{ in(port: number): number, out(port: number, value: number): void }} */
  io;
  /** @type {Video} The text readout of video RAM. */
  video;
  /** @type {Sound} Every port $FF write, raw and stamped in T-states. */
  sound;
  /** @type {KeyQueue} Key presses now, cycle-timed typing through the matrix, and the ROM keyboard-scan hook's feed. */
  keyboard;
  /**
   * @type {{ bas(bytes: Uint8Array): ReturnType<typeof loadBas>, cmd(bytes: Uint8Array): ReturnType<typeof loadCmd>,
   *   cas(bytes: Uint8Array, opts?: { baud?: 500 | 1500, via?: 'rom' | 'fast' }): ReturnType<typeof loadCas>,
   *   dsk(bytes: Uint8Array, opts?: { drive?: number, boot?: boolean }): ReturnType<typeof loadDsk> }}
   * Program loaders; each returns a manifest of where the bytes land and why.
   */
  load;
  /** @type {ReturnType<typeof cassetteDeck>} The cassette deck: insert a .CAS at a baud, rewind, read the motor relay. */
  cassette;
  /** @type {ReturnType<typeof diskDrives>} The four floppy drives: mount a JV1, JV3, or DMK image, unmount, list what is in each, export one as DMK. */
  fdc;
  /** @type {Debugger} Breakpoints, watchpoints, hooks, coverage, the instruction trace, snapshots, labels, and the label file (spec §7, §8). */
  debug;

  /** True inside `run`, false inside `step`, which ignores breakpoints. */
  #checkBreaks = false;
  /** True until a run's first boundary has passed; that boundary is never checked, so a run resumes past a break. */
  #firstBoundary = false;
  /** @type {number | null} The PC where the last run stopped for a breakpoint: the next run's first boundary skips the check there only. */
  #resumePc = null;
  /** True while `step` or `run` executes, so a callback cannot re-enter either. */
  #busy = false;
  /** Set by the hook when a breakpoint held the boundary, read by `run`. */
  #stopped = false;

  /**
   * @param {{ model?: 1 | 3 | 4, ram?: 4 | 16 | 32 | 48 | 64 | 128, roms: { level2: Uint8Array }, expansion?: boolean, lowercase?: boolean,
   *   log?: (level: string, text: string) => void }} opts
   *   `ram` defaults to 48 (the Model III takes only 48 for now; the Model 4 takes 64 or 128, 128 by
   *   default); `expansion` (the Expansion Interface, default
   *   true) and `lowercase` (the lowercase modification, default false) are Model I options
   */
  constructor({ model = 3, ram, roms, expansion, lowercase, log } = /** @type {any} */ ({})) {
    const desc = modelOf(model);
    const kb = ram ?? desc.defaultRam;
    const badRam = ramProblem(desc, kb);
    if (badRam !== null) throw new Error(badRam);
    for (const [name, value] of /** @type {const} */ ([['expansion', expansion], ['lowercase', lowercase]])) {
      if (value === undefined) continue;
      if (desc.id !== 1) throw new Error(`${name} is a Model I option; the ${desc.name} has no ${name === 'expansion' ? 'Expansion Interface' : 'lowercase modification (its lowercase is built in)'}.`);
      if (typeof value !== 'boolean') throw new Error(`${name} must be true or false, not ${String(value)}.`);
    }
    const level2 = roms?.level2;
    if (!ArrayBuffer.isView(level2) || level2.BYTES_PER_ELEMENT !== 1) throw new Error('Machine needs roms.level2, the ROM image as a Uint8Array');

    // A ROM recognised as the other model's is refused by name before its size is checked, so the
    // sentence says which model it needs rather than only that its length is wrong.
    const sha256 = sha256Hex(level2);
    const recognized = ROM_HASHES[sha256] ?? null;
    const problem = romModelProblem(recognized, desc.id);
    if (problem !== null) throw new Error(problem);
    this.system = new TRS80System({ romData: level2, log, model: desc, ram: kb, expansion: expansion ?? true, lowercase: lowercase ?? false });
    this.rom = { bytes: level2.length, sha256, recognized };

    const sys = this.system;
    const cpu = sys.cpu;
    this.cpu = {
      get regs() {
        const r = cpu.registers;
        return {
          a: r.A, f: r.F, b: r.B, c: r.C, d: r.D, e: r.E, h: r.H, l: r.L,
          a2: r.A_, f2: r.F_, b2: r.B_, c2: r.C_, d2: r.D_, e2: r.E_, h2: r.H_, l2: r.L_,
          ix: cpu.IX, iy: cpu.IY, sp: r.SP, pc: r.PC, i: r.I, r: r.R,
          iff1: cpu.IFF1, iff2: cpu.IFF2, im: cpu.interruptMode,
        };
      },
      get flags() {
        const f = cpu.registers.F;
        return { s: (f & 0x80) !== 0, z: (f & 0x40) !== 0, h: (f & 0x10) !== 0, pv: (f & 0x04) !== 0, n: (f & 0x02) !== 0, c: (f & 0x01) !== 0 };
      },
      // True while the CPU sits in a HALT (PC is then just past it), until an interrupt or a reset.
      get halted() {
        return cpu.halted;
      },
    };
    this.mem = {
      read(addr, len) {
        const out = new Uint8Array(len);
        // Peeked: reading the Model I's interrupt latch here does not clear it, as a CPU read would.
        for (let k = 0; k < len; k++) out[k] = sys.memory.peekByte((addr + k) & 0xffff);
        return out;
      },
      write(addr, bytes) {
        for (let k = 0; k < bytes.length; k++) sys.memory.writeByte((addr + k) & 0xffff, bytes[k]);
      },
      // All RAM: from $4000 on the Model III and Model I; on the Model 4 every 32K bank in order,
      // map 0's CPU address A at ram[A] (memory.js, Model4Memory).
      get ram() {
        return sys.memory.ram;
      },
      // The Model 4's memory map now: `map` (0-3, port $84 bits 0-1), `page` (the 128K page select,
      // port $84 bits 4-6; 0 with 64K), and `register` (the last byte written to port $84); null on
      // the Model III and Model I, which have one map. A fresh object each read.
      get map() {
        if (sys.model.id !== 4) return null;
        const mm = /** @type {import('./memory.js').Model4Memory} */ (sys.memory);
        return { map: mm.map, page: mm.page, register: mm.mapRegister };
      },
    };
    this.video = new Video(sys);
    this.sound = new Sound();
    sys.io.onSoundWrite = (cycle, value) => this.sound.record(cycle, value);
    sys.io.onSoundReset = () => this.sound.clear();
    // Typing counts in the clock at the time it is queued (the Model 4's can switch).
    this.keyboard = new KeyQueue(sys.keyboard, () => sys.cpu.cycles, () => sys.clockHz);
    this.debug = new Debugger(this);
    // Each load records its manifest and the bytes' hash for the label file (the last one wins).
    const record = (/** @type {any} */ manifest, /** @type {Uint8Array} */ bytes) => {
      this.debug.recordLoad(manifest, bytes);
      return manifest;
    };
    this.load = {
      bas: (bytes) => record(loadBas(this, bytes), bytes),
      cmd: (bytes) => record(loadCmd(this, bytes), bytes),
      cas: (bytes, opts) => record(loadCas(this, bytes, opts), bytes),
      dsk: (bytes, opts) => record(loadDsk(this, bytes, opts), bytes),
    };
    this.cassette = cassetteDeck(this);
    this.fdc = diskDrives(this);
    this.io = {
      in: (port) => sys.io.readPort(port),
      out: (port, value) => sys.io.writePort(port, value),
    };
  }

  /** @returns {1 | 3 | 4} The model built: 1 (the Model I), 3 (the Model III), or 4 (the Model 4). */
  get model() {
    return this.system.model.id;
  }

  /**
   * The CPU clock in Hz now: 2,027,520 on the Model III, 1,774,080 on the Model I, and on the
   * Model 4 2,027,520, or 4,055,040 while port $EC bit 6 is set (models.js). T-state counts
   * (`cycles`, `run`'s budget, `m.sound` stamps) are in this clock's states; on the Model 4 an
   * emulated second is as many T-states as `clockHz` says at the time.
   * @returns {number}
   */
  get clockHz() {
    return this.system.clockHz;
  }

  /** Total T-states since the last reset. */
  get cycles() {
    return this.system.cpu.cycles;
  }

  /** Hardware reset: CPU to $0000, cycle count to 0, RAM kept (TRS80System.reset). */
  reset() {
    this.system.reset();
    this.#resumePc = null;
    this.sound.clear();
    this.keyboard.clear();
  }

  /**
   * Internal: a restore starts a fresh timeline, so the PC where the last run stopped for a
   * breakpoint is forgotten, and the key queue and sound ring (whose cycle stamps belong to the
   * old timeline) are cleared.
   */
  newTimeline() {
    this.#resumePc = null;
    this.sound.clear();
    this.keyboard.clear();
  }

  /**
   * The internal per-instruction hook, run at every instruction boundary (after interrupt
   * delivery, before the instruction executes) by both `step` and `run`: deliver the matrix key
   * events now due, then, with a fed character waiting and the PC at the ROM's keyboard scan
   * ($002B) or wait-for-key ($0049), return from that routine with the character as the ROM
   * would (spec §6, "Keyboard-scan hook"). The Model I Level II ROM has the same two entries with
   * the same contract (romKeyReturn), so the hook serves both models. That return stands in for
   * the boundary's instruction, as one RET (10 T-states); a halted CPU idles instead, as it does
   * for any instruction, so the next boundary is at the caller's return address.
   * Between draining and the keyboard hook, a breakpoint hit (only while `debug.active`, and
   * never in `step`) stops the boundary: nothing executes. Last, with memory accesses watched or
   * hooked, the debugger is told an instruction starts at PC, so its fetches are not taken for
   * reads and its accesses carry its PC; the keyboard hook's stand-in and a halted CPU's idle
   * start none (the idle reads nothing; the stand-in's stack reads carry the CPU's PC).
   * @returns {boolean | 'stop'} true when the hook stood in for the instruction, 'stop' when a breakpoint holds the boundary
   */
  #beforeInstruction() {
    const cpu = this.system.cpu;
    const kb = this.keyboard;
    if (cpu.cycles >= kb.nextAt) kb.drain(cpu.cycles);
    // A run's first boundary skips the check only at the PC its predecessor stopped at; a halted
    // CPU idles at HALT+1 on every boundary, so it is never checked.
    const pc = cpu.registers.PC;
    const first = this.#firstBoundary && pc === this.#resumePc;
    this.#firstBoundary = false;
    this.#resumePc = null;
    if (this.debug.active && this.#checkBreaks && !cpu.halted && this.debug.beforeInstruction(pc, first)) {
      this.#stopped = true;
      this.#resumePc = pc;
      return 'stop';
    }
    if (cpu.halted) return false;
    // On the Model 4 only map 0 has the ROM there; in maps 1-3 $002B and $0049 are RAM (memory.js,
    // Model4Memory). Other models' memory has no `map`.
    if (kb.hasFeed && (pc === 0x002b || pc === 0x0049) && !this.system.memory.map) {
      const debug = this.debug;
      if (debug.tracksAccess) {
        debug.standIn(true);
        try {
          romKeyReturn(cpu, pc, kb.takeFeed());
        } finally {
          debug.standIn(false);
        }
      } else romKeyReturn(cpu, pc, kb.takeFeed());
      return true;
    }
    if (this.debug.startsInstruction) this.debug.startInstruction(pc);
    return false;
  }

  /** Bound once, so the hot loop passes the same function every instruction. */
  #hook = () => this.#beforeInstruction();

  /**
   * Execute `n` whole instructions (an interrupt response counts with the instruction after it).
   * @param {number} [n]
   * @returns {{ cycles: number, halted: boolean }}
   */
  step(n = 1) {
    const sys = this.system;
    const start = sys.cpu.cycles;
    const debug = this.debug;
    if (this.#busy) throw new Error('step: the machine is already running; step and run cannot be called from a when or until callback');
    this.#busy = true;
    this.#checkBreaks = false;
    try {
      for (let k = 0; k < n; k++) {
        sys.stepInstruction(this.#hook);
        if (debug.active) debug.afterInstruction();
      }
    } catch (e) {
      // A hook or callback that threw leaves no instruction open, no edge recorded for it, and no stop pending for the next call.
      if (debug.active) {
        debug.endInstruction();
        debug.afterInstruction();
      }
      throw e;
    } finally {
      this.#busy = false;
    }
    return { cycles: sys.cpu.cycles - start, halted: sys.cpu.halted };
  }

  /**
   * Run until a T-state budget is spent or a condition holds, both checked after each
   * instruction; at least one instruction always runs. The condition wins a tie with the budget.
   * A breakpoint stops the run before its instruction executes, and the next run starts past it
   * (only at that PC, so hit counts do not depend on how a session is split into runs). A
   * breakpoint at a run's first boundary that it did not just stop at stops with `cycles: 0`
   * (an interrupt response at that boundary counts). Breakpoints are not checked while halted.
   * A watch with `stop` returns after the instruction whose access hit it; after an instruction
   * the order is watch stop, then `until`, then the budget. `step` logs watch hits but never stops.
   * A stop watch hit by an interrupt response at a boundary a breakpoint then holds stays pending:
   * the next run returns `'watch'` after the held instruction (a `step` in between drops it).
   * @param {{ cycles?: number, until?: Until }} opts
   * @returns {{ reason: 'cycles' | 'halt' | 'predicate', cycles: number } | { reason: 'break' | 'watch', id: number, cycles: number }}
   */
  run({ cycles, until } = {}) {
    if (cycles === undefined && until === undefined) throw new Error('run needs cycles, until, or both; with neither it would never stop');
    if (cycles !== undefined && !(Number.isFinite(cycles) && cycles >= 0)) throw new Error(`run: cycles must be a finite number of T-states, 0 or more, not ${String(cycles)}`);
    if (until !== undefined && until !== 'halt' && typeof until !== 'function') throw new Error(`run: until must be 'halt' or a function, not ${String(until)}`);
    const sys = this.system;
    const cpu = sys.cpu;
    const start = cpu.cycles;
    const target = cycles === undefined ? Infinity : start + cycles;
    const debug = this.debug;
    if (this.#busy) throw new Error('run: the machine is already running; step and run cannot be called from a when or until callback');
    this.#busy = true;
    this.#checkBreaks = true;
    this.#firstBoundary = true;
    this.#stopped = false;
    try {
      for (;;) {
        sys.stepInstruction(this.#hook);
        if (this.#stopped) {
          this.#stopped = false;
          // A watch stop from this boundary's interrupt response stays pending: the next run returns it after the held instruction.
          debug.endInstruction();
          const id = /** @type {number} */ (debug.stopId);
          debug.stopId = null;
          return { reason: 'break', id, cycles: cpu.cycles - start };
        }
        if (debug.active) {
          const w = debug.afterInstruction();
          if (w !== null) return { reason: 'watch', id: w, cycles: cpu.cycles - start };
        }
        if (until === 'halt') {
          if (cpu.halted) return { reason: 'halt', cycles: cpu.cycles - start };
        } else if (until !== undefined && until(this)) {
          return { reason: 'predicate', cycles: cpu.cycles - start };
        }
        if (cpu.cycles >= target) return { reason: 'cycles', cycles: cpu.cycles - start };
      }
    } catch (e) {
      // A hook or callback that threw leaves no instruction open, no edge recorded for it, and no stop pending for the next call.
      if (debug.active) {
        debug.endInstruction();
        debug.afterInstruction();
      }
      throw e;
    } finally {
      this.#busy = false;
    }
  }
}
