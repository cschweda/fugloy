/**
 * The line syntax: labels, case, comments, operands, and the minimal
 * directives (ORG, EQU, DB/DEFB/DEFM, DW/DEFW) that Task 2's programs need.
 * Each rule that zmac decides is also a probe in zmac-probes.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { assemble } from '../src/index.js';
import { at6000, bytesOf, diagnosticsOf, errorsOf } from './helpers.js';

describe('labels', () => {
  it('a label in column 1 needs no colon', () => {
    expect(bytesOf(['\tORG 6000H', 'BAZ\tNOP', '\tJP BAZ'].join('\n'))).toEqual([0x00, 0xc3, 0x00, 0x60]);
  });

  it('a label with a colon may be indented', () => {
    expect(bytesOf(['\tORG 6000H', '  bar: NOP', '\tJP bar'].join('\n'))).toEqual([0x00, 0xc3, 0x00, 0x60]);
  });

  it('a label may stand alone on its line, with or without a colon', () => {
    expect(bytesOf(['\tORG 6000H', 'ONE', 'two:', '\tJP ONE', '\tJP TWO'].join('\n'))).toEqual([0xc3, 0x00, 0x60, 0xc3, 0x00, 0x60]);
  });

  it('labels are case-insensitive (zmac), and the symbol keeps its first spelling', () => {
    const result = assemble(['\tORG 6000H', 'Loop:\tNOP', '\tJP loop', '\tJP LOOP'].join('\n'));
    expect(errorsOf(result)).toEqual([]);
    expect([...result.image!.bytes.slice(0x6000, 0x6007)]).toEqual([0x00, 0xc3, 0x00, 0x60, 0xc3, 0x00, 0x60]);
    expect(result.symbols.get('Loop')).toEqual({ value: 0x6000, line: 2, kind: 'label' });
  });

  it('label characters: letters, digits, _ . $ @ ?', () => {
    expect(bytesOf(['\tORG 6000H', '_x: NOP', 'x.y: NOP', 'x$y: NOP', '@x: NOP', '?x: NOP', 'x1: JP x1'].join('\n'))).toEqual([0, 0, 0, 0, 0, 0xc3, 0x05, 0x60]);
  });

  it('a mnemonic may be a label when it has a colon (zmac)', () => {
    expect(bytesOf(['\tORG 6000H', 'ld: NOP', '\tJP ld'].join('\n'))).toEqual([0x00, 0xc3, 0x00, 0x60]);
  });

  it('a mnemonic alone in column 1 is an instruction (zmac)', () => {
    expect(bytesOf(['\tORG 6000H', 'nop', 'ret'].join('\n'))).toEqual([0x00, 0xc9]);
  });

  it('EQU takes a name with or without a colon, indented or not', () => {
    const src = ['\tORG 6000H', 'A1 EQU 1', '  A2 EQU 2', 'A3: EQU 3', '  A4:\tequ\t4', '\tDB A1,A2,A3,A4'].join('\n');
    expect(bytesOf(src)).toEqual([1, 2, 3, 4]);
  });
});

describe('the optional A of the 8-bit arithmetic (zmac)', () => {
  it('SUB, AND, OR, XOR, and CP may write A, first', () => {
    expect(at6000('SUB A,5', 'AND A,5', 'OR A,5', 'XOR A,5', 'CP A,5', 'CP A,(HL)', 'SUB A,B', 'AND A,(IX+1)', 'OR A,IXH', 'XOR A,A', 'CP A,(IY-2)', 'CP A,(IX)')).toEqual([
      0xd6, 0x05, 0xe6, 0x05, 0xf6, 0x05, 0xee, 0x05, 0xfe, 0x05, 0xbe, 0x90, 0xdd, 0xa6, 0x01, 0xdd, 0xb4, 0xaf, 0xfd, 0xbe, 0xfe, 0xdd, 0xbe, 0x00,
    ]);
  });

  it('ADD, ADC, and SBC may leave A, out', () => {
    expect(at6000('ADD 5', 'ADC 5', 'SBC 5', 'ADD B', 'ADC B', 'SBC (HL)', 'ADD (IX+1)', 'SBC IXH', 'ADC (IY)', 'ADD A')).toEqual([
      0xc6, 0x05, 0xce, 0x05, 0xde, 0x05, 0x80, 0x88, 0x9e, 0xdd, 0x86, 0x01, 0xdd, 0x9c, 0xfd, 0x8e, 0x00, 0x87,
    ]);
  });

  it('the parenthesised number falls back with the A, too', () => {
    const result = assemble(['\tORG 6000H', '\tSUB A,(5)', '\tADD (5)'].join('\n'));
    expect([...result.image!.bytes.slice(0x6000, 0x6004)]).toEqual([0xd6, 0x05, 0xc6, 0x05]);
    expect(diagnosticsOf(result)[1]).toBe('3:6-9 warning: ADD (5) reads as ADD 5: ADD has no form that reads memory there, so the parentheses only group. Write ADD 5 to say so. To use the byte at address 5, point HL at it: LD HL,5 then ADD A,(HL).');
  });

  it('other registers before the operand are still errors', () => {
    expect(errorsOf(assemble('\tSUB B,5'))[0]).toMatch(/^1: SUB has no form B,5\./);
    expect(errorsOf(assemble('\tADD HL'))[0]).toMatch(/^1: ADD has no form HL\./);
  });
});

describe('case and spacing', () => {
  it('mnemonics, registers, and directives are case-insensitive', () => {
    expect(at6000('Ld A,( 3C00H )', 'ld a , ( 5 ) ', 'nop', 'NOP', 'defb 9')).toEqual([0x3a, 0x00, 0x3c, 0x3a, 0x05, 0x00, 0x00, 0x00, 0x09]);
  });

  it("EX AF,AF' with the quote", () => {
    expect(at6000("EX AF,AF'", "ex af,af' ; swap")).toEqual([0x08, 0x08]);
  });
});

describe('comments', () => {
  it('a semicolon starts a comment, anywhere outside a string', () => {
    const src = ['; whole line', '\tORG 6000H ; set origin', '\tNOP;tight', "\tDB ';',0 ; a semicolon in a string", '\tLD A,5 ; comment, with (paren'].join('\n');
    expect(bytesOf(src)).toEqual([0x00, 0x3b, 0x00, 0x3e, 0x05]);
  });

  it('blank lines and comment lines produce nothing', () => {
    expect(bytesOf(['', '   ', '\tORG 6000H', ';', '\tNOP', ''].join('\n'))).toEqual([0x00]);
  });
});

describe('strings in DB', () => {
  it("'' inside a single-quoted string is one quote, and \"\" inside a double-quoted one", () => {
    expect(at6000("DB 'it''s',0", 'DB "dq",0', 'DB "a""b"', "DB ''")).toEqual([0x69, 0x74, 0x27, 0x73, 0x00, 0x64, 0x71, 0x00, 0x61, 0x22, 0x62]);
  });

  it('strings and expressions mix', () => {
    expect(at6000("DB 'A'+1,'BC'", "DEFB 'hi',13", 'DEFM "ok"')).toEqual([0x42, 0x42, 0x43, 0x68, 0x69, 0x0d, 0x6f, 0x6b]);
  });

  it('DW and DEFW store words low byte first', () => {
    expect(at6000('DW 1,2', 'DEFW 1234H')).toEqual([1, 0, 2, 0, 0x34, 0x12]);
  });
});

describe('operands', () => {
  it('an operand that is entirely parenthesised is memory', () => {
    expect(at6000('LD A,(3C00H)', 'LD A,((5))', 'LD HL,(1234H)', 'LD A,(HIGH 1234H)')).toEqual([0x3a, 0x00, 0x3c, 0x3a, 0x05, 0x00, 0x2a, 0x34, 0x12, 0x3a, 0x12, 0x00]);
  });

  it('parentheses that do not enclose the whole operand only group', () => {
    expect(at6000('LD A,3C00H & 0FFH', 'LD A,(5)+1', 'LD A,1+(5)', 'LD HL,(12H)+(34H)', 'LD A,(2)*(3)', 'LD A,-(3)', 'LD BC,(5)+1', 'JP (5)+1')).toEqual([
      0x3e, 0x00, 0x3e, 0x06, 0x3e, 0x06, 0x21, 0x46, 0x00, 0x3e, 0x06, 0x3e, 0xfd, 0x01, 0x06, 0x00, 0xc3, 0x06, 0x00,
    ]);
  });

  it('a parenthesised operand where the instruction has no memory form is the number (zmac), with a warning', () => {
    const result = assemble(['\tORG 6000H', '\tSUB (5)', '\tCALL (5)', '\tJR (6000H)', '\tIM (1)', '\tBIT (1),A', '\tJP NZ,(5)'].join('\n'));
    expect(errorsOf(result)).toEqual([]);
    expect([...result.image!.bytes.slice(0x6000, 0x600f)]).toEqual([0xd6, 0x05, 0xcd, 0x05, 0x00, 0x18, 0xf9, 0xed, 0x56, 0xcb, 0x4f, 0xc2, 0x05, 0x00, 0x00]);
    expect(diagnosticsOf(result)[0]).toBe('2:6-9 warning: SUB (5) reads as SUB 5: SUB has no form that reads memory there, so the parentheses only group. Write SUB 5 to say so. To use the byte at address 5, point HL at it: LD HL,5 then SUB (HL).');
    expect(diagnosticsOf(result)[1]).toBe('3:7-10 warning: CALL (5) reads as CALL 5: CALL has no form that reads memory there, so the parentheses only group. Write CALL 5 to say so.');
    expect(result.diagnostics.filter((d) => d.severity === 'warning')).toHaveLength(6);
  });

  it('register indirection and index registers', () => {
    expect(at6000('LD A,(HL)', 'LD A,( hl )', 'LD A,(IX+5)', 'LD A,(ix + 5)', 'LD A,(IX+ -5)', 'LD A,(IX-3)', 'LD A,(IX)', 'LD A,(IX+(2))', 'JP (IX)', 'LD (IY+2*3),7')).toEqual([
      0x7e, 0x7e, 0xdd, 0x7e, 0x05, 0xdd, 0x7e, 0x05, 0xdd, 0x7e, 0xfb, 0xdd, 0x7e, 0xfd, 0xdd, 0x7e, 0x00, 0xdd, 0x7e, 0x02, 0xdd, 0xe9, 0xfd, 0x36, 0x06, 0x07,
    ]);
  });

  it('a relative jump to a label', () => {
    expect(bytesOf(['\tORG 6000H', 'TOP:\tNOP', '\tDJNZ TOP', '\tJR NZ,TOP', '\tJR $'].join('\n'))).toEqual([0x00, 0x10, 0xfd, 0x20, 0xfb, 0x18, 0xfe]);
  });
});

describe('ORG and the default origin', () => {
  it('ORG sets the address', () => {
    const result = assemble(['\tORG 7000H', 'X:\tNOP', '\tORG 7100H', 'Y:\tDW X'].join('\n'));
    expect(errorsOf(result)).toEqual([]);
    expect(result.symbols.get('Y')?.value).toBe(0x7100);
    expect(result.image!.bytes[0x7101]).toBe(0x70);
  });

  it('with no ORG the program starts at 5200H, and an info note says so', () => {
    const result = assemble('\tNOP');
    expect(result.ok).toBe(true);
    expect(result.image!.isLoaded(0x5200)).toBe(true);
    expect(diagnosticsOf(result)).toEqual(['1:1-5 info: There is no ORG, so the program starts at $5200.']);
  });
});

describe('the result', () => {
  it('lists every line with its address and bytes, and maps addresses to lines', () => {
    const result = assemble(['\tORG 6000H', 'X:\tLD A,1 ; one', '', '\tNOP'].join('\n'));
    expect(result.listing).toEqual([
      { line: 1, address: null, bytes: [], text: '\tORG 6000H' },
      { line: 2, address: 0x6000, bytes: [0x3e, 0x01], text: 'X:\tLD A,1 ; one' },
      { line: 3, address: null, bytes: [], text: '' },
      { line: 4, address: 0x6002, bytes: [0x00], text: '\tNOP' },
    ]);
    expect(result.sourceMap.lineOf(0x6001)).toBe(2);
    expect(result.sourceMap.lineOf(0x6002)).toBe(4);
    expect(result.sourceMap.lineOf(0x6003)).toBeNull();
    expect(result.sourceMap.addressesOf(2)).toEqual([0x6000, 0x6001]);
    expect(result.sourceMap.addressesOf(3)).toEqual([]);
    expect(result.entry).toBeNull();
  });

  it('records EQUs and labels with their lines and kinds', () => {
    const result = assemble(['\tORG 6000H', 'SCREEN\tEQU 3C00H', 'Go:\tNOP'].join('\n'));
    expect(result.symbols.get('SCREEN')).toEqual({ value: 0x3c00, line: 2, kind: 'equ' });
    expect(result.symbols.get('Go')).toEqual({ value: 0x6000, line: 3, kind: 'label' });
  });

  it('CRLF line endings count lines the same', () => {
    const result = assemble('\tORG 6000H\r\n\tNOP\r\n\tBAD\r\n');
    expect(errorsOf(result)).toHaveLength(1);
    expect(errorsOf(result)[0]).toMatch(/^3: Unknown instruction BAD\./);
  });
});
