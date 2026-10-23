/**
 * The Model I's devices in the differential comparison (emu phase 7, Model I, Task 4; plan Ruling 5):
 * the $37E0 latch after every read of it, video RAM through the bit-6 gate (raw with the lowercase
 * modification), port $FF through the registers of each IN, and the Model I's interrupt request
 * for held interrupts. And Review Focus 2: a planted bug in our Model I path (the latch not
 * cleared on a read; the gate inverted) is caught at the instruction it first matters, against
 * each reference.
 *
 * The first half always runs: a second Machine of ours stands in as a lockstep reference (`self`,
 * below), and traces written from our own machine stand in for MAME's. The rest needs
 * FUGLOY_XTRS=1 or FUGLOY_MAME=1 (gate.js) and the Model I ROM.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { Machine } from '../../src/index.js';
import { TIMER_BIT } from '../../src/devices/interrupt-latch.js';
import { restoreState, serializeState } from '../../src/debug/state.js';
import { ROM_TEST_TIMEOUT } from '../rom.js';
import { compareRun, formatReport, modelDevices, ourRegs, videoGate } from './compare.js';
import { mameSkip, requireRom, xtrsSkip } from './gate.js';
import { CHARGEN, openTrace, recordMameTrace, ROM_SETS, writeTrace } from './mame-trace.js';
import { recordOurs, syntheticRom } from './own-trace.js';
import { loadXtrs } from './xtrs-adapter.js';
import { mameTick, mameTimer } from './mame-clock.js';

const dir = mkdtempSync(join(tmpdir(), 'fugloy-m1dev-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/**
 * The synthetic ROM (own-trace.js): DI / LD SP,$8000 / IM 1 / JP $4000, and at $0038 the 40 Hz
 * handler, which reads the latch at $37E0 (clearing the clock bit) into $5001. Programs go at $4000.
 */
const ROM = syntheticRom([0xc3, 0x00, 0x40]);
/** The handler's LD A,($37E0). */
const LATCH_READ_PC = 0x0039;

/** EI, then a loop of 4- to 7-T-state instructions: LD A,B / INC B / NOP / JR loop. */
const LOOP = [0xfb, 0x78, 0x04, 0x00, 0x18, 0xfb];
/** Writes $0D, $60, $2D and $C1 to $3C00-$3C03 (LD A,n / LD ($3C0k),A), reads $3C00 back to $5000, then halts in a JR $. */
const VIDEO = [0x3e, 0x0d, 0x32, 0x00, 0x3c, 0x3e, 0x60, 0x32, 0x01, 0x3c, 0x3e, 0x2d, 0x32, 0x02, 0x3c, 0x3e, 0xc1, 0x32, 0x03, 0x3c,
  0x3a, 0x00, 0x3c, 0x32, 0x00, 0x50, 0x18, 0xfe];
/** OUT ($FF),A with A = 8 (MODESEL: 32 characters), IN A,($FF), LD ($5002),A, JR $. */
const PORT_FF = [0x3e, 0x08, 0xd3, 0xff, 0xdb, 0xff, 0x32, 0x02, 0x50, 0x18, 0xfe];

/** A Model I on the synthetic ROM, run to $4000 with `program` there. @param {number[]} program @param {{ lowercase?: boolean }} [opts] */
function machine(program, opts = {}) {
  const m = new Machine({ model: 1, roms: { level2: ROM }, ...opts });
  m.mem.write(0x4000, program);
  while (m.cpu.regs.pc !== 0x4000) m.step(1);
  return m;
}

/**
 * Our own Model I as a lockstep Reference: a second Machine, synced by save state. `storeRaw`
 * makes it keep video bytes as written (as MAME's trs80l2 does); the comparison must still find it
 * equal through the gate.
 * @param {{ storeRaw?: boolean }} [opts]
 * @returns {import('./reference.js').Reference}
 */
