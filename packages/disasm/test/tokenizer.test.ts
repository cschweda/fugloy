import { describe, expect, it } from 'vitest';
import { TOKENS, TOKEN_BYTES } from '../src/tokens.js';
import { tokenizeLine, writeBasic } from './writers/basic-tokenizer.js';

const hex = (bytes: ArrayLike<number>) => Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
const tok = (text: string) => hex(tokenizeLine(text));

describe('token table', () => {
  it('holds the 124 Level II tokens 80H..FBH in appendix order', () => {
    expect(TOKENS.length).toBe(124);
    expect(TOKENS[0]).toBe('END');
    expect(TOKENS[0x93 - 0x80]).toBe('REM');
    expect(TOKENS[0xbc - 0x80]).toBe('TAB(');
    expect(TOKENS[0xcd - 0x80]).toBe('+');
    expect(TOKENS[0xfa - 0x80]).toBe('MID$');
    expect(TOKENS[123]).toBe("'");
    expect(TOKEN_BYTES.get('PRINT')).toBe(0xb2);
    expect(TOKEN_BYTES.get('ELSE')).toBe(0x95);
    expect(TOKEN_BYTES.size).toBe(124);
  });
});

describe('synthetic tokenizer', () => {
  it('replaces keywords with single bytes and keeps text and spaces as typed', () => {
    expect(tok('PRINT"HI"')).toBe('B2 22 48 49 22');
    expect(tok('FOR I=1 TO 10')).toBe('81 20 49 D5 31 20 BD 20 31 30');
    expect(tok('X=PEEK(16548)+256*PEEK(16549)')).toBe('58 D5 E5 28 31 36 35 34 38 29 CD 32 35 36 CF E5 28 31 36 35 34 39 29');
  });

  it('prefers the longest keyword at each position', () => {
    expect(tok('INKEY$')).toBe('C9');
    expect(tok('INT(X)')).toBe('D8 28 58 29');
    expect(tok('TAB(3)')).toBe('BC 33 29');
    expect(tok('ERROR')).toBe('9E');
  });

  it('is case-insensitive outside literals', () => {
    expect(tok('print"Hi"')).toBe('B2 22 48 69 22');
  });

  it('copies everything after REM literally', () => {
    expect(tok('REM FOR')).toBe('93 20 46 4F 52');
  });

  it('stores a remark apostrophe as :REM\' and copies the rest literally', () => {
    expect(tok("' GOTO")).toBe('3A 93 FB 20 47 4F 54 4F');
  });

  it('stores ELSE with a hidden leading colon', () => {
    expect(tok('IF A THEN 1 ELSE 2')).toBe('8F 20 41 20 CA 20 31 20 3A 95 20 32');
  });

  it('copies DATA items literally up to the next colon, tracking quotes', () => {
    expect(tok('DATA FOR,1:PRINT')).toBe('88 20 46 4F 52 2C 31 3A B2');
    expect(tok('DATA "A:B",FOR:END')).toBe('88 20 22 41 3A 42 22 2C 46 4F 52 3A 80');
  });

  it('leaves string contents alone, including bytes above 7FH', () => {
    expect(tok('PRINT"FOR\u0080"')).toBe('B2 22 46 4F 52 80 22');
  });
});

describe('writeBasic', () => {
  it('writes the FF header, a pointer chain, line numbers, bodies, terminators, and the final 00 00', () => {
    expect(hex(writeBasic([{ number: 10, text: 'END' }], 0x6000))).toBe('FF 06 60 0A 00 80 00 00 00');
    expect(hex(writeBasic([{ number: 10, text: 'END' }], 0x6000, { header: false }))).toBe('06 60 0A 00 80 00 00 00');
  });

  it('chains each line to the next from the base address', () => {
    const bytes = writeBasic([{ number: 10, text: 'CLS' }, { number: 20, text: 'END' }], 0x62c8);
    expect(hex(bytes)).toBe('FF CE 62 0A 00 84 00 D4 62 14 00 80 00 00 00');
  });

  it('writes raw bodies verbatim for hidden machine code, still terminated', () => {
    const bytes = writeBasic([{ number: 20, raw: [0xc3, 0x00, 0x00] }], 0x7000, { header: false });
    expect(hex(bytes)).toBe('08 70 14 00 C3 00 00 00 00 00');
  });

  it('appends trailing bytes after the program end when asked', () => {
    const bytes = writeBasic([{ number: 1, text: 'END' }], 0x7000, { header: false, trailing: [0xaa, 0x55] });
    expect(hex(bytes)).toBe('06 70 01 00 80 00 00 00 AA 55');
  });

  it('rejects line numbers above 65529', () => {
    expect(() => writeBasic([{ number: 65530, text: 'END' }], 0x7000)).toThrow(RangeError);
  });
});
