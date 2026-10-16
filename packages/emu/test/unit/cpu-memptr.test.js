/**
 * MEMPTR (WZ), the Z80's hidden address latch. Software sees it only through BIT n,(HL), whose
 * flags 3 and 5 come from its high byte, so a wrong value shows up as wrong flags; ZEXALL's
 * harness runs LD SP,(nn) just before each instruction under test. The rules are from "MEMPTR,
 * esoteric register of the ZiLOG Z80 CPU" (boo_boo and Vladimir Kladov).
 */
import { describe, expect, it } from 'vitest';
import { bare } from './bare.js';

const STALE = 0xbeef;
const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');

/** Runs the instruction at 0100H with MEMPTR first set to BEEFH; returns the core. */
function run(bytes, setup = () => {}) {
  const { cpu } = bare(bytes, (c, mem) => {
    c.wz = STALE;
    setup(c, mem);
  });
  cpu.executeInstruction();
  return cpu;
}

/** F that makes condition `cc` (0 NZ, 1 Z, 2 NC, 3 C, 4 PO, 5 PE, 6 P, 7 M) hold or not. */
function flagsFor(cc, holds) {
  const flag = [0x40, 0x40, 0x01, 0x01, 0x04, 0x04, 0x80, 0x80][cc];
  return (cc % 2 === 1) === holds ? flag : 0;
}

const stack1234 = (c, mem) => {
  c.registers.SP = 0x8000;
  mem[0x8000] = 0x34;
  mem[0x8001] = 0x12;
};

describe('MEMPTR after loads and stores through an address', () => {
  it('LD A,(nn), LD A,(BC), LD A,(DE): the address + 1 (already right)', () => {
    expect(run([0x3a, 0x34, 0x12]).wz).toBe(0x1235);
    expect(run([0x0a], (c) => { c.BC = 0x1234; }).wz).toBe(0x1235);
    expect(run([0x1a], (c) => { c.DE = 0x1234; }).wz).toBe(0x1235);
  });

  it('LD (nn),A, LD (BC),A, LD (DE),A: low byte the address + 1, high byte A (already right)', () => {
    expect(run([0x32, 0xff, 0x12], (c) => { c.registers.A = 0x56; }).wz).toBe(0x5600);
    expect(run([0x02], (c) => { c.BC = 0x1234; c.registers.A = 0x56; }).wz).toBe(0x5635);
    expect(run([0x12], (c) => { c.DE = 0x1234; c.registers.A = 0x56; }).wz).toBe(0x5635);
  });

  it('LD rp,(nn) and LD (nn),rp in every form: nn + 1', () => {
    const forms = [
      [0x2a], [0x22],
      [0xed, 0x4b], [0xed, 0x5b], [0xed, 0x6b], [0xed, 0x7b],
      [0xed, 0x43], [0xed, 0x53], [0xed, 0x63], [0xed, 0x73],
      [0xdd, 0x2a], [0xdd, 0x22], [0xfd, 0x2a], [0xfd, 0x22],
    ];
    for (const op of forms) expect(run([...op, 0x34, 0x12]).wz, hex(op)).toBe(0x1235);
    expect(run([0x22, 0xff, 0xff]).wz).toBe(0x0000);
  });

  it('EX (SP),HL, EX (SP),IX, EX (SP),IY: the value taken from the stack', () => {
    for (const op of [[0xe3], [0xdd, 0xe3], [0xfd, 0xe3]]) expect(run(op, stack1234).wz, hex(op)).toBe(0x1234);
  });
});

describe('MEMPTR after 16-bit arithmetic and the nibble rotates (already right)', () => {
  it('ADD/ADC/SBC HL,rp and ADD IX/IY,rp: the first operand + 1', () => {
    for (const op of [[0x09], [0xed, 0x4a], [0xed, 0x42]]) expect(run(op, (c) => { c.HL = 0x1000; }).wz, hex(op)).toBe(0x1001);
    expect(run([0xdd, 0x09], (c) => { c.IX = 0x2000; }).wz).toBe(0x2001);
    expect(run([0xfd, 0x09], (c) => { c.IY = 0x3000; }).wz).toBe(0x3001);
  });

  it('RLD and RRD: HL + 1', () => {
    for (const op of [[0xed, 0x6f], [0xed, 0x67]]) expect(run(op, (c) => { c.HL = 0x3000; }).wz, hex(op)).toBe(0x3001);
  });
});

