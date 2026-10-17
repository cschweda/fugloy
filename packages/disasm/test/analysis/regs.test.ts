/** The shared register rule: what one instruction does to the values known about the registers. */
import { decodeAt } from '@fugloy/z80';
import { describe, expect, it } from 'vitest';
import { pair, stepRegs, unknownRegs } from '../../src/analysis/regs.js';
import type { RegState } from '../../src/analysis/regs.js';

/** Runs hand-assembled bytes through stepRegs from an unknown start. */
function run(bytes: number[], start: RegState = unknownRegs()): RegState {
  const r = start;
  for (let at = 0; at < bytes.length; ) {
    const ins = decodeAt(bytes, at);
    stepRegs(ins, r);
    at += ins.length;
  }
  return r;
}

describe('stepRegs', () => {
  it('LD rr,nn sets the pair', () => {
    const r = run([0x21, 0x00, 0x3c]); // LD HL,3C00H
    expect(pair(r, 'HL')).toBe(0x3c00);
    expect(r.H).toBe(0x3c);
    expect(pair(r, 'DE')).toBeNull();
  });

  it('LD IX,nn sets the IX pair and its halves', () => {
    const r = run([0xdd, 0x21, 0x34, 0x12]);
    expect(pair(r, 'IX')).toBe(0x1234);
    expect(r.IXH).toBe(0x12);
  });

  it('LD r,n and LD r,r\' set known values', () => {
    const r = run([0x3e, 0x05, 0x47]); // LD A,5 / LD B,A
    expect(r.A).toBe(5);
    expect(r.B).toBe(5);
  });

  it('LD H,3CH; LD L,0 makes HL $3C00', () => {
    expect(pair(run([0x26, 0x3c, 0x2e, 0x00]), 'HL')).toBe(0x3c00);
  });

  it('a pair is unknown while either half is', () => {
    expect(pair(run([0x26, 0x3c]), 'HL')).toBeNull();
  });

  it('LD r,r\' from an unknown register makes the target unknown', () => {
    expect(run([0x3e, 0x05, 0x78]).A).toBeNull(); // LD A,5 / LD A,B
  });

  it('LD r,(HL) and LD r,(nn) make the target unknown', () => {
    expect(run([0x3e, 0x05, 0x7e]).A).toBeNull();
    expect(run([0x3e, 0x05, 0x3a, 0x00, 0x40]).A).toBeNull();
  });

  it('XOR A makes A zero', () => {
    expect(run([0x3e, 0x05, 0xaf]).A).toBe(0);
  });

  it('other ALU ops make A unknown', () => {
    expect(run([0x3e, 0x05, 0xc6, 0x01]).A).toBeNull(); // ADD A,1
    expect(run([0x3e, 0x05, 0xe6, 0x0f]).A).toBeNull(); // AND 0FH
    expect(run([0x3e, 0x05, 0xed, 0x44]).A).toBeNull(); // NEG
    expect(run([0x3e, 0x05, 0x2f]).A).toBeNull(); // CPL
    expect(run([0x3e, 0x05, 0x07]).A).toBeNull(); // RLCA
  });

  it('CP leaves registers alone', () => {
    expect(run([0x3e, 0x05, 0xfe, 0x01]).A).toBe(5);
  });

  it('LD HL,3C00H; INC HL gives $3C01', () => {
    expect(pair(run([0x21, 0x00, 0x3c, 0x23]), 'HL')).toBe(0x3c01);
  });

  it('INC rr wraps at 16 bits and DEC rr at zero', () => {
    expect(pair(run([0x21, 0xff, 0xff, 0x23]), 'HL')).toBe(0);
    expect(pair(run([0x01, 0x00, 0x00, 0x0b]), 'BC')).toBe(0xffff);
  });

  it('LD B,0; DEC B gives $FF', () => {
    expect(run([0x06, 0x00, 0x05]).B).toBe(0xff);
  });

  it('INC of an unknown register stays unknown', () => {
    expect(run([0x04]).B).toBeNull();
    expect(pair(run([0x23]), 'HL')).toBeNull();
  });

  it('INC r wraps at 8 bits', () => {
    expect(run([0x3e, 0xff, 0x3c]).A).toBe(0);
  });

  it('LD A,5; CALL x makes everything unknown', () => {
    const r = run([0x3e, 0x05, 0x21, 0x00, 0x3c, 0xcd, 0x00, 0x40]);
    expect(Object.values(r).every((v) => v === null)).toBe(true);
  });

  it('RST makes everything unknown', () => {
    expect(run([0x3e, 0x05, 0xcf]).A).toBeNull(); // RST 08H
  });

  it('LD DE,1; EX DE,HL gives HL 1 and DE unknown', () => {
    const r = run([0x11, 0x01, 0x00, 0xeb]);
    expect(pair(r, 'HL')).toBe(1);
    expect(pair(r, 'DE')).toBeNull();
  });

  it('EX DE,HL swaps two known pairs', () => {
    const r = run([0x11, 0x01, 0x00, 0x21, 0x02, 0x00, 0xeb]);
    expect(pair(r, 'HL')).toBe(1);
    expect(pair(r, 'DE')).toBe(2);
  });

  it('POP makes the pair unknown, POP AF only A', () => {
    const r = run([0x3e, 0x05, 0x21, 0x00, 0x3c, 0xe1, 0xf1]); // POP HL / POP AF
    expect(pair(r, 'HL')).toBeNull();
    expect(r.A).toBeNull();
    expect(run([0x06, 0x01, 0xf1]).B).toBe(1);
  });

  it('RES and SET on a register make it unknown, on memory leave registers alone', () => {
    expect(run([0x3e, 0x05, 0xcb, 0x87]).A).toBeNull(); // RES 0,A
    expect(run([0x3e, 0x05, 0xcb, 0xc7]).A).toBeNull(); // SET 0,A
    expect(run([0x3e, 0x05, 0xcb, 0x86]).A).toBe(5); // RES 0,(HL)
  });

  it('rotates and shifts of a register make it unknown', () => {
    expect(run([0x06, 0x05, 0xcb, 0x00]).B).toBeNull(); // RLC B
  });

  it('EXX makes BC, DE, HL unknown and keeps A', () => {
    const r = run([0x3e, 0x05, 0x01, 0x01, 0x00, 0x11, 0x02, 0x00, 0x21, 0x03, 0x00, 0xd9]);
    expect([pair(r, 'BC'), pair(r, 'DE'), pair(r, 'HL')]).toEqual([null, null, null]);
    expect(r.A).toBe(5);
  });

  it("EX AF,AF' makes A unknown", () => {
    expect(run([0x3e, 0x05, 0x08]).A).toBeNull();
  });

  it('ADD HL,rr makes HL unknown', () => {
    expect(pair(run([0x21, 0x00, 0x3c, 0x09]), 'HL')).toBeNull();
  });

  it('LDIR and LDDR clear BC, DE, and HL', () => {
    for (const op of [0xb0, 0xb8]) {
      const r = run([0x01, 0x01, 0x00, 0x11, 0x02, 0x00, 0x21, 0x03, 0x00, 0xed, op]);
      expect([pair(r, 'BC'), pair(r, 'DE'), pair(r, 'HL')]).toEqual([null, null, null]);
    }
  });

  it('LDI changes BC, DE, HL but not A', () => {
    const r = run([0x3e, 0x05, 0x21, 0x00, 0x3c, 0xed, 0xa0]);
    expect(pair(r, 'HL')).toBeNull();
    expect(r.A).toBe(5);
  });

  it('CPIR changes BC and HL but not DE', () => {
    const r = run([0x11, 0x02, 0x00, 0x21, 0x00, 0x3c, 0xed, 0xb1]);
    expect(pair(r, 'HL')).toBeNull();
    expect(pair(r, 'DE')).toBe(2);
  });

  it('INIR changes B and HL; DJNZ only B', () => {
    const r = run([0x06, 0x03, 0x21, 0x00, 0x3c, 0xed, 0xb2]);
    expect(r.B).toBeNull();
    expect(pair(r, 'HL')).toBeNull();
    const d = run([0x06, 0x03, 0x21, 0x00, 0x3c, 0x10, 0x00]);
    expect(d.B).toBeNull();
    expect(pair(d, 'HL')).toBe(0x3c00);
  });

  it('IN r,(C) makes the register unknown', () => {
    expect(run([0x3e, 0x05, 0xdb, 0x00]).A).toBeNull(); // IN A,(0)
    expect(run([0x06, 0x05, 0xed, 0x40]).B).toBeNull(); // IN B,(C)
  });

  it('LD (HL),n and PUSH leave registers alone', () => {
    const r = run([0x21, 0x00, 0x3c, 0x36, 0x01, 0xe5]);
    expect(pair(r, 'HL')).toBe(0x3c00);
  });

  it('IX halves are tracked, and ADD IX,rr makes them unknown', () => {
    const r = run([0xdd, 0x21, 0x34, 0x12, 0xdd, 0x2c]); // LD IX,1234H / INC IXL
    expect(r.IXL).toBe(0x35);
    expect(run([0xdd, 0x21, 0x34, 0x12, 0xdd, 0x09]).IXH).toBeNull(); // ADD IX,BC
  });

  it('LD SP,nn and INC SP are not tracked and harm nothing', () => {
    expect(run([0x06, 0x01, 0x31, 0x00, 0x40, 0x33]).B).toBe(1);
  });

  it('an undocumented DDCB form (RLC (IX+0),B) makes everything unknown', () => {
    expect(run([0x06, 0x05, 0xdd, 0xcb, 0x00, 0x00]).B).toBeNull();
  });

  it('an undocumented NEG duplicate (ED 54) makes A unknown', () => {
    expect(run([0x3e, 0x05, 0xed, 0x54]).A).toBeNull();
  });
});
