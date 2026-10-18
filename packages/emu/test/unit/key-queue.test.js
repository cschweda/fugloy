/**
 * m.keyboard on synthetic ROMs: the cycle-timed matrix queue (timing, pending, key names) and the
 * ROM keyboard-scan hook at $002B and $0049 (spec §6), whose return contract is checked register
 * by register.
 */
import { describe, expect, it } from 'vitest';
import { CPU_CLOCK_HZ, Machine } from '../../src/index.js';

/** A 14K ROM with `bytes` at $0000 (and `at` maps more addresses to bytes). */
function romWith(bytes, at = {}) {
  const rom = new Uint8Array(0x3800);
  rom.set(bytes, 0);
  for (const [addr, more] of Object.entries(at)) rom.set(more, Number(addr));
  return rom;
}

const machine = (bytes, at) => new Machine({ roms: { level2: romWith(bytes, at) } });
const JR_SELF = [0x18, 0xfe]; // a 12-T-state loop

/** Runs `m` for `cycles`, returning each change of the matrix rows as { at, rows }. */
function matrixChanges(m, cycles) {
  const rows = m.system.keyboard.rows;
  let last = '';
  const changes = [];
  const end = m.cycles + cycles;
  m.run({
    until: (mm) => {
      // The predicate runs after each instruction; the queue drained before it, so stamp the
      // change with the instruction's start, the boundary where the queue applied it.
      const now = Array.from(rows).join(',');
      if (now !== last) changes.push({ at: mm.cycles - 12, rows: Array.from(rows) });
      last = now;
      return mm.cycles >= end;
    },
  });
  return changes;
}

const bit = (row, b) => {
  const rows = new Array(8).fill(0);
  rows[row] |= 1 << b;
  return rows;
};

describe('m.keyboard matrix queue', () => {
  it("type('AB', { cps: 10 }) presses A at cycle 0, releases it, then presses B a tenth of a second later", () => {
    const m = machine(JR_SELF);
    m.keyboard.type('AB', { cps: 10 });
    const period = CPU_CLOCK_HZ / 10;
    const changes = matrixChanges(m, 2 * period + 100);
    expect(changes.map((c) => c.rows)).toEqual([bit(0, 1), new Array(8).fill(0), bit(0, 2), new Array(8).fill(0)]);
    const [aDown, aUp, bDown, bUp] = changes.map((c) => c.at);
    expect(aDown).toBe(0);
    expect(aUp).toBeLessThan(bDown);
    expect(Math.abs(bDown - period)).toBeLessThan(12);
    expect(Math.abs(aUp - period / 2)).toBeLessThan(12);
    expect(bUp).toBeGreaterThan(bDown);
  });

  it('presses a repeated letter twice, with a key-up gap between', () => {
    const m = machine(JR_SELF);
    m.keyboard.type('AA', { cps: 20 });
    const changes = matrixChanges(m, CPU_CLOCK_HZ / 10 + 100);
    expect(changes.map((c) => c.rows)).toEqual([bit(0, 1), new Array(8).fill(0), bit(0, 1), new Array(8).fill(0)]);
  });

  it('presses SHIFT with a shifted character, and not with a capital (an unshifted Model III letter key)', () => {
    const m = machine(JR_SELF);
    m.keyboard.type('"a');
    const changes = matrixChanges(m, CPU_CLOCK_HZ / 5 + 100);
    const quote = bit(4, 2);
    quote[7] = 1;
    const lower = bit(0, 1);
    lower[7] = 1;
    expect(changes.map((c) => c.rows)).toEqual([quote, new Array(8).fill(0), lower, new Array(8).fill(0)]);
  });

  it('starts new typing when the queued typing ends', () => {
    const m = machine(JR_SELF);
    m.keyboard.type('A', { cps: 10 });
    m.keyboard.type('B', { cps: 10 });
    const changes = matrixChanges(m, CPU_CLOCK_HZ / 5 + 100);
    expect(Math.abs(changes[2].at - CPU_CLOCK_HZ / 10)).toBeLessThan(12);
    expect(changes[2].rows).toEqual(bit(0, 2));
  });

  it('pending counts the undelivered presses and releases down to 0', () => {
    const m = machine(JR_SELF);
    m.keyboard.type('AB', { cps: 10 });
    expect(m.keyboard.pending).toBe(4);
    m.step();
    expect(m.keyboard.pending).toBe(3);
    m.run({ cycles: CPU_CLOCK_HZ / 20 + 100 });
    expect(m.keyboard.pending).toBe(2);
    m.run({ cycles: CPU_CLOCK_HZ / 20 });
    expect(m.keyboard.pending).toBe(1);
    m.run({ cycles: CPU_CLOCK_HZ / 20 });
    expect(m.keyboard.pending).toBe(0);
    expect(Array.from(m.system.keyboard.rows)).toEqual(new Array(8).fill(0));
  });

  it.each([
    ['ENTER', 6, 0],
    ['CLEAR', 6, 1],
    ['BREAK', 6, 2],
    ['UP', 6, 3],
    ['DOWN', 6, 4],
    ['LEFT', 6, 5],
    ['RIGHT', 6, 6],
    ['SPACE', 6, 7],
    [' ', 6, 7],
    ['SHIFT', 7, 0],
    ['A', 0, 1],
    ['@', 0, 0],
    ['Z', 3, 2],
    ['1', 4, 1],
    ['9', 5, 1],
    ['/', 5, 7],
  ])('press(%j) holds row %i bit %i until release', (key, row, b) => {
    const m = machine(JR_SELF);
    m.keyboard.press(key);
    expect(Array.from(m.system.keyboard.rows)).toEqual(bit(row, b));
    m.keyboard.release(key);
    expect(Array.from(m.system.keyboard.rows)).toEqual(new Array(8).fill(0));
  });

  it('rejects keys with no matrix position and bad options', () => {
    const m = machine(JR_SELF);
    expect(() => m.keyboard.press('ESCAPE')).toThrow(/no matrix key/);
    expect(() => m.keyboard.type('A~')).toThrow(/no matrix key/);
    expect(() => m.keyboard.type('A', { cps: 0 })).toThrow(/cps/);
    expect(() => m.keyboard.type('A', { mode: 'fast' })).toThrow(/mode/);
    expect(m.keyboard.pending).toBe(0);
  });

  it('reset drops the queue', () => {
    const m = machine(JR_SELF);
    m.keyboard.type('AB');
    m.keyboard.feed('C');
    m.reset();
    expect(m.keyboard.pending).toBe(0);
  });
});

