/**
 * What the Model I's trace tests share (mame-trace.test.js, model1-devices.test.js): a synthetic
 * Level II ROM, and our own machine recorded in MAME's trace format (mame-trace.js), so the trace
 * plumbing and the Model I's devices are tested in CI, where no MAME runs. No copyrighted code: the
 * ROM is a few hand-assembled bytes.
 */
import { IRQ } from './mame-trace.js';

/**
 * A 12K ROM: DI / LD SP,$8000 / IM 1 at $0000, then `main` from $0006; at $0038 the 40 Hz handler
 * PUSH AF / LD A,($37E0) (reads the latch, clearing the clock bit) / LD ($5001),A / POP AF / EI /
 * RETI.
 * @param {number[]} main
 */
export function syntheticRom(main) {
  const rom = new Uint8Array(12288);
  rom.set([0xf3, 0x31, 0x00, 0x80, 0xed, 0x56, ...main], 0);
  rom.set([0xf5, 0x3a, 0xe0, 0x37, 0x32, 0x01, 0x50, 0xf1, 0xfb, 0xed, 0x4d], 0x38);
  return rom;
}

/**
 * Records `steps` instructions of `m` as MAME's would be: the state before each instruction after
 * any interrupt response (IFF1 set from EI on, as MAME shows it), the step's writes as the CPU
 * attempted them (the push first; MAME stores video bytes as written, with no gate), and its reads
 * of the keyboard matrix and the interrupt latch. Writes the start memory too.
 * @param {import('../../src/machine/machine.js').Machine} m @param {number} steps
 * @returns {{ start: Uint8Array, records: import('./mame-trace.js').TraceRecord[] }}
 */
export function recordOurs(m, steps) {
  const sys = m.system;
  const cpu = sys.cpu;
  const mem = sys.memory;
  const start = m.mem.read(0, 0x10000);
  /** @type {import('./mame-trace.js').TraceRecord[]} */
  const records = [];
  /** @type {{ addr: number, value: number }[]} */
  let writes = [];
  /** @type {{ addr: number, value: number }[]} */
  let reads = [];
  /** @type {0 | 1} */
  let kind = 0;
  let inExec = false;
  const w = mem.writeByte;
  const r = mem.readByte;
  const intr = cpu.interrupt;
  const exec = cpu.executeInstruction;
  mem.writeByte = (/** @type {number} */ a, /** @type {number} */ v) => { writes.push({ addr: a & 0xffff, value: v & 0xff }); w.call(mem, a, v); };
  mem.readByte = (/** @type {number} */ a) => {
    const v = r.call(mem, a);
    if (inExec && ((a >= 0x3800 && a < 0x3c00) || (a >= 0x37e0 && a < 0x37e4))) reads.push({ addr: a, value: v });
    return v;
  };
  cpu.interrupt = (/** @type {number | undefined} */ b) => {
    const t = intr.call(cpu, b);
    if (t) kind = IRQ;
    return t;
  };
  cpu.executeInstruction = () => {
    const x = m.cpu.regs;
    const ei = cpu.pendingEI > 0;
    const word = (/** @type {number} */ hi, /** @type {number} */ lo) => (hi << 8) | lo;
    records.push({
      w: [x.pc, word(x.a, x.f), word(x.b, x.c), word(x.d, x.e), word(x.h, x.l), word(x.a2, x.f2), word(x.b2, x.c2), word(x.d2, x.e2), word(x.h2, x.l2), x.ix, x.iy, x.sp],
      i: x.i, r: x.r, iff1: x.iff1 || ei, iff2: x.iff2 || ei, im: x.im, total: cpu.cycles, kind, writes, reads,
    });
    inExec = true;
    try {
      return exec.call(cpu);
    } finally {
      inExec = false;
    }
  };
  try {
    for (let k = 0; k <= steps; k++) {
      writes = [];
      reads = [];
      kind = 0;
      m.step(1);
    }
  } finally {
    delete mem.writeByte;
    delete mem.readByte;
    delete cpu.interrupt;
    delete cpu.executeInstruction;
  }
  return { start, records };
}
