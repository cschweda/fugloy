/**
 * Content-based identity for hint files. A block is a loaded run; its identity
 * is its length and the first 16 hex digits of SHA-256 over its first 64 bytes,
 * so a relocated build (same bytes except absolute addresses) keeps the same
 * identity and the same hints.
 */
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

export function blockIdentities(image: MemoryImage): BlockIdentity[] {
  return image.runs().map((run, index) => ({
    index,
    start: run.start,
    length: run.length,
    hash: sha256Hex(image.bytes.subarray(run.start, run.start + Math.min(IDENTITY_BYTES, run.length))).slice(0, 16),
  }));
}

/** SHA-256 of the whole input file, as the hint file's `program` line records it. */
export const programHash = (bytes: Uint8Array): string => sha256Hex(bytes);
