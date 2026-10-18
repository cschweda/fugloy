/** Explain's "why this register": facts about the Z80 that force a register, and a ROM call's input register. */
import { describe, expect, it } from 'vitest';
import { explainLine, sentenceText } from '../../src/explain/index.js';
import { inputRegisters } from '../../src/explain/why-register.js';
import { openProgram } from '../../src/session.js';

const raw = (bytes: number[]) => openProgram(new Uint8Array(bytes), { base: 0x7000, selection: { machine: 3, dos: 'trsdos' } });
/** The "why this register" sentences for the line at `at` (default: the first) of a program `bytes`. */
const why = (bytes: number[], at = 0x7000): string[] => (explainLine(raw(bytes), at).why?.register ?? []).map(sentenceText);
const RET = 0xc9;

describe('why this register: facts about the Z80', () => {
  it('8-bit add and subtract work on A', () => {
    expect(why([0xc6, 0x05, RET])).toEqual(['Every 8-bit add and subtract works on A, the accumulator: to add to or subtract from a byte, the program must have it in A.']);
    expect(why([0xd6, 0x05, RET])[0]).toMatch(/^Every 8-bit add and subtract works on A, the accumulator/);
    expect(why([0x8f, RET])[0]).toMatch(/^Every 8-bit add and subtract/); // ADC A,A
    expect(why([0x9f, RET])[0]).toMatch(/^Every 8-bit add and subtract/); // SBC A,A
  });

  it('AND, OR and XOR work on A', () => {
    for (const b of [[0xe6, 0x0f], [0xb0], [0xee, 0x01]]) {
      expect(why([...b, RET])).toEqual(['Every 8-bit AND, OR and XOR works on A, the accumulator: a byte must be in A to be masked or combined this way.']);
    }
  });

  it('CP compares with A', () => {
    expect(why([0xfe, 0x0d, RET])).toEqual(['CP always compares with A, the accumulator: the Z80 compares a byte only against A, so the value to test must be in A.']);
    expect(why([0xbe, RET])[0]).toMatch(/^CP always compares with A/); // CP (HL)
  });

  it('only A loads from or stores to an address written in the instruction', () => {
    expect(why([0x3a, 0x00, 0x3c, RET])).toEqual(['Of the one-byte registers, only A, the accumulator, can be loaded straight from an address written in the instruction; any other would have to take its byte through A, or through an address in HL, IX or IY.']);
    expect(why([0x32, 0x00, 0x3c, RET])).toEqual(['Of the one-byte registers, only A, the accumulator, can be stored straight to an address written in the instruction; any other would have to go through A, or through an address in HL, IX or IY.']);
  });

  it('only A loads or stores through BC or DE', () => {
    expect(why([0x1a, RET])).toEqual(['Only A, the accumulator, can be loaded through the address in DE; the other registers can be loaded through an address only when it is in HL, IX or IY.']);
    expect(why([0x02, RET])).toEqual(['Only A, the accumulator, can be stored through the address in BC; the other registers can be stored through an address only when it is in HL, IX or IY.']);
  });

  it('only A goes to or from a port named in the instruction', () => {
    expect(why([0xd3, 0xff, RET])).toEqual(['Only A, the accumulator, can be sent to a port whose number is written in the instruction; any other register needs the port number in C (OUT (C),r).']);
    expect(why([0xdb, 0xff, RET])).toEqual(['Only A, the accumulator, can be read from a port whose number is written in the instruction; any other register needs the port number in C (IN r,(C)).']);
  });

  it('a port picked by a register is always the one in C', () => {
    expect(why([0xed, 0x79, RET])).toEqual(['When a register picks the port, it is always C: the Z80 takes the port number from C and from no other register.']);
  });

  it('DJNZ counts in B', () => {
    // 7000 LD B,3; 7002 NOP; 7003 DJNZ 7002; 7005 RET
    expect(why([0x06, 0x03, 0x00, 0x10, 0xfd, RET], 0x7003)).toEqual(['DJNZ always counts down in B: it takes 1 from B and jumps unless B has reached zero, so a loop that uses it keeps its count in B.']);
  });

  it('the block copy, search and port instructions fix their registers', () => {
    const copy = 'The block copy instructions fix their registers: HL is always the source, DE the destination and BC the count, so the program sets those three first.';
    expect(why([0xed, 0xb0, RET])).toEqual([copy]); // LDIR
    expect(why([0xed, 0xa0, RET])).toEqual([copy]); // LDI
    const search = 'The block search instructions fix their registers: A, the accumulator, holds the byte to look for, HL the address and BC the count.';
    expect(why([0xed, 0xb1, RET])).toEqual([search]); // CPIR
    expect(why([0xed, 0xa9, RET])).toEqual([search]); // CPD
    expect(why([0xed, 0xa2, RET])).toEqual(['The block input and output instructions fix their registers: HL is the address in memory, B the count and C the port number.']); // INI
  });

  it('the rotate-A and adjust instructions work only on A', () => {
    expect(why([0x07, RET])).toEqual(['RLCA works only on A, the accumulator; to rotate another register the Z80 has a separate instruction, RLC.']);
    expect(why([0x1f, RET])).toEqual(['RRA works only on A, the accumulator; to rotate another register the Z80 has a separate instruction, RR.']);
    expect(why([0x2f, RET])).toEqual(['CPL works only on A, the accumulator: the Z80 can flip every bit of no other register.']);
    expect(why([0xed, 0x44, RET])).toEqual(['NEG works only on A, the accumulator: the Z80 can negate no other register.']);
    expect(why([0x27, RET])).toEqual(['DAA works only on A, the accumulator: it corrects A after an add or subtract of decimal digits.']);
  });

  it('16-bit adds land only in HL, IX or IY', () => {
    const add = 'A 16-bit add can land only in HL, IX or IY, so a 16-bit total is kept in one of them.';
    expect(why([0x09, RET])).toEqual([add]);
    expect(why([0xdd, 0x09, RET])).toEqual([add]);
    expect(why([0xed, 0x4a, RET])).toEqual(['A 16-bit add with carry or subtract can land only in HL.']);
  });

  it('JP (HL) jumps only through HL, IX or IY', () => {
    expect(why([0xe9])).toEqual(['The Z80 can jump to an address held in a register only through HL, IX or IY, so the address to jump to is put in one of them first.']);
  });

  it('EX DE,HL exists because HL is the register most memory instructions use', () => {
    expect(why([0xeb, RET])).toEqual(['HL is the register most memory and 16-bit arithmetic instructions use; EX DE,HL swaps an address kept in DE into HL, in one step, so those instructions can use it.']);
  });

  it('the stack pointer, I and R have their own forced registers', () => {
    expect(why([0xf9, RET])).toEqual(['The stack pointer can be loaded from a register only from HL, IX or IY.']);
    expect(why([0xe3, RET])).toEqual(['Only HL, IX or IY can be swapped with the top of the stack.']);
    expect(why([0xed, 0x57, RET])).toEqual(['Only A, the accumulator, can be loaded from I or R.']);
    expect(why([0xed, 0x47, RET])).toEqual(['I and R can be loaded only from A, the accumulator.']);
  });

  it('no forced choice, no sentence', () => {
    expect(why([0x41, RET])).toEqual([]); // LD B,C
    expect(why([0x14, RET])).toEqual([]); // INC D
    expect(why([0x00, RET])).toEqual([]); // NOP
    expect(why([0x21, 0x00, 0x3c, RET])).toEqual([]); // LD HL,3C00H with no call after
    expect(why([0x7e, RET])).toEqual([]); // LD A,(HL): any register can be loaded through HL
    expect(explainLine(raw([0x41, RET]), 0x7000).why).toEqual({ register: [], purpose: [], idiom: [] });
  });

  it('a data row and a BASIC session have no why', () => {
    expect(explainLine(raw([RET, 0xff]), 0x7001).why).toBeUndefined();
  });
});

