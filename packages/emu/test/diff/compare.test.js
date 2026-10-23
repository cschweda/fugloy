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
import { CLASS_NAMES, COMMON_CLASSES, declaredClasses, diffStep, explainStep, INTERRUPT_CLASSES, REFERENCE_FIXES, STEP_CLASSES } from './known.js';
import { trsjsSkip } from './gate.js';
import { MAME_CLASSES } from './mame-trace.js';
import { loadTrsjs, TRSJS_CLASSES } from './trsjs-adapter.js';
import { XTRS_CLASSES } from './xtrs-adapter.js';

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
/** Each reference's step classes, as compareRun resolves them. */
const TRSJS_STEP = declaredClasses(TRSJS_CLASSES, 'trsjs').step;
const XTRS_STEP = declaredClasses(XTRS_CLASSES, 'xtrs').step;
const MAME_STEP = declaredClasses(MAME_CLASSES, 'MAME').step;

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
    // Ruling 6: ZEXALL, Young, Zilog's manual, the Technical Reference Handbook, or a reference's source file.
    for (const c of ALL) expect(c.evidence).toMatch(/Young|ZEXALL|Zilog|Handbook|\b[\w-]+\.(c|cpp|lst|js)\b/);
    expect(new Set(CLASS_NAMES).size).toBe(CLASS_NAMES.length);
  });

  /** A step context for a step class's predicate; our memory reads 00H. */
  const stepCtx = (bytes, ours, theirs) => {
    const regs = { pc: 0x4001, f: 0 };
    return {
      bytes: Uint8Array.from([...bytes, 0, 0, 0, 0].slice(0, 4)),
      execPc: 0x4000,
      peek: () => 0x00,
      ours: { regs, cycles: 19, irq: false, writes: ours, wasHalted: false, fBefore: 0, q: 0, wz: 0 },
      theirs: { regs, cycles: 19, irq: false, writes: theirs },
    };
  };
  const explains = (id, ctx) => STEP_CLASSES.find((c) => c.id === id).explains(ctx, new Set(['writes']));

  it('a repeating block instruction\'s flags 3 and 5: only while it repeats, only from PC, and before the general class', () => {
    // The reference's bits 00H, on each class's rule (the next test): xtrs's n (A 00H and the byte
    // moved or compared, 00H) and trsjs's F before (00H).
    const at = (bytes, pc, f, execPc = 0x4000) => {
      const moved = (bytes[1] & 0x01) === 0 ? [{ addr: 0x6000, value: 0x00 }] : [];
      const ctx = stepCtx(bytes, moved, moved);
      ctx.execPc = execPc;
      ctx.ours.regs = { ...ctx.ours.regs, pc, f, a: 0x00, h: 0x50, l: 0x01 };
      ctx.theirs.regs = { ...ctx.ours.regs, f: 0x00 };
      return ctx;
    };
    const f35 = new Set(['f.5', 'f.3']);
    for (const id of ['block-xy-n', 'block-xy-keep']) {
      const block = (ctx) => STEP_CLASSES.find((c) => c.id === id).explains(ctx, f35);
      for (const op of [0xb0, 0xb8, 0xb1, 0xb9]) expect(block(at([0xed, op], 0x2800, 0x28, 0x2800)), `${id} ${op.toString(16)}`).toEqual(['f.5', 'f.3']);
      expect(block(at([0xed, 0xb0], 0x4002, 0x00)), id).toBeNull(); // it ended
      expect(block(at([0xed, 0xb0], 0x2800, 0x08, 0x2800)), id).toBeNull(); // not PC's bits
      expect(block(at([0xed, 0xa0], 0x4000, 0x00)), id).toBeNull(); // LDI
      expect(block(at([0xed, 0xb2], 0x4000, 0x00)), id).toBeNull(); // INIR: not this class
      const irq = at([0xed, 0xb0], 0x2800, 0x28, 0x2800);
      irq.ours.irq = true;
      expect(block(irq), id).toBeNull(); // an interrupt response in the step
    }
    // Counted under the reference's class, not also under trsjs's general flags 3 and 5.
    const ctx = at([0xed, 0xb0], 0x4000, 0x00);
    ctx.ours.fBefore = 0x28;
    ctx.theirs.regs = { ...ctx.theirs.regs, f: 0x28 };
    expect(explainStep(ctx, new Set(['f.5', 'f.3']), TRSJS_STEP)).toEqual({ classes: [name('block-xy-keep')], unexplained: [] });
  });

  it('block-xy holds the reference to its own rule: xtrs\'s n, trsjs\'s bits as they were', () => {
    // A repeating step at $2800 (ours: PC's bits 13 and 11, 28H), A 10H, F before 00H, the byte
    // moved (the step's write) or compared (at $5000; FFH elsewhere, so a wrong address shows) 08H.
    // xtrs keeps Young §4.2's rule, the finished iteration's n, at every iteration:
    // tools/xtrs/src/z80.c's do_ldir runs `do_ldi();` (line 1014), whose `undoc = REG_A + moved;`
    // (line 989) sets them, and do_cpir runs `do_cpi();` (line 606), whose `result - H` (lines
    // 537-543) does. LDIR and LDDR: n = 08H + 10H = 18H, flags 3 and 5 08H; CPIR and CPDR: n = 10H -
    // 08H - H (1) = 07H, 20H (without H 08H, the LDs'). trsjs's oped_b0, oped_b8, oped_b1 and oped_b9
    // (trsemu-1.6.js) leave them as they were, 00H. The value that matches neither rule is the other
    // pair's n.
    const step = (/** @type {number} */ op, /** @type {number} */ hl, /** @type {number} */ theirs) => {
      const regs = { pc: 0x2800, f: 0x28, a: 0x10, h: hl >> 8, l: hl & 0xff };
      const writes = op & 1 ? [] : [{ addr: 0x6000, value: 0x08 }];
      return {
        bytes: Uint8Array.from([0xed, op, 0x00, 0x00]),
        execPc: 0x2800,
        peek: (/** @type {number} */ addr) => (addr === 0x5000 ? 0x08 : 0xff),
        ours: { regs, cycles: 21, irq: false, writes, wasHalted: false, fBefore: 0x00, q: 0, wz: 0x2801 },
        theirs: { regs: { ...regs, f: theirs }, cycles: 21, irq: false, writes },
      };
    };
    // HL after the iteration: LDIR and CPIR count up from $5000, LDDR and CPDR down.
    const cases = [
      { op: 0xb0, hl: 0x5001, n: 0x08, neither: 0x20 },
      { op: 0xb8, hl: 0x4fff, n: 0x08, neither: 0x20 },
      { op: 0xb1, hl: 0x5001, n: 0x20, neither: 0x08 },
      { op: 0xb9, hl: 0x4fff, n: 0x20, neither: 0x08 },
    ];
    const explain = (/** @type {ReturnType<typeof step>} */ ctx, /** @type {import('./known.js').StepClass[]} */ classes) => explainStep(ctx, diffStep(ctx), classes);
    for (const { op, hl, n, neither } of cases) {
      const what = `ED ${op.toString(16).toUpperCase()}`;
      // xtrs's bits as they were (trsjs's rule) or matching neither rule: a divergence against xtrs.
      for (const theirs of [0x00, neither]) {
        const ctx = step(op, hl, theirs);
        expect(explain(ctx, XTRS_STEP), `${what}, xtrs ${theirs}`).toEqual({ classes: [], unexplained: [...diffStep(ctx)] });
      }
      // trsjs's bits from n (xtrs's rule) or matching neither: never its block class (its general
      // flag 3 and 5 class, which ZEXALL's evidence gives it alone, counts them instead).
      for (const theirs of [n, neither]) {
        expect(explain(step(op, hl, theirs), TRSJS_STEP), `${what}, trsjs ${theirs}`).toEqual({ classes: [name('xy')], unexplained: [] });
      }
      // Each reference on its own rule: its own block class.
      expect(explain(step(op, hl, n), XTRS_STEP), `${what}, xtrs n`).toEqual({ classes: [name('block-xy-n')], unexplained: [] });
      expect(explain(step(op, hl, 0x00), TRSJS_STEP), `${what}, trsjs kept`).toEqual({ classes: [name('block-xy-keep')], unexplained: [] });
    }
    // An LDIR or LDDR step of the reference that wrote nothing has no byte moved to take n from.
    for (const { op, hl, n } of cases.slice(0, 2)) {
      const ctx = step(op, hl, n);
      ctx.theirs.writes = [];
      expect(STEP_CLASSES.find((c) => c.id === 'block-xy-n').explains(ctx, diffStep(ctx)), `ED ${op.toString(16).toUpperCase()}, no write`).toBeNull();
    }
  });

  it('SCF and CCF\'s flags 3 and 5: only for SCF and CCF, only as Q gives them on ours and the reference\'s own rule on theirs', () => {
    const at = (bytes, { f, a = 0x00, fBefore, q, theirs }) => {
      const ctx = stepCtx(bytes, [], []);
      ctx.ours.regs = { ...ctx.ours.regs, f, a };
      ctx.ours.fBefore = fBefore;
      ctx.ours.q = q;
      ctx.theirs.regs = { ...ctx.ours.regs, f: theirs };
      return ctx;
    };
    const f35 = new Set(['f.5', 'f.3']);
    // Each asked about the bits that differ between the two sides.
    const byA = (ctx) => STEP_CLASSES.find((c) => c.id === 'scf-ccf-a').explains(ctx, diffStep(ctx));
    const kept = (ctx) => STEP_CLASSES.find((c) => c.id === 'scf-ccf-keep').explains(ctx, diffStep(ctx));
    // After an instruction that left the flags alone (q 28H): ours keeps F's bits 3 and 5 and adds
    // A's; xtrs takes A's alone (00H here), trsjs keeps F's (28H).
    for (const op of [[0x37], [0x3f], [0xdd, 0x37], [0xfd, 0x3f]]) {
      expect(byA(at(op, { f: 0x29, fBefore: 0x28, q: 0x28, theirs: 0x01 })), op.join()).toEqual(['f.5', 'f.3']);
    }
    expect(byA(at([0x37], { f: 0x29, fBefore: 0x20, a: 0x08, q: 0x28, theirs: 0x09 }))).toEqual(['f.5']);
    expect(kept(at([0x37], { f: 0x29, fBefore: 0x20, a: 0x08, q: 0x28, theirs: 0x21 }))).toEqual(['f.3']);
    // After one that set them (q 0): ours A's alone; trsjs still keeps F's.
    expect(kept(at([0x37], { f: 0x01, fBefore: 0x28, q: 0, theirs: 0x29 }))).toEqual(['f.5', 'f.3']);
    // Ours off the rule either way, or another instruction (CPL): not explained.
    expect(byA(at([0x37], { f: 0x01, fBefore: 0x28, q: 0x28, theirs: 0x29 }))).toBeNull();
    expect(kept(at([0x37], { f: 0x29, fBefore: 0x28, q: 0, theirs: 0x01 }))).toBeNull();
    expect(byA(at([0x2f], { f: 0x29, fBefore: 0x28, q: 0x28, theirs: 0x01 }))).toBeNull();
    // The reference off its own rule: not explained by its class (a Q bug of ours that a
    // reference shared would not show; one it does not share is a divergence).
    expect(byA(at([0x37], { f: 0x29, fBefore: 0x28, a: 0x00, q: 0x28, theirs: 0x09 }))).toBeNull(); // xtrs's not A's
    expect(kept(at([0x37], { f: 0x29, fBefore: 0x28, a: 0x00, q: 0x28, theirs: 0x01 }))).toBeNull(); // trsjs's not F's
    // Counted under the reference's class, not also under trsjs's general flags 3 and 5.
    expect(explainStep(at([0x37], { f: 0x01, fBefore: 0x28, q: 0, theirs: 0x29 }), f35, TRSJS_STEP)).toEqual({ classes: [name('scf-ccf-keep')], unexplained: [] });
    expect(explainStep(at([0x37], { f: 0x29, fBefore: 0x28, q: 0x28, theirs: 0x01 }), f35, XTRS_STEP)).toEqual({ classes: [name('scf-ccf-a')], unexplained: [] });
  });

  it('BIT n,(HL) and BIT n,(IX+d)\'s flags 3 and 5: only for those, ours from MEMPTR\'s high byte, the reference\'s clear', () => {
    const at = (bytes, { f, wz, theirs }) => {
      const ctx = stepCtx(bytes, [], []);
      ctx.ours.regs = { ...ctx.ours.regs, f };
      ctx.ours.wz = wz;
      ctx.theirs.regs = { ...ctx.ours.regs, f: theirs };
      return ctx;
    };
    const f35 = new Set(['f.5', 'f.3']);
    const bit = (ctx) => STEP_CLASSES.find((c) => c.id === 'bit-mem-xy').explains(ctx, f35);
    // BIT 0,(HL), BIT 7,(HL), BIT 2,(IX+5), BIT 4,(IY-1): MEMPTR $28xx shows 28H.
    for (const op of [[0xcb, 0x46], [0xcb, 0x7e], [0xdd, 0xcb, 0x05, 0x56], [0xfd, 0xcb, 0xff, 0x66]]) {
      expect(bit(at(op, { f: 0x38, wz: 0x2812, theirs: 0x10 })), op.join()).toEqual(['f.5', 'f.3']);
    }
    // BIT n,r, the DD CB d form with low bits 0 (xtrs takes those from the byte), SET n,(HL): not this class.
    expect(bit(at([0xcb, 0x47], { f: 0x38, wz: 0x2812, theirs: 0x10 }))).toBeNull();
    expect(bit(at([0xdd, 0xcb, 0x05, 0x50], { f: 0x38, wz: 0x2812, theirs: 0x10 }))).toBeNull();
    expect(bit(at([0xcb, 0xc6], { f: 0x38, wz: 0x2812, theirs: 0x10 }))).toBeNull();
    // Ours not MEMPTR's, or the reference's not clear: not explained.
    expect(bit(at([0xcb, 0x46], { f: 0x38, wz: 0x0812, theirs: 0x10 }))).toBeNull();
    expect(bit(at([0xcb, 0x46], { f: 0x38, wz: 0x2812, theirs: 0x18 }))).toBeNull();
    // xtrs counts it; its everyday class, so `strict: true` passes it by.
    expect(explainStep(at([0xcb, 0x46], { f: 0x38, wz: 0x2812, theirs: 0x10 }), f35, XTRS_STEP)).toEqual({ classes: [name('bit-mem-xy')], unexplained: [] });
    expect(COMMON_CLASSES).toEqual(new Set([name('xy'), name('bit-mem-xy')]));
  });

  it('each reference declares its own classes, and a class it does not declare explains nothing', () => {
    // Pinned, so a declaration that widens shows here: trsjs keeps every class it had; xtrs the five
    // it was found to need; MAME only its video read.
    expect([...TRSJS_CLASSES].sort()).toEqual(['bit', 'block-xy-keep', 'cpi-c', 'ddcb-r', 'dropped-prefix', 'ex-sp-order', 'halt-push', 'held-di', 'held-ei', 'held-prefix', 'irq-r', 'scf-ccf-keep', 'xy']);
    expect([...XTRS_CLASSES].sort()).toEqual(['bit-mem-xy', 'block-xy-n', 'ex-sp-order', 'io-cycles', 'scf-ccf-a']);
    expect([...MAME_CLASSES]).toEqual(['video-read-gate']);
    expect(MAME_STEP).toEqual([]);
    // An OR A whose flags 3 and 5 differ (any instruction): trsjs's general class, nobody else's.
    const or = stepCtx([0xb7], [], []);
    const f35 = new Set(['f.5', 'f.3']);
    expect(explainStep(or, f35, TRSJS_STEP)).toEqual({ classes: [name('xy')], unexplained: [] });
    expect(explainStep(or, f35, XTRS_STEP)).toEqual({ classes: [], unexplained: ['f.5', 'f.3'] });
    expect(explainStep(or, f35, MAME_STEP)).toEqual({ classes: [], unexplained: ['f.5', 'f.3'] });
    // A missing or misspelt declaration is refused.
    expect(() => declaredClasses(undefined, 'a reference')).toThrow('a reference declares no known classes (Reference.classes): a reference names the ones it needs (known.js), each with its evidence, or an empty set');
    expect(() => declaredClasses(new Set(['xy', 'flags-xy']), 'a reference')).toThrow('a reference declares the known class flags-xy, which known.js does not have');
  });

  it('IN and block I/O cycles: one T-state more on ours, only for those instructions, no interrupt in the step', () => {
    const io = (bytes, ours, theirs, irq = false) => {
      const ctx = stepCtx(bytes, [], []);
      ctx.ours.cycles = ours;
      ctx.theirs.cycles = theirs;
      ctx.ours.irq = ctx.theirs.irq = irq;
      return STEP_CLASSES.find((c) => c.id === 'io-cycles').explains(ctx, new Set(['cycles']));
    };
    expect(io([0xdb, 0xff], 11, 10)).toEqual(['cycles']);
    for (const op of [0x40, 0x48, 0x50, 0x58, 0x60, 0x68, 0x70, 0x78]) expect(io([0xed, op], 12, 11), op.toString(16)).toEqual(['cycles']);
    for (const op of [0xa2, 0xaa, 0xb2, 0xba, 0xa3, 0xab, 0xb3, 0xbb]) expect(io([0xed, op], 16, 15), op.toString(16)).toEqual(['cycles']);
    expect(io([0xdb, 0xff], 12, 10)).toBeNull(); // two more
    expect(io([0xdb, 0xff], 10, 11)).toBeNull(); // ours less
    expect(io([0xd3, 0xff], 12, 11)).toBeNull(); // OUT (n),A
    expect(io([0xed, 0x41], 13, 12)).toBeNull(); // OUT (C),B
    expect(io([0xed, 0xb0], 22, 21)).toBeNull(); // LDIR
    expect(io([0xdb, 0xff], 24, 23, true)).toBeNull(); // an interrupt response in the step
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
      // (0) in ours and the $28 F had in trsjs (block-xy-keep, resynced); the second 0 on both; the
      // last n = A + 0 = $28's bit 3 in ours, trsjs the 0 it was given (xy).
      program: [0x3e, 0x28, 0xb7, 0x21, 0x00, 0x50, 0x11, 0x00, 0x51, 0x01, 0x03, 0x00, 0xed, 0xb0, 0x00],
      n: 9,
      known: { [name('block-xy-keep')]: 1, [name('xy')]: 2 },
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
