/**
 * Errors go on the right line, as sentences that name the problem and the
 * fix, and every error in a program is reported at once. An error-free
 * result is the only one with an image.
 */
import { describe, expect, it } from 'vitest';
import { assemble } from '../src/index.js';
import { bytesOf, diagnosticsOf, errorsOf } from './helpers.js';

const lines = (...l: string[]): string => l.join('\n');

describe('typos get one error with a suggestion (Review Focus 5)', () => {
  it('LDA 5 suggests LD A,…', () => {
    expect(diagnosticsOf(assemble(lines('\tORG 6000H', '\tLDA 5')))).toEqual(['2:2-5 error: Unknown instruction LDA. Did you mean LD A,…?']);
  });

  it('JMP X suggests JP, by edit distance over the mnemonics', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', 'X:\tJMP X')))).toEqual(['2: Unknown instruction JMP. Did you mean JP?']);
  });

  it('a register glued to a mnemonic is split', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tINCA', '\tPUSHHL')))).toEqual(['2: Unknown instruction INCA. Did you mean INC A?', '3: Unknown instruction PUSHHL. Did you mean PUSH HL?']);
  });

  it('a transposition is one edit', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tLDRI')))).toEqual(['2: Unknown instruction LDRI. Did you mean LDIR?']);
  });

  it('nothing close gives no guess', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tFROBNICATE 1')))).toEqual(['2: Unknown instruction FROBNICATE.']);
  });

  it('an indented word alone, which zmac would take as a label with a warning, is an error', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '  START')))).toEqual(['2: Unknown instruction START. If START is a label, start it in column 1 or end it with a colon.']);
  });

  it('an indented label before an instruction (a zmac syntax error)', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '  foo\tNOP')))).toEqual(['2: Unknown instruction FOO. If FOO is a label, start it in column 1 or end it with a colon.']);
  });

  it('an instruction with operands in column 1 (a zmac syntax error)', () => {
    expect(diagnosticsOf(assemble(lines('\tORG 6000H', 'ld a,1')))).toEqual(['2:1-3 error: LD starts in column 1, where a word is a label. Put a space or tab before it.']);
  });

  it('the rest of the program still assembles, so every error shows at once', () => {
    const result = assemble(lines('\tORG 6000H', '\tLDA 5', '\tNOP', 'X:\tJMP X', '\tLD A,300', '\tCALL NOWHERE'));
    expect(errorsOf(result)).toEqual([
      '2: Unknown instruction LDA. Did you mean LD A,…?',
      '4: Unknown instruction JMP. Did you mean JP?',
      '5: LD A,n takes a byte, -128 to 255; 300 ($012C) is out of range.',
      '6: NOWHERE is not defined.',
    ]);
    expect(result.ok).toBe(false);
    expect(result.image).toBeNull();
  });

  it('a line with an error has no bytes, and later addresses do not move', () => {
    const result = assemble(lines('\tORG 6000H', '\tLD A,300', 'AFTER:\tNOP'));
    expect(result.listing[1]).toEqual({ line: 2, address: 0x6000, load: 0x6000, bytes: [], text: '\tLD A,300' });
    expect(result.symbols.get('AFTER')?.value).toBe(0x6002);
  });
});

describe('a bad line keeps its label', () => {
  it('a label on a line with an error is still defined, so its uses raise nothing more', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', 'LOOP:\tLD A,(5', '\tJP LOOP', '\tJP LOOP')))).toEqual(['2: This ( has no matching ).']);
    expect(errorsOf(assemble(lines('\tORG 6000H', 'LOOP\tLD A,0b101', '\tJP LOOP')))).toEqual(['2: 0b101 is not a number; write binary as 101B.']);
    expect(errorsOf(assemble(lines('\tORG 6000H', "LOOP:\tDB 'é'", '\tJP LOOP')))).toEqual(['2: This string holds é, which is not plain ASCII; write its code as a number instead.']);
    expect(errorsOf(assemble(lines('\tORG 6000H', 'LOOP:\tFROB 1', '\tJP LOOP')))).toEqual(['2: Unknown instruction FROB.']);
  });

  it('a character outside the BMP is named and marked whole, not as half a surrogate pair', () => {
    expect(diagnosticsOf(assemble(lines('\tORG 6000H', "\tDB '😀'")))).toEqual(['2:6-8 error: This string holds 😀, which is not plain ASCII; write its code as a number instead.']);
    expect(diagnosticsOf(assemble(lines('\tORG 6000H', '\tDB 1😀')))).toEqual(['2:6-8 error: 😀 has no meaning here.']);
  });

  it('an EQU whose value has an error is defined but failed, so its uses raise nothing more', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', 'X\tEQU 0b101', '\tDB X')))).toEqual(['2: 0b101 is not a number; write binary as 101B.']);
  });
});

