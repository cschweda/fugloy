/**
 * Heuristics that run after descent (spec §3, §5.4). Strings are applied: a
 * terminated printable run in untyped memory becomes Kind.String. Tables are
 * only proposed, with the exact hint line that would declare them. Neither
 * ever overrides code, typed bytes, or hints.
 */
import { hex4 } from '@fugloy/z80';
import type { Pass1 } from './descent.js';
import { Kind } from './map.js';
import type { ByteMap } from './map.js';
import type { BlockIdentity } from '../hints/identity.js';
import type { MemoryImage } from '../memory.js';

/** A string is at least this many printable bytes before its terminator. */
const MIN_STRING = 4;
const TERMINATORS: ReadonlySet<number> = new Set([0x0d, 0x03, 0x00]);
/** A table is at least this many consecutive words. */
const MIN_TABLE = 3;

export interface TableProposal {
  kind: 'table';
  addr: number;
  count: number;
  /** The hint line that declares it: `block i:$off table n 2`. */
  hint: string;
}

const printable = (b: number): boolean => b >= 0x20 && b <= 0x7e;
const isData = (k: number): boolean => k === Kind.Byte || k === Kind.Word || k === Kind.String;

/**
 * Untyped runs of four or more printable bytes ending in 0DH, 03H, or 00H, the
 * terminator included. A candidate never includes code or typed bytes, never
 * touches data typed before the scan, and may start at a symbol (`stops`) but
 * never runs through one. The caller types the results as Kind.String.
 *
 * `frame` names a .BAS program's line headers, terminators, and end marker:
 * typed, but no data a string could belong to, so a candidate may sit beside
 * them, and a line's own 00 may end one without joining it.
 */
export function findStrings(
  image: MemoryImage,
  map: ByteMap,
  stops: ReadonlySet<number> = new Set(),
  frame: (addr: number) => boolean = () => false,
): { addr: number; length: number }[] {
  const found: { addr: number; length: number }[] = [];
  const free = (a: number): boolean => map.kind(a) === Kind.Unknown;
  const data = (a: number): boolean => isData(map.kind(a)) && !frame(a);
  for (const run of image.runs()) {
    let a = run.start;
    while (a <= run.end) {
      if (!free(a) || !printable(image.bytes[a]!)) {
        a++;
        continue;
      }
      let b = a + 1;
      while (b <= run.end && free(b) && printable(image.bytes[b]!) && !stops.has(b)) b++;
      const ownTerminator = b <= run.end && free(b) && TERMINATORS.has(image.bytes[b]!) && !stops.has(b);
      const lineTerminator = b <= run.end && frame(b) && image.bytes[b] === 0x00;
      const touches = (a > run.start && data(a - 1)) || (ownTerminator && b < run.end && data(b + 1));
      if ((ownTerminator || lineTerminator) && b - a >= MIN_STRING && !touches) {
        found.push({ addr: a, length: ownTerminator ? b - a + 1 : b - a });
        a = b + 1;
      } else a = b;
    }
  }
  return found;
}

/**
 * Three or more consecutive little-endian words in untyped memory, each the
 * address of a decoded instruction. `toFile` maps a runtime address back to
 * the file, so a proposal inside a relocated region names its file offset.
 */
export function proposeTables(image: MemoryImage, pass1: Pass1, identities: BlockIdentity[], toFile: (runAddr: number) => number | null = (a) => a): TableProposal[] {
  const { map, instructions } = pass1;
  const proposals: TableProposal[] = [];
  const free = (a: number): boolean => map.kind(a) === Kind.Unknown;
  const word = (a: number): number => image.bytes[a]! | (image.bytes[a + 1]! << 8);
  for (const run of image.runs()) {
    let a = run.start;
    while (a + 1 <= run.end) {
      let count = 0;
      while (a + 2 * count + 1 <= run.end && free(a + 2 * count) && free(a + 2 * count + 1) && instructions.has(word(a + 2 * count))) count++;
      if (count < MIN_TABLE) {
        a++;
        continue;
      }
      const fileAddr = toFile(a) ?? a;
      const block = identities.find((b) => fileAddr >= b.start && fileAddr < b.start + b.length);
      if (block !== undefined) proposals.push({ kind: 'table', addr: a, count, hint: `block ${block.index}:$${hex4(fileAddr - block.start)} table ${count} 2` });
      a += 2 * count;
    }
  }
  return proposals;
}
