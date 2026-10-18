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
 * Keys (Ruling 3) go to both machines' keyboard matrices directly, at the first instruction
 * boundary at or after their T-state, never through our ROM keyboard hook.
 *
 * The comparator wraps our CPU's `interrupt` and `executeInstruction` and our memory's `writeByte`
 * for the run, and puts them back after.
 */
import { decode, formatInstruction } from '@fugloy/z80';
import { KeyQueue } from '../../src/devices/key-queue.js';
import { KeyboardMatrix } from '../../src/devices/keyboard.js';
import { RTC_IRQ_BIT } from '../../src/machine/io.js';
import { diffStep, droppedPrefix, explainStep, interruptClass, REFERENCE_FIXES, STEP_CLASSES } from './known.js';

/**
 * @typedef {import('../../src/machine/machine.js').Machine} Machine
 * @typedef {import('./trsjs-adapter.js').Reference} Reference
 * @typedef {import('./trsjs-adapter.js').Write} Write
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
 *   differs (register names, flag bits as `f.S`, `cycles`, `writes`, or `video`); known: the class a
 *   `strict` run stopped on, else null; context: up to 10 instructions before, the divergent one,
 *   and up to 10 after (both machines run on, unsynced).
 * @typedef {{ instructions: number, divergence: Divergence | null, known: Record<string, number> }} CompareResult
 */

const CONTEXT = 10;
const XY = /** @type {string} */ (STEP_CLASSES.find((c) => c.id === 'xy')?.name);
const DROPPED_PREFIX = REFERENCE_FIXES[0].name;
const VIDEO = 0x3c00;
const VIDEO_LEN = 0x400;

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
 * instruction. Returns the step function and an uninstall.
 * @param {Machine} m
 */
function instrument(m) {
  const mem = m.system.memory;
  const cpu = m.system.cpu;
  const log = { writes: /** @type {Write[]} */ ([]), irq: false, execPc: 0, idle: false, code: 0 };
  const own = (/** @type {object} */ o, /** @type {string} */ k) => Object.prototype.hasOwnProperty.call(o, k);
  const saved = { write: own(mem, 'writeByte'), interrupt: own(cpu, 'interrupt'), exec: own(cpu, 'executeInstruction') };
  const write = mem.writeByte;
  const interrupt = cpu.interrupt;
  const exec = cpu.executeInstruction;
  mem.writeByte = (/** @type {number} */ addr, /** @type {number} */ value) => {
    log.writes.push({ addr: addr & 0xffff, value: value & 0xff });
    write.call(mem, addr, value);
  };
  cpu.interrupt = (/** @type {number | undefined} */ bus) => {
    const taken = interrupt.call(cpu, bus);
    if (taken) log.irq = true;
    return taken;
  };
  cpu.executeInstruction = () => {
    const pc = cpu.registers.PC;
    log.execPc = pc;
    log.idle = cpu.halted;
    // The instruction's bytes before it runs (it may rewrite itself); a halted step runs a NOP
    // (Zilog UM0080, "HALT Exit").
    log.code = cpu.halted ? 0
      : ((mem.readByte(pc) << 24) | (mem.readByte((pc + 1) & 0xffff) << 16) | (mem.readByte((pc + 2) & 0xffff) << 8) | mem.readByte((pc + 3) & 0xffff)) >>> 0;
    return exec.call(cpu);
  };
  return {
    log,
    machine: m,
    step() {
      log.writes = [];
      log.irq = false;
      const { cycles } = m.step(1);
      return cycles;
    },
    uninstall() {
      // Put back exactly what was there: an own property the caller had, else the prototype's.
      if (saved.write) mem.writeByte = write; else delete mem.writeByte;
      if (saved.interrupt) cpu.interrupt = interrupt; else delete cpu.interrupt;
      if (saved.exec) cpu.executeInstruction = exec; else delete cpu.executeInstruction;
    },
  };
}