describe('MEMPTR after jumps, calls, and returns', () => {
  it('JP nn and CALL nn: nn', () => {
    expect(run([0xc3, 0x34, 0x12]).wz).toBe(0x1234);
    expect(run([0xcd, 0x34, 0x12]).wz).toBe(0x1234);
  });

  it('JP cc,nn and CALL cc,nn: nn, whether or not they go', () => {
    for (let cc = 0; cc < 8; cc++) {
      for (const holds of [true, false]) {
        for (const op of [0xc2 | (cc << 3), 0xc4 | (cc << 3)]) {
          expect(run([op, 0x34, 0x12], (c) => { c.registers.F = flagsFor(cc, holds); }).wz, `${hex([op])} ${holds}`).toBe(0x1234);
        }
      }
    }
  });

  it('JR e, and JR cc,e and DJNZ e when they go: the destination; when they do not: unchanged', () => {
    expect(run([0x18, 0x05]).wz).toBe(0x0107);
    for (let cc = 0; cc < 4; cc++) {
      const op = 0x20 | (cc << 3);
      expect(run([op, 0x05], (c) => { c.registers.F = flagsFor(cc, true); }).wz, hex([op])).toBe(0x0107);
      expect(run([op, 0x05], (c) => { c.registers.F = flagsFor(cc, false); }).wz, hex([op])).toBe(STALE);
    }
    expect(run([0x10, 0x05], (c) => { c.registers.B = 2; }).wz).toBe(0x0107);
    expect(run([0x10, 0x05], (c) => { c.registers.B = 1; }).wz).toBe(STALE);
  });

  it('RET, RETI, RETN, and RET cc when it goes: the return address; RET cc that stays: unchanged', () => {
    for (const op of [[0xc9], [0xed, 0x4d], [0xed, 0x45]]) expect(run(op, stack1234).wz, hex(op)).toBe(0x1234);
    for (let cc = 0; cc < 8; cc++) {
      const op = 0xc0 | (cc << 3);
      const go = (holds) => (c, mem) => {
        stack1234(c, mem);
        c.registers.F = flagsFor(cc, holds);
      };
      expect(run([op], go(true)).wz, hex([op])).toBe(0x1234);
      expect(run([op], go(false)).wz, hex([op])).toBe(STALE);
    }
  });

  it('RST p: p', () => {
    for (let p = 0; p < 0x40; p += 8) expect(run([0xc7 | p]).wz, hex([0xc7 | p])).toBe(p);
  });

  it('JP (HL), JP (IX), and LD SP,HL leave it alone', () => {
    for (const op of [[0xe9], [0xdd, 0xe9], [0xf9]]) expect(run(op, (c) => { c.HL = 0x1234; c.IX = 0x1234; }).wz, hex(op)).toBe(STALE);
  });
});

describe('MEMPTR after port I/O', () => {
  it('IN A,(n): A before the read, times 256, plus n, plus 1', () => {
    expect(run([0xdb, 0xfe], (c) => { c.registers.A = 0x12; }).wz).toBe(0x12ff);
    expect(run([0xdb, 0xff], (c) => { c.registers.A = 0xff; }).wz).toBe(0x0000);
  });

  it('OUT (n),A: low byte n + 1, high byte A', () => {
    expect(run([0xd3, 0xff], (c) => { c.registers.A = 0x12; }).wz).toBe(0x1200);
    expect(run([0xd3, 0x34], (c) => { c.registers.A = 0x12; }).wz).toBe(0x1235);
  });

  it('IN r,(C) and OUT (C),r for every register: BC before the instruction + 1', () => {
    for (let r = 0; r < 8; r++) {
      if (r === 6) continue; // ED 70 and ED 71 arrive with the rest of the ED table (Task 4)
      for (const op of [0x40 | (r << 3), 0x41 | (r << 3)]) {
        expect(run([0xed, op], (c) => { c.BC = 0x12ff; }).wz, hex([0xed, op])).toBe(0x1300);
      }
    }
  });
});