describe("why this register: a ROM call's input register", () => {
  it("a ROM call's input register is explained with its table entry", () => {
    // 7000 LD A,'X'; 7002 CALL 0033H ($VDCHAR); 7005 RET
    const e = explainLine(raw([0x3e, 0x58, 0xcd, 0x33, 0x00, RET]), 0x7000);
    const s = e.why!.register;
    expect(s.map(sentenceText)).toEqual(['A, the accumulator, is loaded here because the ROM routine $VDCHAR ($0033), called at $7002, takes its input in A: display the character in A at the cursor.']);
    expect(s[0]!.find((p) => p.text === '$VDCHAR')?.entry?.key).toBe(0x33);
    expect(s[0]!.find((p) => p.text === '$7002')?.addr).toBe(0x7002);
  });

  it('the scan passes lines that leave the register alone, and names the pair a half belongs to', () => {
    // 7000 LD L,00H; 7002 LD H,72H; 7004 NOP; 7005 CALL 28A7H (print the string at HL); 7008 RET
    const bytes = [0x2e, 0x00, 0x26, 0x72, 0x00, 0xcd, 0xa7, 0x28, RET];
    const all = [0x7000, 0x7002].map((at) => why(bytes, at));
    for (const s of all) expect(s).toHaveLength(1);
    expect(all[0]![0]).toMatch(/^L is loaded here because the ROM routine \S+ \(\$28A7\), called at \$7005, takes its input in HL: /);
    expect(all[1]![0]).toMatch(/^H is loaded here because/);
  });

  it('an RST to a ROM routine is a call too', () => {
    // 7000 LD HL,7100H; 7003 RST 10H (advance HL to the next non-blank character); 7004 RET
    expect(why([0x21, 0x00, 0x71, 0xd7, RET])[0]).toMatch(/^HL is loaded here because the ROM routine \S+ \(\$0010\), called at \$7003, takes its input in HL: /);
  });

  it('a register the routine returns, not takes, gives no reason', () => {
    // 7000 LD A,0; 7002 CALL 0049H (wait for a key and return it in A); 7005 RET
    expect(why([0x3e, 0x00, 0xcd, 0x49, 0x00, RET])).toEqual([]);
  });

  it('the scan stops where the register is written again', () => {
    // 7000 LD A,1; 7002 LD A,2; 7004 CALL 0033H; 7007 RET
    const bytes = [0x3e, 0x01, 0x3e, 0x02, 0xcd, 0x33, 0x00, RET];
    expect(why(bytes, 0x7000)).toEqual([]);
    expect(why(bytes, 0x7002)).toHaveLength(1);
  });

  it('the scan stops at a branch and at a join', () => {
    // 7000 LD A,1; 7002 JR Z,7004; 7004 CALL 0033H; 7007 RET
    expect(why([0x3e, 0x01, 0x28, 0x00, 0xcd, 0x33, 0x00, RET])).toEqual([]);
    // 7000 LD A,1; 7002 CALL 0033H (the jump at 7005 also leads here); 7005 JR Z,7002; 7007 RET
    expect(why([0x3e, 0x01, 0xcd, 0x33, 0x00, 0x28, 0xfb, RET])).toEqual([]);
  });

  it('the scan stops at another call, and a conditional call is not counted', () => {
    // 7000 LD A,1; 7002 CALL 7009H; 7005 CALL 0033H; 7008 RET; 7009 RET
    expect(why([0x3e, 0x01, 0xcd, 0x09, 0x70, 0xcd, 0x33, 0x00, RET, RET])).toEqual([]);
    // 7000 LD A,1; 7002 CALL Z,0033H; 7005 RET
    expect(why([0x3e, 0x01, 0xcc, 0x33, 0x00, RET])).toEqual([]);
  });

  it('a call whose address the program rewrites names no routine', () => {
    // 7000 LD (7006H),HL; 7003 LD A,1; 7005 CALL 0033H (its address bytes are 7006 and 7007); 7008 RET
    expect(why([0x22, 0x06, 0x70, 0x3e, 0x01, 0xcd, 0x33, 0x00, RET], 0x7003)).toEqual([]);
  });
});

describe('inputRegisters: the registers a table purpose says a routine takes', () => {
  it('reads what goes in, not what comes back', () => {
    expect(inputRegisters('display the character in A at the cursor')).toEqual(['A']);
    expect(inputRegisters('pause for a time set by BC')).toEqual(['BC']);
    expect(inputRegisters('read a line from the keyboard into a buffer at HL')).toEqual(['HL']);
    expect(inputRegisters('send the byte in A to the device whose control block DE addresses; Z set when it was ready')).toEqual(['A', 'DE']);
    expect(inputRegisters('compare HL with DE as unsigned numbers; Z if equal, carry if HL is the smaller')).toEqual(['HL', 'DE']);
    expect(inputRegisters('multiply HL by A')).toEqual(['HL', 'A']);
    expect(inputRegisters('wait for a key and return it in A')).toEqual([]);
    expect(inputRegisters('read one byte from the cassette into A')).toEqual([]);
    expect(inputRegisters('return the cursor column on its line in A')).toEqual([]);
    expect(inputRegisters('divide a 16-bit value by an 8-bit divisor: quotient in HL, remainder in A')).toEqual([]);
  });
});
