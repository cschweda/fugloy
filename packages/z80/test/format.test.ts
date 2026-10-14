import { describe, expect, it } from 'vitest';
import { decodeAt, formatInstruction, hex4, hexByte, hexWord } from '../src/index.js';

const t = (bytes: number[]) => formatInstruction(decodeAt(bytes, 0, 0));

describe('hex formatting', () => {
  it('writes assembler hex with an H suffix and a leading zero before A-F', () => {
    expect(hexByte(0x05)).toBe('05H');
    expect(hexByte(0xdd)).toBe('0DDH');
    expect(hexWord(0x3c00)).toBe('3C00H');
    expect(hexWord(0xa000)).toBe('0A000H');
    expect(hex4(0xa000)).toBe('A000');
    expect(hex4(0x0012)).toBe('0012');
  });
});

describe('instruction text', () => {
  it('matches zmac spelling for every operand kind', () => {
    expect(t([0x08])).toBe("EX AF,AF'");
    expect(t([0xe9])).toBe('JP (HL)');
    expect(t([0x0a])).toBe('LD A,(BC)');
    expect(t([0xed, 0x40])).toBe('IN B,(C)');
    expect(t([0xed, 0x79])).toBe('OUT (C),A');
    expect(t([0xd3, 0xff])).toBe('OUT (0FFH),A');
    expect(t([0xdb, 0x01])).toBe('IN A,(01H)');
    expect(t([0x32, 0x00, 0x3c])).toBe('LD (3C00H),A');
    expect(t([0xcb, 0x7e])).toBe('BIT 7,(HL)');
    expect(t([0xed, 0x56])).toBe('IM 1');
    expect(t([0xef])).toBe('RST 28H');
    expect(t([0xc7])).toBe('RST 00H');
    expect(t([0xf5])).toBe('PUSH AF');
    expect(t([0x96])).toBe('SUB (HL)');
    expect(t([0x9e])).toBe('SBC A,(HL)');
    expect(t([0xfe, 0x0d])).toBe('CP 0DH');
    expect(t([0xed, 0x4b, 0x34, 0x12])).toBe('LD BC,(1234H)');
    expect(t([0xed, 0xa1])).toBe('CPI');
    expect(t([0x00])).toBe('NOP');
  });
});
