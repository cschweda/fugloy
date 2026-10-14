import { MemoryImage } from './memory.js';

/** A raw binary loaded at a user-supplied base address. */
export interface RawModule {
  format: 'raw';
  image: MemoryImage;
  base: number;
  entry: number;
}

export function loadRaw(bytes: Uint8Array, base: number): RawModule {
  const image = new MemoryImage();
  const start = base & 0xffff;
  image.load(start, bytes);
  return { format: 'raw', image, base: start, entry: start };
}
