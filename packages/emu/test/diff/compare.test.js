/**
 * The lockstep comparator and the known classes (emu phase 7, Task 2), on small synthetic programs
 * in RAM over a synthetic ROM (no copyrighted code: the tests need trsjs and FUGLOY_TRSJS=1, not a
 * ROM). The keyEvents tests always run.
 *
 * The synthetic ROM: at $0000 DI / LD SP,$7000 / IM 1 / JP $4000; at $0038 the 30 Hz handler,
 * PUSH AF / IN A,($EC) (acknowledges the request) / POP AF / EI / RETI. Each program starts at
 * $4000 with SP = $7000, IM 1, the 30 Hz interrupt enabled in port $E0, and the request due
 * `rtcIn` T-states from the start, so it lands on a chosen instruction boundary.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Machine } from '../../src/index.js';
import { compareRun, formatReport, keyEvents } from './compare.js';
import { CLASS_NAMES, explainStep, INTERRUPT_CLASSES, REFERENCE_FIXES, STEP_CLASSES } from './known.js';
import { trsjsSkip } from './gate.js';
import { loadTrsjs } from './trsjs-adapter.js';

const ROM = new Uint8Array(0x3800);
ROM.set([0xf3, 0x31, 0x00, 0x70, 0xed, 0x56, 0xc3, 0x00, 0x40], 0x0000);
ROM.set([0xf5, 0xdb, 0xec, 0xf1, 0xfb, 0xed, 0x4d], 0x0038);

/** A Machine at $4000 running `program`, the 30 Hz request due in `rtcIn` T-states. */
function setup(program, rtcIn = 1e9) {
  const m = new Machine({ roms: { level2: ROM } });
  m.mem.write(0x4000, program);
  const cpu = m.system.cpu;
  cpu.registers.PC = 0x4000;
  cpu.registers.SP = 0x7000;
  cpu.interruptMode = 1;
  m.system.io.intMask = 0x04;
  m.system.nextRtcAt = m.cycles + rtcIn;
  return m;
}

const ALL = [...STEP_CLASSES, ...INTERRUPT_CLASSES, ...REFERENCE_FIXES];
const name = (id) => ALL.find((c) => c.id === id).name;
const IRQ_R = name('irq-r');

describe('keyEvents', () => {
  it('turns a key script into matrix presses and releases, in time order', () => {
    expect(keyEvents([{ at: 500, key: 'ENTER', hold: 100 }, { at: 100, key: 'A', hold: 50 }])).toEqual([
      { at: 100, row: 0, bit: 1, down: true },
      { at: 150, row: 0, bit: 1, down: false },
      { at: 500, row: 6, bit: 0, down: true },
      { at: 600, row: 6, bit: 0, down: false },
    ]);
  });

  it('presses SHIFT with a key that needs it (a lowercase letter)', () => {
    const downs = keyEvents([{ at: 0, key: 'a' }]).filter((e) => e.down);
    expect(downs).toEqual([{ at: 0, row: 0, bit: 1, down: true }, { at: 0, row: 7, bit: 0, down: true }]);
  });
});

