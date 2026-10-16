/**
 * DD and FD prefixes the next byte does not use (Young, "The Undocumented Z80 Documented" §3.6).
 * Before another DD, FD, or ED, the prefix is a 4-T-state no-op with one R count; the next byte
 * starts the opcode, with no interrupt taken in between. Before EX DE,HL or EXX it is ignored.
 */
import { describe, expect, it } from 'vitest';
import { bare } from './bare.js';

/** Runs instructions until PC reaches `end`, at most 4; returns the T-states they took. */
function runTo(cpu, end) {
  const start = cpu.cycles;
  for (let n = 0; cpu.registers.PC !== end; n++) {
    if (n === 4) throw new Error(`PC is ${cpu.registers.PC.toString(16)}, not ${end.toString(16)}, after 4 steps`);
    cpu.executeInstruction();
  }
  return cpu.cycles - start;
}

describe('a prefix before another prefix or ED', () => {
  it('DD DD 21 nn loads IX; the first DD costs 4 T-states and one R count', () => {
    const { cpu } = bare([0xdd, 0xdd, 0x21, 0x34, 0x12], (c) => { c.registers.R = 0; });
    expect(runTo(cpu, 0x105)).toBe(18);
    expect([cpu.IX, cpu.HL, cpu.registers.R]).toEqual([0x1234, 0x0000, 3]);
  });

  it('DD FD 21 nn loads IY: the last prefix counts', () => {
    const { cpu } = bare([0xdd, 0xfd, 0x21, 0x34, 0x12], (c) => { c.registers.R = 0; });
    expect(runTo(cpu, 0x105)).toBe(18);
    expect([cpu.IY, cpu.IX, cpu.registers.R]).toEqual([0x1234, 0x0000, 3]);
  });

  it('FD ED A0 is LDI through HL, not IY', () => {
    const { cpu, mem } = bare([0xfd, 0xed, 0xa0], (c, m) => {
      c.HL = 0x3000;
      c.DE = 0x4000;
      c.BC = 1;
      c.IY = 0x5000;
      c.registers.R = 0;
      m[0x3000] = 0xab;
      m[0x5000] = 0xcd;
    });
    expect(runTo(cpu, 0x103)).toBe(20);
    expect([mem[0x4000], cpu.HL, cpu.IY, cpu.registers.R]).toEqual([0xab, 0x3001, 0x5000, 3]);
  });

  it('takes no interrupt between the lone prefix and the instruction it leads into', () => {
    const { cpu } = bare([0xdd, 0xdd, 0x21, 0x34, 0x12], (c) => {
      c.IFF1 = true;
      c.IFF2 = true;
      c.interruptMode = 1;
    });
    cpu.executeInstruction(); // the first DD, alone
    expect(cpu.interrupt()).toBe(false);
    cpu.executeInstruction(); // DD 21 34 12
    expect(cpu.registers.PC).toBe(0x105);
    expect(cpu.interrupt()).toBe(true);
    expect(cpu.registers.PC).toBe(0x0038);
  });

  it('runs a long string of DDs one prefix per step', () => {
    const { cpu } = bare(new Array(1000).fill(0xdd));
    expect(runTo(cpu, 0x101)).toBe(4);
  });
});

describe('a prefix before EX DE,HL or EXX', () => {
  it('DD EB exchanges DE and HL and leaves IX alone', () => {
    const { cpu } = bare([0xdd, 0xeb], (c) => {
      c.DE = 0x1122;
      c.HL = 0x3344;
      c.IX = 0x5566;
    });
    expect(runTo(cpu, 0x102)).toBe(8);
    expect([cpu.DE, cpu.HL, cpu.IX]).toEqual([0x3344, 0x1122, 0x5566]);
  });

  it('FD D9 exchanges BC, DE, HL with their shadows and leaves IY alone', () => {
    const { cpu } = bare([0xfd, 0xd9], (c) => {
      c.HL = 0x3344;
      c.registers.H_ = 0x77;
      c.registers.L_ = 0x88;
      c.IY = 0x5566;
    });
    expect(runTo(cpu, 0x102)).toBe(8);
    expect([cpu.HL, cpu.registers.H_, cpu.registers.L_, cpu.IY]).toEqual([0x7788, 0x33, 0x44, 0x5566]);
  });
});
