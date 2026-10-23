/**
 * The lockstep comparator of emu phase 7's differential harness: run our Machine and the trsjs
 * reference one instruction at a time from the same state, compare them after every instruction,
 * and report the first difference that no known class (known.js) explains.
 *
 * Compared after every instruction (plan Ruling 5): PC, every register, F and F' bit by bit, R as
 * 7 bits, IFF1/2, IM, the instruction's T-states (an interrupt response counts with the instruction
 * after it, on both sides), and every memory write the CPU attempts, in order, address and value.
 * Video RAM is compared on every divergence and at the end of the run.
 *
 * Two representation differences are mapped, not counted: during EI's one-instruction delay our
 * IFF1/2 read as set (trsjs sets them in EI itself), and a halted CPU of ours sits at HALT+1 where
 * trsjs's sits on the HALT, so our PC is compared less one while halted.
 *
 * Where an interrupt may be taken is derived from the instruction stream, never from our CPU's
 * own state: none at the boundary right after an executed EI, none after a lone DD or FD (one whose
 * next byte is DD, FD, or ED). A request held for one of those, or while IFF1 was 0, must be taken
 * by our CPU at the first boundary that allows it, and none may be taken where the stream forbids
 * it; either fault is a divergence in the field `irq`.
 *
 * The known classes that may explain a difference are the reference's own (`Reference.classes`,
 * resolved by known.js's declaredClasses; plan Rulings 3 and 6): a step class explains only
 * against a reference that declares it, an interrupt is held back or forced on the reference only
 * for a reason it declares a class for, and a reference fix is made only for the reference that
 * declares it. Nothing here asks which reference it is.
 *
 * Keys (Ruling 3) go to both machines' keyboard matrices directly, at the first instruction
 * boundary at or after their T-state, never through our ROM keyboard hook.
 *
 * A trace reference (MAME, mame-trace.js) cannot be synced; it brings `follow` instead (Ruling 4):
 * our machine starts in the trace's power-on state, takes a maskable interrupt exactly at the
 * steps the trace took one (a request ours raised at another time is the divergence `irqTime`,
 * never excused), and its reads of the keyboard matrix return the bytes the trace's reads returned
 * (a read on one side only is the divergence `keys`). A trace that loaded a program loads it into
 * ours before the same step (follow.beforeStep). After a difference a known class explains,
 * our machine adopts the trace's state instead of the reverse. A trace shorter than the run ends it
 * with the trace's sentence (`ended`), never as "no divergence".
 *
 * The model's devices are passed in (`model`, `lowercase`; Ruling 5), never inferred from which
 * reference runs (Ruling 3). The Model III's 30 Hz request is port $E0's latch under its mask; the
 * Model I's is the Expansion Interface's latch at $37E0 (bit 7, the 40 Hz clock), and on the Model
 * I three more things are compared:
 *
 * - **The $37E0 latch after every read of it** (field `latch`): a step in which our CPU read the
 *   latch compares our latch afterwards with the reference's (`Reference.latch`), so a read that
 *   fails to clear the clock bit shows on that instruction. A trace (MAME) records the bytes its
 *   reads returned instead: ours must have read the same bytes, in order.
 * - **Video RAM through the bit-6 gate** (field `video`), after every step that wrote it and at the
 *   end: the Model I without the lowercase modification has seven video RAMs, and the CPU reads
 *   bit 6 from NOR gate Z30 ("If Bit 5 ... and Bit 7 ... are low, then Bit 6 will be high": TRS-80
 *   Micro Computer Technical Reference Handbook, 2nd ed., 1982, p. 34, "Video RAMs"). Our byte is
 *   compared as stored (our memory applies the gate on the write, as xtrs's mem_write does) with
 *   the reference's byte read through the gate (`b & 0xBF` when bit 5 or 7 is set, else
 *   `b | 0x40`), so a reference that stores the byte as written (MAME) compares equal, and a gate
 *   of ours that is wrong does not. With the lowercase modification the bytes compare raw.
 *   Following a trace, a read of video RAM where the trace's byte is ours but for the gate returns
 *   the trace's byte, counted as a reference fix (MAME's CPU reads the byte as written).
 * - **Port $FF** (the cassette and 32-character mode latch): its reads land in a register
 *   (`IN A,($FF)`: bit 7 the cassette latch, bit 6 not MODESEL, bits 5-0 high, on ours, xtrs's
 *   trs_io.c and MAME's trs80_m.cpp alike) and its writes are made from registers, so both are
 *   compared on the instruction that makes them.
 *
 * The comparator wraps our CPU's `interrupt` and `executeInstruction`, our memory's `writeByte`,
 * on the Model I the latch's `read` (and, following a trace, our memory's `readByte` and the I/O's
 * `pendingInterrupt`) for the run, and puts them back after.
 */
