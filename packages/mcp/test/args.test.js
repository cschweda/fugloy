import { describe, expect, it } from 'vitest';
import { hex4, parseAddr, parseCount, parseRange } from '../src/args.js';

const labels = new Map([
  [0x5200, { addr: 0x5200, name: 'CLS' }],
  [0x0033, { addr: 0x0033, name: 'Put_Char' }],
  [0x7000, { addr: 0x7000, name: 'ACC' }],
]);

describe('addresses', () => {
  it('hex4 echoes uppercase digits, four wide, with a lowercase h', () => {
    expect(hex4(0x5200)).toBe('5200h');
    expect(hex4(0x33)).toBe('0033h');
    expect(hex4(0xabcd)).toBe('ABCDh');
  });

  it('parseAddr accepts every documented form and a label', () => {
    for (const form of ['5200', '0x5200', '0X5200', '$5200', '5200h', '5200H', ' 5200 ', 20992]) expect(parseAddr(form)).toBe(0x5200);
    expect(parseAddr('400')).toBe(0x0400);
    expect(parseAddr('cls', labels)).toBe(0x5200);
    expect(parseAddr('PUT_CHAR', labels)).toBe(0x33);
    expect(parseAddr(0)).toBe(0);
    expect(parseAddr('FFFF')).toBe(0xffff);
  });

  it('refuses a string that is both a hex address and a label, naming both readings', () => {
    expect(() => parseAddr('ACC', labels)).toThrow('"ACC" is ambiguous: read as hex it is 0ACCh, and it is also the label at 7000h; write 0xACC for the hex address or 28672 (decimal) for the label.');
    expect(parseAddr('0xACC', labels)).toBe(0x0acc);
    expect(parseAddr('ACC')).toBe(0x0acc);
  });

  it('parseAddr refuses what is not an address, in sentences', () => {
    expect(() => parseAddr('nowhere', labels)).toThrow('"nowhere" is not an address');
    expect(() => parseAddr('nowhere')).toThrow(/label name/);
    expect(() => parseAddr(70000)).toThrow('Address 70000 is outside 0000h-FFFFh.');
    expect(() => parseAddr('10000')).toThrow('outside 0000h-FFFFh');
    expect(() => parseAddr(1.5)).toThrow('whole number');
    expect(() => parseAddr(-1)).toThrow('outside');
    expect(() => parseAddr(null)).toThrow('is not an address');
  });

  it('parseRange takes "A-B" and { addr, len }', () => {
    expect(parseRange('5200-52FF')).toEqual({ addr: 0x5200, len: 0x100 });
    expect(parseRange('$5200-$5200')).toEqual({ addr: 0x5200, len: 1 });
    expect(parseRange({ addr: '5200', len: 16 })).toEqual({ addr: 0x5200, len: 16 });
    expect(parseRange({ addr: 'CLS', len: 4 }, labels)).toEqual({ addr: 0x5200, len: 4 });
    expect(() => parseRange('52FF-5200')).toThrow('ends before it starts');
    expect(() => parseRange('5200')).toThrow('"5200-52FF"');
    expect(() => parseRange({ addr: 'FFF0', len: 32 })).toThrow('runs past FFFFh');
    expect(() => parseRange({ addr: 'FFF0', len: '16' })).toThrow('len is a decimal count');
  });
});

describe('counts', () => {
  const opts = { name: 'len', min: 1, max: 1024 };

  it('refuses a string length with the decimal hint', () => {
    expect(() => parseCount('400', opts)).toThrow('len is a decimal count; write 400, not "400".');
    expect(() => parseCount('0x10', { name: 'n', min: 0 })).toThrow('n is a decimal count; write 16, not "0x10".');
  });

  it('accepts integers inside the bounds and refuses the rest', () => {
    expect(parseCount(64, opts)).toBe(64);
    expect(parseCount(1024, opts)).toBe(1024);
    expect(() => parseCount(0, opts)).toThrow('len must be between 1 and 1024, not 0.');
    expect(() => parseCount(2000, opts)).toThrow('len must be between 1 and 1024, not 2000.');
    expect(() => parseCount(2.5, opts)).toThrow('len must be a whole number, not 2.5.');
    expect(() => parseCount(-1, { name: 'offset', min: 0 })).toThrow('offset must be at least 0, not -1.');
    expect(parseCount(5, { name: 'offset', min: 0 })).toBe(5);
    expect(() => parseCount(undefined, opts)).toThrow('len is required');
  });
});
