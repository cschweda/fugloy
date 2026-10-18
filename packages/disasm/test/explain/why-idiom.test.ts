/** Explain's "why write it this way": common Z80 idioms, each with a cost comparison decoded from @fugloy/z80. */
import { describe, expect, it } from 'vitest';
import { decodeAt } from '@fugloy/z80';
import { explainLine, sentenceText } from '../../src/explain/index.js';
import { openProgram } from '../../src/session.js';

const raw = (bytes: number[]) => openProgram(new Uint8Array(bytes), { base: 0x7000, selection: { machine: 3, dos: 'trsdos' } });
/** The idiom sentences for the line at `at` (default: the first) of a program `bytes`. */
const why = (bytes: number[], at = 0x7000): string[] => (explainLine(raw(bytes), at).why?.idiom ?? []).map(sentenceText);
const RET = 0xc9;

/** Bytes and T-states of `bytes` decoded as consecutive instructions, the test's own reading of the table. */
function cost(bytes: number[]): { b: number; t: number; nt: number } {
  let b = 0;
  let t = 0;
  let nt = 0;
  for (let at = 0; at < bytes.length; ) {
    const i = decodeAt(bytes, at, 0);
    b += i.length;
    t += i.cycles;
    nt += i.cyclesNotTaken ?? i.cycles;
    at += i.length;
  }
  return { b, t, nt };
}
const bytesText = (n: number): string => `${n} ${n === 1 ? 'byte' : 'bytes'}`;

