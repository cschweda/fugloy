/**
 * Breakpoints and the stop signal (spec §7): a tiny loop in a synthetic ROM, stopped before the
 * instruction at an address, resumed past it, gated, counted, and ignored by `step`.
 */
import { describe, expect, it } from 'vitest';
import { Machine, RTC_INTERVAL_TSTATES } from '../../src/index.js';

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
    expect(r).toEqual({ cycles: 7 + 4 + 4 + 12 + 4 + 4 + 12 + 4 + 4 + 12, halted: false });
    expect(r).not.toHaveProperty('reason');
    expect(m.cpu.regs.b).toBe(3); // crossed $0003 three times
    expect(m.debug.breaks[0].hits).toBe(0);
  });

  it('a budget that ends at the breakpoint boundary returns cycles; the next run stops there with 0 cycles', () => {
    const m = machine();
    const id = m.debug.break(0x0003);
    // LD A,0 (7) + INC A (4) spend exactly 11 T-states, landing on the boundary at $0003
    expect(m.run({ cycles: 11 })).toEqual({ reason: 'cycles', cycles: 11 });
    expect(m.cpu.regs.pc).toBe(0x0003);
    expect(m.debug.breaks[0].hits).toBe(0);
    expect(m.run({ cycles: 1e6 })).toEqual({ reason: 'break', id, cycles: 0 });
    expect(m.debug.breaks[0].hits).toBe(1);
  });

  it('a break at the first boundary returns cycles: 0, then the next run executes past it', () => {
    const m = machine();
    const id = m.debug.break(0x0000);
    expect(m.run({ cycles: 0 })).toEqual({ reason: 'break', id, cycles: 0 });
    expect(m.run({ cycles: 0 })).toEqual({ reason: 'cycles', cycles: 7 });
    expect(m.debug.breaks[0].hits).toBe(1);
  });

  it('step and run called from a when or until callback throw', () => {
    const m = machine();
    m.debug.break(0x0003, { when: () => m.step() });
    expect(() => m.run({ cycles: 1e6 })).toThrow(/already running/);
    const n = machine();
    expect(() => n.run({ until: () => n.run({ cycles: 1 }) })).toThrow(/already running/);
    expect(n.step().cycles).toBe(4); // usable afterwards (INC A)
  });

  it('rejects an address outside 0..FFFF', () => {
    const m = machine();
    for (const bad of [-1, 0x10000, 1.5, NaN, '3']) expect(() => m.debug.break(bad)).toThrow(/address/);
  });
});

// An RTC-enabled ROM: LD A,4 / OUT (E0H),A / IM 1 / LD SP,8000H / EI, then `body` at $000A. The
// ISR at $0038 reads the RTC status port, restores AF, EI, RET.
function rtcMachine(body) {
  const rom = new Uint8Array(0x3800);
  rom.set([0x3e, 0x04, 0xd3, 0xe0, 0xed, 0x56, 0x31, 0x00, 0x80, 0xfb, ...body], 0);
  rom.set([0xf5, 0xdb, 0xec, 0xf1, 0xfb, 0xc9], 0x38);
  return new Machine({ roms: { level2: rom } });
}

describe('breakpoints with interrupts and HALT', () => {
  const LIMIT = RTC_INTERVAL_TSTATES + 5000;

  /** Break stops (absolute T-state and C) up to LIMIT when a session is cut into runs of `chunk` T-states. */
  function session(chunk) {
    const m = rtcMachine([0x0c, 0x18, 0xfd]); // INC C / JR $000A (break at the INC)
    m.debug.break(0x000a);
    const stops = [];
    while (m.cycles < LIMIT + 100) {
      const r = m.run({ cycles: chunk });
      if (r.reason === 'break') stops.push([m.cycles, m.cpu.regs.pc, m.cpu.regs.c]);
    }
    return stops.filter(([at]) => at <= LIMIT);
  }

  it('hit counts and stop points do not depend on how a session is split into runs', () => {
    const whole = session(1e9);
    expect(whole.length).toBeGreaterThan(1000); // past an RTC interrupt: the loop ran across it
    for (const chunk of [1, 7, 16, 37, 1001]) expect(session(chunk)).toEqual(whole);
  });

  it('after a break stop the next run executes the breakpointed instruction', () => {
    const m = rtcMachine([0x0c, 0x18, 0xfd]);
    m.debug.break(0x000a);
    m.run({ cycles: 1e6 });
    expect(m.cpu.regs.c).toBe(0);
    m.run({ cycles: 1e6 });
    expect(m.cpu.regs.c).toBe(1);
  });

  it('a breakpoint at HALT+1 stops only after the interrupt returns, not every idle boundary', () => {
    const m = rtcMachine([0x76, 0x18, 0xfd]); // HALT at $000A, JR at $000B (break), back to HALT
    const id = m.debug.break(0x000b);
    for (let k = 1; k <= 2; k++) {
      const r = m.run({ cycles: 1e7 });
      expect(r).toMatchObject({ reason: 'break', id });
      expect(r.cycles).toBeGreaterThan(RTC_INTERVAL_TSTATES / 2);
      expect(m.cpu.regs.pc).toBe(0x000b);
      expect(m.system.cpu.halted).toBe(false);
      expect(m.debug.breaks[0].hits).toBe(k);
    }
  });
});
