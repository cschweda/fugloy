import { describe, expect, it } from 'vitest';
import { ByteMap, Kind } from '../../src/analysis/map.js';

describe('ByteMap', () => {
  it('starts all unknown with no instruction starts', () => {
    const m = new ByteMap();
    expect(m.kinds.length).toBe(65536);
    expect(m.starts.length).toBe(65536);
    expect(m.kind(0x6000)).toBe(Kind.Unknown);
    expect(m.isStart(0x6000)).toBe(false);
    expect(m.isCode(0x6000)).toBe(false);
  });

  it('marks an instruction as Code then Tail and records its start', () => {
    const m = new ByteMap();
    m.markCode(0x6000, 3);
    expect([m.kind(0x6000), m.kind(0x6001), m.kind(0x6002), m.kind(0x6003)]).toEqual([Kind.Code, Kind.Tail, Kind.Tail, Kind.Unknown]);
    expect(m.isStart(0x6000)).toBe(true);
    expect(m.isStart(0x6001)).toBe(false);
    expect(m.isCode(0x6002)).toBe(true);
    expect(m.isCode(0x6003)).toBe(false);
  });

  it('detects overlap with existing code anywhere in the range', () => {
    const m = new ByteMap();
    m.markCode(0x6002, 2);
    expect(m.overlapsCode(0x6000, 2)).toBe(false);
    expect(m.overlapsCode(0x6000, 3)).toBe(true);
    expect(m.overlapsCode(0x6003, 1)).toBe(true);
    expect(m.overlapsCode(0x6004, 4)).toBe(false);
  });

  it('marks data bytes, clearing any start, and wraps at $FFFF', () => {
    const m = new ByteMap();
    m.markByte(0xffff, 2);
    expect(m.kind(0xffff)).toBe(Kind.Byte);
    expect(m.kind(0x0000)).toBe(Kind.Byte);
    expect(m.isCode(0xffff)).toBe(false);
    m.markCode(0x7000, 1);
    m.markByte(0x7000, 1);
    expect(m.isStart(0x7000)).toBe(false);
  });
});