/*
 * The hook ROM: LD SP,8000H / LD BC,1234H / LD HL,5678H / LD IX,9ABCH / LD IY,DEF0H /
 * LD DE,1111H / CALL 0049H / HALT, with $0049 a ROM stand-in that returns 0 with DE = $4015
 * (LD DE,4015H / XOR A / RET) when the hook does not intercept. CALL 0049H is at $0013 and
 * returns to $0016. The same at $002B.
 */
const PROLOGUE = [0x31, 0x00, 0x80, 0x01, 0x34, 0x12, 0x21, 0x78, 0x56, 0xdd, 0x21, 0xbc, 0x9a, 0xfd, 0x21, 0xf0, 0xde, 0x11, 0x11, 0x11];
const STANDIN = [0x11, 0x15, 0x40, 0xaf, 0xc9];
const hookRom = (entry) => [...PROLOGUE, 0xcd, entry, 0x00, 0x76];
const hookMachine = (entry) => machine(hookRom(entry), { 0x2b: STANDIN, 0x49: STANDIN });
const RETURN_AT = PROLOGUE.length + 3;

describe('m.keyboard ROM keyboard-scan hook', () => {
  it.each([
    // $0049 returns after OR A: S Z 5 3 P from A, H N C clear.
    [0x49, 'X', 0x58, 0x08],
    [0x49, 'A', 0x41, 0x04],
    [0x49, '\n', 0x0d, 0x08],
    // $002B returns after CP 01H at $3100: N set, H when A's low nibble is 0, 5 and 3 from the operand.
    [0x2b, 'X', 0x58, 0x02],
    [0x2b, 'P', 0x50, 0x12],
    [0x2b, '\n', 0x0d, 0x02],
  ])('at $%s returns %j as A=%i, F=%i, DE=$4015, BC HL IX IY kept, the call popped', (entry, ch, a, f) => {
    const m = hookMachine(entry);
    m.keyboard.feed(ch);
    m.run({ until: 'halt' });
    const r = m.cpu.regs;
    expect(r.a).toBe(a);
    expect(r.f).toBe(f);
    expect([r.d, r.e]).toEqual([0x40, 0x15]);
    expect([r.b, r.c, r.h, r.l, r.ix, r.iy]).toEqual([0x12, 0x34, 0x56, 0x78, 0x9abc, 0xdef0]);
    expect(r.sp).toBe(0x8000);
    expect(r.pc).toBe(RETURN_AT + 1); // past the HALT at the return address
    expect(m.keyboard.pending).toBe(0);
  });

  it('stands in for one instruction, a RET of 10 T-states, stopping at the return address', () => {
    const m = hookMachine(0x49);
    m.keyboard.feed('X');
    m.run({ until: (mm) => mm.cpu.regs.pc === 0x0049 });
    expect(m.step()).toEqual({ cycles: 10, halted: false });
    expect(m.cpu.regs.pc).toBe(RETURN_AT);
    expect(m.cpu.regs.a).toBe(0x58);
  });

  it('does not intercept with an empty buffer: the ROM routine runs', () => {
    const m = hookMachine(0x49);
    m.run({ until: 'halt' });
    expect(m.cpu.regs.a).toBe(0);
    expect(m.cpu.flags.z).toBe(true);
  });

  it('delivers each character exactly once, in order, then lets the ROM run', () => {
    // CALL 002BH three times, storing A at $8000, $8001, $8002, then HALT.
    const call = [0xcd, 0x2b, 0x00];
    const store = (addr) => [0x32, addr & 0xff, addr >> 8];
    const m = machine([0x31, 0x00, 0x90, ...call, ...store(0x8000), ...call, ...store(0x8001), ...call, ...store(0x8002), 0x76], { 0x2b: STANDIN });
    m.keyboard.feed('AA');
    expect(m.keyboard.pending).toBe(2);
    m.run({ until: 'halt' });
    expect(Array.from(m.mem.read(0x8000, 3))).toEqual([0x41, 0x41, 0x00]);
    expect(m.keyboard.pending).toBe(0);
  });

  it('leaves the matrix alone, so a program that scans $3800 directly sees nothing', () => {
    const m = machine(JR_SELF);
    m.keyboard.feed('A');
    m.run({ cycles: 1000 });
    expect(Array.from(m.system.keyboard.rows)).toEqual(new Array(8).fill(0));
    expect(m.keyboard.pending).toBe(1);
  });

  it("type(str, { mode: 'hook' }) feeds", () => {
    const m = hookMachine(0x49);
    m.keyboard.type('Q', { mode: 'hook' });
    m.run({ until: 'halt' });
    expect(m.cpu.regs.a).toBe(0x51);
  });

  it('rejects characters the ROM routine cannot return', () => {
    const m = machine(JR_SELF);
    expect(() => m.keyboard.feed('\u0000')).toThrow(/feed/);
    expect(() => m.keyboard.feed('é')).toThrow(/feed/);
  });
});
