/**
 * The order of an instruction's memory writes on the bus. Two writes of the same bytes in another
 * order leave memory the same, but a write-logging differential (emu phase 7) or a device that
 * watches the bus sees the order, so the core follows the Z80's.
 *
 * EX (SP),HL takes 19 T-states as (4, 3, 4, 3, 5) (Zilog UM0080, UM008011-0816, p. 127): opcode
 * fetch, read (SP), read (SP+1), then two writes. The first write is (SP+1) ← H and the second
 * (SP) ← L: MAME 0.289's z80.lst, `macro ex_sp` (`@pop`, then `@wm16_sp`, which writes the high
 * byte at SP-1 before the low byte at SP-2 of the popped SP), and floooh/chips z80.h (commit
 * 9e88298), a cycle-stepped core whose EX (SP),HL steps are `_mwrite(cpu->sp+1, …h)` at its step 8
 * and `_mwrite(cpu->sp, …l)` at its step 11. The DD and FD forms run the same machine cycles.
 */
import { describe, expect, it } from 'vitest';
import { bare } from './bare.js';

/** Run `bytes` at 0100H with SP 8000H holding 3412H, logging every write. */
function writesOf(bytes) {
  /** @type {[number, number][]} */
  const log = [];
  const { cpu, mem } = bare(bytes, (c, m) => {
    c.registers.SP = 0x8000;
    m[0x8000] = 0x12;
    m[0x8001] = 0x34;
    c.HL = 0xa1b2;
    c.IX = 0xc3d4;
    c.IY = 0xe5f6;
    const write = c.writeMemory;
    c.writeMemory = (a, v) => {
      log.push([a & 0xffff, v & 0xff]);
      write(a, v);
    };
  });
  cpu.executeInstruction();
  return { log, cpu, mem };
}

describe('EX (SP),rr writes (SP+1) first, then (SP), as the Z80 does', () => {
  it('EX (SP),HL: H to SP+1, then L to SP; HL takes the stack word', () => {
    const { log, cpu } = writesOf([0xe3]);
    expect(log).toEqual([[0x8001, 0xa1], [0x8000, 0xb2]]);
    expect(cpu.HL).toBe(0x3412);
  });

  it('EX (SP),IX and EX (SP),IY: the same order', () => {
    const ix = writesOf([0xdd, 0xe3]);
    expect(ix.log).toEqual([[0x8001, 0xc3], [0x8000, 0xd4]]);
    expect(ix.cpu.IX).toBe(0x3412);
    const iy = writesOf([0xfd, 0xe3]);
    expect(iy.log).toEqual([[0x8001, 0xe5], [0x8000, 0xf6]]);
    expect(iy.cpu.IY).toBe(0x3412);
  });

  it('PUSH writes the high byte first too (unchanged)', () => {
    const { log } = writesOf([0xe5]);
    expect(log).toEqual([[0x7fff, 0xa1], [0x7ffe, 0xb2]]);
  });
});