describe('the known classes', () => {
  it('each carries its evidence and has a distinct name', () => {
    for (const c of ALL) expect(c.evidence).toMatch(/Young|ZEXALL|Zilog/);
    expect(new Set(CLASS_NAMES).size).toBe(CLASS_NAMES.length);
  });

  /** A step context for a step class's predicate. */
  const stepCtx = (bytes, ours, theirs) => {
    const regs = { pc: 0x4001, f: 0 };
    return {
      bytes: Uint8Array.from([...bytes, 0, 0, 0, 0].slice(0, 4)),
      execPc: 0x4000,
      ours: { regs, cycles: 19, irq: false, writes: ours, wasHalted: false, fBefore: 0 },
      theirs: { regs, cycles: 19, irq: false, writes: theirs },
    };
  };
  const explains = (id, ctx) => STEP_CLASSES.find((c) => c.id === id).explains(ctx, new Set(['writes']));

  it('a repeating block instruction\'s flags 3 and 5: only while it repeats, only from PC, and before the general class', () => {
    const at = (bytes, pc, f, execPc = 0x4000) => {
      const ctx = stepCtx(bytes, [], []);
      ctx.execPc = execPc;
      ctx.ours.regs = { ...ctx.ours.regs, pc, f };
      return ctx;
    };
    const f35 = new Set(['f.5', 'f.3']);
    const block = (ctx) => STEP_CLASSES.find((c) => c.id === 'block-xy').explains(ctx, f35);
    for (const op of [0xb0, 0xb8, 0xb1, 0xb9]) expect(block(at([0xed, op], 0x2800, 0x28, 0x2800))).toEqual(['f.5', 'f.3']);
    expect(block(at([0xed, 0xb0], 0x4002, 0x00))).toBeNull(); // it ended
    expect(block(at([0xed, 0xb0], 0x2800, 0x08, 0x2800))).toBeNull(); // not PC's bits
    expect(block(at([0xed, 0xa0], 0x4000, 0x00))).toBeNull(); // LDI
    expect(block(at([0xed, 0xb2], 0x4000, 0x00))).toBeNull(); // INIR: not this class
    // Counted under this class, not also under flags 3 and 5.
    const ctx = at([0xed, 0xb0], 0x4000, 0x00);
    ctx.theirs.regs = { ...ctx.theirs.regs, pc: 0x4000, f: 0x28 };
    expect(explainStep(ctx, new Set(['f.5', 'f.3']))).toEqual({ classes: [name('block-xy')], unexplained: [] });
  });

  it('EX (SP),rr\'s write order: only the two bytes swapped, only for EX (SP),rr', () => {
    const h = { addr: 0x7001, value: 0x12 };
    const l = { addr: 0x7000, value: 0x34 };
    for (const op of [[0xe3], [0xdd, 0xe3], [0xfd, 0xe3]]) expect(explains('ex-sp-order', stepCtx(op, [h, l], [l, h]))).toEqual(['writes']);
    // Another instruction, another value, the same order, or our order the reference's: not explained.
    expect(explains('ex-sp-order', stepCtx([0xe5], [h, l], [l, h]))).toBeNull();
    expect(explains('ex-sp-order', stepCtx([0xe3], [h, l], [l, { ...h, value: 0x13 }]))).toBeNull();
    expect(explains('ex-sp-order', stepCtx([0xe3], [l, h], [h, l]))).toBeNull();
    // An interrupt response's push before it must agree too.
    const push = [{ addr: 0x7003, value: 0x40 }, { addr: 0x7002, value: 0x00 }];
    expect(explains('ex-sp-order', stepCtx([0xe3], [...push, h, l], [...push, l, h]))).toEqual(['writes']);
    expect(explains('ex-sp-order', stepCtx([0xe3], [...push, h, l], [push[1], push[0], l, h]))).toBeNull();
  });
});

