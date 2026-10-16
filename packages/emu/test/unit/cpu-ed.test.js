/**
 * The ED opcodes beyond the documented ones, and the flags of the block I/O instructions, from
 * Sean Young, "The Undocumented Z80 Documented" (v0.91) §3 and §4.3. ZEXALL cannot see these:
 * it runs none of the duplicates and no I/O.
 */
import { describe, expect, it } from 'vitest';
import { bare } from './bare.js';

/** Runs the instruction at 0100H; returns the core, its memory, and the T-states it took. */
function step(bytes, setup) {
  const { cpu, mem } = bare(bytes, setup);
  const t = cpu.executeInstruction();
  return { cpu, mem, t };
}

describe('ED duplicates', () => {
  it('ED 4C, 54, 5C, 64, 6C, 74, 7C are NEG', () => {
    const neg = step([0xed, 0x44], (c) => { c.registers.A = 0x01; });
    for (const op of [0x4c, 0x54, 0x5c, 0x64, 0x6c, 0x74, 0x7c]) {
      const { cpu, t } = step([0xed, op], (c) => { c.registers.A = 0x01; });
      expect([cpu.registers.A, cpu.registers.F, t], op.toString(16)).toEqual([neg.cpu.registers.A, neg.cpu.registers.F, 8]);
    }
  });

  it('ED 55, 5D, 65, 6D, 75, 7D are RETN', () => {
    for (const op of [0x55, 0x5d, 0x65, 0x6d, 0x75, 0x7d]) {
      const { cpu, t } = step([0xed, op], (c, mem) => {
        c.registers.SP = 0x8000;
        mem[0x8000] = 0x34;
        mem[0x8001] = 0x12;
        c.IFF1 = false;
        c.IFF2 = true;
      });
      expect([cpu.registers.PC, cpu.registers.SP, cpu.IFF1, t], op.toString(16)).toEqual([0x1234, 0x8002, true, 14]);
    }
  });

  it('ED 4E, 66, 6E set IM 0; ED 76 sets IM 1; ED 7E sets IM 2', () => {
    for (const [op, mode, from] of [[0x4e, 0, 2], [0x66, 0, 2], [0x6e, 0, 2], [0x76, 1, 0], [0x7e, 2, 0]]) {
      const { cpu, t } = step([0xed, op], (c) => { c.interruptMode = from; });
      expect([cpu.interruptMode, t], op.toString(16)).toEqual([mode, 8]);
    }
  });
});

describe('IN F,(C) and OUT (C),0', () => {
  it('ED 70 reads port C and sets the flags as IN r,(C) does, storing the byte nowhere', () => {
    const { cpu, mem, t } = step([0xed, 0x70], (c, m) => {
      c.readPort = () => 0x80;
      c.BC = 0x12fe;
      c.DE = 0x3456;
      c.HL = 0x3000;
      c.registers.A = 0x55;
      c.registers.F = 0x01;
      m[0x3000] = 0x99;
    });
    expect([cpu.BC, cpu.DE, cpu.HL, cpu.registers.A, mem[0x3000]]).toEqual([0x12fe, 0x3456, 0x3000, 0x55, 0x99]);
    expect(cpu.registers.F).toBe(0x81); // S from bit 7; Z, H, P/V (odd parity), N clear; C kept
    expect([cpu.wz, t]).toEqual([0x12ff, 12]);
  });

  it('ED 71 writes 0 to port C', () => {
    const writes = [];
    const { cpu, t } = step([0xed, 0x71], (c) => {
      c.writePort = (port, value) => writes.push([port, value]);
      c.BC = 0x12fe;
      c.registers.A = 0x55;
    });
    expect(writes).toEqual([[0xfe, 0x00]]);
    expect([cpu.wz, t]).toEqual([0x12ff, 12]);
  });
});