import { decode, formatInstruction } from '@fugloy/z80';
import { KeyQueue } from '../../src/devices/key-queue.js';
import { KeyboardMatrix } from '../../src/devices/keyboard.js';
import { RTC_IRQ_BIT } from '../../src/machine/io.js';
import { TIMER_BIT } from '../../src/devices/interrupt-latch.js';
import { COMMON_CLASSES, declaredClasses, diffStep, droppedPrefix, explainStep, interruptClass, REFERENCE_FIXES } from './known.js';

/**
 * @typedef {import('../../src/machine/machine.js').Machine} Machine
 * @typedef {import('./reference.js').Reference} Reference
 * @typedef {import('./reference.js').Write} Write
 * @typedef {import('./known.js').Regs} Regs
 * @typedef {{ at: number, row: number, bit: number, down: boolean }} KeyEvent
 * @typedef {{ regs: Regs, cycles: number }} SideState
 * @typedef {{ index: number, pc: number, code: number, idle: boolean, text: string, ours: SideState, theirs: SideState }} ContextLine
 *   code: the instruction's first four bytes as it began (big-endian), so self-modifying code shows
 *   what ran; idle: a halted CPU's step (a NOP).
 * @typedef {{
 *   index: number,
 *   pc: number,
 *   kind: 'step' | 'video',
 *   fields: string[],
 *   known: string | null,
 *   ours: SideState,
 *   theirs: SideState,
 *   writes: { ours: Write[], theirs: Write[] },
 *   video: { equal: boolean, differing: number, first: number | null },
 *   context: ContextLine[],
 * }} Divergence
 *   index: the instruction's 0-based number in the run; pc: where our CPU executed it; fields: what
 *   differs (register names, flag bits as `f.S`, `cycles`, `writes`, `irq` (an interrupt taken where none may be, or not taken where it must), or `video`); known: the class a
 *   `strict` run stopped on, else null; context: up to 10 instructions before, the divergent one,
 *   and up to 10 after (both machines run on, unsynced).
 * @typedef {{ instructions: number, divergence: Divergence | null, known: Record<string, number>, ended?: string, reference: string, model: 1 | 3, lowercase: boolean }} CompareResult
 *   ended: a trace reference's sentence when its trace ended before `instructions` (then
 *   `instructions` is how many were compared); reference: the reference's name; model, lowercase:
 *   the devices compared.
 * @typedef {{
 *   model: 1 | 3,
 *   lowercase: boolean,
 *   through: ((b: number) => number) | null,
 *   request(sys: Machine['system']): boolean,
 *   latch: boolean,
 *   videoEach: boolean,
 * }} Devices
 *   through: how the reference's video byte reads on this machine (the Model I's bit-6 gate), or
 *   null for raw; request: our timer's request is pending (the one `held` tracks); latch: compare
 *   the $37E0 latch after each read of it; videoEach: compare the video bytes each step wrote.
 */

const CONTEXT = 10;
const DROPPED_PREFIX = /** @type {string} */ (REFERENCE_FIXES.find((c) => c.id === 'dropped-prefix')?.name);
const VIDEO_READ = /** @type {string} */ (REFERENCE_FIXES.find((c) => c.id === 'video-read-gate')?.name);
const VIDEO = 0x3c00;
const VIDEO_LEN = 0x400;

/**
 * The Model I's bit-6 gate, as the CPU reads a video byte without the lowercase modification:
 * bit 6 is NOR(bit 5, bit 7) (Technical Reference Handbook, 1982, p. 34; xtrs's trs_memory.c and
 * our memory.js apply it on the write).
 * @param {number} b
 */
export const videoGate = (b) => (b & 0xa0 ? b & 0xbf : b | 0x40);

/**
 * The devices compareRun compares for `model` (Ruling 5). @param {1 | 3} model @param {boolean} lowercase
 * @returns {Devices}
 */
export function modelDevices(model, lowercase) {
  if (model === 1) {
    return {
      model,
      lowercase,
      through: lowercase ? null : videoGate,
      // The Expansion Interface's 40 Hz clock bit in the $37E0 latch (it has no mask). Its disk
      // bit (bit 6, the WD1771's INTRQ) also drives the line and is not followed here (held or
      // mustTake): no Model I session mounts a disk, so none raises it; a disk session adds it.
      request: (sys) => sys.io.latch !== null && (sys.io.latch.bits & TIMER_BIT) !== 0,
      latch: true,
      videoEach: true,
    };
  }
  return { model, lowercase: false, through: null, request: (sys) => (sys.io.intLatch & sys.io.intMask & RTC_IRQ_BIT) !== 0, latch: false, videoEach: false };
}

/**
 * Key events for compareRun from a script of key presses, each held `hold` T-states (default
 * 100,000, about 50 ms). Keys are named as for `m.keyboard.press`: a character or ENTER, CLEAR,
 * BREAK, UP, DOWN, LEFT, RIGHT, SHIFT, SPACE; a key that needs SHIFT presses both matrix bits.
 * @param {{ at: number, key: string, hold?: number }[]} script
 * @returns {KeyEvent[]}
 */
