import { expect } from 'vitest';
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
