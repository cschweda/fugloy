/**
 * Content-based identity for hint files. A block is a loaded run; its identity
 * is its length and the first 16 hex digits of SHA-256 over its first 64 bytes,
 * so a relocated build (same bytes except absolute addresses) keeps the same
 * identity and the same hints. A tokenized BASIC program's first 64 bytes hold
 * line pointers, which a rebase rewrites, so its identity reads each pointer
 * as an offset from the program start (basIdentityNormalizer).
 */
import type { BasProgram } from '../bas.js';
import { sha256Hex } from '../hash.js';
import type { MemoryImage } from '../memory.js';

export const IDENTITY_BYTES = 64;

export interface BlockIdentity {
  index: number;
  start: number;
  length: number;
  /** 16 hex digits. */
  hash: string;
}

/** Rewrites a copy of a block's identity window, which starts at `start`, before it is hashed. */
export type IdentityNormalizer = (bytes: Uint8Array, start: number) => Uint8Array;

export function blockIdentities(image: MemoryImage, normalize?: IdentityNormalizer): BlockIdentity[] {
  return image.runs().map((run, index) => {
    const window = image.bytes.subarray(run.start, run.start + Math.min(IDENTITY_BYTES, run.length));
    return {
      index,
      start: run.start,
      length: run.length,
      hash: sha256Hex(normalize === undefined ? window : normalize(Uint8Array.from(window), run.start)).slice(0, 16),
    };
  });
}

/** Replaces each line pointer inside the window by its offset from the program start, little-endian. */
export function basIdentityNormalizer(prog: BasProgram): IdentityNormalizer {
  return (bytes, start) => {
    const out = Uint8Array.from(bytes);
    for (const line of prog.lines) {
      const at = line.addr - start;
      if (at + 1 < 0 || at >= out.length) continue;
      const offset = (line.addr + line.length - prog.base) & 0xffff;
      if (at >= 0) out[at] = offset & 0xff;
      if (at + 1 < out.length) out[at + 1] = offset >> 8;
    }
    return out;
  };
}

/** SHA-256 of the whole input file, as the hint file's `program` line records it. */
export const programHash = (bytes: Uint8Array): string => sha256Hex(bytes);