export function keyEvents(script) {
  /** @type {KeyEvent[]} */
  const out = [];
  for (const { at, key, hold = 100_000 } of script) {
    const matrix = new KeyboardMatrix();
    new KeyQueue(matrix, () => 0).press(key);
    for (let row = 0; row < 8; row++) {
      for (let bit = 0; bit < 8; bit++) {
        if ((matrix.rows[row] >> bit) & 1) out.push({ at, row, bit, down: true }, { at: at + hold, row, bit, down: false });
      }
    }
  }
  // Stable: events at one T-state keep the script's order.
  return out.map((e, k) => ({ e, k })).sort((a, b) => a.e.at - b.e.at || a.k - b.k).map(({ e }) => e);
}

/**
 * Our registers in the comparison's terms: R as 7 bits, IFF set during EI's delay, PC on the
 * HALT while halted.
 * @param {Machine} m
 * @returns {Regs}
 */
export function ourRegs(m) {
  const cpu = m.system.cpu;
  const o = m.cpu.regs;
  o.r &= 0x7f;
  if (cpu.pendingEI > 0) o.iff1 = o.iff2 = true;
  if (cpu.halted) o.pc = (o.pc - 1) & 0xffff;
  return o;
}

/**
 * Wrap our machine's CPU and memory to log each step's writes, interrupt response, and executed
 * instruction (and, on the Model I, the bytes its reads of the $37E0 latch returned). Returns the
 * step function and an uninstall. With `follow` (a trace reference), our machine also takes the
 * trace's interrupts and keyboard bytes, and the log says where its own request or reads
 * disagreed (`irqTime`, `irqRefused`, `keys`); with `theirsVideo` too (the Model I's gate), a read
 * of video RAM whose trace byte is ours but for the gate returns the trace's (`videoRead`).
 * @param {Machine} m
 * @param {import('./mame-trace.js').Follow | null} [follow]
 * @param {Devices} [devices]
 * @param {((addr: number) => number) | null} [theirsVideo] the reference's video byte before this step
 */
function instrument(m, follow = null, devices = modelDevices(3, false), theirsVideo = null) {
  const mem = m.system.memory;
  const cpu = m.system.cpu;
  const io = m.system.io;
  const latch = devices.latch ? io.latch : null;
  const log = { writes: /** @type {Write[]} */ ([]), irq: false, execPc: 0, idle: false, code: 0, irqTime: false, irqRefused: false, keys: false, requested: false, latchReads: /** @type {number[]} */ ([]), videoRead: false };
  const own = (/** @type {object} */ o, /** @type {string} */ k) => Object.prototype.hasOwnProperty.call(o, k);
  const saved = { write: own(mem, 'writeByte'), interrupt: own(cpu, 'interrupt'), exec: own(cpu, 'executeInstruction'), read: own(mem, 'readByte'), pending: own(io, 'pendingInterrupt'), latch: latch !== null && own(latch, 'read') };
  const write = mem.writeByte;
  const interrupt = cpu.interrupt;
  const exec = cpu.executeInstruction;
  const read = mem.readByte;
  const pending = io.pendingInterrupt;
  const latchRead = latch?.read;
  let snapshot = false;
  // Our CPU is running an instruction (not the comparator reading our memory).
  let executing = false;
  if (latch !== null) {
    latch.read = () => {
      const v = /** @type {() => number} */ (latchRead).call(latch);
      log.latchReads.push(v);
      return v;
    };
  }
  mem.writeByte = (/** @type {number} */ addr, /** @type {number} */ value) => {
    log.writes.push({ addr: addr & 0xffff, value: value & 0xff });
    write.call(mem, addr, value);
  };
  cpu.interrupt = (/** @type {number | undefined} */ bus) => {
    if (follow !== null && !follow.irqAt(follow.index)) {
      // The trace took none here: hold ours. If our CPU would have taken it, ours was requested
      // before MAME's.
      if (cpu.IFF1 && cpu.pendingEI === 0 && !cpu.afterPrefix) log.irqTime = true;
      return false;
    }
    const taken = interrupt.call(cpu, bus);
    if (taken) log.irq = true;
    else if (follow !== null) log.irqRefused = true;
    return taken;
  };
  cpu.executeInstruction = () => {
    const pc = cpu.registers.PC;
    log.execPc = pc;
    log.idle = cpu.halted;
    // The instruction's bytes before it runs (it may rewrite itself); a halted step runs a NOP
    // (Zilog UM0080, "HALT Exit").
    snapshot = true;
    log.code = cpu.halted ? 0
      : ((mem.readByte(pc) << 24) | (mem.readByte((pc + 1) & 0xffff) << 16) | (mem.readByte((pc + 2) & 0xffff) << 8) | mem.readByte((pc + 3) & 0xffff)) >>> 0;
    snapshot = false;
    executing = true;
    try {
      return exec.call(cpu);
    } finally {
      executing = false;
    }
  };
  if (follow !== null) {
    // The trace's interrupt: ours is made to see a request where the trace took one; where ours
    // had none, its request came after MAME's.
    io.pendingInterrupt = () => {
      log.requested = pending.call(io);
      if (follow.irqAt(follow.index)) {
        if (!log.requested) log.irqTime = true;
        return true;
      }
      return log.requested;
    };
    // The trace's keyboard bytes, at the reads the trace recorded; and its video bytes where they
    // are ours but for the gate (the trace's CPU read the byte as written).
    mem.readByte = (/** @type {number} */ addr) => {
      const a = addr & 0xffff;
      if (executing && !snapshot && theirsVideo !== null && devices.through !== null && a >= VIDEO && a < VIDEO + VIDEO_LEN) {
        const v = read.call(mem, addr);
        const t = theirsVideo(a);
        if (t !== v && devices.through(t) === v) {
          log.videoRead = true;
          return t;
        }
        return v;
      }
      if (snapshot || a < 0x3800 || a >= 0x3c00) return read.call(mem, addr);
      const v = follow.keyRead(follow.index, a);
      if (v === undefined) {
        log.keys = true;
        return read.call(mem, addr);
      }
      return v;
    };
  }
  return {
    log,
    machine: m,
    /**
     * A byte of our memory without a read's side effects (known.js, StepContext's peek): the
     * $37E0 latch peeked, and, following a trace, read as a snapshot, so no trace keyboard byte is
     * used up. @param {number} addr
     */
    peek(addr) {
      snapshot = true;
      try {
        return mem.peekByte(addr & 0xffff);
      } finally {
        snapshot = false;
      }
    },
    step() {
      log.writes = [];
      log.irq = false;
      log.irqTime = false;
      log.irqRefused = false;
      log.keys = false;
      log.latchReads = [];
      log.videoRead = false;
      const wantIrq = follow !== null && follow.irqAt(follow.index);
      const { cycles } = m.step(1);
      if (follow !== null) {
        // The trace took an interrupt that ours never got to (no boundary check ran it), or read the
        // keyboard where ours did not.
        if (wantIrq && !log.irq) log.irqRefused = true;
        if (follow.keyReadsLeft(follow.index) > 0) log.keys = true;
      }
      return cycles;
    },
    uninstall() {
      // Put back exactly what was there: an own property the caller had, else the prototype's.
      if (saved.write) mem.writeByte = write; else delete mem.writeByte;
      if (saved.interrupt) cpu.interrupt = interrupt; else delete cpu.interrupt;
      if (saved.exec) cpu.executeInstruction = exec; else delete cpu.executeInstruction;
      if (latch !== null) {
        if (saved.latch) latch.read = /** @type {() => number} */ (latchRead); else delete /** @type {any} */ (latch).read;
      }
      if (follow !== null) {
        if (saved.read) mem.readByte = read; else delete mem.readByte;
        if (saved.pending) io.pendingInterrupt = pending; else delete io.pendingInterrupt;
      }
    },
  };
}

