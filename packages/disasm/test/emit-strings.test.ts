import { describe, expect, it } from 'vitest';
import { dbItems, dbString } from '../src/emit/strings.js';

const text = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

describe('dbString', () => {
  it('quotes printable runs, doubles a quote, and writes every other byte in hex', () => {
    expect(dbString(text("IT'S"))).toBe("\tDB\t'IT''S'");
    expect(dbString([...text('HELLO'), 0x0d])).toBe("\tDB\t'HELLO',0DH");
    expect(dbString([0x80, ...text('AB'), 0x00])).toBe("\tDB\t80H,'AB',00H");
    expect(dbItems([...text('O'), 0x0d])).toBe("'O',0DH");
  });

  it('starts a new row after 16 bytes or 8 items', () => {
    expect(dbString([...text('ABCDEFGHIJKLMNOPQRST'), 0x0d])).toBe("\tDB\t'ABCDEFGHIJKLMNOP'\n\tDB\t'QRST',0DH");
    expect(dbString([0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89])).toBe('\tDB\t80H,81H,82H,83H,84H,85H,86H,87H\n\tDB\t88H,89H');
  });
});