describe('symbols', () => {
  it('an undefined symbol names itself, at its column, with the nearest name', () => {
    expect(diagnosticsOf(assemble(lines('\tORG 6000H', 'LOOP:\tNOP', '\tJP LOOP2')))).toEqual(['3:5-10 error: LOOP2 is not defined. Did you mean LOOP?']);
  });

  it('a duplicate label names both lines', () => {
    expect(diagnosticsOf(assemble(lines('\tORG 6000H', 'LOOP:\tNOP', '\tNOP', 'loop:\tNOP')))).toEqual(['4:1-5 error: LOOP is defined twice, on lines 2 and 4. Rename one of them.']);
  });

  it('an EQU and a label with the same name are a duplicate too', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', 'X\tEQU 5', 'X:\tNOP')))).toEqual(['3: X is defined twice, on lines 2 and 3. Rename one of them.']);
  });

  it('a register or condition name cannot be a label', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', 'A:\tNOP', 'HL:\tNOP', 'NZ:\tNOP')))).toEqual([
      '2: A is a register name, so it cannot be a label.',
      '3: HL is a register name, so it cannot be a label.',
      '4: NZ is a condition name, so it cannot be a label.',
    ]);
  });

  it('an operator word cannot be a label', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', 'HIGH:\tNOP')))).toEqual(['2: HIGH is an operator in expressions, so it cannot be a label.']);
  });

  it('ORG cannot use a name defined further down (Review Focus 2)', () => {
    expect(errorsOf(assemble(lines('\tORG BASE', 'BASE\tEQU 6000H', '\tNOP')))).toEqual([
      '1: ORG cannot use BASE before BASE is defined, because the addresses after this line depend on it. Define BASE above the ORG.',
    ]);
  });
});