/**
 * Video RAM on both sides: ours as stored, the reference's read through `through` (the Model I's
 * bit-6 gate) when given.
 * @param {Machine} m @param {Reference} ref @param {((b: number) => number) | null} [through]
 */
function compareVideo(m, ref, through = null) {
  const a = m.mem.read(VIDEO, VIDEO_LEN);
  const b = ref.peek(VIDEO, VIDEO_LEN);
  let differing = 0;
  /** @type {number | null} */
  let first = null;
  for (let k = 0; k < VIDEO_LEN; k++) {
    if (a[k] !== (through === null ? b[k] : through(b[k]))) {
      differing++;
      if (first === null) first = VIDEO + k;
    }
  }
  return { equal: differing === 0, differing, first };
}

/**
 * An instruction disassembled from its first four bytes (`code`, big-endian) at `pc`.
 * @param {number} code @param {number} pc @param {boolean} [idle] a halted CPU's step
 */
export function disassemble(code, pc, idle = false) {
  if (idle) return 'HALT (halted)';
  return formatInstruction(decode((i) => (i < 4 ? (code >>> (24 - 8 * i)) & 0xff : undefined), pc));
}

/**
 * Run `instructions` instructions on both machines in lockstep from our machine's current state
 * and compare them after each one.
 *
 * The reference is synced from our machine first (Ruling 4). A difference the known classes the
 * reference declares (`Reference.classes`) explain is counted by class and the reference resynced
 * from our state (its registers, its cycle count and 30 Hz phase, and the bytes our instruction
 * wrote); with `strict`, the run stops on it instead. The first difference nothing explains ends
 * the run as the divergence, with context. Our machine's own key queue must be empty: keys come
 * through `keys`.
 *
 * `strict: true` stops on any known class but the reference's everyday flag 3 and 5 class (known.js
 * `common`: trsjs's general one, xtrs's BIT n,(HL) and BIT n,(IX+d), which differ in most programs
 * within a few instructions); `strict: 'all'` stops on that one as well. Against a reference that
 * declares no such class (MAME) the two are the same. `progress`, if given, is called after every
 * `progress.every` instructions with the count so far (a session test checks the screen there).
 *
 * `model` (1 or 3; default the machine's, a Model 4 compared as a III) and `lowercase` (the Model
 * I's lowercase modification; default the machine's) name the devices compared (Ruling 5); each
 * must agree with the machine, so the comparison never assumes hardware the run does not have.
 * @param {{ machine: Machine, reference: Reference, instructions: number, keys?: KeyEvent[], strict?: boolean | 'all', progress?: { every: number, fn: (done: number) => void }, model?: 1 | 3, lowercase?: boolean }} opts
 * @returns {CompareResult}
 */