describe('why write it this way: the idioms', () => {
  it('XOR A and SUB A set A to zero', () => {
    expect(why([0xaf, RET])).toEqual([
      'Programmers write XOR A rather than LD A,00H to set A to zero because it is 1 byte and 4 T-states against 2 bytes and 7; it also sets the Z flag and clears the carry, where LD A,00H leaves the flags as they were.',
    ]);
    expect(why([0x97, RET])[0]).toMatch(/^Programmers write SUB A rather than LD A,00H to set A to zero/);
  });

  it('OR A and AND A test A for zero and clear the carry', () => {
    expect(why([0xb7, RET])).toEqual([
      'OR A leaves A as it is but sets the flags from it: Z when A is zero, S from its top bit, and the carry always cleared. It is the usual way to test A for zero, or to clear the carry, in 1 byte and 4 T-states against 2 bytes and 7 for CP 00H, which tests for zero the same way.',
    ]);
    expect(why([0xa7, RET])[0]).toMatch(/^AND A leaves A as it is/);
  });

  it('OR A before SBC HL clears the carry for a plain subtract', () => {
    // 7000 OR A; 7001 SBC HL,DE; 7003 RET
    const s = why([0xb7, 0xed, 0x52, RET]);
    expect(s).toHaveLength(2);
    expect(s[1]).toBe('The next line, at $7001, is SBC HL,DE: the Z80 has no 16-bit subtract that leaves the carry out, so clearing the carry first is the usual way to make SBC a plain subtract.');
  });

  it('CP compares without changing A', () => {
    expect(why([0xfe, 0x0d, RET])).toEqual(['CP 0DH subtracts to set the flags, exactly as SUB 0DH would, but throws the result away and leaves A unchanged, so A can be tested again; it costs the same 2 bytes and 7 T-states.']);
    expect(why([0xb8, RET])[0]).toMatch(/^CP B subtracts to set the flags, exactly as SUB B would/);
    expect(why([0xdd, 0xbe, 0x02, RET])[0]).toMatch(/^CP \(IX\+02H\) subtracts to set the flags, exactly as SUB \(IX\+02H\) would/);
  });

  it('LD B,n and DJNZ make a counted loop', () => {
    // 7000 LD B,8; 7002 LD HL,3C00H; 7005 INC (HL); 7006 DJNZ 7005; 7008 RET
    const bytes = [0x06, 0x08, 0x21, 0x00, 0x3c, 0x34, 0x10, 0xfd, RET];
    expect(why(bytes)).toEqual([
      'LD B,08H with the DJNZ at $7006 is the Z80\'s counted loop: B holds the count, and DJNZ takes 1 from it and jumps back in 2 bytes and 13 T-states (8 when it falls out), against 3 bytes and 16 (11) for DEC B and JR NZ.',
    ]);
    expect(why(bytes, 0x7006)).toEqual([
      'Programmers write DJNZ rather than DEC B and JR NZ to close a counted loop because it is 2 bytes and 13 T-states when it jumps back (8 when it falls out), against 3 bytes and 16 (11), and it leaves the flags alone where DEC B changes S, Z, H, P/V and N.',
    ]);
  });

  it('ADD A,A and ADD HL,HL double', () => {
    expect(why([0x87, RET])).toEqual(['ADD A,A adds A to itself, doubling it: the Z80 has no multiply, and this is the usual quick way to multiply by two, 1 byte and 4 T-states against 2 bytes and 8 for SLA A, which shifts A left the same way.']);
    expect(why([0x29, RET])).toEqual(['ADD HL,HL adds HL to itself, doubling it: the Z80 has no multiply, and this is the usual way to multiply a 16-bit number by two, 1 byte and 11 T-states against 4 bytes and 16 for SLA L and RL H.']);
  });

  it('SLA and SRL multiply and divide by two', () => {
    expect(why([0xcb, 0x27, RET])[0]).toMatch(/^SLA shifts every bit left, which doubles an unsigned byte .* For A, ADD A,A does the same in 1 byte and 4 T-states against 2 bytes and 8\.$/);
    expect(why([0xcb, 0x20, RET])[0]).toMatch(/Doing it through A instead \(LD A,B, ADD A,A and LD B,A\) would take 3 bytes and 12 T-states against 2 bytes and 8, and would change A\.$/);
    expect(why([0xcb, 0x26, RET])[0]).toMatch(/\(LD A,\(HL\), ADD A,A and LD \(HL\),A\)/);
    expect(why([0xcb, 0x3f, RET])[0]).toMatch(/^SRL shifts every bit right, which halves an unsigned byte.* For A, clearing the carry and rotating \(OR A and RRA\) gives the same value in the same 2 bytes and 8 T-states, but only SRL works on the other registers\.$/);
    expect(why([0xcb, 0x39, RET])[0]).toMatch(/\(LD A,C, OR A, RRA and LD C,A\) would take 4 bytes and 16 T-states/);
  });

  it('RLA and the other one-byte rotates are the short forms', () => {
    expect(why([0x17, RET])).toEqual([
      'RLA is the short form of RL A: 1 byte and 4 T-states against 2 bytes and 8, and it leaves S, Z and P/V alone, where RL A sets them. Rotating through the carry passes a bit from one byte into the next, the usual way to shift a number longer than one byte.',
    ]);
    expect(why([0x07, RET])).toEqual(['RLCA is the short form of RLC A: 1 byte and 4 T-states against 2 bytes and 8, and it leaves S, Z and P/V alone, where RLC A sets them.']);
  });

  it('INC (HL) and DEC (HL) count in memory', () => {
    expect(why([0x34, RET])).toEqual(['INC (HL) adds 1 to the byte in memory where it is, the usual way to keep a counter in memory: 1 byte and 11 T-states against 3 bytes and 18 for LD A,(HL), INC A and LD (HL),A, which would also change A.']);
    expect(why([0xdd, 0x35, 0x04, RET])[0]).toMatch(/^DEC \(IX\+04H\) takes 1 from the byte in memory.*against 7 bytes and 42 for LD A,\(IX\+04H\), DEC A and LD \(IX\+04H\),A/);
  });

  it('PUSH AF and POP AF keep A and the flags across a call', () => {
    // 7000 PUSH AF; 7001 CALL 7006H; 7004 POP AF; 7005 RET; 7006 RET
    expect(why([0xf5, 0xcd, 0x06, 0x70, 0xf1, RET, RET])).toEqual([
      'PUSH AF here, with the POP AF at $7004 after the call at $7001, is the usual way to keep A and the flags across a call: the stack holds them while the routine runs, 2 bytes and 21 T-states in all. Keeping A at a fixed address instead (LD (nn),A and LD A,(nn)) would take 6 bytes and 26 T-states, and would not keep the flags.',
    ]);
  });

  it("EX AF,AF' sets A and the flags aside", () => {
    expect(why([0x08, RET])).toEqual(["EX AF,AF' swaps A and the flags with the spare pair, A' and F', in 1 byte and 4 T-states: a quick way to set A and the flags aside without the stack, where PUSH AF and POP AF would take 2 bytes and 21 T-states."]);
  });

  it('RST is a one-byte call', () => {
    expect(why([0xef, RET])).toEqual([
      'RST 28H calls $0028 in 1 byte and 11 T-states against 3 bytes and 17 for CALL 0028H. The Z80 has eight of these one-byte calls, to $0000, $0008 and so on up to $0038, so they are usually kept for the routines called most often.',
    ]);
  });

  it('LD A,(HL) and INC HL walk a table', () => {
    expect(why([0x7e, 0x23, RET])).toEqual([
      'LD A,(HL) with the INC HL at $7001 is the usual way to walk through a table: read the byte HL points at, then move HL on to the next. HL is as cheap as any pointer for it (LD A,(DE) and INC DE cost the same), 2 bytes and 13 T-states against 5 bytes and 29 for LD A,(IX+00H) and INC IX.',
    ]);
    expect(why([0x4e, 0x2b, RET])[0]).toMatch(/^LD C,\(HL\) with the DEC HL at \$7001 .* move HL back to the next\. HL is the cheapest pointer for it, /);
  });

  it('LDIR copies a block', () => {
    expect(why([0xed, 0xb0, RET])).toEqual([
      'LDIR copies a whole block with a single 2-byte instruction, 21 T-states for each byte but the last (16). The same copy written as a loop (LD A,(HL), LD (DE),A, INC HL, INC DE, DEC BC, LD A,B, OR C and JR NZ) takes 9 bytes and 52 T-states a byte, and uses A.',
    ]);
    expect(why([0xed, 0xb8, RET])[0]).toMatch(/^LDDR copies .*DEC HL, DEC DE,/);
  });

  it('addresses are links', () => {
    const s = explainLine(raw([0x7e, 0x23, RET]), 0x7000).why!.idiom[0]!;
    expect(s.find((p) => p.text === '$7001')?.addr).toBe(0x7001);
  });
});