describe('every out-of-range value is an error naming the value and the limit (Review Focus 3)', () => {
  it('JR names the target label', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', 'LOOP:\tNOP', '\tORG 612AH', '\tJR LOOP')))).toEqual(['4: JR reaches 128 bytes either way; LOOP is 300 bytes back. Use JP.']);
  });

  it('DJNZ names the target label', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tDJNZ FAR', '\tORG 6100H', 'FAR:\tNOP')))).toEqual(['2: DJNZ reaches 128 bytes either way; FAR is 254 bytes ahead. Use DEC B and JP NZ.']);
  });

  it('a JR across $FFFF is refused, as zmac does', () => {
    expect(errorsOf(assemble(lines('\tORG 0FFF0H', '\tJR 0005H')))).toEqual(['2: JR cannot wrap around the top of memory from $FFF0 to $0005. Use JP.']);
  });

  it('a range error marks the operand at fault', () => {
    expect(diagnosticsOf(assemble(lines('\tORG 6000H', '\tLD A, 256')))).toEqual(['2:8-11 error: LD A,n takes a byte, -128 to 255; 256 ($0100) is out of range.']);
    expect(diagnosticsOf(assemble(lines('\tORG 6000H', '\tLD (IX+200),5')))).toEqual(['2:5-13 error: The displacement in (IX+d) runs from -128 to 127; 200 ($C8) is out of range.']);
    expect(diagnosticsOf(assemble(lines('\tORG 6000H', '\tBIT 8,A')))).toEqual(['2:6-7 error: BIT takes a bit number from 0 to 7; 8 is out of range.']);
    expect(diagnosticsOf(assemble(lines('\tORG 6000H', '\tSUB A,300')))).toEqual(['2:8-11 error: SUB n takes a byte, -128 to 255; 300 ($012C) is out of range.']);
    expect(diagnosticsOf(assemble(lines('\tORG 6000H', '\tADD 300')))).toEqual(['2:6-9 error: ADD A,n takes a byte, -128 to 255; 300 ($012C) is out of range.']);
  });

  it('a condition is called a condition, not a register', () => {
    expect(errorsOf(assemble(lines('\tORG Z')))).toEqual(['1: ORG needs an address; Z is a condition.']);
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tDB NZ')))).toEqual(['2: DB takes values; NZ is a condition.']);
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tDB B')))).toEqual(['2: DB takes values; B is a register.']);
    expect(errorsOf(assemble(lines('\tORG 6000H', 'X\tEQU PE')))).toEqual(['2: EQU needs a value; PE is a condition.']);
  });

  it.each([
    ['LD A,256', 'LD A,n takes a byte, -128 to 255; 256 ($0100) is out of range.'],
    ['LD A,-129', 'LD A,n takes a byte, -128 to 255; -129 is out of range.'],
    ["LD A,'ab'", 'LD A,n takes a byte, -128 to 255; 25185 ($6261) is out of range.'],
    ['LD HL,65536', 'LD HL,nn takes a word, -32768 to 65535; 65536 ($10000) is out of range.'],
    ['OUT (256),A', 'OUT (n),A takes a port, 0 to 255; 256 ($0100) is out of range.'],
    ['OUT (-1),A', 'OUT (n),A takes a port, 0 to 255; -1 is out of range.'],
    ['LD A,(IX+128)', 'The displacement in (IX+d) runs from -128 to 127; 128 ($80) is out of range.'],
    ['SET 3,(IX+200)', 'The displacement in (IX+d) runs from -128 to 127; 200 ($C8) is out of range.'],
    ['IM 3', 'IM takes 0, 1, or 2; 3 is not one of them.'],
    ['BIT 8,A', 'BIT takes a bit number from 0 to 7; 8 is out of range.'],
    ['RST 9', 'RST takes 0, 8, 10H, 18H, 20H, 28H, 30H, or 38H; 9 is not one of them.'],
    ['RST 1', 'RST takes 0, 8, 10H, 18H, 20H, 28H, 30H, or 38H; 1 is not one of them. zmac reads RST 1 as RST 8; write RST 8 if that is what you mean.'],
    ['DB 256', 'DB takes bytes, -128 to 255; 256 ($0100) is out of range.'],
    ['DW 65536', 'DW takes words, -32768 to 65535; 65536 ($10000) is out of range.'],
  ])('%s', (line, message) => {
    expect(errorsOf(assemble(lines('\tORG 6000H', `\t${line}`)))).toEqual([`2: ${message}`]);
  });
});

describe('forms and parentheses', () => {
  it('JP (nn) is refused, since zmac only warns that it means JP nn', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tJP (1234H)')))).toEqual(['2: JP (1234H) jumps to 1234H; it does not read an address from memory there. Write JP 1234H.']);
  });

  it('LD with a parenthesised number is always memory, as in zmac', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tLD B,(5)')))).toEqual(['2: Only A can be loaded from an address; use LD A,(5) then LD B,A.']);
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tLD (HL),(SCREEN)', 'SCREEN\tEQU 3C00H')))).toEqual(['2: Only A can be loaded from an address; use LD A,(SCREEN) then LD (HL),A.']);
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tLD (5),B')))).toEqual(['2: Only A can be stored at an address from a single register; use LD A,B then LD (5),A.']);
  });

  it('a form that does not exist is named as written, with at most five forms listed', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tPUSH (5)')))).toEqual(['2: PUSH has no form (5). Its forms are AF, BC, DE, HL, IX, and IY.']);
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tINC (5)')))).toEqual(['2: INC has no form (5). Its forms include (HL), (IX+offset), (IY+offset), A, B, and 15 more.']);
  });

  it('a missing comma is named', () => {
    expect(diagnosticsOf(assemble(lines('\tORG 6000H', '\tLD A B')))).toEqual(['2:5-8 error: A comma is missing between A and B.']);
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tLD (HL) 5')))).toEqual(['2: A comma is missing between (HL) and 5.']);
  });

  it('an index register inside a larger expression is an error', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tLD A,(IX+2)+1')))).toEqual(['2: IX is a register; it cannot be part of an expression.']);
  });

  it('undocumented ED forms keep their sentence', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tIN F,(C)')))).toEqual(['2: IN F,(C) is undocumented, and Fugløy writes it as DB 0EDH,70H; use that instead.']);
  });

  it('a trailing comma or an empty operand is an error', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tLD A,', '\tDB 1,,2')))).toEqual(['2: An operand is missing after the comma.', '3: An operand is missing after the comma.']);
  });

  it('DB with nothing after it says what it needs', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tDB')))).toEqual(['2: DB needs at least one value.']);
  });
});