describe('undefined ED opcodes', () => {
  const defined = new Set([
    ...Array.from({ length: 0x40 }, (_, i) => 0x40 + i).filter((op) => op !== 0x77 && op !== 0x7f),
    0xa0, 0xa1, 0xa2, 0xa3, 0xa8, 0xa9, 0xaa, 0xab, 0xb0, 0xb1, 0xb2, 0xb3, 0xb8, 0xb9, 0xba, 0xbb,
  ]);

  it('each is a two-byte, 8-T-state NOP that changes nothing and logs nothing', () => {
    const log = [];
    for (let op = 0; op < 0x100; op++) {
      if (defined.has(op)) continue;
      const { cpu, t } = step([0xed, op], (c) => {
        c.log = (...entry) => log.push(entry);
        c.BC = 0x1234;
        c.DE = 0x5678;
        c.HL = 0x9abc;
        c.registers.A = 0xde;
        c.registers.F = 0xf0;
      });
      const after = [cpu.registers.PC, t, cpu.BC, cpu.DE, cpu.HL, cpu.registers.A, cpu.registers.F];
      expect(after, op.toString(16)).toEqual([0x102, 8, 0x1234, 0x5678, 0x9abc, 0xde, 0xf0]);
    }
    expect(log).toEqual([]);
  });
});

describe('block I/O flags', () => {
  // S, Z, 5, 3 from B after it counts down; N from bit 7 of the byte moved. k is that byte plus
  // C + 1 (INI), C - 1 (IND), or L after HL moves (OUTI, OUTD); H and C are set when k > 255,
  // and P/V is the parity of (k AND 7) XOR B.
  const ini = (c) => {
    c.readPort = () => 0xf5;
    c.BC = 0x0210;
    c.HL = 0x3000;
    c.registers.F = 0x00;
  };
  const outd = (c, mem) => {
    mem[0x3081] = 0xff;
    c.BC = 0x2910;
    c.HL = 0x3081;
    c.registers.F = 0x00;
  };

  it('INI: k = F5H + 11H carries; (6 XOR 1) has odd parity', () => {
    const { cpu, mem } = step([0xed, 0xa2], ini);
    expect([mem[0x3000], cpu.HL, cpu.registers.B, cpu.registers.F]).toEqual([0xf5, 0x3001, 0x01, 0x13]);
  });

  it('IND: k = 01H + 0FH does not carry; B reaches 0', () => {
    const { cpu } = step([0xed, 0xaa], (c) => {
      c.readPort = () => 0x01;
      c.BC = 0x0110;
      c.HL = 0x3000;
      c.registers.F = 0x00;
    });
    expect([cpu.HL, cpu.registers.B, cpu.registers.F]).toEqual([0x2fff, 0x00, 0x44]);
  });

  it('OUTI: k = 80H + L (00H after HL moves); S from B = 80H', () => {
    const { cpu } = step([0xed, 0xa3], (c, mem) => {
      mem[0x30ff] = 0x80;
      c.BC = 0x8110;
      c.HL = 0x30ff;
      c.registers.F = 0x00;
    });
    expect([cpu.HL, cpu.registers.B, cpu.registers.F]).toEqual([0x3100, 0x80, 0x82]);
  });

  it('OUTD: k = FFH + L (80H after HL moves) carries; flags 5 and 3 from B = 28H', () => {
    const { cpu } = step([0xed, 0xab], outd);
    expect([cpu.HL, cpu.registers.B, cpu.registers.F]).toEqual([0x3080, 0x28, 0x3b]);
  });

  it('INIR and OTDR set the same flags on each pass', () => {
    const inir = step([0xed, 0xb2], ini);
    expect([inir.cpu.registers.PC, inir.cpu.registers.F]).toEqual([0x100, 0x13]);
    const otdr = step([0xed, 0xbb], outd);
    expect([otdr.cpu.registers.PC, otdr.cpu.registers.F]).toEqual([0x100, 0x3b]);
  });
});
