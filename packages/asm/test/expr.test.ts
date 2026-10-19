/**
 * Expressions: number forms, characters, operators with zmac's precedence,
 * HIGH/LOW, `$`, and symbols. Every expected value here was read from zmac's
 * listing (zmac-probes.test.ts runs the same expressions through zmac).
 */
import { describe, expect, it } from 'vitest';
import { assemble } from '../src/index.js';
import { errorsOf, wordOf } from './helpers.js';

describe('numbers', () => {
  it.each([
    ['255', 255],
    ['255D', 255],
    ['5d', 5],
    ['0FFH', 0xff],
    ['0ffh', 0xff],
    ['0abcdh', 0xabcd],
    ['0B101H', 0xb101],
    ['$FF', 0xff],
    ['$f', 0x0f],
    ['0xFF', 0xff],
    ['0X1f', 0x1f],
    ['1010B', 10],
    ['1010b', 10],
    ['0b', 0],
    ['1b', 1],
    ['17O', 15],
    ['17q', 15],
    ['65535', 0xffff],
  ])('%s is %i', (text, value) => {
    expect(wordOf(text)).toBe(value);
  });

  it('a hex number must start with a digit; FFH is a symbol', () => {
    expect(errorsOf(assemble('\tDW FFH'))).toEqual(['1: FFH is not defined. A hex number must start with a digit: write 0FFH.']);
  });

  it('%1010 is not binary, since zmac reads % as MOD', () => {
    expect(errorsOf(assemble('\tDW %1010'))).toEqual(['1: zmac reads % as MOD, so %1010 is not a binary number; write 1010B.']);
  });

  it('0b101 is not a number', () => {
    expect(errorsOf(assemble('\tDW 0b101'))).toEqual(['1: 0b101 is not a number; write binary as 101B.']);
  });

  it('a malformed number names itself and the forms', () => {
    expect(errorsOf(assemble('\tDW 12G'))).toEqual(['1: 12G is not a number. Write decimal 255, hex 0FFH, $FF, or 0xFF, binary 1010B, or octal 17O.']);
  });
});

describe('characters', () => {
  it.each([
    ["'A'", 0x41],
    ["'a'", 0x61],
    ["''''", 0x27],
    ['""', 0],
    ["'A'+1", 0x42],
    ["'A'*2", 0x82],
    // Two characters make a word, the first in the low byte (zmac: LD HL,'AB' is 21 41 42).
    ["'AB'", 0x4241],
  ])('%s is %i', (text, value) => {
    expect(wordOf(text)).toBe(value);
  });

  it('a string of three characters is not a number', () => {
    expect(errorsOf(assemble("\tDW 'ABC'"))).toEqual(["1: 'ABC' has 3 characters; as a number a string can have at most 2."]);
  });

  it('a character outside ASCII is refused (zmac would read the file\'s UTF-8 bytes)', () => {
    expect(errorsOf(assemble("\tDB 'café'"))).toEqual(['1: This string holds é, which is not plain ASCII; write its code as a number instead.']);
  });

  it('an unterminated string says so', () => {
    expect(errorsOf(assemble("\tDB 'abc"))).toEqual(["1: This string has no closing '."]);
  });
});

describe("operators follow zmac's precedence", () => {
  it.each([
    ['1+2*3', 7],
    ['1<<2+1', 8],
    ['2+1<<2', 12],
    ['6&3|8', 10],
    ['8|6&3', 10],
    ['6^3&1', 7],
    ['6&3^1', 3],
    ['5|3^6', 5],
    ['5^3|6', 6],
    ['7 MOD 4*2', 6],
    ['2*7 mod 4', 2],
    ['1+7 MOD 4', 4],
    ['7%4', 3],
    ['16>>2+1', 2],
    ['1<<4&16', 16],
    ['1 SHL 3', 8],
    ['16 shr 2', 4],
    ['3 & 1 SHL 2', 0],
    ['8-2-1', 5],
    ['64/4/2', 8],
    ['7 MOD 4 MOD 2', 1],
    ['10/3', 3],
    ['(1+2)*3', 9],
  ])('%s is %i', (text, value) => {
    expect(wordOf(text)).toBe(value);
  });

  it.each([
    ['-2*3', 0xfffa],
    ['~0', 0xffff],
    ['~1+1', 0xffff],
    ['-1+5', 4],
    ['-7/2', 0xfffd],
    ['-7 MOD 2', 0xffff],
    ['+5', 5],
  ])('unary: %s is %i', (text, value) => {
    expect(wordOf(text)).toBe(value);
  });

  it.each([
    ['HIGH 1234H', 0x12],
    ['LOW 1234H', 0x34],
    ['high 1234h+1', 0x13],
    ['low 1234h+1', 0x35],
    ['2*HIGH 1234H', 0x24],
    ['HIGH(1234H)', 0x12],
  ])('%s is %i', (text, value) => {
    expect(wordOf(text)).toBe(value);
  });

  it('$ is the address of the line', () => {
    expect(wordOf('$')).toBe(0x6000);
    expect(wordOf('$+2')).toBe(0x6002);
    expect(wordOf('$+$')).toBe(0xc000);
    expect(wordOf('$1234+$')).toBe(0x7234);
  });

  it('division by zero is an error', () => {
    expect(errorsOf(assemble('\tDW 1/0'))).toEqual(['1: This expression divides by zero.']);
    expect(errorsOf(assemble('\tDW 1 MOD 0'))).toEqual(['1: This expression divides by zero.']);
  });

  it('an unbalanced parenthesis says which', () => {
    expect(errorsOf(assemble('\tDW (1+2'))).toEqual(['1: This ( has no matching ).']);
    expect(errorsOf(assemble('\tDW 1+2)'))).toEqual(['1: This ) has no matching (.']);
  });

  it('a missing operand says what is missing', () => {
    expect(errorsOf(assemble('\tDW 1+'))).toEqual(['1: The expression ends after +; a number or a name should follow it.']);
  });

  it('a register cannot be part of an expression', () => {
    expect(errorsOf(assemble('\tLD A,B+1'))).toEqual(['1: B is a register; it cannot be part of an expression.']);
  });
});

describe('symbols in expressions', () => {
  it('labels and EQUs, forward and backward, case-insensitive', () => {
    const src = ['\tORG 6000H', 'X\tEQU Y+1', 'Y\tEQU 5', 'Start:\tDW x, START, later', 'Later:\tDW $'].join('\n');
    const result = assemble(src);
    expect(errorsOf(result)).toEqual([]);
    const b = [...result.image!.bytes.slice(0x6000, 0x6008)];
    expect(b).toEqual([0x06, 0x00, 0x00, 0x60, 0x06, 0x60, 0x06, 0x60]);
  });

  it('an EQU defined in terms of itself is an error naming the loop', () => {
    const result = assemble(['A1\tEQU B1', 'B1\tEQU A1+1', '\tDW A1'].join('\n'));
    expect(errorsOf(result)).toEqual(['1: A1 is defined in terms of itself: A1 → B1 → A1.']);
  });
});