function self({ storeRaw = false } = {}) {
  /** @type {Machine} */
  let r = /** @type {any} */ (null);
  /** @type {{ addr: number, value: number }[]} */
  let writes = [];
  let irq = false;
  const ref = {
    name: 'self',
    reset() { throw new Error('self: no reset'); },
    step({ irq: mode = 'auto' } = {}) {
      writes = [];
      irq = false;
      const sys = r.system;
      const before = sys.nextRtcAt;
      const pending = sys.io.pendingInterrupt;
      if (mode === 'hold') sys.io.pendingInterrupt = () => false;
      else if (mode === 'force') sys.io.pendingInterrupt = () => true;
      try {
        const { cycles } = r.step(1);
        return { cycles, irq, raised: sys.nextRtcAt !== before };
      } finally {
        sys.io.pendingInterrupt = pending;
      }
    },
    regs: () => ourRegs(r),
    peek: (a, n) => r.mem.read(a, n),
    poke: (a, bytes) => r.mem.write(a, bytes),
    setKeyBit(row, bit, down) {
      if (down) r.system.keyboard.pressKey(row, bit); else r.system.keyboard.releaseKey(row, bit);
    },
    alignRtc() { throw new Error('self: no alignRtc'); },
    syncFrom(m) {
      r = new Machine({ model: 1, roms: { level2: romOf(m) }, lowercase: !m.system.memory.videoBit6Gate });
      restoreState(r.system, serializeState(m.system));
      const mem = r.system.memory;
      const write = mem.writeByte.bind(mem);
      mem.writeByte = (a, v) => {
        writes.push({ addr: a & 0xffff, value: v & 0xff });
        if (storeRaw && (a & 0xffff) >= 0x3c00 && (a & 0xffff) < 0x4000) mem.videoRam[(a & 0xffff) - 0x3c00] = v & 0xff;
        else write(a, v);
      };
      const cpu = r.system.cpu;
      const interrupt = cpu.interrupt.bind(cpu);
      cpu.interrupt = (b) => {
        const t = interrupt(b);
        if (t) irq = true;
        return t;
      };
    },
    syncRegs(m) {
      const keep = r.system.memory.writeByte;
      const keepInt = r.system.cpu.interrupt;
      restoreState(r.system, serializeState(m.system));
      r.system.memory.writeByte = keep;
      r.system.cpu.interrupt = keepInt;
    },
    redoDroppedPrefix() { throw new Error('self drops nothing'); },
    writes: () => writes.map((w) => ({ ...w })),
    latch: () => /** @type {NonNullable<Machine['system']['io']['latch']>} */ (r.system.io.latch).peek(),
    get cycles() { return r.cycles; },
    prefixedOps: new Set(Array.from({ length: 256 }, (_, k) => k).filter((k) => k !== 0xdd && k !== 0xfd && k !== 0xed)),
    // Our own machine needs no known class.
    classes: new Set(),
  };
  return /** @type {import('./reference.js').Reference} */ (ref);
}

/** A Model I's 12K ROM, from its memory. @param {Machine} m */
const romOf = (m) => m.system.memory.rom.slice(0, 12288);

/** Test-only: our latch's read no longer clears the clock bit. @param {Machine} m */
function plantLatchBug(m) {
  const latch = /** @type {NonNullable<Machine['system']['io']['latch']>} */ (m.system.io.latch);
  latch.read = () => latch.bits;
}

/** Test-only: our video gate inverted (bit 6 = bit 5 OR bit 7). @param {Machine} m */
function plantGateBug(m) {
  const mem = m.system.memory;
  const write = mem.writeByte.bind(mem);
  mem.writeByte = (a, v) => {
    write(a, v);
    const x = a & 0xffff;
    if (x >= 0x3c00 && x < 0x4000) mem.videoRam[x - 0x3c00] ^= 0x40;
  };
}

/**
 * Test-only: SCF as our core had it before 32a59b7, flags 3 and 5 from A alone whatever the
 * instruction before did (the fix undone). @param {Machine} m
 */
function undoScfFix(m) {
  const cpu = m.system.cpu;
  cpu.opcodeHandlers[0x37] = () => {
    cpu.flagC = true;
    cpu.flagH = false;
    cpu.flagN = false;
    cpu._xy(cpu.registers.A);
    return 4;
  };
}

/**
 * Test-only: LDIR as our core had it before d4dbaeb, a repeating iteration's flags 3 and 5 left
 * from its n (Young §4.2) instead of PC (the fix undone). @param {Machine} m
 */
function undoBlockFix(m) {
  const cpu = m.system.cpu;
  cpu.ldir = () => {
    const cycles = cpu.ldi();
    if (cpu.BC === 0) return cycles;
    cpu.registers.PC = (cpu.registers.PC - 2) & 0xffff;
    cpu.wz = (cpu.registers.PC + 1) & 0xffff;
    return cycles + 5;
  };
}

/** LD A,28H / OR A (F's flags 3 and 5 from the result: 28H) / LD A,00H (the flags left alone) / SCF / JR $. */
const SCF = [0x3e, 0x28, 0xb7, 0x3e, 0x00, 0x37, 0x18, 0xfe];
/**
 * LD A,0CH / LD HL,$4000 / LD DE,$5100 / LD BC,3 / LDIR / JR $: the LDIR at $400B repeats twice, its
 * first iteration's n ((HL) + A, $3E + $0C = $4A) has bits 1 and 3 set (Young's flags 5 and 3) and
 * PC's bits 13 and 11 are clear.
 */
const LDIR = [0x3e, 0x0c, 0x21, 0x00, 0x40, 0x11, 0x00, 0x51, 0x01, 0x03, 0x00, 0xed, 0xb0, 0x18, 0xfe];

/** The index of the first step of `m` (a copy is run) that writes video RAM. @param {Machine} m */
function firstVideoWrite(m, limit = 1_000_000) {
  const c = new Machine({ model: 1, roms: { level2: romOf(m) } });
  restoreState(c.system, serializeState(m.system));
  const mem = c.system.memory;
  const write = mem.writeByte.bind(mem);
  let hit = false;
  mem.writeByte = (a, v) => {
    if ((a & 0xffff) >= 0x3c00 && (a & 0xffff) < 0x4000) hit = true;
    write(a, v);
  };
  for (let k = 0; k < limit; k++) {
    c.step(1);
    if (hit) return k;
  }
  throw new Error('no video write');
}