/** @param {Machine} m @param {Reference} ref */
function compareVideo(m, ref) {
  const a = m.mem.read(VIDEO, VIDEO_LEN);
  const b = ref.peek(VIDEO, VIDEO_LEN);
  let differing = 0;
  /** @type {number | null} */
  let first = null;
  for (let k = 0; k < VIDEO_LEN; k++) {
    if (a[k] !== b[k]) {
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
 * The reference is synced from our machine first (Ruling 4). A difference the known classes
 * explain is counted by class and the reference resynced from our state (its registers, its cycle
 * count and 30 Hz phase, and the bytes our instruction wrote); with `strict`, the run stops on it
 * instead. The first difference nothing explains ends the run as the divergence, with context.
 * Our machine's own key queue must be empty: keys come through `keys`.
 *
 * `strict: true` stops on any known class but flag bits 3 and 5 (which differ in most programs
 * within a few instructions); `strict: 'all'` stops on that one as well.
 * @param {{ machine: Machine, reference: Reference, instructions: number, keys?: KeyEvent[], strict?: boolean | 'all' }} opts
 * @returns {CompareResult}
 */
export function compareRun({ machine: m, reference: ref, instructions, keys = [], strict = false }) {
  if (m.keyboard.pending > 0) throw new Error('compareRun: the machine\'s key queue has keys waiting; pass keys to compareRun so both machines get them');
  const sys = m.system;
  const cpu = sys.cpu;
  const io = sys.io;
  const ours = instrument(m);
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

  try {
    ref.syncFrom(m);
    for (let index = 0; index < instructions; index++) {
      deliverKeys();
      // Why our CPU will not take an interrupt at this boundary, if it will not.
      const blocked = cpu.pendingEI > 0 ? 'EI' : cpu.afterPrefix ? 'prefix' : null;
      const wasHalted = cpu.halted;
      const op = cpu.halted ? 0 : sys.memory.readByte(cpu.registers.PC);
      // Before a DD or FD, the reference's registers and the byte after the prefix, in case trsjs
      // skips the pair (known.js, REFERENCE_FIXES).
      const theirsBefore = op === 0xdd || op === 0xfd ? ref.regs() : null;
      const afterPrefix = theirsBefore === null ? 0 : sys.memory.readByte((cpu.registers.PC + 1) & 0xffff);
      const refIff1 = ref.z.reg.IFF1 !== 0;

      const oursCycles = ours.step();
      const oursIrq = ours.log.irq;
      /** @type {import('./trsjs-adapter.js').IrqMode} */
      const mode = oursIrq ? (held !== null ? 'force' : 'auto') : blocked !== null ? 'hold' : 'auto';
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
        // (DI), or held back (hold mode) because our CPU could not take it here (EI's delay, a lone
        // prefix). Either way our latch keeps it. Anything else records nothing, so a later take
        // by our CPU is a divergence.
        /** @type {'DI' | 'EI' | 'prefix' | null} */
        const reason = !refIff1 ? 'DI' : mode === 'hold' ? blocked : null;
        if (reason !== null) held ??= { reason };
      }
      // The request is gone from our side (read from $EC, or masked): nothing is held any more.
      if (held !== null && (io.intLatch & io.intMask & RTC_IRQ_BIT) === 0) held = null;

      const o = ourRegs(m);
      const s = ref.regs();
      const execPc = ours.log.execPc;
      const code = ours.log.code;
      for (let k = 0; k < 4; k++) bytes[k] = (code >>> (24 - 8 * k)) & 0xff;
      const ctx = {
        bytes,
        execPc,
        ours: { regs: o, cycles: oursCycles, irq: oursIrq, writes: ours.log.writes, wasHalted },
        theirs: { regs: s, cycles: t.cycles, irq: t.irq, writes: ref.writes() },
      };
      /** @type {ContextLine} */
      const line = { index, pc: execPc, code, idle: ours.log.idle, text: '', ours: { regs: o, cycles: oursCycles }, theirs: { regs: s, cycles: t.cycles } };

      const diff = diffStep(ctx);
      const { classes, unexplained } = diff.size === 0 ? { classes: [], unexplained: [] } : explainStep(ctx, diff);
      if (fix !== null) classes.unshift(fix);
      if (interrupt !== null) classes.unshift(interrupt);

      const stopsOn = strict === false ? undefined : classes.find((c) => strict === 'all' || c !== XY);
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
          video: compareVideo(m, ref),
          context: [],
        });
        divergence.context = context(ref, ring, index, line, ours);
        if (strict) for (const c of classes) known[c] = (known[c] ?? 0) + 1;
        return { instructions: index + 1, divergence, known };
      }
      for (const c of classes) known[c] = (known[c] ?? 0) + 1;
      if (diff.size > 0) {
        // Resync the reference from our state: registers, cycle count and 30 Hz phase, and the
        // bytes our instruction wrote.
        ref.syncRegs(m);
        for (const w of ctx.ours.writes) ref.poke(w.addr, [m.mem.read(w.addr, 1)[0]]);
      }
      ring[index % CONTEXT] = line;
    }

    const video = compareVideo(m, ref);
    if (!video.equal) {
      const o = ourRegs(m);
      const s = ref.regs();
      return {
        instructions,
        divergence: {
          index: instructions,
          pc: o.pc,
          kind: 'video',
          fields: ['video'],
          known: null,
          ours: { regs: o, cycles: m.cycles },
          theirs: { regs: s, cycles: ref.cycles },
          writes: { ours: [], theirs: [] },
          video,
          context: ringLines(ring, instructions).map(withText),
        },
        known,
      };
    }
    return { instructions, divergence: null, known };
  } finally {
    ours.uninstall();
  }
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
  const out = [`instructions compared: ${result.instructions}`];
  const classes = Object.keys(result.known).sort();
  out.push(classes.length === 0 ? 'known differences: none' : 'known differences:');
  for (const c of classes) out.push(`  ${String(result.known[c]).padStart(9)}  ${c}`);
  const d = result.divergence;
  if (d === null) {
    out.push('divergence: none (video RAM equal at the end)');
    return `${out.join('\n')}\n`;
  }
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
