import { expect } from 'vitest';
import { dbString } from '../../src/emit/strings.js';
import { assemble, skipIfNoZmac } from './zmac.js';

const test = skipIfNoZmac();

test('assembles a three-line program into a .cmd our loader reads back, entry included', () => {
  const { module } = assemble('\torg\t6000h\n\tld\ta,1\n\tret\n\tend\t6000h\n');
  expect(module.image.runs()).toEqual([{ start: 0x6000, end: 0x6002, length: 3 }]);
  expect(Array.from(module.image.bytes.subarray(0x6000, 0x6003))).toEqual([0x3e, 0x01, 0xc9]);
  expect(module.entry).toBe(0x6000);
  expect(module.entrySource).toBe('transfer');
});

test('accepts upper-case source with H-suffix hex, a lone DD prefix as DB, and both undocumented spellings', () => {
  const { module } = assemble('\tORG\t0A000H\n\tLD\tHL,3C00H\n\tDB\t0DDH\n\tSLL\tB\n\tLD\tA,IXH\n\tEND\t0A000H\n');
  expect(Array.from(module.image.bytes.subarray(0xa000, 0xa008))).toEqual([0x21, 0x00, 0x3c, 0xdd, 0xcb, 0x30, 0xdd, 0x7c]);
});

test('reports zmac errors with the offending source', () => {
  expect(() => assemble('\torg\t6000h\n\tld\ta,\n')).toThrow(/zmac failed[\s\S]*Syntax error[\s\S]*ld\ta,/);
});

test('treats a zmac warning as a failure, since an unknown mnemonic becomes a silent label', () => {
  expect(() => assemble('\tbogus\n')).toThrow(/zmac failed[\s\S]*treated as label[\s\S]*bogus/);
});

test('assembles quoted DB rows byte for byte: doubled quotes, semicolons, backslashes, short and long runs', () => {
  const text = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
  const rows = [[...text("IT'S"), 0x0d], [...text('A;B "Q" \\N'), 0x00], text("'"), text('A'), text('AB'), [0x80, ...text('xyz'), 0x03], [...text('ABCDEFGHIJKLMNOPQRSTUVWXYZ'), 0x0d]];
  const bytes = rows.flat();
  const { module } = assemble(`\tORG\t7000H\n${rows.map((r) => dbString(r)).join('\n')}\n\tEND\n`);
  expect(Array.from(module.image.bytes.subarray(0x7000, 0x7000 + bytes.length))).toEqual(bytes);
  expect(module.image.runs()).toEqual([{ start: 0x7000, end: 0x7000 + bytes.length - 1, length: bytes.length }]);
});

test('.PHASE gives labels their runtime values and JR its runtime offset while the bytes stay at the ORG', () => {
  const { module } = assemble('\tORG\t8000H\n\t.PHASE\t5000H\nL5000:\tJR\tL5004\n\tNOP\n\tNOP\nL5004:\tJP\tL5000\n\t.DEPHASE\n\tDW\tL5000\n\tEND\n');
  expect(Array.from(module.image.bytes.subarray(0x8000, 0x8009))).toEqual([0x18, 0x02, 0x00, 0x00, 0xc3, 0x00, 0x50, 0x00, 0x50]);
  expect(module.image.runs()).toEqual([{ start: 0x8000, end: 0x8008, length: 9 }]);
});