describe('why write it this way: look-alikes do not match', () => {
  it('look-alikes do not match', () => {
    expect(why([0xa8, RET])).toEqual([]); // XOR B does not zero A
    expect(why([0x90, RET])).toEqual([]); // SUB B
    expect(why([0xb0, RET])).toEqual([]); // OR B does not test A alone
    expect(why([0xe6, 0x0f, RET])).toEqual([]); // AND 0FH
    expect(why([0x3e, 0x00, RET])).toEqual([]); // LD A,0 itself
    expect(why([0x80, RET])).toEqual([]); // ADD A,B
    expect(why([0x09, RET])).toEqual([]); // ADD HL,BC
    expect(why([0x3c, RET])).toEqual([]); // INC A
    expect(why([0x23, RET])).toEqual([]); // INC HL alone
    expect(why([0xcb, 0x2f, RET])).toEqual([]); // SRA A
    expect(why([0x7e, 0x13, RET])).toEqual([]); // LD A,(HL) then INC DE
    expect(why([0x7e, 0x00, 0x23, RET])).toEqual([]); // LD A,(HL), NOP, INC HL
    expect(why([0x66, 0x23, RET])).toEqual([]); // LD H,(HL) changes the pointer
    expect(why([0xed, 0xb1, RET])).toEqual([]); // CPIR
  });

  it('PUSH AF without a call, or popped into another pair, is not the idiom', () => {
    expect(why([0xf5, 0x00, 0xf1, RET])).toEqual([]); // no call between
    expect(why([0xf5, 0xcd, 0x06, 0x70, 0xc1, RET, RET])).toEqual([]); // POP BC
    expect(why([0xc5, 0xcd, 0x06, 0x70, 0xc1, RET, RET])).toEqual([]); // PUSH BC
    expect(why([0xf5, 0xc5, 0xcd, 0x08, 0x70, 0xc1, 0xf1, RET, RET])).toEqual([]); // another push in between
    // 7000 PUSH AF; 7001 JR Z,7003; 7003 CALL 7007H; 7006 POP AF ... a branch stops the scan
    expect(why([0xf5, 0x28, 0x00, 0xcd, 0x08, 0x70, 0xf1, RET, RET])).toEqual([]);
  });

  it('LD B,n is a loop count only when the DJNZ loop starts after it in straight-line code', () => {
    // 7000 LD B,8; 7002 LD B,4; 7004 NOP; 7005 DJNZ 7004: the first LD B is overwritten
    const bytes = [0x06, 0x08, 0x06, 0x04, 0x00, 0x10, 0xfd, RET];
    expect(why(bytes, 0x7000)).toEqual([]);
    expect(why(bytes, 0x7002)[0]).toMatch(/^LD B,04H with the DJNZ at \$7005/);
    // 7000 LD B,8; 7002 NOP; 7003 CALL 7008H; 7006 DJNZ 7002: a call in the body leaves the count unproven
    expect(why([0x06, 0x08, 0x00, 0xcd, 0x08, 0x70, 0x10, 0xfa, RET, RET])).toEqual([]);
    // 7000 LD B,8; 7002 JR 7004; 7004 NOP; 7005 RET: no DJNZ
    expect(why([0x06, 0x08, 0x18, 0x00, 0x00, RET])).toEqual([]);
  });

  it('a rewritten operand gives no comparison that would show its number', () => {
    // 7000 LD (7004H),A; 7003 CP 0DH, whose 0DH the program stores over
    expect(why([0x32, 0x04, 0x70, 0xfe, 0x0d, RET], 0x7003)).toEqual([]);
    // 7000 LD (7005H),A; 7003 SLA (IX+02H), whose displacement the program stores over
    expect(why([0x32, 0x05, 0x70, 0xdd, 0xcb, 0x02, 0x26, RET], 0x7003)).toEqual([]);
    // 7000 LD (7005H),A; 7003 INC (IX+02H), whose displacement the program stores over
    expect(why([0x32, 0x05, 0x70, 0xdd, 0x34, 0x02, RET], 0x7003)).toEqual([]);
  });

  it('PUSH AF around a call whose return address has a label is not the idiom', () => {
    // 7000 LD HL,7007H; 7003 PUSH AF; 7004 CALL 700AH; 7007 POP AF (labelled: the LD HL at 7000 holds its address); 7008 RET; 7009 RET; 700A RET
    const bytes = [0x21, 0x07, 0x70, 0xf5, 0xcd, 0x0a, 0x70, 0xf1, RET, RET, RET];
    expect(raw(bytes).analysis.symbols.has(0x7007)).toBe(true);
    expect(why(bytes, 0x7003)).toEqual([]);
    // Without the label it is the idiom: the test is not passing for another reason.
    expect(why([0x21, 0x00, 0x60, 0xf5, 0xcd, 0x0a, 0x70, 0xf1, RET, RET, RET], 0x7003)[0]).toMatch(/^PUSH AF here, with the POP AF at \$7007/);
  });

  it('a forward DJNZ is not a loop', () => {
    expect(why([0x10, 0x00, RET])).toEqual([]);
  });

  it('an instruction whose opcode the program rewrites gets nothing', () => {
    // 7000 LD (7005H),A; 7003 NOP; 7004 NOP; 7005 XOR A; 7006 RET
    expect(why([0x32, 0x05, 0x70, 0x00, 0x00, 0xaf, RET], 0x7005)).toEqual([]);
  });
});