describe('the bit-6 gate and the devices compareRun is given', () => {
  it('reads bit 6 as NOR(bit 5, bit 7): Technical Reference Handbook p. 34', () => {
    expect([0x0d, 0x4d, 0x20, 0x60, 0x2d, 0x80, 0xc0, 0xc1, 0x00, 0xff].map(videoGate)).toEqual([0x4d, 0x4d, 0x20, 0x20, 0x2d, 0x80, 0x80, 0x81, 0x40, 0xbf]);
    expect(modelDevices(1, false).through).toBe(videoGate);
    expect(modelDevices(1, true).through).toBeNull();
    expect(modelDevices(3, false)).toMatchObject({ through: null, latch: false, videoEach: false });
  });

  it('agrees with our memory\'s own gate for every byte', () => {
    const m = new Machine({ model: 1, roms: { level2: ROM } });
    for (let b = 0; b < 256; b++) {
      m.mem.write(0x3c00, [b]);
      expect(m.mem.read(0x3c00, 1)[0]).toBe(videoGate(b));
    }
  });

  it('refuses a model or lowercase setting the machine does not have', () => {
    const m = machine([0x00]);
    expect(() => compareRun({ machine: m, reference: self(), instructions: 1, model: 3 })).toThrow('compareRun: model 3 was asked for, and the machine is a Model I');
    expect(() => compareRun({ machine: m, reference: self(), instructions: 1, lowercase: true })).toThrow('compareRun: lowercase true was asked for, and the machine has no lowercase modification');
    const m3 = new Machine({ roms: { level2: new Uint8Array(0x3800) } });
    expect(() => compareRun({ machine: m3, reference: self(), instructions: 1, lowercase: false })).toThrow('compareRun: lowercase is a Model I option (the modification); this machine is not a Model I');
  });

  it('names the reference and the model in the result and the report', () => {
    const r = compareRun({ machine: machine([0x00, 0x00]), reference: self(), instructions: 2 });
    expect(r).toMatchObject({ reference: 'self', model: 1, lowercase: false, divergence: null });
    expect(formatReport(r).split('\n')[0]).toBe('reference: self, Model I');
    const lc = compareRun({ machine: machine([0x00], { lowercase: true }), reference: self(), instructions: 1 });
    expect(formatReport(lc).split('\n')[0]).toBe('reference: self, Model I (lowercase modification)');
  });
});