describe.skipIf(trsjsSkip !== null)(`compareRun against trsjs${trsjsSkip === null ? '' : ` (skipped: ${trsjsSkip})`}`, () => {
  // Loaded before the tests, not while collecting: a skipped describe's body still runs, and
  // without trsjs (CI) loading here would fail the file.
  /** @type {import('./trsjs-adapter.js').Reference} */
  let ref;
  beforeAll(() => {
    ref = loadTrsjs();
  });
  const run = (m, n, opts = {}) => compareRun({ machine: m, reference: ref, instructions: n, ...opts });

  // Each program differs from trsjs only by the named classes; the counts are exact, so a class
  // that began to excuse more (or less) fails here.
  const cases = [
    {
      what: 'flag bits 3 and 5: SCF after OR A',
      program: [0x3e, 0xff, 0xb7, 0x37, 0x3f, 0x00], // LD A,$FF / OR A / SCF / CCF / NOP
      n: 4,
      known: { [name('xy')]: 1 },
    },
    {
      what: 'BIT 7,A and BIT 0,A on $80: S and P/V',
      program: [0x3e, 0x80, 0xcb, 0x7f, 0xcb, 0x47, 0x00],
      n: 4,
      known: { [name('bit')]: 2 },
    },
    {
      what: 'BIT 0,(IX+0): R counted three times, and BIT\'s S and P/V',
      program: [0xdd, 0x21, 0x00, 0x50, 0xdd, 0xcb, 0x00, 0x46, 0x00],
      n: 3,
      known: { [name('bit')]: 1, [name('ddcb-r')]: 1 },
    },
    {
      what: 'DD before LD B,C: trsjs drops the instruction',
      program: [0x01, 0x11, 0x00, 0xdd, 0x41, 0x00], // LD BC,$0011 / LD B,C (DD-prefixed) / NOP
      n: 3,
      known: { [name('dropped-prefix')]: 1 },
    },
    {
      what: 'a request while DI: held until EI and one more instruction',
      program: [0xf3, 0x00, 0x00, 0x00, 0x00, 0xfb, 0x00, 0x00, 0x00], // DI / NOP x4 / EI / NOP x3
      rtcIn: 8, // after DI and one NOP
      n: 12,
      known: { [name('held-di')]: 1, [IRQ_R]: 1 },
    },
    {
      what: 'a request right after EI: waits for the instruction after EI',
      program: [0x00, 0xfb, 0x00, 0x00, 0x00, 0x00], // NOP / EI / NOP ...
      rtcIn: 8, // the boundary after EI
      n: 12,
      known: { [name('held-ei')]: 1, [IRQ_R]: 1 },
    },
    {
      what: 'a request right after a lone DD: waits for the instruction after it',
      program: [0xfb, 0x00, 0xdd, 0xdd, 0x21, 0x34, 0x12, 0x00, 0x00], // EI / NOP / DD / LD IX,$1234 / NOP
      rtcIn: 12, // the boundary after the lone DD
      n: 12,
      known: { [name('dropped-prefix')]: 1, [name('held-prefix')]: 1, [IRQ_R]: 1 },
    },
    {
      what: 'CPIR over three bytes that do not match: trsjs sets C',
      program: [0xaf, 0x21, 0x00, 0x50, 0x01, 0x03, 0x00, 0x3e, 0x99, 0xed, 0xb1, 0x00], // XOR A / LD HL,$5000 / LD BC,3 / LD A,$99 / CPIR / NOP
      n: 7,
      known: { [name('cpi-c')]: 3, [name('xy')]: 1 },
    },
    {
      what: 'EX (SP),HL and EX (SP),IX: trsjs writes (SP) before (SP+1)',
      program: [0x21, 0x34, 0x12, 0xe3, 0xdd, 0xe3, 0x00], // LD HL,$1234 / EX (SP),HL / EX (SP),IX / NOP
      n: 3,
      known: { [name('ex-sp-order')]: 2 },
    },
    {
      what: 'LDIR that repeats: flags 3 and 5 from PC in ours, kept in trsjs',
      // LD A,$28 / OR A (ours sets F bits 3 and 5 from the result, trsjs not: xy, then resynced) /
      // LD HL,$5000 / LD DE,$5100 / LD BC,3 / LDIR / NOP: the first iteration leaves PC $40's bits
      // (0) in ours and $28 in trsjs (block-xy, resynced); the second 0 on both; the last n = A + 0
      // = $28's bit 3 in ours, trsjs the 0 it was given (xy).
      program: [0x3e, 0x28, 0xb7, 0x21, 0x00, 0x50, 0x11, 0x00, 0x51, 0x01, 0x03, 0x00, 0xed, 0xb0, 0x00],
      n: 9,
      known: { [name('block-xy')]: 1, [name('xy')]: 2 },
    },
    {
      what: 'a HALT idling with no interrupt: R counts on every step, as on trsjs',
      program: [0xf3, 0x76], // DI / HALT
      n: 6,
      known: {},
    },
    {
      what: 'an interrupt that ends a HALT: trsjs pushes the HALT\'s address',
      program: [0xfb, 0x00, 0x76, 0x00, 0x00], // EI / NOP / HALT / NOP
      rtcIn: 12, // the boundary after HALT
      n: 12,
      known: { [name('halt-push')]: 1, [IRQ_R]: 1 },
    },
  ];

  it.each(cases)('counts, not fails: $what', ({ program, rtcIn, n, known }) => {
    const m = setup(program, rtcIn);
    const r = run(m, n);
    expect(r.divergence).toBeNull();
    expect(r.instructions).toBe(n);
    expect(r.known).toEqual(known);
    expect(ref.cycles).toBe(m.cycles);
  });

  it('returns from the HALT\'s interrupt to the instruction after it, as Young §5.4 says', () => {
    const m = setup([0xfb, 0x00, 0x76, 0x00, 0x00], 12);
    // EI, NOP, HALT, then the handler (the response with PUSH AF, IN, POP, EI, RETI).
    expect(run(m, 8).divergence).toBeNull();
    expect(m.cpu.regs.pc).toBe(0x4003);
    expect(ref.regs().pc).toBe(0x4003); // resynced from ours after the push
    expect(m.system.cpu.halted).toBe(false);
  });

  it('makes trsjs run what a DD before LD B,C leaves to run, and checks our result against it', () => {
    const m = setup([0x01, 0x11, 0x00, 0xdd, 0x41, 0x00]); // LD BC,$0011 / LD B,C (DD-prefixed) / NOP
    expect(run(m, 2).divergence).toBeNull();
    expect(m.cpu.regs.b).toBe(0x11);
    expect(ref.regs().b).toBe(0x11);
    expect(ref.cycles).toBe(m.cycles); // 10 + 8
  });

  it('a bug in our instruction after an ignored DD is a divergence, not a known difference', () => {
    // The reviewer's case: our LD B,C (test-only) flips B's bit 7, sets SP, and takes 7 more T-states.
    const m = setup([0x01, 0x11, 0x00, 0xdd, 0x41, 0x00]);
    const cpu = m.system.cpu;
    const ldbc = cpu.opcodeHandlers[0x41];
    cpu.opcodeHandlers[0x41] = () => {
      const t = ldbc();
      cpu.registers.B ^= 0x80;
      cpu.registers.SP = 0x1234;
      return t + 7;
    };
    const r = run(m, 3);
    expect(r.divergence).toMatchObject({ index: 1, pc: 0x4003, known: null, fields: ['b', 'cycles', 'sp'] });
  });

  it('a CPI of ours that changed C is a divergence, not trsjs\'s C', () => {
    const m = setup([0x37, 0x21, 0x00, 0x50, 0x01, 0x01, 0x00, 0x3e, 0x99, 0xed, 0xa1, 0x00]); // SCF / LD HL / LD BC,1 / LD A,$99 / CPI
    const cpu = m.system.cpu;
    const cpi = cpu.cpi.bind(cpu);
    cpu.cpi = () => {
      const t = cpi();
      cpu.flagC = 0; // test-only bug: C cleared
      return t;
    };
    const r = run(m, 6);
    expect(r.divergence).toMatchObject({ index: 4, pc: 0x4009, known: null });
    expect(r.divergence.fields).toContain('f.C');
  });

  it('with strict, stops on the first known difference and names it', () => {
    const m = setup([0x3e, 0x80, 0xcb, 0x7f, 0xcb, 0x47, 0x00]);
    const r = run(m, 4, { strict: true });
    expect(r.instructions).toBe(2);
    expect(r.divergence).toMatchObject({ index: 1, pc: 0x4002, known: name('bit') });
    expect(r.divergence.fields).toContain('f.S');
    expect(r.known).toEqual({ [name('bit')]: 1 });
  });

  it('strict passes flag bits 3 and 5 by; strict \'all\' stops on them too', () => {
    const program = [0x3e, 0xff, 0xb7, 0x37, 0x3f, 0x00]; // LD A,$FF / OR A / SCF / CCF / NOP
    const r = run(setup(program), 4, { strict: true });
    expect(r.divergence).toBeNull();
    expect(r.known).toEqual({ [name('xy')]: 1 });
    const all = run(setup(program), 4, { strict: 'all' });
    expect(all.divergence).toMatchObject({ known: name('xy') });
  });

  /** NOPs to $400F, LD A,5 at $400F, AND A at $4011, then NOPs. */
  const ANDA = [...new Array(15).fill(0x00), 0x3e, 0x05, 0xa7, ...new Array(20).fill(0x00)];
  /** Our AND with Z flipped: a test-only bug in one opcode of our core. */
  function plantAndBug(m) {
    const cpu = m.system.cpu;
    const and = cpu.opcodeHandlers[0xa7];
    cpu.opcodeHandlers[0xa7] = () => {
      const t = and();
      cpu.flagZ = !cpu.flagZ;
      return t;
    };
  }

  it('catches a planted flag bug at the exact instruction, with ten instructions of context each side', () => {
    const m = setup(ANDA);
    plantAndBug(m);
    const r = run(m, 30);
    const d = r.divergence;
    expect(d).not.toBeNull();
    expect(d).toMatchObject({ index: 16, pc: 0x4011, kind: 'step', known: null, fields: ['f.Z'] });
    expect(r.instructions).toBe(17);
    expect(d.ours.regs.f & 0x40).not.toBe(d.theirs.regs.f & 0x40);
    expect(d.video.equal).toBe(true);
    expect(d.context.map((l) => l.index)).toEqual([...Array.from({ length: 21 }, (_, k) => 6 + k)]);
    const at = d.context.find((l) => l.index === 16);
    expect(at).toMatchObject({ pc: 0x4011, text: 'AND A' });
    expect(d.context.find((l) => l.index === 15)).toMatchObject({ pc: 0x400f, text: 'LD A,05H' });
  });

  it('shows each context instruction as it ran, though the code rewrote itself after', () => {
    // $4000 LD A,0 / $4002 LD ($4002),A (overwrites its own first byte with NOP) / three NOPs /
    // LD A,5 / AND A / NOPs
    const program = [0x3e, 0x00, 0x32, 0x02, 0x40, 0x00, 0x00, 0x00, 0x3e, 0x05, 0xa7, ...new Array(20).fill(0x00)];
    const m = setup(program);
    plantAndBug(m);
    const d = run(m, 30).divergence;
    expect(d.index).toBe(6);
    expect(m.mem.read(0x4002, 1)[0]).toBe(0x00);
    expect(d.context.find((l) => l.pc === 0x4002)).toMatchObject({ text: 'LD (4002H),A' });
  });

  it('catches a memory write that differs', () => {
    // LD HL,$5000 / LD A,$42 / LD (HL),A, ours (test-only) writing A xor 1.
    const m = setup([0x21, 0x00, 0x50, 0x3e, 0x42, 0x77, 0x00]);
    const cpu = m.system.cpu;
    cpu.opcodeHandlers[0x77] = () => {
      cpu.writeMemory((cpu.registers.H << 8) | cpu.registers.L, cpu.registers.A ^ 1);
      return 7;
    };
    const d = run(m, 4).divergence;
    expect(d).toMatchObject({ index: 2, pc: 0x4005, fields: ['writes'] });
    expect(d.writes).toEqual({ ours: [{ addr: 0x5000, value: 0x43 }], theirs: [{ addr: 0x5000, value: 0x42 }] });
  });

  it('an interrupt our CPU takes with no request the reference raised is a divergence', () => {
    // A cassette-edge request (port $E0 bit 0) that trsjs never models: nothing is held for it.
    const m = setup([0xfb, 0x00, 0x00, 0x00]);
    m.system.io.intMask = 0x05;
    m.system.io.intLatch = 0x01;
    const d = run(m, 4).divergence;
    expect(d.index).toBe(2);
    expect(d.fields).toEqual(expect.arrayContaining(['pc', 'sp', 'cycles', 'writes']));
  });

  // The held-EI and held-prefix classes come from the instruction stream, not our CPU's state, so
  // a planted fault in that state is a divergence (field irq), not an excused difference.
  it('an EI delay of ours that runs long is a divergence at the boundary it should have ended', () => {
    const m = setup([0x00, 0xfb, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], 8); // NOP / EI / NOP ...
    const cpu = m.system.cpu;
    const exec = cpu.decodeAndExecute.bind(cpu);
    cpu.decodeAndExecute = (op) => {
      const t = exec(op);
      if (op === 0xfb) cpu.pendingEI = 4; // two instructions late
      return t;
    };
    const r = run(m, 12);
    expect(r.divergence).toMatchObject({ index: 3, pc: 0x4003, fields: ['irq'], known: null });
  });

  it('an EI delay of ours that runs short is a divergence where it took the interrupt', () => {
    const m = setup([0x00, 0xfb, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], 8);
    const cpu = m.system.cpu;
    const exec = cpu.decodeAndExecute.bind(cpu);
    cpu.decodeAndExecute = (op) => {
      const t = exec(op);
      if (op === 0xfb) {
        cpu.pendingEI = 0;
        cpu.IFF1 = cpu.IFF2 = true; // no delay at all
      }
      return t;
    };
    const d = run(m, 12).divergence;
    expect(d).toMatchObject({ index: 2, known: null });
    expect(d.fields).toContain('irq');
  });

  it('a lone-prefix hold of ours that sticks is a divergence at the boundary it should have ended', () => {
    // EI / NOP / DD (lone) / LD IX,$1234 / NOP ...; the request lands after the lone DD.
    const m = setup([0xfb, 0x00, 0xdd, 0xdd, 0x21, 0x34, 0x12, 0x00, 0x00, 0x00], 12);
    const cpu = m.system.cpu;
    const exec = cpu.executeInstruction;
    cpu.executeInstruction = () => {
      const pc = cpu.registers.PC;
      const t = exec.call(cpu);
      if (pc === 0x4003) cpu.afterPrefix = true; // still held after LD IX
      return t;
    };
    const r = run(m, 12);
    expect(r.divergence).toMatchObject({ index: 4, pc: 0x4007, fields: ['irq'], known: null });
  });

  it('the held-interrupt class excuses nothing on the step it is taken', () => {
    // The DI case, with our handler's PUSH AF (test-only) pushing F xor 1.
    const m = setup([0xf3, 0x00, 0x00, 0x00, 0x00, 0xfb, 0x00, 0x00, 0x00], 8);
    const cpu = m.system.cpu;
    const push = cpu.opcodeHandlers[0xf5];
    cpu.opcodeHandlers[0xf5] = () => {
      cpu.registers.F ^= 0x01;
      const t = push();
      cpu.registers.F ^= 0x01;
      return t;
    };
    const r = run(m, 12);
    expect(r.divergence).toMatchObject({ index: 7, pc: 0x0038, fields: ['writes'], known: null });
  });

  it('compares video RAM at the end of the run', () => {
    const m = setup(new Array(10).fill(0x00));
    const refStep = ref.step;
    let k = 0;
    ref.step = (opts) => {
      if (k++ === 3) ref.poke(0x3c10, [0x41]); // a reference-side change no write shows
      return refStep(opts);
    };
    try {
      const d = run(m, 8).divergence;
      expect(d).toMatchObject({ kind: 'video', index: 8, fields: ['video'], video: { equal: false, differing: 1, first: 0x3c10 } });
      expect(d.context).toHaveLength(8);
    } finally {
      ref.step = refStep;
    }
  });

  it('reports the same run the same way, byte for byte', () => {
    const report = () => {
      const m = setup(ANDA);
      plantAndBug(m);
      return formatReport(run(m, 30));
    };
    const text = report();
    expect(report()).toBe(text);
    expect(text).toContain('divergence at instruction 16, PC $4011: differs: f.Z');
    expect(text).toMatch(/^> +16 {2}\$4011 {2}AND A/m);
  });

  it('delivers keys to both matrices at the same boundary', () => {
    // loop: LD A,($3801) / LD HL,$5000 / OR (HL) / LD (HL),A / JR loop — ORs row 0 into $5000.
    const m = setup([0x3a, 0x01, 0x38, 0x21, 0x00, 0x50, 0xb6, 0x77, 0x18, 0xf6]);
    const r = run(m, 300, { keys: keyEvents([{ at: 400, key: 'A', hold: 600 }]) });
    expect(r.divergence).toBeNull();
    expect(m.mem.read(0x5000, 1)[0]).toBe(0x02); // A is row 0 bit 1
    expect(ref.peek(0x5000, 1)[0]).toBe(0x02);
    expect(m.system.keyboard.rows[0]).toBe(0); // released again
  });

  it('refuses a machine whose own key queue has keys waiting', () => {
    const m = setup([0x00]);
    m.keyboard.type('A');
    expect(() => run(m, 1)).toThrow(/key queue has keys waiting; pass keys to compareRun/);
  });

  it('leaves our machine unwrapped after the run', () => {
    const m = setup(new Array(4).fill(0x00));
    run(m, 2);
    expect(Object.hasOwn(m.system.memory, 'writeByte')).toBe(false);
    expect(Object.hasOwn(m.system.cpu, 'interrupt')).toBe(false);
    expect(Object.hasOwn(m.system.cpu, 'executeInstruction')).toBe(false);
  });
});
