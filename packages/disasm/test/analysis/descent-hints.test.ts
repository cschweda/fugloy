import { describe, expect, it } from 'vitest';
import { recursiveDescent } from '../../src/analysis/descent.js';
import { Kind } from '../../src/analysis/map.js';
import { emptyAnnotations } from '../../src/hints/apply.js';
import type { Annotations } from '../../src/hints/apply.js';
import { analyze } from '../../src/pipeline.js';
import { loadRaw } from '../../src/raw.js';
import { image } from '../images.js';

const ann = (partial: Partial<Annotations>): Annotations => ({ ...emptyAnnotations(), ...partial });
const starts = (p: ReturnType<typeof recursiveDescent>) => [...p.instructions.keys()].sort((a, b) => a - b);
const kinds = (p: ReturnType<typeof recursiveDescent>, from: number, n: number) => Array.from({ length: n }, (_, i) => p.map.kind(from + i));

describe('descent with annotations', () => {
  it('composes roots in order: module entry, --entry, hint entries, code hints', () => {
    const mod = loadRaw(Uint8Array.from([0xc9, 0xc9, 0xc9, 0xc9, 0xc9]), 0x6000);
    const a = analyze(mod, { entries: [0x6001], annotations: ann({ entries: [0x6002], overrides: [{ addr: 0x6003, kind: 'code', length: 0 }] }) });
    expect(a.roots).toEqual([0x6000, 0x6001, 0x6002, 0x6003]);
    expect(starts(a.pass1)).toEqual([0x6000, 0x6001, 0x6002, 0x6003]);
    expect(a.annotations.entries).toEqual([0x6002]);
  });

  it('ends a path at a nocode address with a diagnostic and leaves what follows unknown', () => {
    const p = recursiveDescent(image({ 0x6000: [0x00, 0x00, 0xc9] }), [0x6000], ann({ overrides: [{ addr: 0x6001, kind: 'nocode', length: 1 }] }));
    expect(starts(p)).toEqual([0x6000]);
    expect(kinds(p, 0x6000, 3)).toEqual([Kind.Code, Kind.Unknown, Kind.Unknown]);
    expect(p.diagnostics).toEqual([{ kind: 'nocode', addr: 0x6001, message: 'path ends at $6001 (nocode hint)' }]);
  });

  it('treats a jump into a bytes override as in-data and keeps the bytes typed', () => {
    // 6000 JR 6003 ; 6002 unreached ; 6003..6004 bytes override ; 6005 RET
    const p = recursiveDescent(image({ 0x6000: [0x18, 0x01, 0x00, 0xff, 0xff, 0xc9] }), [0x6000], ann({ overrides: [{ addr: 0x6003, kind: 'bytes', length: 2 }] }));
    expect(starts(p)).toEqual([0x6000]);
    expect(kinds(p, 0x6003, 2)).toEqual([Kind.Byte, Kind.Byte]);
    expect(p.diagnostics).toEqual([{ kind: 'in-data', addr: 0x6003, from: 0x6000, message: 'target $6003 is typed as data' }]);
  });

  it('stops a path that falls through into a bytes override', () => {
    const p = recursiveDescent(image({ 0x6000: [0x00, 0xff, 0xc9] }), [0x6000], ann({ overrides: [{ addr: 0x6001, kind: 'bytes', length: 1 }] }));
    expect(starts(p)).toEqual([0x6000]);
    expect(p.diagnostics).toEqual([{ kind: 'in-data', addr: 0x6001, message: 'target $6001 is typed as data' }]);
  });

  it('refuses an instruction that would extend into an override region', () => {
    const p = recursiveDescent(image({ 0x6000: [0x21, 0x00, 0x3c, 0xc9] }), [0x6000], ann({ overrides: [{ addr: 0x6002, kind: 'bytes', length: 1 }] }));
    expect(starts(p)).toEqual([]);
    expect(p.diagnostics).toEqual([{ kind: 'overlap', addr: 0x6000, message: 'instruction at $6000 would overlap data at $6002' }]);
  });

  it('applies overrides before any decoding, so bytes on the entry itself win', () => {
    const p = recursiveDescent(image({ 0x6000: [0xc9, 0xc9] }), [0x6000], ann({ overrides: [{ addr: 0x6000, kind: 'bytes', length: 1 }] }));
    expect(p.instructions.size).toBe(0);
    expect(p.diagnostics.map((d) => d.kind)).toEqual(['in-data']);
  });

  it('pre-types words and string overrides', () => {
    const p = recursiveDescent(image({ 0x6000: [1, 2, 3, 4, 0x48, 0x49, 0x0d] }), [], ann({ overrides: [{ addr: 0x6000, kind: 'words', length: 4 }, { addr: 0x6004, kind: 'string', length: 3 }] }));
    expect(kinds(p, 0x6000, 7)).toEqual([Kind.Word, Kind.Word, Kind.Word, Kind.Word, Kind.String, Kind.String, Kind.String]);
  });

  it('types a table as words, seeds its loaded targets as roots, records xrefs, and makes unloaded entries externals', () => {
    const img = image({ 0x6000: [0xc9], 0x6010: [0x00, 0x60, 0x33, 0x00, 0x20, 0x60], 0x6020: [0xc9] });
    const p = recursiveDescent(img, [], ann({ tables: [{ addr: 0x6010, count: 3, width: 2 }] }));
    expect(kinds(p, 0x6010, 6)).toEqual(Array<Kind>(6).fill(Kind.Word));
    expect(starts(p)).toEqual([0x6000, 0x6020]);
    expect(p.xrefs).toEqual([
      { from: 0x6010, to: 0x6000, kind: 'jump' },
      { from: 0x6012, to: 0x0033, kind: 'jump' },
      { from: 0x6014, to: 0x6020, kind: 'jump' },
    ]);
    expect(p.externals).toEqual([0x0033]);
  });

  it('stops reading table entries at the end of loaded memory', () => {
    const p = recursiveDescent(image({ 0x6010: [0x00, 0x60, 0x33] }), [], ann({ tables: [{ addr: 0x6010, count: 4, width: 2 }] }));
    expect(p.xrefs).toEqual([{ from: 0x6010, to: 0x6000, kind: 'jump' }]);
    expect(p.externals).toEqual([0x6000]);
  });

  it('decodes a code hint with a length linearly, ignoring flow, and still follows its transfers', () => {
    // 6001 NOP ; 6002 RET ; 6003 CALL 6010 ; 6006 RST 38H — no root reaches them; 6010 RET
    const img = image({ 0x6000: [0xff, 0x00, 0xc9, 0xcd, 0x10, 0x60, 0xff], 0x6010: [0xc9] });
    const p = recursiveDescent(img, [], ann({ overrides: [{ addr: 0x6001, kind: 'code', length: 6 }] }));
    expect(starts(p)).toEqual([0x6001, 0x6002, 0x6003, 0x6006, 0x6010]);
    expect(p.map.kind(0x6000)).toBe(Kind.Unknown);
  });

  it('lets a forced code region win over a later natural path and skips data inside it', () => {
    const img = image({ 0x6000: [0x3e, 0x00, 0xc9, 0xff] });
    // forced: 6000 LD A,0 ; 6002 RET ; 6003 is a bytes override inside the region; root 6001 is then inside an instruction
    const p = recursiveDescent(img, [0x6001], ann({ overrides: [{ addr: 0x6000, kind: 'code', length: 4 }, { addr: 0x6003, kind: 'bytes', length: 1 }] }));
    expect(starts(p)).toEqual([0x6000, 0x6002]);
    expect(p.map.kind(0x6003)).toBe(Kind.Byte);
    expect(p.diagnostics.map((d) => d.kind)).toEqual(['inside-instruction']);
  });

  it('is unchanged without annotations', () => {
    const a = recursiveDescent(image({ 0x6000: [0x21, 0x00, 0x3c, 0xc9] }), [0x6000]);
    const b = recursiveDescent(image({ 0x6000: [0x21, 0x00, 0x3c, 0xc9] }), [0x6000], emptyAnnotations());
    expect(starts(a)).toEqual(starts(b));
    expect(a.diagnostics).toEqual(b.diagnostics);
  });
});