describe('the Model I\'s devices against our own machine as the reference', () => {
  it('a video byte with bit 5 set compares equal through the gate on both, though one side stores it raw', () => {
    const m = machine(VIDEO);
    const ref = self({ storeRaw: true });
    // The four writes (instructions 0-7), up to the read back.
    const r = compareRun({ machine: m, reference: ref, instructions: 8 });
    expect(r.divergence).toBeNull();
    // Stored: ours through the gate, the reference as written ($60 has bit 5 set: bit 6 cleared).
    expect([...m.mem.read(0x3c00, 4)]).toEqual([0x4d, 0x20, 0x2d, 0x81]);
    expect([...ref.peek(0x3c00, 4)]).toEqual([0x0d, 0x60, 0x2d, 0xc1]);
    // A lockstep reference's CPU reads what it stored, so its LD A,($3C00) gets $0D where a Model I
    // reads $4D: a divergence in A (no class: MAME is a trace, and only a trace is substituted).
    const d = compareRun({ machine: machine(VIDEO), reference: self({ storeRaw: true }), instructions: 12 }).divergence;
    expect(d).toMatchObject({ index: 8, pc: 0x4014, fields: ['a'], known: null });
  });

  it('with lowercase: true it compares raw, so the same raw reference is equal and a gating one is not', () => {
    const raw = compareRun({ machine: machine(VIDEO, { lowercase: true }), reference: self({ storeRaw: true }), instructions: 12, lowercase: true });
    expect(raw.divergence).toBeNull();
    // A reference that gates (a lowercase machine compared with an unmodified one): the first
    // write whose bit 6 the gate changes ($0D, at instruction 1) differs.
    const m = machine(VIDEO, { lowercase: true });
    const ref = self();
    const syncFrom = ref.syncFrom;
    ref.syncFrom = (mm) => {
      syncFrom.call(ref, mm);
      /** @type {any} */ (ref).peek = (/** @type {number} */ a, /** @type {number} */ n) => Uint8Array.from(m.mem.read(a, n), (b, k) => (a + k >= 0x3c00 && a + k < 0x4000 ? videoGate(b) : b));
    };
    const d = compareRun({ machine: m, reference: ref, instructions: 12 }).divergence;
    expect(d).toMatchObject({ index: 1, pc: 0x4002, fields: ['video'], known: null });
  });

  it('planted: our gate inverted is caught at the first video write', () => {
    const m = machine(VIDEO);
    plantGateBug(m);
    const d = compareRun({ machine: m, reference: self(), instructions: 12 }).divergence;
    expect(d).toMatchObject({ index: 1, pc: 0x4002, fields: ['video'], known: null });
  });

  it('the latch: taken, read and cleared on both, compared after each read', () => {
    const m = machine(LOOP);
    const r = compareRun({ machine: m, reference: self(), instructions: 60_000 });
    expect(r.divergence).toBeNull();
    expect(m.mem.read(0x5001, 1)[0]).toBe(TIMER_BIT); // the handler read the clock bit
  });

  it('planted: a latch read that does not clear is caught at that read, LD A,($37E0)', () => {
    const m = machine(LOOP);
    plantLatchBug(m);
    const d = compareRun({ machine: m, reference: self(), instructions: 60_000 }).divergence;
    expect(d).toMatchObject({ pc: LATCH_READ_PC, fields: ['latch'], known: null });
    expect(d?.context.find((l) => l.index === d.index)?.text).toBe('LD A,(37E0H)');
  });

  it('port $FF: OUT sets MODESEL, IN reads it back as bit 6 clear, compared in A', () => {
    const m = machine(PORT_FF);
    const r = compareRun({ machine: m, reference: self(), instructions: 6 });
    expect(r.divergence).toBeNull();
    expect(m.mem.read(0x5002, 1)[0]).toBe(0x3f); // bit 7: no tape; bit 6: MODESEL set; bits 5-0 high
    // A port of ours that forgot MODESEL is a divergence in A at the IN.
    const bad = machine(PORT_FF);
    const io = bad.system.io;
    const ff = io.portHandlers.get(0xff);
    io.portHandlers.set(0xff, { read: () => ff.read() | 0x40, write: ff.write });
    const d = compareRun({ machine: bad, reference: self(), instructions: 6 }).divergence;
    expect(d).toMatchObject({ index: 2, pc: 0x4004, fields: ['a'], known: null });
  });

  it('a held 40 Hz request: our CPU must take it after EI, through the Model I\'s latch (mustTake)', () => {
    // DI, NOPs past the 40 Hz tick, EI, NOPs: the request is held while DI. Ours (test-only) never
    // takes an interrupt again after EI: a divergence in irq at the boundary it was due.
    const m = machine([0xf3, ...new Array(30).fill(0x00), 0xfb, ...new Array(10).fill(0x00)]);
    m.system.nextRtcAt = m.cycles + 20;
    const ok = compareRun({ machine: m, reference: self(), instructions: 36 });
    expect(ok.divergence).toBeNull();
    expect(ok.known).toEqual({}); // the reference held it too: nothing forced, nothing counted
    const bad = machine([0xf3, ...new Array(30).fill(0x00), 0xfb, ...new Array(10).fill(0x00)]);
    bad.system.nextRtcAt = bad.cycles + 20;
    const cpu = bad.system.cpu;
    cpu.interrupt = () => false;
    const d = compareRun({ machine: bad, reference: self(), instructions: 36 }).divergence;
    // DI, 30 NOPs, EI, then one instruction after EI: the boundary after that is index 33.
    expect(d?.index).toBe(33);
    expect(d?.fields).toContain('irq');
  });
});