export function compareRun({ machine: m, reference: ref, instructions, keys = [], strict = false, progress, model, lowercase }) {
  if (m.keyboard.pending > 0) throw new Error('compareRun: the machine\'s key queue has keys waiting; pass keys to compareRun so both machines get them');
  const machineModel = m.model === 1 ? 1 : 3;
  if (model !== undefined && model !== machineModel) throw new Error(`compareRun: model ${model} was asked for, and the machine is a Model ${m.model === 1 ? 'I' : m.model === 4 ? '4' : 'III'}`);
  const machineLower = machineModel === 1 && !m.system.memory.videoBit6Gate;
  if (lowercase !== undefined && machineModel !== 1) throw new Error('compareRun: lowercase is a Model I option (the modification); this machine is not a Model I');
  if (lowercase !== undefined && lowercase !== machineLower) throw new Error(`compareRun: lowercase ${lowercase} was asked for, and the machine ${machineLower ? 'has' : 'has no'} lowercase modification`);
  const devices = modelDevices(machineModel, machineLower);
  const refName = /** @type {any} */ (ref).name ?? 'the reference';
  const tag = { reference: refName, model: devices.model, lowercase: devices.lowercase };
  // The known classes this reference declares, and only those (Rulings 3 and 6).
  const declared = declaredClasses(ref.classes, `compareRun: ${refName}`);
  /** @type {import('./mame-trace.js').Follow | null} A trace reference: our machine follows it (Ruling 4). */
  const follow = /** @type {any} */ (ref).follow ?? null;
  if (follow !== null && keys.length > 0) throw new Error('compareRun: a trace reference brings its own keys (the bytes its keyboard reads returned); pass none');
  // A trace with no instruction to follow (MAME stopped before its first record, or the file holds
  // no more than its header) ends the run at once with its sentence, like any trace cut short.
  if (follow !== null && !follow.has(0)) return { instructions: 0, divergence: null, known: {}, ended: follow.ended(0, instructions), ...tag };
  const sys = m.system;
  const cpu = sys.cpu;
  // Following a trace on the Model I that declares it, our video reads may take the trace's byte
  // (the gate: known.js, video-read-gate).
  const theirsVideo = follow !== null && devices.through !== null && declared.fixes.has('video-read-gate') ? (/** @type {number} */ a) => ref.peek(a, 1)[0] : null;
  const fixesPrefix = declared.fixes.has('dropped-prefix');
  const ours = instrument(m, follow, devices, theirsVideo);
  /** @type {Record<string, number>} */
  const known = {};
  /** @type {(ContextLine | undefined)[]} The last CONTEXT compared instructions, a ring. */
  const ring = new Array(CONTEXT);
  /** @type {{ reason: 'DI' | 'EI' | 'prefix' } | null} A 30 Hz request the reference raised and did not take, our latch still holding it. */
  let held = null;
  let nextKey = 0;
  const bytes = new Uint8Array(4);

  /** Deliver the key events due at this boundary to both matrices. */
  const deliverKeys = () => {
    while (nextKey < keys.length && keys[nextKey].at <= m.cycles) {
      const e = keys[nextKey++];
      if (e.down) sys.keyboard.pressKey(e.row, e.bit); else sys.keyboard.releaseKey(e.row, e.bit);
      ref.setKeyBit(e.row, e.bit, e.down);
    }
  };

  /**
   * Why no maskable interrupt may be taken at the next boundary, derived from the instruction
   * stream, not from our CPU's state: EI allows none at the one boundary right after it (Zilog
   * UM0080, EI), and a DD or FD whose next byte is DD, FD or ED (a lone prefix, which our step runs
   * on its own) allows none before that byte runs (Young §3.7). The first boundary has no
   * instruction before it in the run, so its reason comes from our CPU's state at the start.
   * @type {'EI' | 'prefix' | null}
   */
  let blocked = cpu.pendingEI > 0 ? 'EI' : cpu.afterPrefix ? 'prefix' : null;

  /** @type {string | undefined} */
  let ended;
  let compared = instructions;
  try {
    if (follow !== null) follow.start(m); else ref.syncFrom(m);
    for (let index = 0; index < instructions; index++) {
      if (follow !== null && !follow.has(index)) {
        ended = follow.ended(index, instructions);
        compared = index;
        break;
      }
      // A trace that loaded a program loads it into ours where MAME's debugger did.
      follow?.beforeStep?.(index, m);
      deliverKeys();
      const wasHalted = cpu.halted;
      const op = cpu.halted ? 0 : sys.memory.readByte(cpu.registers.PC);
      // Before a DD or FD, the reference's registers and the byte after the prefix, in case trsjs
      // skips the pair (known.js, REFERENCE_FIXES), for a reference that declares the fix.
      const theirsBefore = fixesPrefix && (op === 0xdd || op === 0xfd) ? ref.regs() : null;
      const afterPrefix = theirsBefore === null ? 0 : sys.memory.readByte((cpu.registers.PC + 1) & 0xffff);
      const refIff1 = ref.regs().iff1;
      const fBefore = cpu.registers.F;
      // A held request our latch still holds must be taken at the first boundary where IFF1 is
      // set and nothing blocks it (Zilog UM0080 p. 7, INT pin): if our CPU does not, that is a
      // divergence (field irq), whatever our CPU's own state says.
      const mustTake = held !== null && refIff1 && blocked === null && devices.request(sys);

      const oursCycles = ours.step();
      const oursIrq = ours.log.irq;
      // Our CPU took an interrupt where the stream says none may be taken, or did not take the one
      // it had to.
      const irqWrong = (oursIrq && blocked !== null) || (mustTake && !oursIrq);
      // A held request our CPU takes is forced on the reference, unless the reference still holds
      // it itself (a latch it can show, as xtrs's): then it takes it by its own rule, and no
      // interrupt class is counted, since it needed none. A reference is held back where the stream
      // allows no interrupt, or forced, only for a reason it declares an interrupt class for
      // (trsjs); any other takes or keeps the request by its own rule, and where that is not the
      // Z80's the step diverges.
      const refHolds = oursIrq && held !== null && devices.latch && typeof ref.latch === 'function' && (ref.latch() & TIMER_BIT) !== 0;
      /** @type {import('./reference.js').IrqMode} */
      const mode = blocked !== null && declared.holds.has(blocked) ? 'hold'
        : oursIrq && held !== null && !refHolds && declared.holds.has(held.reason) ? 'force' : 'auto';
      // The trace's reads of the latch at this step, before the trace moves on.
      const theirLatchReads = follow !== null && devices.latch ? follow.latchReads(index) : null;
      const t = ref.step({ irq: mode });
      /** @type {string | null} */
      let fix = null;
      if (theirsBefore !== null && !oursIrq && droppedPrefix(afterPrefix, theirsBefore, ref.regs(), t, ref.writes().length, ref.prefixedOps)) {
        t.cycles = ref.redoDroppedPrefix(theirsBefore.pc, theirsBefore.r);
        fix = DROPPED_PREFIX;
      }

      /** @type {string | null} The interrupt class this step's response is counted under. */
      let interrupt = null;
      if (oursIrq) {
        if (mode === 'force' && t.irq && held !== null) interrupt = interruptClass(held.reason).name;
        held = null;
      } else if (t.raised && !t.irq) {
        // The reference raised the request and did not take it: dropped because its IFF1 was 0
        // (DI), or not taken (held back, or by its own rule) because the stream allows no interrupt
        // here (EI's delay, a lone prefix). Either way our latch keeps it, and our CPU must take it
        // at the first boundary that allows one (mustTake). Anything else records nothing, so a
        // later take by our CPU is a divergence.
        /** @type {'DI' | 'EI' | 'prefix' | null} */
        const reason = !refIff1 ? 'DI' : blocked;
        if (reason !== null) held ??= { reason };
      }
      // The request is gone from our side (read from $EC or $37E0, or masked): nothing is held any more.
      if (held !== null && !devices.request(sys)) held = null;

      const o = ourRegs(m);
      const s = ref.regs();
      const execPc = ours.log.execPc;
      const code = ours.log.code;
      for (let k = 0; k < 4; k++) bytes[k] = (code >>> (24 - 8 * k)) & 0xff;
      const ctx = {
        bytes,
        execPc,
        peek: ours.peek,
        ours: { regs: o, cycles: oursCycles, irq: oursIrq, writes: ours.log.writes, wasHalted, fBefore, q: cpu.q, wz: cpu.wz },
        theirs: { regs: s, cycles: t.cycles, irq: t.irq, writes: ref.writes() },
      };
      /** @type {ContextLine} */
      const line = { index, pc: execPc, code, idle: ours.log.idle, text: '', ours: { regs: o, cycles: oursCycles }, theirs: { regs: s, cycles: t.cycles } };

      const diff = diffStep(ctx);
      const { classes, unexplained } = diff.size === 0 ? { classes: [], unexplained: [] } : explainStep(ctx, diff, declared.step);
      if (irqWrong || ours.log.irqRefused) {
        diff.add('irq');
        unexplained.push('irq');
      }
      for (const field of /** @type {const} */ (['irqTime', 'keys'])) {
        if (ours.log[field]) {
          diff.add(field);
          unexplained.push(field);
        }
      }
      // The Model I's devices (Ruling 5): the latch after a read of it, and the video bytes written.
      if (devices.latch && latchDiffers(m, ref, ours.log.latchReads, theirLatchReads)) {
        diff.add('latch');
        unexplained.push('latch');
      }
      if (devices.videoEach && videoWritesDiffer(m, ref, devices.through, ctx.ours.writes, ctx.theirs.writes)) {
        diff.add('video');
        unexplained.push('video');
      }
      // The next boundary's reason, from the instruction that just ran (a halted step runs a NOP).
      blocked = ours.log.idle ? null : bytes[0] === 0xfb ? 'EI'
        : (bytes[0] === 0xdd || bytes[0] === 0xfd) && (bytes[1] === 0xdd || bytes[1] === 0xfd || bytes[1] === 0xed) ? 'prefix' : null;
      if (fix !== null) classes.unshift(fix);
      if (ours.log.videoRead) classes.unshift(VIDEO_READ);
      if (interrupt !== null) classes.unshift(interrupt);

      const stopsOn = strict === false ? undefined : classes.find((c) => strict === 'all' || !COMMON_CLASSES.has(c));
      const stop = unexplained.length > 0 || stopsOn !== undefined;
      if (stop) {
        const divergence = /** @type {Divergence} */ ({
          index,
          pc: execPc,
          kind: 'step',
          fields: unexplained.length > 0 ? unexplained.sort() : [...diff].sort(),
          known: unexplained.length > 0 ? null : /** @type {string} */ (stopsOn),
          ours: line.ours,
          theirs: line.theirs,
          writes: { ours: ctx.ours.writes, theirs: ctx.theirs.writes },
          video: compareVideo(m, ref, devices.through),
          context: [],
        });
        divergence.context = context(ref, ring, index, line, ours);
        if (strict) for (const c of classes) known[c] = (known[c] ?? 0) + 1;
        return { instructions: index + 1, divergence, known, ...tag };
      }
      for (const c of classes) known[c] = (known[c] ?? 0) + 1;
      if (diff.size > 0 && follow !== null) {
        // A trace cannot be resynced: our machine takes the trace's registers and writes instead.
        follow.adopt(m);
      } else if (diff.size > 0) {
        // Resync the reference from our state: registers, cycle count and 30 Hz phase, and the
        // bytes our instruction wrote.
        ref.syncRegs(m);
        for (const w of ctx.ours.writes) ref.poke(w.addr, [m.mem.read(w.addr, 1)[0]]);
      }
      ring[index % CONTEXT] = line;
      if (progress !== undefined && (index + 1) % progress.every === 0) progress.fn(index + 1);
    }

    const video = compareVideo(m, ref, devices.through);
    const tail = ended === undefined ? {} : { ended };
    if (!video.equal) {
      const o = ourRegs(m);
      const s = ref.regs();
      return {
        instructions: compared,
        ...tail,
        divergence: {
          index: compared,
          pc: o.pc,
          kind: 'video',
          fields: ['video'],
          known: null,
          ours: { regs: o, cycles: m.cycles },
          theirs: { regs: s, cycles: ref.cycles },
          writes: { ours: [], theirs: [] },
          video,
          context: ringLines(ring, compared).map(withText),
        },
        known,
        ...tag,
      };
    }
    return { instructions: compared, divergence: null, known, ...tail, ...tag };
  } finally {
    ours.uninstall();
  }
}

