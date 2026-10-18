/** Explain's "what it does here": a value's proven journey, and what its destination means on a TRS-80. */
import { describe, expect, it } from 'vitest';
import { explainLine, sentenceText } from '../../src/explain/index.js';
import { openProgram } from '../../src/session.js';

const raw = (bytes: number[]) => openProgram(new Uint8Array(bytes), { base: 0x7000, selection: { machine: 3, dos: 'trsdos' } });
/** The "what it does here" sentences for the line at `at` (default: the first) of a program `bytes`. */
const why = (bytes: number[], at = 0x7000): string[] => (explainLine(raw(bytes), at).why?.purpose ?? []).map(sentenceText);
/** The routine reference for the line at `at`. */
const routine = (bytes: number[], at = 0x7000): string[] => (explainLine(raw(bytes), at).why?.routine ?? []).map(sentenceText);
const RET = 0xc9;

describe('what it does here: proven flow', () => {
  it('carries a byte to the screen', () => {
    // 7000 LD A,(5A20H); 7003 LD (3C45H),A; 7006 RET
    const bytes = [0x3a, 0x20, 0x5a, 0x32, 0x45, 0x3c, RET];
    expect(why(bytes)).toEqual(['A carries the byte read from $5A20 to $3C45 (VIDEO+0045H, the screen, row 1, column 5): the LD (VIDEO+0045H),A at $7003 stores it there.']);
    expect(why(bytes, 0x7003)).toEqual(['A carries the byte read from $5A20, set at $7000, to the screen here, at row 1, column 5.']);
    // The routine reference is its own field, not part of the purpose.
    expect(routine(bytes, 0x7003)).toEqual(['It is part of the routine at $7000, which writes to the screen.']);
    expect(routine(bytes)).toEqual([]); // the routine's own start
    // A known character: where it shows.
    // 7000 LD A,58H; 7002 LD (3C45H),A; 7005 RET
    const x = [0x3e, 0x58, 0x32, 0x45, 0x3c, RET];
    expect(why(x)).toEqual(['A carries $58 to $3C45 (VIDEO+0045H, the screen, row 1, column 5): the LD (VIDEO+0045H),A at $7002 stores it there, where it shows as "X".']);
    expect(why(x, 0x7002)).toEqual(['A carries $58, set at $7000, to the screen here, at row 1, column 5, where it shows as "X".']);
  });

  it('lowercase shows as lowercase only where the machine has it', () => {
    // 7000 LD A,61H ("a"); 7002 LD (3C45H),A; 7005 RET
    const bytes = [0x3e, 0x61, 0x32, 0x45, 0x3c, RET];
    expect(why(bytes)[0]).toMatch(/, where it shows as "a"\.$/); // Model III
    const m1 = openProgram(new Uint8Array(bytes), { base: 0x7000, selection: { machine: 1, dos: 'none' } });
    // A stock Model I has no bit 6 in video RAM ($61 shows as "!"), so nothing is named there.
    expect(sentenceText(explainLine(m1, 0x7000).why!.purpose[0]!)).not.toMatch(/shows as/);
    expect(sentenceText(explainLine(m1, 0x7002).why!.purpose[0]!)).not.toMatch(/shows as/);
    // No machine selected: $60-$7F are not named.
    const none = openProgram(new Uint8Array(bytes), { base: 0x7000 });
    expect(sentenceText(explainLine(none, 0x7000).why!.purpose[0]!)).not.toMatch(/shows as/);
  });

  it('a rewritten displacement gives no number', () => {
    // 7000 LD (7005H),A; 7003 LD A,(IY+05H), whose displacement (7005) the program stores over; 7006 INC A; 7007 RET
    const fwd = why([0x32, 0x05, 0x70, 0xfd, 0x7e, 0x05, 0x3c, RET], 0x7003);
    expect(fwd).toEqual(['A holds the byte at an offset from IY that the program rewrites as it runs; its next use is the INC A at $7006.']);
    // The store line: 7000 LD (7005H),A; 7003 LD A,(IX+05H) (rewritten); 7006 LD (3C00H),A; 7009 RET
    const bytes = [0x32, 0x05, 0x70, 0xdd, 0x7e, 0x05, 0x32, 0x00, 0x3c, RET];
    expect(why(bytes, 0x7003)[0]).toMatch(/^A carries the byte at an offset from IX that the program rewrites as it runs to \$3C00/);
    expect(why(bytes, 0x7006)).toEqual(['A carries the byte at an offset from IX that the program rewrites as it runs, set at $7003, to the screen here, at row 0, column 0.']);
    for (const at of [0x7003, 0x7006]) expect(why(bytes, at).join(' ')).not.toMatch(/\$05|IX\+/);
  });

  it('a key from the ROM tested for ENTER', () => {
    // 7000 CALL 0049H ($KBWAIT: "wait for a key and return it in A"); 7003 CP 0DH; 7005 RET
    const bytes = [0xcd, 0x49, 0x00, 0xfe, 0x0d, RET];
    expect(why(bytes, 0x7003)).toEqual(['A holds what the ROM routine $KBWAIT ($0049), called at $7000, returns in A, and this CP 0DH tests it for $0D, the code of the ENTER key.']);
    expect(why(bytes)).toEqual(['A holds what the ROM routine $KBWAIT ($0049) returns in A; the CP 0DH at $7003 tests it for $0D, the code of the ENTER key.']);
    // The Model III table's $KBCHAR does not say which register it returns in, so nothing is claimed;
    // the Model I table's does ("A returns the key's character code").
    const kb = [0xcd, 0x2b, 0x00, 0xfe, 0x0d, RET];
    expect(why(kb, 0x7003)).toEqual([]);
    const m1 = openProgram(new Uint8Array(kb), { base: 0x7000, selection: { machine: 1, dos: 'none' } });
    expect((explainLine(m1, 0x7003).why?.purpose ?? []).map(sentenceText)).toEqual(['A holds what the ROM routine $KBCHAR ($002B), called at $7000, returns in A, and this CP 0DH tests it for $0D, the code of the ENTER key.']);
    // Not a key routine: no key name. 7000 CALL 0235H (read one byte from the cassette into A); 7003 CP 0DH
    expect(why([0xcd, 0x35, 0x02, 0xfe, 0x0d, RET], 0x7003).join(' ')).not.toMatch(/ENTER/);
  });

  it('a DJNZ count', () => {
    // 7000 LD B,8; 7002 LD HL,3C00H; 7005 INC (HL); 7006 DJNZ 7005; 7008 RET
    const bytes = [0x06, 0x08, 0x21, 0x00, 0x3c, 0x34, 0x10, 0xfd, RET];
    expect(why(bytes)).toEqual(['B holds $08 as the count for the DJNZ at $7006: the loop from $7005 runs 8 times.']);
    expect(why(bytes, 0x7006)).toEqual(['B holds $08 when the loop from $7005 is entered (set at $7000), so it runs 8 times.']);
    // An early exit makes the count a bound.
    // 7000 LD B,8; 7002 INC (HL); 7003 JR Z,7007; 7005 DJNZ 7002; 7007 RET
    const exit = [0x06, 0x08, 0x34, 0x28, 0x02, 0x10, 0xfb, RET];
    expect(why(exit)).toEqual(['B holds $08 as the count for the DJNZ at $7005: the loop from $7002 runs at most 8 times, leaving early at $7003.']);
  });

  it('stops at a branch', () => {
    // 7000 LD A,(5A20H); 7003 JR NZ,7008; 7005 LD (3C00H),A; 7008 RET
    const s = why([0x3a, 0x20, 0x5a, 0x20, 0x03, 0x32, 0x00, 0x3c, RET]);
    expect(s).toEqual(['A holds the byte read from $5A20; its next use is not certain: the code branches at $7003.']);
    expect(s.join(' ')).not.toMatch(/3C00|screen/);
    // A join stops it too: 7000 LD A,(5A20H); 7003 NOP (jumped to from 7006); 7004 LD (3C00H),A; 7007 JR 7003
    const j = why([0x3a, 0x20, 0x5a, 0x00, 0x32, 0x00, 0x3c, 0x18, 0xfa]);
    expect(j).toEqual(['A holds the byte read from $5A20; its next use is not certain: other code also arrives at $7003.']);
    // A call to the program's own routine may use or change it.
    // 7000 LD A,5; 7002 CALL 7008H; 7005 LD (3C00H),A; 7008 RET
    expect(why([0x3e, 0x05, 0xcd, 0x08, 0x70, 0x32, 0x00, 0x3c, RET])).toEqual(['A holds $05; its next use is not certain: the call at $7002 may use or change it.']);
  });

  it('a variable is not a constant', () => {
    // 7000 LD A,(7008H); 7003 INC A; 7004 LD (7008H),A; 7007 RET; 7008 DEFB 05H
    const bytes = [0x3a, 0x08, 0x70, 0x3c, 0x32, 0x08, 0x70, RET, 0x05];
    const s = why(bytes);
    expect(s).toEqual(['A holds the byte read from $7008 (DATA_7008; the program also writes it at $7004); its next use is the INC A at $7003.']);
    expect(s.join(' ')).not.toMatch(/\$05\b/);
    // The stores stay inside the parentheses, so ", set at" cannot be read as one of them.
    // 7000 LD A,(8000H); 7003 LD (3C00H),A; 7006 LD (8000H),A; 7009 RET
    const out = [0x3a, 0x00, 0x80, 0x32, 0x00, 0x3c, 0x32, 0x00, 0x80, RET];
    expect(why(out, 0x7003)).toEqual(['A carries the byte read from $8000 (the program also writes it at $7006), set at $7000, to the screen here, at row 0, column 0.']);
  });

  it('a bare result whose next use is not certain says nothing', () => {
    // 7000 INC A; 7001 JR Z,7004H; 7003 RET; 7004 RET
    expect(why([0x3c, 0x28, 0x01, RET, RET])).toEqual([]);
    // A proven value still speaks: 7000 XOR A; 7001 JR Z,7004H; 7003 RET; 7004 RET
    expect(why([0xaf, 0x28, 0x01, RET, RET])).toEqual(['A holds the result ($00); its next use is not certain: the code branches at $7001.']);
  });

  it('OR A and AND A leave A as it was: no new value, and the store names the load before them', () => {
    // 7000 LD A,58H; 7002 OR A; 7003 LD (3C00H),A; 7006 RET
    for (const op of [0xb7, 0xa7]) {
      const bytes = [0x3e, 0x58, op, 0x32, 0x00, 0x3c, RET];
      expect(why(bytes, 0x7002)).toEqual([]);
      // The tracker does not carry A's value across the OR, so no character is named.
      expect(why(bytes, 0x7003)).toEqual(['A carries $58, set at $7000, to the screen here, at row 0, column 0.']);
    }
  });

  it('a ROM routine that takes the register gets the value, not a second copy of its purpose', () => {
    // 7000 LD A,58H; 7002 CALL 0033H; 7005 RET
    expect(why([0x3e, 0x58, 0xcd, 0x33, 0x00, RET])).toEqual(['A holds $58; it goes into the call at $7002 to the ROM routine $VDCHAR ($0033).']);
  });

  it('port $FF and the keyboard get their TRS-80 meaning', () => {
    // 7000 LD A,1; 7002 OUT (0FFH),A; 7004 RET
    expect(why([0x3e, 0x01, 0xd3, 0xff, RET])).toEqual([
      'A carries $01 to port $FF (CASSETTE): the OUT (CASSETTE),A at $7002 sends it there.',
      'Programs on the TRS-80 also make sound by switching the cassette output.',
    ]);
    expect(why([0x3e, 0x01, 0xd3, 0xff, RET], 0x7002).slice(0, 2)).toEqual(['A carries $01, set at $7000, to port $FF (CASSETTE) here.', 'Programs on the TRS-80 also make sound by switching the cassette output.']);
    // 7000 LD A,(3801H); 7003 AND 01H; 7005 RET
    expect(why([0x3a, 0x01, 0x38, 0xe6, 0x01, RET])[0]).toMatch(/^A holds the byte read from \$3801 \(KEYBOARD\+0001H\), the keyboard matrix, where a set bit is a key held down; its next use is the AND 01H at \$7003\.$/);
  });

  it('names the routine when it writes to the screen', () => {
    // 7000 CALL 7004H; 7003 RET; 7004 LD A,2AH; 7006 LD (3C00H),A; 7009 RET
    const bytes = [0xcd, 0x04, 0x70, RET, 0x3e, 0x2a, 0x32, 0x00, 0x3c, RET];
    expect(routine(bytes, 0x7006)).toEqual(['It is part of the routine SUB_7004 ($7004), which writes to the screen.']);
    expect(why(bytes, 0x7006).join(' ')).not.toMatch(/It is part of/);
    // Ports and the keyboard, from the summary's facts: 7000 CALL 7004H; 7003 RET; 7004 LD A,(3801H); 7007 OUT (0FFH),A; 7009 RET
    expect(routine([0xcd, 0x04, 0x70, RET, 0x3a, 0x01, 0x38, 0xd3, 0xff, RET], 0x7007)).toEqual(['It is part of the routine SUB_7004 ($7004), which reads the keyboard and writes to port $FF.']);
  });

  it('addresses are links', () => {
    const s = explainLine(raw([0x3a, 0x20, 0x5a, 0x32, 0x45, 0x3c, RET]), 0x7000).why!.purpose[0]!;
    expect(s.find((p) => p.text === '$7003')?.addr).toBe(0x7003);
  });

  it('nothing proven, nothing said', () => {
    expect(why([0x00, RET])).toEqual([]); // NOP
    // 7000 LD C,5; 7002 LD C,6; 7004 RET: replaced before any use
    expect(why([0x0e, 0x05, 0x0e, 0x06, RET])).toEqual([]);
    // 7000 CALL 7007H; 7003 LD (6000H),A; 7006 RET; 7007 RET: what the call leaves in A is not proven
    expect(why([0xcd, 0x07, 0x70, 0x32, 0x00, 0x60, RET, RET], 0x7003)).toEqual([]);
    // A rewritten opcode: 7000 LD (7005H),A; 7003 NOP; 7004 NOP; 7005 LD A,5; 7007 LD (3C00H),A; 700A RET
    expect(why([0x32, 0x05, 0x70, 0x00, 0x00, 0x3e, 0x05, 0x32, 0x00, 0x3c, RET], 0x7005)).toEqual([]);
  });

  it('a rewritten operand states no value', () => {
    // 7000 LD (7004H),A; 7003 LD A,5 (7004 is its operand); 7005 LD (3C00H),A; 7008 RET
    const bytes = [0x32, 0x04, 0x70, 0x3e, 0x05, 0x32, 0x00, 0x3c, RET];
    for (const at of [0x7003, 0x7005]) expect(why(bytes, at).join(' ')).not.toMatch(/\$05\b/);
    expect(why(bytes, 0x7003)[0]).toMatch(/^A carries the number in this instruction, which the program rewrites as it runs, to \$3C00/);
  });
});
