import { describe, expect, it } from 'vitest';
import { recursiveDescent } from '../../src/analysis/descent.js';
import { Kind } from '../../src/analysis/map.js';
import { image } from '../images.js';

type Pass1 = ReturnType<typeof recursiveDescent>;
const kinds = (p: Pass1, from: number, n: number) => Array.from({ length: n }, (_, i) => p.map.kind(from + i));
const starts = (p: Pass1) => [...p.instructions.keys()].sort((a, b) => a - b);

describe('recursiveDescent', () => {
  it('decodes straight-line code from the root and stops at RET, leaving the rest unknown', () => {
    const p = recursiveDescent(image({ 0x6000: [0x21, 0x00, 0x3c, 0xc9, 0xff, 0xff] }), [0x6000]);
    expect(starts(p)).toEqual([0x6000, 0x6003]);
    expect(kinds(p, 0x6000, 6)).toEqual([Kind.Code, Kind.Tail, Kind.Tail, Kind.Code, Kind.Unknown, Kind.Unknown]);
    expect(p.diagnostics).toEqual([]);
    expect(p.roots).toEqual([0x6000]);
  });

  it('follows both arms of a conditional branch and records the xref', () => {
    // 6000 JR NZ,6004 ; 6002 NOP ; 6003 RET ; 6004 RET
    const p = recursiveDescent(image({ 0x6000: [0x20, 0x02, 0x00, 0xc9, 0xc9] }), [0x6000]);
    expect(starts(p)).toEqual([0x6000, 0x6002, 0x6003, 0x6004]);
    expect(p.xrefs).toEqual([{ from: 0x6000, to: 0x6004, kind: 'cjump' }]);
  });

  it('queues a call target and continues after the call', () => {
    // 6000 CALL 6010 ; 6003 RET ; 6010 RET
    const p = recursiveDescent(image({ 0x6000: [0xcd, 0x10, 0x60, 0xc9], 0x6010: [0xc9] }), [0x6000]);
    expect(starts(p)).toEqual([0x6000, 0x6003, 0x6010]);
    expect(p.xrefs).toEqual([{ from: 0x6000, to: 0x6010, kind: 'call' }]);
  });

  it('records a conditional call as ccall', () => {
    const p = recursiveDescent(image({ 0x6000: [0xc4, 0x10, 0x60, 0xc9], 0x6010: [0xc9] }), [0x6000]);
    expect(p.xrefs).toEqual([{ from: 0x6000, to: 0x6010, kind: 'ccall' }]);
  });

  it('follows a target in another loaded run', () => {
    const p = recursiveDescent(image({ 0x6000: [0xc3, 0x00, 0x70], 0x7000: [0xc9] }), [0x6000]);
    expect(starts(p)).toEqual([0x6000, 0x7000]);
    expect(p.xrefs).toEqual([{ from: 0x6000, to: 0x7000, kind: 'jump' }]);
  });

  it('ends the path at an unconditional jump, an indirect jump, and HALT', () => {
    const jp = recursiveDescent(image({ 0x6000: [0x18, 0x01, 0x00, 0xc9] }), [0x6000]); // JR 6003 ; 6002 unreachable NOP ; 6003 RET
    expect(starts(jp)).toEqual([0x6000, 0x6003]);
    const ind = recursiveDescent(image({ 0x6000: [0xe9, 0x00] }), [0x6000]);
    expect(starts(ind)).toEqual([0x6000]);
    expect(ind.indirectJumps).toEqual([0x6000]);
    const halt = recursiveDescent(image({ 0x6000: [0xf3, 0x76, 0x00] }), [0x6000]);
    expect(starts(halt)).toEqual([0x6000, 0x6001]);
  });

  it('continues after a conditional return', () => {
    const p = recursiveDescent(image({ 0x6000: [0xc8, 0x00, 0xc9] }), [0x6000]);
    expect(starts(p)).toEqual([0x6000, 0x6001, 0x6002]);
  });

  it('types the byte after RST 08H as data and continues after it', () => {
    const p = recursiveDescent(image({ 0x6000: [0xcf, 0x2c, 0xc9] }), [0x6000]);
    expect(kinds(p, 0x6000, 3)).toEqual([Kind.Code, Kind.Byte, Kind.Code]);
    expect(p.externals).toEqual([0x0008]);
    expect(p.xrefs).toEqual([{ from: 0x6000, to: 0x0008, kind: 'rst' }]);
  });

  it('leaves a byte already decoded as code alone when an RST 08H would type it as its inline parameter', () => {
    // 6001 INC L is decoded first (root order); then 6000 RST 08H claims 6001 as its inline byte.
    const p = recursiveDescent(image({ 0x6000: [0xcf, 0x2c, 0xc9] }), [0x6001, 0x6000]);
    expect(starts(p)).toEqual([0x6000, 0x6001, 0x6002]);
    expect(p.map.kind(0x6001)).toBe(Kind.Code);
    expect(p.diagnostics).toEqual([{ kind: 'overlap', addr: 0x6000, message: 'inline byte after RST 08H at $6000 is already code at $6001' }]);
  });

  it('records unloaded targets as externals, not errors', () => {
    const p = recursiveDescent(image({ 0x6000: [0xcd, 0x33, 0x00, 0xc9] }), [0x6000]);
    expect(p.externals).toEqual([0x0033]);
    expect(p.diagnostics).toEqual([]);
  });

  it('terminates on a self-loop and a two-instruction loop without re-marking', () => {
    const self = recursiveDescent(image({ 0x6000: [0x18, 0xfe] }), [0x6000]);
    expect(starts(self)).toEqual([0x6000]);
    const two = recursiveDescent(image({ 0x6000: [0x00, 0x18, 0xfd] }), [0x6000]); // NOP ; JR 6000
    expect(starts(two)).toEqual([0x6000, 0x6001]);
    expect(two.xrefs).toEqual([{ from: 0x6001, to: 0x6000, kind: 'jump' }]);
  });

  it('lets the first decode win and diagnoses a root inside it', () => {
    const p = recursiveDescent(image({ 0x6000: [0x21, 0x00, 0x3c, 0xc9] }), [0x6000, 0x6001]);
    expect(starts(p)).toEqual([0x6000, 0x6003]);
    expect(p.diagnostics).toEqual([{ kind: 'inside-instruction', addr: 0x6001, message: 'target $6001 is inside the instruction at $6000' }]);
  });

  it('diagnoses a root that lands on a Tail of a later-decoded stream', () => {
    // 6000 LD HL,0FE18H ; 6003 RET ; root at 6004 decodes LD A,0C9H over 6004-6005 ; root at 6005 is then a Tail.
    const p = recursiveDescent(image({ 0x6000: [0x21, 0x18, 0xfe, 0xc9, 0x3e, 0xc9] }), [0x6000, 0x6004, 0x6005]);
    expect(starts(p)).toEqual([0x6000, 0x6003, 0x6004]);
    expect(p.diagnostics.map((d) => d.kind)).toEqual(['inside-instruction']);
  });

  it('diagnoses an overlap when a later path would cover already-typed code', () => {
    // 6003 RET is decoded first; the root at 6002 decodes LD B,n, whose operand byte is that RET.
    const q = recursiveDescent(image({ 0x6000: [0x00, 0x00, 0x06, 0xc9] }), [0x6003, 0x6002]);
    expect(starts(q)).toEqual([0x6003]);
    expect(q.diagnostics).toEqual([{ kind: 'overlap', addr: 0x6002, message: 'instruction at $6002 would overlap code at $6003' }]);
  });

  it('carries the referring address on diagnostics raised by a jump', () => {
    // 6000 LD HL,nn ; 6003 JR 6001 (into the LD's operand)
    const p = recursiveDescent(image({ 0x6000: [0x21, 0x00, 0x3c, 0x18, 0xfc] }), [0x6000]);
    expect(p.diagnostics).toEqual([{ kind: 'inside-instruction', addr: 0x6001, from: 0x6003, message: 'target $6001 is inside the instruction at $6000' }]);
  });

  it('diagnoses a jump into a data byte', () => {
    // 6000 RST 08H ; 6001 data 2C ; 6002 JR 6001
    const p = recursiveDescent(image({ 0x6000: [0xcf, 0x2c, 0x18, 0xfd] }), [0x6000]);
    expect(p.diagnostics).toEqual([{ kind: 'in-data', addr: 0x6001, from: 0x6002, message: 'target $6001 is typed as data' }]);
  });

  it('types a truncated instruction at the end of a run as data with a diagnostic', () => {
    const p = recursiveDescent(image({ 0x6000: [0x00, 0xcd] }), [0x6000]);
    expect(kinds(p, 0x6000, 2)).toEqual([Kind.Code, Kind.Byte]);
    expect(p.diagnostics).toEqual([{ kind: 'truncated', addr: 0x6001, message: 'instruction at $6001 runs past loaded memory' }]);
  });

  it('diagnoses an unloaded root and ignores a duplicate root', () => {
    const p = recursiveDescent(image({ 0x6000: [0xc9] }), [0x6000, 0x6000, 0x7000]);
    expect(p.roots).toEqual([0x6000, 0x7000]);
    expect(starts(p)).toEqual([0x6000]);
    expect(p.diagnostics).toEqual([{ kind: 'unloaded-root', addr: 0x7000, message: 'entry $7000 is not in loaded memory' }]);
  });

  it('processes roots in the order given, so a root inside an earlier root\'s instruction is diagnosed', () => {
    const p = recursiveDescent(image({ 0x6000: [0x1e, 0x00, 0xc9] }), [0x6000, 0x6001]);
    expect(starts(p)).toEqual([0x6000, 0x6002]);
    expect(p.diagnostics[0]?.kind).toBe('inside-instruction');
  });

  it('keeps the decoded instructions with their bytes and addresses', () => {
    const p = recursiveDescent(image({ 0x6000: [0x21, 0x00, 0x3c, 0xc9] }), [0x6000]);
    expect(p.instructions.get(0x6000)?.bytes).toEqual([0x21, 0x00, 0x3c]);
    expect(p.instructions.get(0x6003)?.mnemonic).toBe('RET');
  });
});