/**
 * The $37E0 latch after a step that read it differs (Ruling 5): a trace's reads (`theirs`) must
 * have returned what ours did, in order; a lockstep reference's latch afterwards must be ours.
 * Nothing is asked of the reference on a step no one read the latch.
 * @param {Machine} m @param {Reference} ref @param {number[]} ours the bytes our reads returned
 * @param {import('./reference.js').Write[] | null} theirs a trace's recorded reads of $37E0-$37E3
 */
function latchDiffers(m, ref, ours, theirs) {
  if (theirs !== null) {
    if (ours.length !== theirs.length) return true;
    for (let k = 0; k < ours.length; k++) if (ours[k] !== theirs[k].value) return true;
    return false;
  }
  if (ours.length === 0 || typeof ref.latch !== 'function') return false;
  return (/** @type {NonNullable<Machine['system']['io']['latch']>} */ (m.system.io.latch).peek()) !== ref.latch();
}

/**
 * Whether a video byte either side wrote in this step differs: ours as stored, the reference's
 * through `through` (the gate) when given.
 * @param {Machine} m @param {Reference} ref @param {((b: number) => number) | null} through
 * @param {import('./reference.js').Write[]} a @param {import('./reference.js').Write[]} b
 */
function videoWritesDiffer(m, ref, through, a, b) {
  let lo = 0x10000;
  let hi = -1;
  for (const w of a) if (w.addr >= VIDEO && w.addr < VIDEO + VIDEO_LEN) { lo = Math.min(lo, w.addr); hi = Math.max(hi, w.addr); }
  for (const w of b) if (w.addr >= VIDEO && w.addr < VIDEO + VIDEO_LEN) { lo = Math.min(lo, w.addr); hi = Math.max(hi, w.addr); }
  if (hi < 0) return false;
  const ours = m.mem.read(lo, hi - lo + 1);
  const theirs = ref.peek(lo, hi - lo + 1);
  for (let k = 0; k < ours.length; k++) if (ours[k] !== (through === null ? theirs[k] : through(theirs[k]))) return true;
  return false;
}