describe('why write it this way: the numbers come from the table', () => {
  it('the numbers come from the table', () => {
    // Each case: the program, and the line's bytes and the alternative's bytes as this test decodes them.
    const cases: { prog: number[]; mine: number[]; alt: number[] }[] = [
      { prog: [0xaf, RET], mine: [0xaf], alt: [0x3e, 0x00] },
      { prog: [0xb7, RET], mine: [0xb7], alt: [0xfe, 0x00] },
      { prog: [0x87, RET], mine: [0x87], alt: [0xcb, 0x27] },
      { prog: [0x29, RET], mine: [0x29], alt: [0xcb, 0x25, 0xcb, 0x14] },
      { prog: [0x17, RET], mine: [0x17], alt: [0xcb, 0x17] },
      { prog: [0x34, RET], mine: [0x34], alt: [0x7e, 0x3c, 0x77] },
      { prog: [0xef, RET], mine: [0xef], alt: [0xcd, 0x28, 0x00] },
      { prog: [0x7e, 0x23, RET], mine: [0x7e, 0x23], alt: [0xdd, 0x7e, 0x00, 0xdd, 0x23] },
    ];
    for (const { prog, mine, alt } of cases) {
      const m = cost(mine);
      const a = cost(alt);
      expect(why(prog)[0]).toContain(`${bytesText(m.b)} and ${m.t} T-states against ${bytesText(a.b)} and ${a.t}`);
    }
    // Equal costs read "the same …"; the line and the alternative must really cost the same.
    const same: { prog: number[]; mine: number[]; alt: number[] }[] = [
      { prog: [0xfe, 0x0d, RET], mine: [0xfe, 0x0d], alt: [0xd6, 0x0d] },
      { prog: [0xb8, RET], mine: [0xb8], alt: [0x90] },
      { prog: [0xdd, 0xbe, 0x02, RET], mine: [0xdd, 0xbe, 0x02], alt: [0xdd, 0x96, 0x02] },
      { prog: [0xcb, 0x3f, RET], mine: [0xcb, 0x3f], alt: [0xb7, 0x1f] },
    ];
    for (const { prog, mine, alt } of same) {
      const m = cost(mine);
      expect(cost(alt)).toEqual(m);
      expect(why(prog)[0]).toContain(`the same ${bytesText(m.b)} and ${m.t} T-states`);
    }
    // SLA and SRL against the same work done through A, and the (IX+d) forms.
    const through: { prog: number[]; mine: number[]; alt: number[] }[] = [
      { prog: [0xcb, 0x20, RET], mine: [0xcb, 0x20], alt: [0x78, 0x87, 0x47] },
      { prog: [0xcb, 0x39, RET], mine: [0xcb, 0x39], alt: [0x79, 0xb7, 0x1f, 0x4f] },
      { prog: [0xdd, 0xcb, 0x02, 0x26, RET], mine: [0xdd, 0xcb, 0x02, 0x26], alt: [0xdd, 0x7e, 0x02, 0x87, 0xdd, 0x77, 0x02] },
      { prog: [0xfd, 0xcb, 0x01, 0x3e, RET], mine: [0xfd, 0xcb, 0x01, 0x3e], alt: [0xfd, 0x7e, 0x01, 0xb7, 0x1f, 0xfd, 0x77, 0x01] },
    ];
    for (const { prog, mine, alt } of through) {
      const m = cost(mine);
      const a = cost(alt);
      expect(why(prog)[0]).toContain(`would take ${bytesText(a.b)} and ${a.t} T-states against ${bytesText(m.b)} and ${m.t}`);
    }
    const slaA = cost([0xcb, 0x27]);
    const addA = cost([0x87]);
    expect(why([0xcb, 0x27, RET])[0]).toContain(`For A, ADD A,A does the same in ${bytesText(addA.b)} and ${addA.t} T-states against ${bytesText(slaA.b)} and ${slaA.t}`);
    const incIx = cost([0xdd, 0x34, 0x02]);
    const incIxAlt = cost([0xdd, 0x7e, 0x02, 0x3c, 0xdd, 0x77, 0x02]);
    expect(why([0xdd, 0x34, 0x02, RET])[0]).toContain(`${bytesText(incIx.b)} and ${incIx.t} T-states against ${bytesText(incIxAlt.b)} and ${incIxAlt.t}`);
    const loop = cost([0x05, 0x20, 0xfe]);
    const dj = cost([0x10, 0xfe]);
    expect(why([0x00, 0x10, 0xfd, RET], 0x7001)[0]).toContain(`${bytesText(dj.b)} and ${dj.t} T-states when it jumps back (${dj.nt} when it falls out), against ${bytesText(loop.b)} and ${loop.t} (${loop.nt})`);
    const copy = cost([0xed, 0xb0]);
    const byHand = cost([0x7e, 0x12, 0x23, 0x13, 0x0b, 0x78, 0xb1, 0x20, 0xf7]);
    expect(why([0xed, 0xb0, RET])[0]).toContain(`${copy.t} T-states for each byte but the last (${copy.nt}). The same copy written as a loop`);
    expect(why([0xed, 0xb0, RET])[0]).toContain(`takes ${bytesText(byHand.b)} and ${byHand.t} T-states a byte`);
    const keep = cost([0x32, 0x00, 0x00, 0x3a, 0x00, 0x00]);
    const pushPop = cost([0xf5, 0xf1]);
    const s = why([0xf5, 0xcd, 0x06, 0x70, 0xf1, RET, RET])[0]!;
    expect(s).toContain(`${bytesText(pushPop.b)} and ${pushPop.t} T-states in all`);
    expect(s).toContain(`would take ${bytesText(keep.b)} and ${keep.t} T-states`);
  });
});