describe('the Model I\'s devices against a trace (our own machine recorded in MAME\'s format)', () => {
  /** A trace of `program` from power-on, written to `name`. @param {number[]} program @param {number} steps @param {string} name */
  function trace(program, steps, name) {
    const m = new Machine({ model: 1, roms: { level2: ROM } });
    m.mem.write(0x4000, program);
    const t = recordOurs(m, steps);
    const path = join(dir, name);
    writeTrace(path, { header: {}, ...t });
    return path;
  }
  const fresh = () => {
    const m = new Machine({ model: 1, roms: { level2: ROM } });
    return m;
  };

  it('a trace that stores video raw compares equal through the gate', () => {
    const path = trace(VIDEO, 40, 'video.fmt');
    const m = fresh();
    m.mem.write(0x4000, VIDEO);
    const ref = openTrace(path);
    // Boot (4) and the four writes (8), up to the read back.
    const r = compareRun({ machine: m, reference: ref, instructions: 12 });
    expect(r.divergence).toBeNull();
    expect(r.known).toEqual({});
    // The trace's video bytes are as written, ours through the gate.
    expect([...ref.peek(0x3c00, 4)]).toEqual([0x0d, 0x60, 0x2d, 0xc1]);
    expect([...m.mem.read(0x3c00, 4)]).toEqual([0x4d, 0x20, 0x2d, 0x81]);
  });

  it('where the trace read video bit 6 as written, our read takes the trace\'s byte and the step is counted', () => {
    // A trace from a machine that stores video raw (as MAME's trs80l2): its LD A,($3C00) gets $0D.
    const m0 = new Machine({ model: 1, roms: { level2: ROM }, lowercase: true });
    m0.mem.write(0x4000, VIDEO);
    const t = recordOurs(m0, 40);
    const path = join(dir, 'video-raw.fmt');
    writeTrace(path, { header: {}, ...t });
    const m = fresh();
    m.mem.write(0x4000, VIDEO);
    const r = compareRun({ machine: m, reference: openTrace(path), instructions: 40 });
    expect(r.divergence).toBeNull();
    expect(r.known).toEqual({ 'video read: the reference returns bit 6 as written (no gate)': 1 });
    expect(m.mem.read(0x5000, 1)[0]).toBe(0x0d); // ours went on from the trace's byte
    expect(m.mem.read(0x3c00, 1)[0]).toBe(0x4d); // and still stores through its gate
  });

  it('a video byte the trace read that differs from ours by more than the gate is not substituted: the read diverges', () => {
    // The same raw trace ($0D read back from $3C00); ours holds $4D there, but just before the
    // read (test-only) its byte is made $4C, which no gate makes of $0D. The fix (known.js,
    // video-read-gate) must not touch it: our CPU reads its own byte, and A differs.
    const m0 = new Machine({ model: 1, roms: { level2: ROM }, lowercase: true });
    m0.mem.write(0x4000, VIDEO);
    const t = recordOurs(m0, 40);
    const path = join(dir, 'video-raw-far.fmt');
    writeTrace(path, { header: {}, ...t });
    const m = fresh();
    m.mem.write(0x4000, VIDEO);
    let poked = false;
    // After the boot's four and the eight that write (instructions 0-11), before LD A,($3C00).
    const progress = { every: 12, fn: () => { if (!poked) m.system.memory.videoRam[0] = 0x4c; poked = true; } };
    const r = compareRun({ machine: m, reference: openTrace(path), instructions: 40, progress });
    expect(r.divergence).toMatchObject({ index: 12, pc: 0x4014, fields: ['a'], known: null });
    expect(r.divergence?.ours.regs.a).toBe(0x4c);
    expect(r.divergence?.theirs.regs.a).toBe(0x0d);
    expect(r.known).toEqual({});
  });

  it('planted: our gate inverted is caught at the first video write, against a trace', () => {
    const path = trace(VIDEO, 40, 'video-planted.fmt');
    const m = fresh();
    m.mem.write(0x4000, VIDEO);
    plantGateBug(m);
    const d = compareRun({ machine: m, reference: openTrace(path), instructions: 40 }).divergence;
    // DI, LD SP, IM 1, JP $4000, LD A,$0D, then the write: instruction 5.
    expect(d).toMatchObject({ index: 5, pc: 0x4002, fields: ['video'], known: null });
  });

  it('the latch reads must return what the trace\'s did; a read that does not clear shows at the next boundary that may interrupt (irqTime)', () => {
    const path = trace(LOOP, 60_000, 'latch.fmt');
    const ok = fresh();
    ok.mem.write(0x4000, LOOP);
    expect(compareRun({ machine: ok, reference: openTrace(path), instructions: 60_000 }).divergence).toBeNull();
    const m = fresh();
    m.mem.write(0x4000, LOOP);
    plantLatchBug(m);
    const ref = openTrace(path);
    const d = compareRun({ machine: m, reference: ref, instructions: 60_000 }).divergence;
    // The handler's RETI is the instruction after EI; the boundary after it is the first where our
    // still-set latch can interrupt and the trace took none.
    expect(d?.fields).toEqual(['irqTime']);
    const ctx = /** @type {import('./compare.js').Divergence} */ (d).context;
    const k = ctx.findIndex((l) => l.index === d?.index);
    expect(ctx[k - 1].text).toBe('RETI');
    expect(ctx.slice(0, k).some((l) => l.pc === LATCH_READ_PC)).toBe(true);
  });

  it('a latch read the trace recorded with another byte is a divergence in latch', () => {
    const m0 = fresh();
    m0.mem.write(0x4000, LOOP);
    const t = recordOurs(m0, 60_000);
    const j = t.records.findIndex((r) => r.reads.some((x) => x.addr === 0x37e0));
    t.records[j] = { ...t.records[j], reads: t.records[j].reads.map((x) => (x.addr === 0x37e0 ? { ...x, value: 0xc0 } : x)) };
    const path = join(dir, 'latch-bad.fmt');
    writeTrace(path, { header: {}, ...t });
    const m = fresh();
    m.mem.write(0x4000, LOOP);
    const d = compareRun({ machine: m, reference: openTrace(path), instructions: 60_000 }).divergence;
    expect(d).toMatchObject({ index: j, pc: LATCH_READ_PC });
    expect(d?.fields).toContain('latch');
  });

  // The final review's demonstration: a trace declares no step class (MAME_CLASSES), so a flag 3
  // or 5 bug of ours is a divergence against it, never counted under a class (known.js).
  it('our core with the SCF/CCF fix undone diverges at the SCF against a trace of the fixed one, nothing counted', () => {
    const path = trace(SCF, 20, 'scf-q.fmt');
    const ok = fresh();
    ok.mem.write(0x4000, SCF);
    expect(compareRun({ machine: ok, reference: openTrace(path), instructions: 20 })).toMatchObject({ divergence: null, known: {} });
    const m = fresh();
    m.mem.write(0x4000, SCF);
    undoScfFix(m);
    const r = compareRun({ machine: m, reference: openTrace(path), instructions: 20 });
    // DI, LD SP, IM 1, JP $4000, LD A, OR A, LD A, then the SCF: instruction 7.
    expect(r.divergence).toMatchObject({ index: 7, pc: 0x4005, fields: ['f.3', 'f.5'], known: null });
    expect(r.known).toEqual({});
  });

  it('our core with the repeating-block fix undone diverges at the LDIR against a trace of the fixed one, nothing counted', () => {
    const path = trace(LDIR, 20, 'ldir-xy.fmt');
    const ok = fresh();
    ok.mem.write(0x4000, LDIR);
    expect(compareRun({ machine: ok, reference: openTrace(path), instructions: 20 })).toMatchObject({ divergence: null, known: {} });
    const m = fresh();
    m.mem.write(0x4000, LDIR);
    undoBlockFix(m);
    const r = compareRun({ machine: m, reference: openTrace(path), instructions: 20 });
    // The boot's four, the four loads, then the LDIR's first iteration: instruction 8.
    expect(r.divergence).toMatchObject({ index: 8, pc: 0x400b, fields: ['f.3', 'f.5'], known: null });
    expect(r.known).toEqual({});
  });
});