/** The ring's lines in order, oldest first, ending before `index`. @param {(ContextLine | undefined)[]} ring @param {number} index */
function ringLines(ring, index) {
  /** @type {ContextLine[]} */
  const out = [];
  for (let k = Math.max(0, index - CONTEXT); k < index; k++) {
    const l = ring[k % CONTEXT];
    if (l !== undefined) out.push(l);
  }
  return out;
}

/** A context line with its disassembly. @param {ContextLine} l */
const withText = (l) => ({ ...l, text: disassemble(l.code, l.pc, l.idle) });

/**
 * The divergence's context: the ring's lines, the divergent one, and up to CONTEXT more steps of
 * both machines, unsynced (they stop early if one throws).
 * @param {Reference} ref @param {(ContextLine | undefined)[]} ring @param {number} index @param {ContextLine} line
 * @param {ReturnType<typeof instrument>} ours
 */
function context(ref, ring, index, line, ours) {
  const lines = [...ringLines(ring, index), line].map(withText);
  for (let k = 1; k <= CONTEXT; k++) {
    try {
      const oc = ours.step();
      const tc = ref.step().cycles;
      const { execPc, code, idle } = ours.log;
      lines.push(withText({ index: index + k, pc: execPc, code, idle, text: '', ours: { regs: ourRegs(ours.machine), cycles: oc }, theirs: { regs: ref.regs(), cycles: tc } }));
    } catch {
      break;
    }
  }
  return lines;
}

