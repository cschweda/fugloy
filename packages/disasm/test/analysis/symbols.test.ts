import { describe, expect, it } from 'vitest';
import { recursiveDescent } from '../../src/analysis/descent.js';
import { dataReference, synthesizeSymbols } from '../../src/analysis/symbols.js';
import { decodeAt } from '@fugloy/z80';
import { emptyAnnotations } from '../../src/hints/apply.js';
import type { Annotations } from '../../src/hints/apply.js';
import { analyze } from '../../src/pipeline.js';
import { loadRaw } from '../../src/raw.js';
import { image } from '../images.js';

const ann = (partial: Partial<Annotations>): Annotations => ({ ...emptyAnnotations(), ...partial });
const symbols = (blocks: Record<number, number[]>, roots: number[], a: Annotations = emptyAnnotations()) => {
  const img = image(blocks);
  return synthesizeSymbols(recursiveDescent(img, roots, a), a, img);
};
const names = (t: ReturnType<typeof symbols>) => t.list().map((s) => `${s.addr.toString(16).toUpperCase()}=${s.name}:${s.kind}:${s.source}`);

describe('synthesizeSymbols', () => {
  it('labels jump targets L and call targets SUB_, with SUB_ winning at one address', () => {
    // 6000 CALL 600A ; 6003 JR NZ,600A ; 6005 JR 6005 ; 6007 RET (unreached) ; 600A RET
    const t = symbols({ 0x6000: [0xcd, 0x0a, 0x60, 0x20, 0x05, 0x18, 0xfe, 0xc9], 0x600a: [0xc9] }, [0x6000]);
    expect(names(t)).toEqual(['6005=L6005:code:synth', '600A=SUB_600A:sub:synth']);
    expect(t.has(0x6000)).toBe(false);
  });

  it('labels data references DATA_, ignoring SP, ports, immediates of other instructions, and unloaded addresses', () => {
    // 6000 LD HL,6020 ; 6003 LD (6022),A ; 6006 LD SP,7000 ; 6009 LD DE,9000 ; 600C IN A,(20) ; 600E LD A,(6021) ; 6011 ADD A,20 ; 6013 RET
    const t = symbols({
      0x6000: [0x21, 0x20, 0x60, 0x32, 0x22, 0x60, 0x31, 0x00, 0x70, 0x11, 0x00, 0x90, 0xdb, 0x20, 0x3a, 0x21, 0x60, 0xc6, 0x20, 0xc9],
      0x6020: [1, 2, 3, 4], 0x7000: [0],
    }, [0x6000]);
    expect(names(t)).toEqual(['6020=DATA_6020:data:synth', '6021=DATA_6021:data:synth', '6022=DATA_6022:data:synth']);
  });

  it('labels tables TBL_ and their targets L', () => {
    const t = symbols({ 0x6000: [0xc9], 0x6010: [0x00, 0x60, 0x20, 0x60], 0x6020: [0xc9] }, [], ann({ tables: [{ addr: 0x6010, count: 2, width: 2 }] }));
    expect(names(t)).toEqual(['6000=L6000:code:synth', '6010=TBL_6010:table:synth', '6020=L6020:code:synth']);
  });

  it('ranks kinds at one address: SUB_ over L over TBL_ over DATA_', () => {
    // 6000 LD HL,6010 (data ref to the table) ; 6003 JP 6010 (jump to the table too) ; table at 6010 -> 6000
    const t = symbols({ 0x6000: [0x21, 0x10, 0x60, 0xc3, 0x10, 0x60], 0x6010: [0x00, 0x60] }, [0x6000], ann({ tables: [{ addr: 0x6010, count: 1, width: 2 }] }));
    expect(t.get(0x6010)).toEqual({ addr: 0x6010, name: 'L6010', kind: 'code', source: 'synth' });
    const t2 = symbols({ 0x6000: [0x21, 0x10, 0x60, 0xc9], 0x6010: [0x00, 0x60] }, [0x6000], ann({ tables: [{ addr: 0x6010, count: 1, width: 2 }] }));
    expect(t2.get(0x6010)?.name).toBe('TBL_6010');
  });

  it('replaces a synthesized name with the user name, keeping the kind', () => {
    const t = symbols({ 0x6000: [0xcd, 0x04, 0x60, 0xc9, 0xc9] }, [0x6000], ann({ names: new Map([[0x6004, 'PRINT']]) }));
    expect(t.get(0x6004)).toEqual({ addr: 0x6004, name: 'PRINT', kind: 'sub', source: 'user' });
  });

  it('creates a data symbol for a user name on an unreferenced address', () => {
    const t = symbols({ 0x6000: [0xc9, 0x00] }, [0x6000], ann({ names: new Map([[0x6001, 'FLAG']]) }));
    expect(t.get(0x6001)).toEqual({ addr: 0x6001, name: 'FLAG', kind: 'data', source: 'user' });
  });

  it('gives externals and RST targets no symbol', () => {
    const t = symbols({ 0x6000: [0xcd, 0x33, 0x00, 0xcf, 0x2c, 0xc9] }, [0x6000]);
    expect(t.list()).toEqual([]);
  });

  it('lists symbols sorted by address', () => {
    const t = symbols({ 0x6000: [0xc3, 0x10, 0x60], 0x6010: [0x18, 0xfe] }, [0x6000, 0x6010]);
    expect(t.list().map((s) => s.addr)).toEqual([0x6010]);
    const t2 = symbols({ 0x6000: [0x21, 0x30, 0x60, 0xc3, 0x20, 0x60], 0x6020: [0xc9], 0x6030: [0] }, [0x6000]);
    expect(t2.list().map((s) => s.name)).toEqual(['L6020', 'DATA_6030']);
  });
});

describe('dataReference', () => {
  it('finds the referenced address of LD rr,nn and (nn) operands only', () => {
    expect(dataReference(decodeAt([0x21, 0x34, 0x12], 0))).toBe(0x1234);
    expect(dataReference(decodeAt([0xdd, 0x21, 0x34, 0x12], 0))).toBe(0x1234);
    expect(dataReference(decodeAt([0x01, 0x34, 0x12], 0))).toBe(0x1234);
    expect(dataReference(decodeAt([0x31, 0x34, 0x12], 0))).toBeNull();
    expect(dataReference(decodeAt([0x2a, 0x34, 0x12], 0))).toBe(0x1234);
    expect(dataReference(decodeAt([0xed, 0x43, 0x34, 0x12], 0))).toBe(0x1234);
    expect(dataReference(decodeAt([0xc3, 0x34, 0x12], 0))).toBeNull();
    expect(dataReference(decodeAt([0xdb, 0x12], 0))).toBeNull();
    expect(dataReference(decodeAt([0x3e, 0x12], 0))).toBeNull();
  });
});

describe('analyze', () => {
  it('exposes the symbol table', () => {
    const a = analyze(loadRaw(Uint8Array.from([0xcd, 0x04, 0x52, 0xc9, 0xc9]), 0x5200));
    expect(a.symbols.list().map((s) => s.name)).toEqual(['SUB_5204']);
  });
});