describe('mameTimer: our 40 Hz on MAME\'s schedule (mame-clock.js, test-only)', () => {
  it('ticks where MAME\'s 1,774,083 Hz clock puts them: as ours for thirteen ticks, then a T-state later every thirteen or so', () => {
    expect([1, 2, 13, 14, 27].map(mameTick)).toEqual([44_352, 88_704, 576_576, 620_929, 1_197_506]);
    const m = mameTimer(new Machine({ model: 1, roms: { level2: ROM } }));
    m.run({ cycles: 700_000 });
    expect(m.system.nextRtcAt).toBe(mameTick(16));
  });

  it('a reset or a restored state during the run throws, rather than taking the timer off MAME\'s schedule', () => {
    const m = mameTimer(new Machine({ model: 1, roms: { level2: ROM } }));
    m.run({ cycles: 100_000 });
    const state = serializeState(m.system);
    expect(() => m.system.reset()).toThrow(/^mameTimer: the 40 Hz was set to T-state \d+, where only its tick's own advance \(\d+, after MAME's tick 3\) keeps it on MAME's schedule; a reset or a restored state during a run that follows MAME is not supported$/);
    expect(() => restoreState(m.system, state)).toThrow(/^mameTimer: the 40 Hz was set to T-state/);
  });
});

describe('pnpm diff: --model and --reference', () => {
  const DIFF = fileURLToPath(new URL('../../scripts/diff.mjs', import.meta.url));
  const run = (/** @type {string[]} */ args) => spawnSync(process.execPath, [DIFF, ...args], { encoding: 'utf8' });
  it.each([
    [['p.cmd', '--model', '3', '--reference', 'xtrs'], 'the Model III is compared against trsjs; xtrs runs the Model I (--model 1)'],
    [['p.cmd', '--model', '1', '--reference', 'trsjs'], 'trsjs runs the Model III; the Model I is compared against xtrs or mame'],
    [['p.cmd', '--model', '2'], '--model takes 1 (the Model I) or 3 (the Model III), not 2'],
    [['p.cmd', '--reference', 'sim'], '--reference takes trsjs, xtrs or mame, not sim'],
    [['p.cmd', '--lowercase'], '--lowercase is the Model I\'s modification (--model 1)'],
    [['--model', '1', '--reference', 'mame'], 'MAME is compared from a trace of its run from power-on: record one with pnpm mame:trace record <instructions>, then pass it with --trace'],
    [['--model', '1', '--reference', 'mame', '--trace', 't.fmt', '--keys', 'k.json'], 'a MAME trace brings its own keys and is compared from power-on: pass no --keys or --from-cycle (record a trace from the ROM\'s boot and typed keys with pnpm mame:trace record <instructions> --keys <script.json>; a trace that loaded a program is recorded by the tests, test/diff/model1-fixtures.test.js, and compared here with that program named)'],
    [['--model', '1', '--reference', 'mame', '--trace', 't.fmt', '--from-cycle', '5'], 'a MAME trace brings its own keys and is compared from power-on: pass no --keys or --from-cycle'],
    [['p.cmd', '--model', '1', '--trace', 't.fmt'], '--trace is for --reference mame'],
  ])('%j: exits 2 with a sentence', (args, sentence) => {
    const r = run(args);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(sentence);
  });
});

// --- Against the references (Review Focus 2) -----------------------------------------------