const hex2 = (/** @type {number} */ v) => v.toString(16).toUpperCase().padStart(2, '0');
const hex4 = (/** @type {number} */ v) => v.toString(16).toUpperCase().padStart(4, '0');

/** One side's registers on a line. @param {SideState} st */
function regLine(st) {
  const r = st.regs;
  return `PC=${hex4(r.pc)} AF=${hex2(r.a)}${hex2(r.f)} BC=${hex2(r.b)}${hex2(r.c)} DE=${hex2(r.d)}${hex2(r.e)} HL=${hex2(r.h)}${hex2(r.l)} IX=${hex4(r.ix)} IY=${hex4(r.iy)} SP=${hex4(r.sp)} I=${hex2(r.i)} R=${hex2(r.r)} IFF=${r.iff1 ? 1 : 0}${r.iff2 ? 1 : 0} IM${r.im} T=${st.cycles}`;
}

/** @param {Write[]} ws */
const writesText = (ws) => (ws.length === 0 ? '(none)' : ws.map((w) => `$${hex4(w.addr)}←$${hex2(w.value)}`).join(' '));

/**
 * The run as text: the instruction count, each known class's count, and the divergence (if any)
 * with its context disassembled. The same run gives the same text, byte for byte.
 * @param {CompareResult} result
 * @returns {string}
 */
export function formatReport(result) {
  const model = result.model === 1 ? `Model I${result.lowercase ? ' (lowercase modification)' : ''}` : 'Model III';
  const out = [`reference: ${result.reference}, ${model}`, `instructions compared: ${result.instructions}`];
  const classes = Object.keys(result.known).sort();
  out.push(classes.length === 0 ? 'known differences: none' : 'known differences:');
  for (const c of classes) out.push(`  ${String(result.known[c]).padStart(9)}  ${c}`);
  const d = result.divergence;
  // A trace that ended early proves nothing past its end: its sentence, never "none".
  if (d === null && result.ended !== undefined) {
    out.push(result.ended);
    return `${out.join('\n')}\n`;
  }
  if (d === null) {
    out.push('divergence: none (video RAM equal at the end)');
    return `${out.join('\n')}\n`;
  }
  if (result.ended !== undefined) out.push(result.ended);
  const what = d.known !== null ? `known difference (strict): ${d.known}` : `differs: ${d.fields.join(', ')}`;
  out.push(`divergence at instruction ${d.index}, PC $${hex4(d.pc)}${d.kind === 'video' ? ' (end of run)' : ''}: ${what}`);
  out.push(`  ours    ${regLine(d.ours)}`);
  out.push(`  theirs  ${regLine(d.theirs)}`);
  if (d.kind === 'step') {
    out.push(`  writes ours    ${writesText(d.writes.ours)}`);
    out.push(`  writes theirs  ${writesText(d.writes.theirs)}`);
  }
  out.push(d.video.equal ? '  video RAM equal' : `  video RAM: ${d.video.differing} bytes differ, the first at $${hex4(/** @type {number} */ (d.video.first))}`);
  out.push('context (ours | theirs):');
  for (const l of d.context) {
    const mark = l.index === d.index ? '>' : ' ';
    const same = regLine(l.ours) === regLine(l.theirs);
    out.push(`${mark} ${String(l.index).padStart(9)}  $${hex4(l.pc)}  ${l.text.padEnd(18)} ${regLine(l.ours)}`);
    if (!same) out.push(`${' '.repeat(36)}| ${regLine(l.theirs)}`);
  }
  return `${out.join('\n')}\n`;
}