describe('MEMPTR after (IX+d) and (IY+d) operands: the address', () => {
  it('loads, stores, arithmetic, INC, DEC, and LD (IX+d),n', () => {
    const forms = [[0x7e], [0x77], [0x86], [0xbe], [0x34], [0x35], [0x36, 0x99]];
    const index = [[0xdd, (c) => { c.IX = 0x2000; }], [0xfd, (c) => { c.IY = 0x2000; }]];
    for (const [prefix, set] of index) {
      for (const [op, ...rest] of forms) {
        expect(run([prefix, op, 0x05, ...rest], set).wz, hex([prefix, op])).toBe(0x2005);
        expect(run([prefix, op, 0xfb, ...rest], set).wz, hex([prefix, op, 0xfb])).toBe(0x1ffb);
      }
    }
  });

  it('BIT n,(IX+d) (already right)', () => {
    expect(run([0xdd, 0xcb, 0x05, 0x46], (c) => { c.IX = 0x2000; }).wz).toBe(0x2005);
  });
});

describe('MEMPTR after block instructions', () => {
  const block = (c, mem) => {
    c.HL = 0x3000;
    c.DE = 0x4000;
    c.registers.A = 0x22;
    mem[0x3000] = 0x11;
  };
  const withBC = (bc, more = () => {}) => (c, mem) => {
    block(c, mem);
    c.BC = bc;
    more(c);
  };

  it('LDIR and LDDR while they repeat: their own address + 1; on the last pass, and LDI and LDD: unchanged', () => {
    for (const op of [0xb0, 0xb8]) {
      expect(run([0xed, op], withBC(2)).wz, hex([0xed, op])).toBe(0x0101);
      expect(run([0xed, op], withBC(1)).wz, hex([0xed, op])).toBe(STALE);
    }
    for (const op of [0xa0, 0xa8]) expect(run([0xed, op], withBC(2)).wz, hex([0xed, op])).toBe(STALE);
  });

  it('CPI and CPD: MEMPTR + 1 and - 1 (already right)', () => {
    expect(run([0xed, 0xa1], withBC(2)).wz).toBe(STALE + 1);
    expect(run([0xed, 0xa9], withBC(2)).wz).toBe(STALE - 1);
  });

  it('CPIR and CPDR while they repeat: their own address + 1; when they stop: as CPI and CPD', () => {
    expect(run([0xed, 0xb1], withBC(2)).wz).toBe(0x0101);
    expect(run([0xed, 0xb9], withBC(2)).wz).toBe(0x0101);
    expect(run([0xed, 0xb1], withBC(1)).wz).toBe(STALE + 1);
    expect(run([0xed, 0xb9], withBC(1)).wz).toBe(STALE - 1);
    expect(run([0xed, 0xb1], withBC(2, (c) => { c.registers.A = 0x11; })).wz).toBe(STALE + 1); // found it
  });

  it('INI, INIR, IND, INDR: BC before B counts down, + 1 or - 1', () => {
    for (const [op, want] of [[0xa2, 0x1235], [0xb2, 0x1235], [0xaa, 0x1233], [0xba, 0x1233]]) {
      expect(run([0xed, op], withBC(0x1234)).wz, hex([0xed, op])).toBe(want);
    }
  });

  it('OUTI, OTIR, OUTD, OTDR: BC after B counts down, + 1 or - 1', () => {
    for (const [op, want] of [[0xa3, 0x1135], [0xb3, 0x1135], [0xab, 0x1133], [0xbb, 0x1133]]) {
      expect(run([0xed, op], withBC(0x1234)).wz, hex([0xed, op])).toBe(want);
    }
  });
});

describe('MEMPTR elsewhere', () => {
  it('ordinary instructions leave it alone', () => {
    const ops = [[0x00], [0x78], [0x34], [0x36, 0x99], [0x7e], [0xcb, 0x46], [0x76]];
    for (const op of ops) expect(run(op, (c) => { c.HL = 0x3000; }).wz, hex(op)).toBe(STALE);
  });
});