describe.skipIf(xtrsSkip !== null)(`the Model I's devices against xtrs${xtrsSkip === null ? '' : ` (skipped: ${xtrsSkip})`}`, { timeout: ROM_TEST_TIMEOUT }, () => {
  /** @type {import('./reference.js').Reference[]} */
  const open = [];
  const xtrs = (/** @type {Uint8Array} */ rom) => {
    const ref = loadXtrs({ rom });
    open.push(ref);
    return ref;
  };
  afterAll(() => {
    for (const r of open) r.close?.();
  });

  it('the latch on the synthetic ROM: 40 Hz interrupts taken, read and cleared in step with xtrs', () => {
    const m = machine(LOOP);
    const r = compareRun({ machine: m, reference: xtrs(ROM), instructions: 60_000 });
    expect(r.divergence).toBeNull();
    expect(r.known).toEqual({});
    expect(m.mem.read(0x5001, 1)[0]).toBe(TIMER_BIT);
  });

  it('planted: a latch read that does not clear is caught at that read, against xtrs', () => {
    const m = machine(LOOP);
    plantLatchBug(m);
    const d = compareRun({ machine: m, reference: xtrs(ROM), instructions: 60_000 }).divergence;
    expect(d).toMatchObject({ pc: LATCH_READ_PC, fields: ['latch'], known: null });
  });

  it('video: a byte with bit 5 set, and $0D, compare equal through the gate; port $FF reads alike', () => {
    const m = machine(VIDEO);
    expect(compareRun({ machine: m, reference: xtrs(ROM), instructions: 12 }).divergence).toBeNull();
    const p = machine(PORT_FF);
    const r = compareRun({ machine: p, reference: xtrs(ROM), instructions: 6 });
    expect(r.divergence).toBeNull();
    expect(p.mem.read(0x5002, 1)[0]).toBe(0x3f);
    // xtrs counts IN A,(n) as 10 T-states, the Z80 11 (known.js).
    expect(r.known).toEqual({ 'IN and block I/O: the reference counts one T-state less': 1 });
  });

  it('SCF after an instruction that left the flags alone: ours keeps F\'s flags 3 and 5, xtrs takes A\'s alone (the SCF/CCF class)', () => {
    // LD A,28H / OR A (F's bits 3 and 5 from the result, 28H, on both) / LD A,00H / SCF / CP 28H /
    // SCF (after CP, A's alone on both) / JR $.
    const m = machine([0x3e, 0x28, 0xb7, 0x3e, 0x00, 0x37, 0xfe, 0x28, 0x37, 0x18, 0xfe]);
    const r = compareRun({ machine: m, reference: xtrs(ROM), instructions: 8 });
    expect(r.divergence).toBeNull();
    expect(r.known).toEqual({ 'SCF/CCF: the reference takes flags 3 and 5 from A alone': 1 });
  });

  it('with the lowercase modification on both, video compares raw and is equal', () => {
    const m = machine(VIDEO, { lowercase: true });
    const ref = xtrs(ROM);
    expect(compareRun({ machine: m, reference: ref, instructions: 12, lowercase: true }).divergence).toBeNull();
    expect(ref.peek(0x3c00, 4)).toEqual(Uint8Array.from([0x0d, 0x60, 0x2d, 0xc1]));
  });

  it('planted: our gate inverted is caught at the Level II boot\'s first video write, against xtrs', () => {
    const rom = requireRom('model1');
    const m = new Machine({ model: 1, roms: { level2: rom } });
    const first = firstVideoWrite(m);
    plantGateBug(m);
    const d = compareRun({ machine: m, reference: xtrs(rom), instructions: first + 100 }).divergence;
    expect(d).toMatchObject({ index: first, fields: ['video'], known: null });
  });
});

