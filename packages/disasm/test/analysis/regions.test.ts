import { describe, expect, it } from 'vitest';
import { recursiveDescent } from '../../src/analysis/descent.js';
import { basicBlocks, regions } from '../../src/analysis/regions.js';
import { image } from '../images.js';

describe('regions', () => {
  it('splits runs into code, bytes, and unknown regions in address order', () => {
    const img = image({ 0x6000: [0xcf, 0x2c, 0xc9, 0xff, 0xff], 0x7000: [0xc9] });
    const p = recursiveDescent(img, [0x6000]);
    expect(regions(img, p.map)).toEqual([
      { kind: 'code', start: 0x6000, end: 0x6000 },
      { kind: 'bytes', start: 0x6001, end: 0x6001 },
      { kind: 'code', start: 0x6002, end: 0x6002 },
      { kind: 'unknown', start: 0x6003, end: 0x6004 },
      { kind: 'unknown', start: 0x7000, end: 0x7000 },
    ]);
  });

  it('keeps a multi-byte instruction stream as one code region', () => {
    const img = image({ 0x6000: [0x21, 0x00, 0x3c, 0x36, 0x41, 0xc9] });
    expect(regions(img, recursiveDescent(img, [0x6000]).map)).toEqual([{ kind: 'code', start: 0x6000, end: 0x6005 }]);
  });
});

describe('basicBlocks', () => {
  it('cuts blocks at targets and after transfers, with successors by kind', () => {
    // 6000 JR NZ,6004 ; 6002 NOP ; 6003 RET ; 6004 CALL 6010 ; 6007 JP 6003 ; 6010 RET
    const img = image({ 0x6000: [0x20, 0x02, 0x00, 0xc9, 0xcd, 0x10, 0x60, 0xc3, 0x03, 0x60], 0x6010: [0xc9] });
    expect(basicBlocks(recursiveDescent(img, [0x6000]))).toEqual([
      { start: 0x6000, end: 0x6001, succ: [{ to: 0x6004, kind: 'cjump' }, { to: 0x6002, kind: 'next' }] },
      { start: 0x6002, end: 0x6002, succ: [{ to: 0x6003, kind: 'next' }] },
      { start: 0x6003, end: 0x6003, succ: [] },
      { start: 0x6004, end: 0x6006, succ: [{ to: 0x6010, kind: 'call' }, { to: 0x6007, kind: 'next' }] },
      { start: 0x6007, end: 0x6009, succ: [{ to: 0x6003, kind: 'jump' }] },
      { start: 0x6010, end: 0x6010, succ: [] },
    ]);
  });

  it('marks a successor outside loaded memory as external, and steps over the RST 08H inline byte', () => {
    const img = image({ 0x6000: [0xcd, 0x33, 0x00, 0xcf, 0x2c, 0xc9] });
    const blocks = basicBlocks(recursiveDescent(img, [0x6000]));
    expect(blocks[0]!.succ).toEqual([{ to: 0x0033, kind: 'external' }, { to: 0x6003, kind: 'next' }]);
    expect(blocks[1]).toEqual({ start: 0x6003, end: 0x6003, succ: [{ to: 0x0008, kind: 'external' }, { to: 0x6005, kind: 'next' }] });
    expect(blocks[2]).toEqual({ start: 0x6005, end: 0x6005, succ: [] });
  });

  it('gives an indirect jump and a HALT no successors, and a self-loop one jump successor', () => {
    expect(basicBlocks(recursiveDescent(image({ 0x6000: [0xe9] }), [0x6000]))).toEqual([{ start: 0x6000, end: 0x6000, succ: [] }]);
    expect(basicBlocks(recursiveDescent(image({ 0x6000: [0x76] }), [0x6000]))).toEqual([{ start: 0x6000, end: 0x6000, succ: [] }]);
    expect(basicBlocks(recursiveDescent(image({ 0x6000: [0x00, 0x18, 0xfd] }), [0x6000]))).toEqual([{ start: 0x6000, end: 0x6002, succ: [{ to: 0x6000, kind: 'jump' }] }]);
  });

  it('keeps the real edge kind for a loaded target that is not an instruction start', () => {
    // 6000 LD HL,3C00H ; 6003 JR 6001 (into the LD's operand) — loaded, so not external
    const inside = recursiveDescent(image({ 0x6000: [0x21, 0x00, 0x3c, 0x18, 0xfc] }), [0x6000]);
    expect(inside.externals).toEqual([]);
    expect(basicBlocks(inside)).toEqual([{ start: 0x6000, end: 0x6004, succ: [{ to: 0x6001, kind: 'jump' }] }]);
    // 6000 RST 08H ; 6001 data ; 6002 JR 6001 (into the data byte)
    const data = basicBlocks(recursiveDescent(image({ 0x6000: [0xcf, 0x2c, 0x18, 0xfd] }), [0x6000]));
    expect(data[1]).toEqual({ start: 0x6002, end: 0x6003, succ: [{ to: 0x6001, kind: 'jump' }] });
  });

  it('ends a block without a next successor where the instruction stream is interrupted', () => {
    // 6000 NOP ; 6001 CD truncated at the run end (typed as data) ; 7000 RET from a second root
    const img = image({ 0x6000: [0x00, 0xcd], 0x7000: [0xc9] });
    expect(basicBlocks(recursiveDescent(img, [0x6000, 0x7000]))).toEqual([
      { start: 0x6000, end: 0x6000, succ: [] },
      { start: 0x7000, end: 0x7000, succ: [] },
    ]);
  });
});
