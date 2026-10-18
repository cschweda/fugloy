/** The instruction trace and its collapsed view (spec §7), on synthetic ROMs. */
import { describe, expect, it } from 'vitest';
import { Machine } from '../../src/index.js';

/** A Machine over a synthetic ROM holding `code` at $0000. */
function machine(code) {
  const rom = new Uint8Array(0x3800);
  rom.set(code, 0);
  return new Machine({ roms: { level2: rom } });
}

// LD A,1 / LD B,2 / NOP / NOP / INC A / JR -3 (back to INC A)
const LOOP = [0x3e, 0x01, 0x06, 0x02, 0x00, 0x3c, 0x18, 0xfd];

describe('trace', () => {
  it('trace keeps the last depth entries', () => {
    const m = machine(LOOP);
    m.debug.trace.enable({ depth: 4 });
    m.step(6);
    const last = m.debug.trace.last(10);
    expect(last.map((e) => e.pc)).toEqual([4, 5, 6, 5]);
    expect(last[0]).toEqual({ pc: 4, bytes: [0x00], cycles: 4 });
    expect(m.debug.trace.last(2).map((e) => e.pc)).toEqual([6, 5]);
    expect(last[2]).toEqual({ pc: 6, bytes: [0x18, 0xfd], cycles: 12 });
    expect(m.debug.trace.enabled).toBe(true);
  });

  it('trace refuses an unlimited or out-of-range depth', () => {
    const m = machine(LOOP);
    for (const depth of [undefined, 0, -1, 1.5, Infinity, 1000001, '5'])
      expect(() => m.debug.trace.enable({ depth })).toThrow(/depth/);
    expect(() => m.debug.trace.enable({ depth: 1000000 })).not.toThrow();
  });

  it('trace records regs only when asked', () => {
    const m = machine(LOOP);
    m.debug.trace.enable({ depth: 8 });
    m.step(2);
    expect(m.debug.trace.last(2).every((e) => !('regs' in e))).toBe(true);
    m.debug.trace.enable({ depth: 8, regs: true });
    m.step(1);
    const [e] = m.debug.trace.last(1);
    expect(e.regs.pc).toBe(4);
    expect(e.regs.a).toBe(1);
    expect(e.regs.b).toBe(2);
    // A copy each time: changing it changes nothing recorded.
    e.regs.a = 0x55;
    expect(m.debug.trace.last(1)[0].regs.a).toBe(1);
  });

  it('runs entries under run, skips a breakpoint stop, and does not instrument memory', () => {
    const m = machine(LOOP);
    m.debug.trace.enable({ depth: 100 });
    expect(m.debug.tracksAccess).toBe(false);
    m.debug.break(4);
    expect(m.run({ cycles: 1000 }).reason).toBe('break');
    expect(m.debug.trace.last(100).map((e) => e.pc)).toEqual([0, 2]);
    m.debug.trace.disable();
    m.step(3);
    expect(m.debug.trace.last(100).length).toBe(2); // kept, not growing
    m.debug.trace.clear();
    expect(m.debug.trace.last(100)).toEqual([]);
  });

  it('halted idling leaves no entry', () => {
    const m = machine([0x76]);
    m.debug.trace.enable({ depth: 10 });
    m.step(5);
    expect(m.debug.trace.last(10).map((e) => e.pc)).toEqual([0]);
  });
});

describe('trace.collapsed', () => {
  it('collapsed merges a two-instruction loop', () => {
    // 3 lead-ins, then INC A / JR -3 repeated.
    const m = machine([0x00, 0x00, 0x00, 0x3c, 0x18, 0xfd]);
    m.debug.trace.enable({ depth: 200 });
    m.step(3 + 100);
    const c = m.debug.trace.collapsed(200);
    expect(c.map((x) => x.repeat)).toEqual([1, 1, 1, 50]);
    expect(c[3].entries.map((e) => e.pc)).toEqual([3, 4]);
    expect(c[0].entries.length).toBe(1);
  });

  it('collapsed leaves a non-repeating trace alone', () => {
    const m = machine([0x00, 0x3c, 0x04, 0x05, 0x0c]);
    m.debug.trace.enable({ depth: 10 });
    m.step(5);
    const c = m.debug.trace.collapsed(10);
    expect(c.length).toBe(5);
    expect(c.every((x) => x.repeat === 1 && x.entries.length === 1)).toBe(true);
  });
});