/**
 * The spellings zmac reads but the tables do not give (zmac-probes.test.ts
 * pins zmac's bytes for each): the error gives the exact rewrite, and the
 * rewrite assembles to the bytes zmac gave the original spelling.
 */
describe("zmac's other spellings get the exact rewrite", () => {
  const CASES: { written: string; message: string; zmac: number[] }[] = [
    { written: 'IN 38H', message: 'IN needs A and the port in parentheses: write IN A,(38H).', zmac: [0xdb, 0x38] },
    { written: 'IN (38H)', message: 'IN needs A and the port in parentheses: write IN A,(38H).', zmac: [0xdb, 0x38] },
    { written: 'OUT 12H', message: 'OUT needs the port in parentheses and then A: write OUT (12H),A.', zmac: [0xd3, 0x12] },
    { written: 'OUT (12H)', message: 'OUT needs the port in parentheses and then A: write OUT (12H),A.', zmac: [0xd3, 0x12] },
    { written: 'JP HL', message: 'JP HL jumps to the address in HL, which Z80 assembly writes in parentheses: write JP (HL).', zmac: [0xe9] },
    { written: 'JP IX', message: 'JP IX jumps to the address in IX, which Z80 assembly writes in parentheses: write JP (IX).', zmac: [0xdd, 0xe9] },
    { written: 'POP A', message: "POP works on register pairs, and A is the 8080's short name for AF: write POP AF.", zmac: [0xf1] },
    { written: 'PUSH B', message: "PUSH works on register pairs, and B is the 8080's short name for BC: write PUSH BC.", zmac: [0xc5] },
    { written: 'PUSH H', message: "PUSH works on register pairs, and H is the 8080's short name for HL: write PUSH HL.", zmac: [0xe5] },
    { written: 'PUSH D', message: "PUSH works on register pairs, and D is the 8080's short name for DE: write PUSH DE.", zmac: [0xd5] },
    { written: "PUSH AF'", message: "PUSH works on AF, not the shadow AF': write PUSH AF.", zmac: [0xf5] },
    { written: "POP AF'", message: "POP works on AF, not the shadow AF': write POP AF.", zmac: [0xf1] },
    { written: 'ADD M', message: "M is the 8080's name for the byte HL points at: write ADD A,(HL).", zmac: [0x86] },
    { written: 'SUB M', message: "M is the 8080's name for the byte HL points at: write SUB (HL).", zmac: [0x96] },
    { written: 'CP M', message: "M is the 8080's name for the byte HL points at: write CP (HL).", zmac: [0xbe] },
    {
      written: 'RL (IX+5),B',
      message: 'RL (IX+5),B is undocumented: it works on the byte at IX+5 and also copies the result into B. Fugløy writes it as data, so write DB 0DDH,0CBH,05H,10H.',
      zmac: [0xdd, 0xcb, 0x05, 0x10],
    },
    {
      written: 'SRL (IY),A',
      message: 'SRL (IY),A is undocumented: it works on the byte at IY and also copies the result into A. Fugløy writes it as data, so write DB 0FDH,0CBH,00H,3FH.',
      zmac: [0xfd, 0xcb, 0x00, 0x3f],
    },
    { written: 'IN (C)', message: 'IN (C) is undocumented, and Fugløy writes it as DB 0EDH,70H; use that instead.', zmac: [0xed, 0x70] },
  ];
  for (const { written, message, zmac } of CASES) {
    it(`${written}`, () => {
      expect(errorsOf(assemble(lines('\tORG 6000H', `\t${written}`)))).toEqual([`2: ${message}`]);
      const rewrite = /.*(?:write|writes it as) (.+?)(?:; use that instead)?\.$/.exec(message)![1]!;
      expect(bytesOf(['\tORG 6000H', `\t${rewrite}`].join('\n')), rewrite).toEqual(zmac);
    });
  }
  it('after JP, CALL, JR, and RET, M is the condition: a missing address is said so, never rewritten to (HL)', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tJP M', '\tCALL NZ', '\tJR C', '\tJR M')))).toEqual([
      '2: JP M names a condition but no address to go to: write JP M,label.',
      '3: CALL NZ names a condition but no address to go to: write CALL NZ,label.',
      '4: JR C names a condition but no address to go to: write JR C,label.',
      '5: JR has no form M. Its forms are C,label, NC,label, NZ,label, Z,label, and label.',
    ]);
    expect(bytesOf(lines('\tORG 6000H', '\tRET M', '\tJP M,6000H'))).toEqual([0xf8, 0xfa, 0x00, 0x60]);
  });
  it('RES and SET copies to a register are rewritten the same way', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tRES 3,(IX-2),C')))).toEqual([
      '2: RES 3,(IX-2),C is undocumented: it works on the byte at IX-2 and also copies the result into C. Fugløy writes it as data, so write DB 0DDH,0CBH,0FEH,99H.',
    ]);
  });
});

