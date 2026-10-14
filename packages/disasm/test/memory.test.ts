import { describe, expect, it } from 'vitest';
import { MemoryImage } from '../src/memory.js';

describe('MemoryImage', () => {
  it('is a flat 64K byte array with a parallel one-byte-per-address bitmap', () => {
    const m = new MemoryImage();
    expect(m.bytes).toBeInstanceOf(Uint8Array);
    expect(m.bytes.length).toBe(65536);
    expect(m.loaded).toBeInstanceOf(Uint8Array);
    expect(m.loaded.length).toBe(65536);
    expect(m.blocks).toEqual([]);
    expect(m.runs()).toEqual([]);
    expect(m.lowestLoaded()).toBeNull();
  });

  it('writes bytes and marks the bitmap for exactly the loaded range', () => {
    const m = new MemoryImage();
    m.load(0x6000, [0x21, 0x00, 0x3c]);
    expect(m.bytes[0x6000]).toBe(0x21);
    expect(m.bytes[0x6002]).toBe(0x3c);
    expect(m.isLoaded(0x5fff)).toBe(false);
    expect(m.isLoaded(0x6000)).toBe(true);
    expect(m.isLoaded(0x6002)).toBe(true);
    expect(m.isLoaded(0x6003)).toBe(false);
    expect(m.read(0x6001)).toBe(0x00);
    expect(m.read(0x6003)).toBeUndefined();
    expect(m.lowestLoaded()).toBe(0x6000);
  });

  it('records every block in load order with inclusive extents', () => {
    const m = new MemoryImage();
    const a = m.load(0x7000, [1, 2]);
    const b = m.load(0x5000, [3]);
    expect(a).toEqual({ index: 0, start: 0x7000, length: 2, end: 0x7001, wrapped: false });
    expect(b).toEqual({ index: 1, start: 0x5000, length: 1, end: 0x5000, wrapped: false });
    expect(m.blocks).toEqual([a, b]);
    expect(m.lowestLoaded()).toBe(0x5000);
  });

  it('lets a later block overwrite an earlier one and logs the exact overlap', () => {
    const m = new MemoryImage();
    m.load(0x8000, [0, 0, 0, 0, 0, 0, 0, 0]);
    m.load(0x8003, [0xaa, 0xbb, 0xcc]);
    expect(m.bytes[0x8002]).toBe(0);
    expect(m.bytes[0x8003]).toBe(0xaa);
    expect(m.bytes[0x8005]).toBe(0xcc);
    expect(m.overlaps).toEqual([{ block: 1, earlier: 0, start: 0x8003, end: 0x8005 }]);
  });

  it('logs one overlap per earlier block touched, clipped to each intersection', () => {
    const m = new MemoryImage();
    m.load(0x1000, [1, 1, 1, 1]);
    m.load(0x1004, [2, 2, 2, 2]);
    m.load(0x1002, [9, 9, 9, 9]);
    expect(m.overlaps).toEqual([
      { block: 2, earlier: 0, start: 0x1002, end: 0x1003 },
      { block: 2, earlier: 1, start: 0x1004, end: 0x1005 },
    ]);
  });

  it('merges adjacent and overlapping blocks into one run and keeps gaps as separate runs', () => {
    const m = new MemoryImage();
    m.load(0x6000, [1, 2, 3]);
    m.load(0x6003, [4]);
    m.load(0x6002, [5, 6]);
    m.load(0x7000, [7]);
    expect(m.runs()).toEqual([
      { start: 0x6000, end: 0x6003, length: 4 },
      { start: 0x7000, end: 0x7000, length: 1 },
    ]);
  });

  it('wraps a block that passes $FFFF around to $0000 and flags it', () => {
    const m = new MemoryImage();
    const b = m.load(0xfffe, [1, 2, 3, 4]);
    expect(b.wrapped).toBe(true);
    expect(b.start).toBe(0xfffe);
    expect(b.length).toBe(4);
    expect(m.bytes[0xffff]).toBe(2);
    expect(m.bytes[0x0000]).toBe(3);
    expect(m.bytes[0x0001]).toBe(4);
    expect(m.isLoaded(0x0001)).toBe(true);
    expect(m.isLoaded(0x0002)).toBe(false);
    expect(m.runs()).toEqual([
      { start: 0x0000, end: 0x0001, length: 2 },
      { start: 0xfffe, end: 0xffff, length: 2 },
    ]);
  });

  it('accepts an empty block without marking anything', () => {
    const m = new MemoryImage();
    const b = m.load(0x4000, []);
    expect(b.length).toBe(0);
    expect(m.isLoaded(0x4000)).toBe(false);
    expect(m.runs()).toEqual([]);
  });
});
