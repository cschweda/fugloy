/**
 * Linear sweep: decode every loaded run from its first byte to its last,
 * one instruction after another. No code/data separation (that is Pass 1,
 * phase 2); an instruction that would cross the end of a run becomes DB.
 */
import { decode, formatInstruction } from '@fugloy/z80';
import type { Instruction } from '@fugloy/z80';
import type { MemoryImage, Run } from './memory.js';

export interface ListingLine {
  addr: number;
  bytes: number[];
  text: string;
  ins: Instruction;
}

export interface Section {
  run: Run;
  lines: ListingLine[];
}

export function linearSweep(image: MemoryImage): Section[] {
  return image.runs().map((run) => {
    const lines: ListingLine[] = [];
    let addr = run.start;
    while (addr <= run.end) {
      const ins = decode((i) => (addr + i <= run.end ? image.bytes[addr + i] : undefined), addr);
      lines.push({ addr, bytes: ins.bytes, text: formatInstruction(ins), ins });
      addr += ins.length;
    }
    return { run, lines };
  });
}