describe('$ and hex digits', () => {
  it('$FFH is not defined, and the message says to choose $ or H', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tDB $FFH')))).toEqual(['2: $FFH is not defined. A hex number takes $ or H, not both: write $FF or 0FFH.']);
  });
  it('$ with hex digits and a ? is refused, since zmac reads the ? as F', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '$?\tEQU 5')))).toEqual(['2: $? is neither a name nor a number: after $, zmac reads ? as the hex digit F. Write the number as $F, or choose a name with a letter from G to Z in it.']);
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tDB $A?')))).toEqual(['2: $A? is neither a name nor a number: after $, zmac reads ? as the hex digit F. Write the number as $AF, or choose a name with a letter from G to Z in it.']);
  });
  it('$ with ., @, or a ? after a letter from G on starts a name', () => {
    expect(bytesOf(lines('\tORG 6000H', '$.X\tEQU 5', '$@\tEQU 6', '$?X\tEQU 7', '\tDB $.X,$@,$?X'))).toEqual([5, 6, 7]);
  });
});

describe('an instruction with no operands says what it needs (final review 2)', () => {
  it('a jump or call needs a target, in words', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tDJNZ', '\tJP', '\tCALL', '\tJR')))).toEqual([
      '2: DJNZ needs a target: write DJNZ label.',
      '3: JP needs a target: write JP label.',
      '4: CALL needs a target: write CALL label.',
      '5: JR needs a target: write JR label.',
    ]);
  });
  it('the rest name one form to copy, and RST its addresses', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tLD', '\tRST', '\tINC', '\tOUT')))).toEqual([
      '2: LD needs operands: write LD A,number, for example.',
      '3: RST needs a restart address, one of 0, 8, 10H, 18H, 20H, 28H, 30H, and 38H: write RST 28H, for example.',
      '4: INC needs an operand: write INC A, for example.',
      '5: OUT needs operands: write OUT (port),A, for example.',
    ]);
  });
  it('form lists use words, not the Zilog letters nn, n, d, and p', () => {
    const errors = errorsOf(assemble(lines('\tORG 6000H', '\tCALL HL', '\tRST A', '\tLD HL,(BC)', '\tINC (5)')));
    expect(errors).toEqual([
      '2: CALL has no form HL. Its forms include C,label, M,label, NC,label, NZ,label, P,label, and 4 more.',
      '3: RST has no form A. RST takes a restart address, one of 0, 8, 10H, 18H, 20H, 28H, 30H, and 38H.',
      '4: LD has no form HL,(BC). The forms that start with HL are HL,(address) and HL,number.',
      '5: INC has no form (5). Its forms include (HL), (IX+offset), (IY+offset), A, B, and 15 more.',
    ]);
    for (const e of errors) expect(e).not.toMatch(/\b(nn|n|p)\b|\+d\)/);
  });
});

