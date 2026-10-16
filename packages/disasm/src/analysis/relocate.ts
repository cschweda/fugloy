/**
 * Relocation (spec §3, §5.7): a region of the file that executes at another
 * address. The analysis space is the file image with each relocated source
 * unloaded from its file address and loaded at its runtime address; Pass 1
 * and Pass 2 run on it unchanged, and toRun/toFile translate between the two.
 * A destination may cover its own source, as a move down by less than its
 * length does, but not memory that stays loaded where it is, nor another
 * destination.
 */
import { hex4 } from '@fugloy/z80';
import { MemoryImage } from '../memory.js';
import type { Run } from '../memory.js';

export interface Relocation {
  /** First byte of the source in the file image. */
  fileAddr: number;
  length: number;
  /** Where that byte executes. */
  runAddr: number;
}

export interface AnalysisSpace {
  /** The file image with each relocated source moved to its runtime address. */
  image: MemoryImage;
  /** The relocations that applied, in the order given. */
  relocations: Relocation[];
  toRun(fileAddr: number): number | null;
  toFile(runAddr: number): number | null;
}

/** A piece of a file run: it executes at `runAddr`, or in place when that is null. */
export interface FilePiece {
  start: number;
  end: number;
  runAddr: number | null;
}

const $ = (n: number): string => `$${hex4(n & 0xffff)}`;
const within = (a: number, start: number, length: number): boolean => a >= start && a < start + length;
const overlap = (a: number, al: number, b: number, bl: number): boolean => a < b + bl && b < a + al;
const span = (start: number, length: number): string => `${$(start)}-${$(start + length - 1)}`;

export function analysisSpace(image: MemoryImage, relocations: readonly Relocation[]): { space: AnalysisSpace; errors: string[] } {
  const errors: string[] = [];
  const runs = image.runs();
  let applied: Relocation[] = [];
  for (const r of relocations) {
    const at = `relocate at ${$(r.fileAddr)}`;
    const run = runs.find((x) => r.fileAddr >= x.start && r.fileAddr <= x.end);
    if (run === undefined) errors.push(`${at}: nothing is loaded there`);
    else if (r.length < 1 || r.fileAddr + r.length - 1 > run.end) errors.push(`${at}: the source ${span(r.fileAddr, r.length)} runs past the end of its block`);
    else if (r.runAddr < 0 || r.runAddr + r.length > 0x10000) errors.push(`${at}: the destination ${$(r.runAddr)} plus ${r.length} bytes runs past $FFFF`);
    else {
      const source = applied.find((o) => overlap(o.fileAddr, o.length, r.fileAddr, r.length));
      const dest = applied.find((o) => overlap(o.runAddr, o.length, r.runAddr, r.length));
      if (source !== undefined) errors.push(`${at}: the source overlaps the source of the relocate at ${$(source.fileAddr)}`);
      else if (dest !== undefined) errors.push(`${at}: the destination ${span(r.runAddr, r.length)} overlaps the destination of the relocate at ${$(dest.fileAddr)}`);
      else applied.push(r);
    }
  }
  // A destination may not cover memory that stays where it was loaded; dropping one relocation can expose another.
  for (;;) {
    const moved = (a: number): boolean => applied.some((r) => within(a, r.fileAddr, r.length));
    const kept = applied.filter((r) => {
      for (let i = 0; i < r.length; i++) {
        const a = r.runAddr + i;
        if (image.isLoaded(a) && !moved(a)) {
          errors.push(`relocate at ${$(r.fileAddr)}: the destination ${span(r.runAddr, r.length)} overlaps loaded memory at ${$(a)}`);
          return false;
        }
      }
      return true;
    });
    if (kept.length === applied.length) break;
    applied = kept;
  }
  const space = new MemoryImage();
  for (const run of runs) {
    for (const piece of filePieces(run, applied)) {
      if (piece.runAddr === null) space.load(piece.start, image.bytes.subarray(piece.start, piece.end + 1));
    }
  }
  for (const r of applied) space.load(r.runAddr, image.bytes.subarray(r.fileAddr, r.fileAddr + r.length));
  const toRun = (fileAddr: number): number | null => {
    const r = applied.find((x) => within(fileAddr, x.fileAddr, x.length));
    if (r !== undefined) return r.runAddr + (fileAddr - r.fileAddr);
    return image.isLoaded(fileAddr) ? fileAddr : null;
  };
  const toFile = (runAddr: number): number | null => {
    const r = applied.find((x) => within(runAddr, x.runAddr, x.length));
    if (r !== undefined) return r.fileAddr + (runAddr - r.runAddr);
    return space.isLoaded(runAddr) ? runAddr : null;
  };
  return { space: { image: space, relocations: applied, toRun, toFile }, errors };
}

/** A file run cut at the relocated sources inside it, in file order. */
export function filePieces(run: Run, relocations: readonly Relocation[]): FilePiece[] {
  const inside = relocations.filter((r) => r.fileAddr >= run.start && r.fileAddr <= run.end).sort((a, b) => a.fileAddr - b.fileAddr);
  const pieces: FilePiece[] = [];
  let a = run.start;
  for (const r of inside) {
    if (r.fileAddr > a) pieces.push({ start: a, end: r.fileAddr - 1, runAddr: null });
    pieces.push({ start: r.fileAddr, end: r.fileAddr + r.length - 1, runAddr: r.runAddr });
    a = r.fileAddr + r.length;
  }
  if (a <= run.end) pieces.push({ start: a, end: run.end, runAddr: null });
  return pieces;
}