describe.skipIf(mameSkip !== null)(`the Model I's devices against MAME${mameSkip === null ? '' : ` (skipped: ${mameSkip})`}`, { timeout: 180_000 }, () => {
  /** A trs80l2 ROM set of the synthetic ROM, under the rsl2 names (MAME warns of the CRCs and runs it). */
  const syntheticSet = () => {
    const romDir = join(dir, 'mame-roms');
    mkdirSync(join(romDir, 'trs80l2'), { recursive: true });
    ROM_SETS.rsl2.forEach((f, k) => writeFileSync(join(romDir, 'trs80l2', f.name), ROM.subarray(k * 4096, (k + 1) * 4096)));
    writeFileSync(join(romDir, 'trs80l2', CHARGEN.name), new Uint8Array(CHARGEN.size));
    return romDir;
  };
  // MAME runs from power-on, so the programs go in the ROM itself, at $0100, and the ROM jumps there.
  const LOOP_ROM = (() => {
    const rom = syntheticRom([0xc3, 0x00, 0x01]); // JP $0100
    rom.set(LOOP, 0x100);
    return rom;
  })();
  const VIDEO_ROM = (() => {
    const rom = syntheticRom([0xc3, 0x00, 0x01]); // JP $0100
    rom.set(VIDEO, 0x100);
    return rom;
  })();
  const SCF_ROM = (() => {
    const rom = syntheticRom([0xc3, 0x00, 0x01]); // JP $0100
    rom.set(SCF, 0x100);
    return rom;
  })();
  /** @param {Uint8Array} rom @param {number} n @param {string} name */
  const record = async (rom, n, name) => {
    const romDir = syntheticSet();
    ROM_SETS.rsl2.forEach((f, k) => writeFileSync(join(romDir, 'trs80l2', f.name), rom.subarray(k * 4096, (k + 1) * 4096)));
    const out = join(dir, name);
    await recordMameTrace({ instructions: n, out, romDir, skipRomCheck: true });
    return out;
  };
  const ours = (/** @type {Uint8Array} */ rom) => new Machine({ model: 1, roms: { level2: rom } });

  /** @type {Promise<string> | null} */
  let latchTrace = null;
  const latchPath = () => (latchTrace ??= record(LOOP_ROM, 200_000, 'mame-latch.fmt'));

  it('the latch: MAME\'s 40 Hz interrupts read and cleared as ours for 100,000 instructions; then its clock drifts (irqTime)', async () => {
    const path = await latchPath();
    const r = compareRun({ machine: ours(LOOP_ROM), reference: openTrace(path), instructions: 100_000 });
    expect(r.ended).toBeUndefined();
    expect(r.divergence).toBeNull();
    expect(r.known).toEqual({});
    // MAME's 40 Hz is 1/40 s of a 1,774,083 Hz clock (44,352.08 T-states), ours 44,352: about
    // fifteen ticks in, our request falls one instruction before MAME's (known.js, reference
    // limitations). Never excused (Ruling 4): pinned here so a change shows.
    const d = compareRun({ machine: ours(LOOP_ROM), reference: openTrace(path), instructions: 200_000 }).divergence;
    expect(d).toMatchObject({ index: 110_781, fields: ['irqTime'], known: null });
    // The trace took it at the next boundary.
    expect(d?.context.find((l) => l.index === 110_782)?.theirs.cycles).toBe(24); // the response (13) and PUSH AF (11)
  });

  it('the latch on MAME\'s clock (mameTimer): 200,000 instructions of 40 Hz interrupts with no irqTime; one T-state late is caught', async () => {
    const path = await latchPath();
    const r = compareRun({ machine: mameTimer(ours(LOOP_ROM)), reference: openTrace(path), instructions: 200_000 });
    expect(r.ended).toBeUndefined();
    expect(r.divergence).toBeNull();
    expect(r.known).toEqual({});
    // A timer of ours one T-state late at every tick is still a divergence, at the first tick
    // whose boundary it moves.
    const late = ours(LOOP_ROM);
    mameTimer(late);
    const get = /** @type {() => number} */ (Object.getOwnPropertyDescriptor(late.system, 'nextRtcAt')?.get);
    const set = /** @type {(v: number) => void} */ (Object.getOwnPropertyDescriptor(late.system, 'nextRtcAt')?.set);
    Object.defineProperty(late.system, 'nextRtcAt', { configurable: true, get: () => get() + 1, set: (v) => set(v - 1) });
    const d = compareRun({ machine: late, reference: openTrace(path), instructions: 200_000 }).divergence;
    expect(d?.fields).toEqual(['irqTime']);
  });

  it('planted: a latch read that does not clear, against MAME: caught after the handler\'s RETI (irqTime)', async () => {
    const path = await latchPath();
    const m = ours(LOOP_ROM);
    plantLatchBug(m);
    const d = compareRun({ machine: m, reference: openTrace(path), instructions: 200_000 }).divergence;
    expect(d?.fields).toEqual(['irqTime']);
    const ctx = /** @type {import('./compare.js').Divergence} */ (d).context;
    const k = ctx.findIndex((l) => l.index === d?.index);
    expect(ctx[k - 1].text).toBe('RETI');
  });

  it('video: MAME stores $0D and $60 as written; through the gate they equal ours, and its read of $0D is counted', async () => {
    const path = await record(VIDEO_ROM, 30, 'mame-video.fmt');
    const ref = openTrace(path);
    const m = ours(VIDEO_ROM);
    const r = compareRun({ machine: m, reference: ref, instructions: 30 });
    expect(r.divergence).toBeNull();
    expect([...ref.peek(0x3c00, 4)]).toEqual([0x0d, 0x60, 0x2d, 0xc1]);
    expect([...m.mem.read(0x3c00, 4)]).toEqual([0x4d, 0x20, 0x2d, 0x81]);
    // MAME's LD A,($3C00) read $0D (no gate); ours took it, counted.
    expect(r.known).toEqual({ 'video read: the reference returns bit 6 as written (no gate)': 1 });
    expect(m.mem.read(0x5000, 1)[0]).toBe(0x0d);
  });

  it('SCF after an instruction that left the flags alone: MAME keeps F\'s flags 3 and 5 as ours does; with our fix undone it diverges, nothing counted', async () => {
    const path = await record(SCF_ROM, 20, 'mame-scf.fmt');
    expect(compareRun({ machine: ours(SCF_ROM), reference: openTrace(path), instructions: 20 })).toMatchObject({ divergence: null, known: {} });
    const m = ours(SCF_ROM);
    undoScfFix(m);
    const r = compareRun({ machine: m, reference: openTrace(path), instructions: 20 });
    expect(r.divergence).toMatchObject({ index: 7, pc: 0x0105, fields: ['f.3', 'f.5'], known: null });
    expect(r.known).toEqual({});
  });

  it('planted: our gate inverted is caught at the Level II boot\'s first video write, against MAME', async () => {
    const rom = requireRom('model1-mame');
    const path = join(dir, 'mame-boot.fmt');
    await recordMameTrace({ instructions: 20_000, out: path });
    const m = new Machine({ model: 1, roms: { level2: rom } });
    const probe = new Machine({ model: 1, roms: { level2: rom } });
    openTrace(path).follow.start(probe);
    const first = firstVideoWrite(probe);
    plantGateBug(m);
    const d = compareRun({ machine: m, reference: openTrace(path), instructions: 20_000 }).divergence;
    expect(d).toMatchObject({ index: first, fields: ['video'], known: null });
  });
});