describe('a service call or port is a number, never a target or an address (final review 3)', () => {
  it('on the Model 4, CALL @CLS and JP @EXIT say how to make the call', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tCALL @CLS', '\tJP @EXIT', '\tLD HL,(@CLS)'), { model: 4 }))).toEqual([
      '2: @CLS is an LS-DOS 6 service call number (105), not an address: to make the call, write LD A,@CLS then RST 28H.',
      '3: @EXIT is an LS-DOS 6 service call number (22), not an address: to make the call, write LD A,@EXIT then RST 28H.',
      '4: @CLS is an LS-DOS 6 service call number (105), not an address: to make the call, write LD A,@CLS then RST 28H.',
    ]);
    expect(assemble(lines('\tORG 6000H', '\tLD A,@CLS', '\tRST 28H'), { model: 4 }).ok).toBe(true);
  });
  it('a port name as a target or an address says to use IN or OUT, and IN and OUT take it', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tJP CASSETTE', '\tLD A,(CASSETTE)', '\tIN A,(CASSETTE)', '\tOUT (CASSETTE),A')))).toEqual([
      '2: CASSETTE is a port number (255 ($FF)), not an address: read it with IN A,(CASSETTE) or write it with OUT (CASSETTE),A.',
      '3: CASSETTE is a port number (255 ($FF)), not an address: read it with IN A,(CASSETTE) or write it with OUT (CASSETTE),A.',
    ]);
  });
  it('a name the source defines is the source\'s, whatever the tables say', () => {
    expect(assemble(lines('\tORG 6000H', '@CLS:\tRET', '\tCALL @CLS'), { model: 4 }).ok).toBe(true);
  });
  it('CALL CLS on the Model III points to $VDCLS, the ROM routine', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tCALL CLS'), { model: 3 }))).toEqual([
      '2: CLS is not defined. @CLS is an LS-DOS 6 service call, which only the Model 4 has. On the Model III, did you mean $VDCLS, the Model III ROM routine at $01C9 (clear the screen)?',
    ]);
  });
  it('CALL CLS on the Model 4 suggests the routine first, and says how a service call is made', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tCALL CLS'), { model: 4 }))).toEqual([
      '2: CLS is not defined. Did you mean $VDCLS, the Model III ROM routine at $01C9 (clear the screen)? (@CLS is an LS-DOS 6 service call number, not an address: to use it, write LD A,@CLS then RST 28H.)',
    ]);
  });
});

describe('the last messages (final review 6)', () => {
  it('an instruction where a value goes says one instruction per line', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tNOP NOP', '\tLD A,RET')))).toEqual([
      '2: NOP is an instruction, not a value; put one instruction per line.',
      '3: RET is an instruction, not a value; put one instruction per line.',
    ]);
  });
  it('IF, MACRO, and INCLUDE are not supported yet', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tIF 1', '\tENDIF', 'MAC\tMACRO', '\tENDM', '\tINCLUDE "x.z"')))).toEqual([
      '2: Fugløy does not support conditional assembly (IF) yet; keep the lines you want and delete the rest.',
      '3: Fugløy does not support conditional assembly (ENDIF) yet; keep the lines you want and delete the rest.',
      '4: Fugløy does not support macros (MACRO) yet; write the instructions out where they are used.',
      '5: Fugløy does not support macros (ENDM) yet; write the instructions out where they are used.',
      '6: Fugløy does not support INCLUDE yet; put the whole program in one file.',
    ]);
  });
  it('MOV and MVI point to LD, with M as (HL)', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tMOV A,B', '\tMOV M,A', '\tMVI A,5')))).toEqual([
      "2: MOV is the 8080's name for what the Z80 calls LD: write LD A,B.",
      "3: MOV is the 8080's name for what the Z80 calls LD: write LD (HL),A.",
      "4: MVI is the 8080's name for what the Z80 calls LD: write LD A,5.",
    ]);
  });
  it('OUT 0FFH,A and IN A,0FFH get the parentheses', () => {
    expect(errorsOf(assemble(lines('\tORG 6000H', '\tOUT 0FFH,A', '\tIN A,0FFH')))).toEqual([
      '2: OUT needs the port in parentheses: write OUT (0FFH),A.',
      '3: IN needs the port in parentheses: write IN A,(0FFH).',
    ]);
  });
});

