/**
 * Breakpoints and the stop signal (spec §7): a tiny loop in a synthetic ROM, stopped before the
 * instruction at an address, resumed past it, gated, counted, and ignored by `step`.
 */
import { describe, expect, it } from 'vitest';
import { Machine } from '../../src/index.js';

// LD A,0 / loop: INC A ($0002, 4 T) / INC B ($0003, 4 T) / JR $0002 ($0004, 12 T)
const LOOP = [0x3e, 0x00, 0x3c, 0x04, 0x18, 0xfc];
const LOOP_TRIP = 4 + 4 + 12;

function machine() {
  const rom = new Uint8Array(0x3800);
  rom.set(LOOP, 0);
  return new Machine({ roms: { level2: rom } });
}

describe('breakpoints', () => {
  it('stops before the instruction at the breakpoint', () => {
    const m = machine();
    const id = m.debug.break(0x0003);
    const r = m.run({ cycles: 1e6 });
    expect(r).toEqual({ reason: 'break', id, cycles: 11 });
    expect(m.cpu.regs.pc).toBe(0x0003);
    expect(m.cpu.regs.a).toBe(1); // INC A ran
    expect(m.cpu.regs.b).toBe(0); // INC B has not
  });

  it('resumes past the breakpoint it stopped at', () => {
    const m = machine();
    const id = m.debug.break(0x0003);
    m.run({ cycles: 1e6 });
    const r = m.run({ cycles: 1e6 });
    expect(r).toEqual({ reason: 'break', id, cycles: LOOP_TRIP });
    expect(m.cpu.regs.pc).toBe(0x0003);
    expect(m.cpu.regs.b).toBe(1);
  });

  it('once removes the breakpoint after its hit', () => {
    const m = machine();
    m.debug.break(0x0003, { once: true });
    expect(m.run({ cycles: 1e6 }).reason).toBe('break');
    expect(m.debug.breaks).toEqual([]);
    expect(m.debug.active).toBe(false);
    expect(m.run({ cycles: 1000 }).reason).toBe('cycles');
  });

  it('when gates the hit', () => {
    const m = machine();
    let calls = 0;
    m.debug.break(0x0003, { when: () => ++calls === 3 });
    const r = m.run({ cycles: 1e6 });
    expect(r.reason).toBe('break');
    expect(calls).toBe(3);
    expect(m.cpu.regs.a).toBe(3);
    expect(m.debug.breaks[0].hits).toBe(1);
  });

  it('unbreak returns false for an unknown id', () => {
    const m = machine();
    const id = m.debug.break(0x0003);
    expect(m.debug.unbreak(99)).toBe(false);
    expect(m.debug.unbreak(id)).toBe(true);
    expect(m.debug.unbreak(id)).toBe(false);
    expect(m.debug.active).toBe(false);
  });

  it('breaks counts hits', () => {
    const m = machine();
    const id = m.debug.break(0x0003);
    for (let k = 0; k < 3; k++) m.run({ cycles: 1e6 });
    expect(m.debug.breaks).toEqual([{ id, addr: 0x0003, once: false, hits: 3 }]);
  });

  it('numbers breakpoints from 1 and keeps them in id order', () => {
    const m = machine();
    expect(m.debug.break(0x0004)).toBe(1);
    expect(m.debug.break(0x0002)).toBe(2);
    expect(m.debug.breaks.map((b) => b.id)).toEqual([1, 2]);
  });

  it('step ignores breakpoints', () => {
    const m = machine();
    m.debug.break(0x0003);
    const r = m.step(10);
    expect(r.cycles).toBeGreaterThan(0);
    expect(m.debug.breaks[0].hits).toBe(0);
  });

  it('a breakpoint and the cycle budget at the same boundary: break wins', () => {
    const m = machine();
    const id = m.debug.break(0x0003);
    // LD A,0 (7) + INC A (4) spend exactly 11 T-states, landing on the boundary at $0003
    expect(m.run({ cycles: 11 })).toEqual({ reason: 'break', id, cycles: 11 });
    expect(m.cpu.regs.pc).toBe(0x0003);
  });

  it('rejects an address outside 0..FFFF', () => {
    const m = machine();
    for (const bad of [-1, 0x10000, 1.5, NaN, '3']) expect(() => m.debug.break(bad)).toThrow(/address/);
  });
});
