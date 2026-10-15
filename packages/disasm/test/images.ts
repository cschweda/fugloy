import { MemoryImage } from '../src/memory.js';

/** A memory image from `{ address: bytes }` blocks, for analysis tests. */
export function image(blocks: Record<number, number[]>): MemoryImage {
  const m = new MemoryImage();
  for (const [addr, bytes] of Object.entries(blocks)) m.load(Number(addr), bytes);
  return m;
}