describe('an exact rewrite comes as a fix too (final review 7)', () => {
  /** Applies a diagnostic's fix to the source. */
  const apply = (source: string, line: number): string => {
    const d = assemble(source).diagnostics.find((x) => x.line === line && x.fix !== undefined);
    expect(d, `no fix on line ${line}`).toBeDefined();
    const { fix } = d!;
    const all = source.split('\n');
    const text = all[fix!.line - 1]!;
    all[fix!.line - 1] = text.slice(0, fix!.column - 1) + fix!.replacement + text.slice(fix!.endColumn - 1);
    return all.join('\n');
  };
  it('each fix, applied, assembles to the bytes the message promised', () => {
    const cases: [string, number[]][] = [
      ['\tJP HL', [0xe9]],
      ['\tPUSH B', [0xc5]],
      ['\tIN 38H', [0xdb, 0x38]],
      ['\tOUT 0FFH,A', [0xd3, 0xff]],
      ['\tADD M', [0x86]],
      ['\tMOV A,M', [0x7e]],
      ['\tIN (C)', [0xed, 0x70]],
      ['\tRL (IX+5),B', [0xdd, 0xcb, 0x05, 0x10]],
      ['\tJP (6000H)', [0xc3, 0x00, 0x60]],
      ['\tSUB (5)', [0xd6, 0x05]],
      ['\tLD A,FFH', [0x3e, 0xff]],
      ['\tLD A,$FFH', [0x3e, 0xff]],
      ['\tLD A,%101', [0x3e, 0x05]],
      ['\tLD A,0b101', [0x3e, 0x05]],
      ['ld a,1', [0x3e, 0x01]],
    ];
    for (const [line, bytes] of cases) {
      const fixed = apply(lines('\tORG 6000H', line), 2);
      expect(bytesOf(fixed), `${line} -> ${fixed.split('\n')[1]}`).toEqual(bytes);
    }
  });
  it('the fix replaces the whole instruction, from the mnemonic to the last operand', () => {
    const d = assemble(lines('\tORG 6000H', '\tOUT 0FFH,A ; send')).diagnostics[0]!;
    expect(d.fix).toEqual({ line: 2, column: 2, endColumn: 12, replacement: 'OUT (0FFH),A' });
  });
  it('a message whose rewrite is the writer\'s to finish has no fix', () => {
    const d = assemble(lines('\tORG 6000H', '\tJP M')).diagnostics[0]!;
    expect(d.fix).toBeUndefined();
    expect(assemble(lines('\tORG 6000H', '\tCALL NOWHERE')).diagnostics[0]!.fix).toBeUndefined();
  });
});

describe('symbol(name) looks a name up in any case (final review 7)', () => {
  it('finds a label, an EQU, and a ROM name however it is written', () => {
    const r = assemble(lines('\tORG 6000H', 'Loop:\tJP loop', 'Count\tEQU 5', '\tCALL $vdcls'));
    expect(r.symbols.has('loop')).toBe(false);
    expect(r.symbol('loop')).toEqual({ value: 0x6000, line: 2, kind: 'label' });
    expect(r.symbol('LOOP')).toEqual(r.symbols.get('Loop'));
    expect(r.symbol('count')).toEqual({ value: 5, line: 3, kind: 'equ' });
    expect(r.symbol('$VDCLS')).toEqual({ value: 0x01c9, line: 0, kind: 'rom' });
    expect(r.symbol('nothing')).toBeUndefined();
  });
});
