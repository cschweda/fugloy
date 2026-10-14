import { describe, expect, it } from 'vitest';
import { MemoryImage } from '../src/memory.js';
import { linearSweep } from '../src/sweep.js';

describe('linearSweep', () => {
  it('decodes a run instruction by instruction with address, bytes, and text', () => {
    const m = new MemoryImage();
    m.load(0x6000, [0x21, 0x00, 0x3c, 0xc9]);
    const sections = linearSweep(m);
    expect(sections.length).toBe(1);
    expect(sections[0]!.run).toEqual({ start: 0x6000, end: 0x6003, length: 4 });
    expect(sections[0]!.lines.map((l) => [l.addr, l.bytes, l.text])).toEqual([
      [0x6000, [0x21, 0x00, 0x3c], 'LD HL,3C00H'],
      [0x6003, [0xc9], 'RET'],
    ]);
  });

  it('emits DB for an instruction cut off by the end of a run and never reads past it', () => {
    const m = new MemoryImage();
    m.load(0x6000, [0x21, 0x00]);
    m.load(0x7000, [0x3c, 0xcd]);
    m.bytes[0x6002] = 0x3c; // present in memory but not loaded: must not be read
    const [a, b] = linearSweep(m);
    expect(a!.lines.map((l) => l.text)).toEqual(['DB 21H', 'NOP']);
    expect(a!.lines[0]!.ins.truncated).toBe(true);
    expect(b!.lines.map((l) => l.text)).toEqual(['INC A', 'DB 0CDH']);
  });

  it('covers every loaded byte exactly once, one section per run', () => {
    const m = new MemoryImage();
    m.load(0x5200, Array.from({ length: 300 }, (_, i) => (i * 7) & 0xff));
    m.load(0x8000, [0xdd, 0xcb, 0x05, 0x06, 0xed, 0xb0, 0x76]);
    const sections = linearSweep(m);
    expect(sections.map((s) => s.run.start)).toEqual([0x5200, 0x8000]);
    for (const s of sections) {
      expect(s.lines.reduce((n, l) => n + l.bytes.length, 0)).toBe(s.run.length);
      expect(s.lines[0]!.addr).toBe(s.run.start);
      for (let i = 1; i < s.lines.length; i++) expect(s.lines[i]!.addr).toBe(s.lines[i - 1]!.addr + s.lines[i - 1]!.bytes.length);
    }
    expect(sections[1]!.lines.map((l) => l.text)).toEqual(['RLC (IX+05H)', 'LDIR', 'HALT']);
  });

  it('resolves relative jumps against the real address', () => {
    const m = new MemoryImage();
    m.load(0x7000, [0x18, 0xfe]);
    expect(linearSweep(m)[0]!.lines[0]!.text).toBe('JR 7000H');
  });
});
