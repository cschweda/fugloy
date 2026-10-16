import { describe, expect, it } from 'vitest';
import { recursiveDescent } from '../../src/analysis/descent.js';
import { findStrings, proposeTables } from '../../src/analysis/heuristics.js';
import { ByteMap, Kind } from '../../src/analysis/map.js';
import { emptyAnnotations } from '../../src/hints/apply.js';
import { blockIdentities } from '../../src/hints/identity.js';
import { image } from '../images.js';

const text = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

describe('findStrings', () => {
  it('takes four or more printable bytes ending in 0DH, 03H, or 00H, terminator included', () => {
    const img = image({ 0x7000: [...text('HELLO'), 0x0d, ...text('ABCD'), 0x03, ...text('WXYZ'), 0x00] });
    expect(findStrings(img, new ByteMap())).toEqual([
      { addr: 0x7000, length: 6 },
      { addr: 0x7006, length: 5 },
      { addr: 0x700b, length: 5 },
    ]);
  });

  it('leaves three printable bytes, an unterminated run, and a run cut by the end of its block untyped', () => {
    const img = image({ 0x7000: [...text('ABC'), 0x0d, 0x01, ...text('ABCDEF'), 0x01], 0x8000: text('ABCDEF') });
    expect(findStrings(img, new ByteMap())).toEqual([]);
  });

  it('never crosses an instruction, and may start right after one', () => {
    const img = image({ 0x7000: [...text('ABCDEFGH'), 0x0d] });
    const map = new ByteMap();
    map.markCode(0x7002, 1);
    expect(findStrings(img, map)).toEqual([{ addr: 0x7003, length: 6 }]);
  });

  it('never takes a candidate next to data typed before it (Review Focus 4)', () => {
    const before = new ByteMap();
    before.mark(0x7000, 2, Kind.Byte);
    expect(findStrings(image({ 0x7000: [...text('ABCDEFGH'), 0x0d] }), before)).toEqual([]);
    const after = new ByteMap();
    after.mark(0x7007, 1, Kind.Word);
    expect(findStrings(image({ 0x7000: [...text('ABCDEF'), 0x0d, 0x55] }), after)).toEqual([]);
  });

  it('starts at a symbol but never runs through one', () => {
    const img = image({ 0x7000: [...text('HELLO WORLD'), 0x0d] });
    expect(findStrings(img, new ByteMap(), new Set([0x7006]))).toEqual([{ addr: 0x7006, length: 6 }]);
    expect(findStrings(img, new ByteMap(), new Set([0x7000]))).toEqual([{ addr: 0x7000, length: 12 }]);
  });
});

describe('proposeTables', () => {
  // Three one-byte routines at $7000-$7002, then seven untyped bytes, then their addresses as words at $700A.
  const tableImage = () => image({ 0x7000: [0xc9, 0xc9, 0xc9, 0, 0, 0, 0, 0, 0, 0, 0x00, 0x70, 0x01, 0x70, 0x02, 0x70, 0x00, 0x00] });

  it('proposes three or more words that all land on instruction starts, with the hint line that declares them', () => {
    const img = tableImage();
    const pass1 = recursiveDescent(img, [0x7000, 0x7001, 0x7002]);
    expect(proposeTables(img, pass1, blockIdentities(img))).toEqual([{ kind: 'table', addr: 0x700a, count: 3, hint: 'block 0:$000A table 3 2' }]);
  });

  it('proposes nothing over typed data or for two words', () => {
    const img = tableImage();
    const typed = recursiveDescent(img, [0x7000, 0x7001, 0x7002], { ...emptyAnnotations(), overrides: [{ addr: 0x700a, kind: 'bytes', length: 6 }] });
    expect(proposeTables(img, typed, blockIdentities(img))).toEqual([]);
    const two = recursiveDescent(img, [0x7000, 0x7001]);
    expect(proposeTables(img, two, blockIdentities(img))).toEqual([]);
  });
});
