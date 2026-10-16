/**
 * Asylum's loader stream, read from the program itself (fixtures/hints/asylum16.hints documents the loader).
 * From $80DD the loader interprets records: `<` n dest copies the next n bytes to dest (n = 0 means 256), and
 * `x` addr jumps to addr. Each `<` record becomes one relocate line, and the `x` target an entry at the file
 * offset that lands there, so the committed hint file can be checked against the sample byte for byte.
 */
import { hex4 } from '@fugloy/z80';
import type { MemoryImage } from '../../src/memory.js';

export interface StreamRecord {
  /** File address of the record's first data byte. */
  data: number;
  length: number;
  dest: number;
}

export function asylumStream(image: MemoryImage, start = 0x80dd): { records: StreamRecord[]; jump: number } {
  const byte = (a: number): number => {
    const b = image.read(a);
    if (b === undefined) throw new Error(`the stream runs off the image at $${hex4(a)}`);
    return b;
  };
  const records: StreamRecord[] = [];
  for (let a = start; ; ) {
    const tag = byte(a);
    if (tag === 0x78) return { records, jump: byte(a + 1) | (byte(a + 2) << 8) };
    if (tag !== 0x3c) throw new Error(`unexpected stream tag ${tag.toString(16).toUpperCase()}H at $${hex4(a)}`);
    const length = byte(a + 1) || 256;
    records.push({ data: a + 4, length, dest: byte(a + 2) | (byte(a + 3) << 8) });
    a += 4 + length;
  }
}

/** Hint lines for block 0, which loads at the image's first address: one relocate per record, then the entry. */
export function asylumHintLines(image: MemoryImage): string[] {
  const base = image.runs()[0]!.start;
  const { records, jump } = asylumStream(image);
  const lines = records.map((r) => `block 0:$${hex4(r.data - base)} relocate $${hex4(r.dest)} $${hex4(r.length)}`);
  const into = records.find((r) => jump >= r.dest && jump < r.dest + r.length);
  if (into === undefined) throw new Error(`the jump target $${hex4(jump)} is in no record`);
  lines.push(`block 0:$${hex4(into.data + (jump - into.dest) - base)} entry`);
  return lines;
}
