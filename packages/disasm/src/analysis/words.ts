/**
 * DW words (design spec §4.5): the 16-bit words the listing and the zmac emitter
 * write on a DW row, and whether each is an entry of a declared jump table (a
 * code address) or another typed word (a data address). Both emitters decide
 * where a row starts with `rowStarts`, and Pass 2 finds the words with the same
 * rule, so a name given to a word in a row is always one `externalUses` counted.
 */
import type { Instruction } from '@fugloy/z80';
import type { Annotations, TableHint } from '../hints/apply.js';
import type { MemoryImage } from '../memory.js';
import { Kind } from './map.js';
import type { ByteMap } from './map.js';
import { filePieces } from './relocate.js';
import type { AnalysisSpace } from './relocate.js';
import type { SymbolTable } from './symbols.js';

/** A word a DW row writes. */
export interface DataWord {
  /** Runtime address of the low byte. */
  addr: number;
  value: number;
  /** True for an entry of a declared jump table, whose value is a code address; false for any other typed word, whose value is a data address. */
  jump: boolean;
}

/**
 * Where an emitter starts a new row: at a symbol, a hint comment or note, an
 * instruction, or the start of a typed region. A run of one kind of data is cut
 * there, so words pair up again from each of these addresses.
 */
export function rowStarts(
  symbols: SymbolTable | undefined,
  annotations: Annotations,
  instructions: ReadonlyMap<number, Instruction>,
): (addr: number) => boolean {
  const regionStarts = new Set(annotations.overrides.map((o) => o.addr & 0xffff));
  return (addr) => (symbols?.has(addr) ?? false) || annotations.comments.has(addr) || annotations.notes.has(addr) || instructions.has(addr) || regionStarts.has(addr);
}

/** What `dataWords` reads: the file image the emitters walk, and Pass 1's map of what each byte is. */
export interface WordLayout {
  /** The file image: the emitters walk its runs, a relocated piece at its runtime address. */
  image: MemoryImage;
  /** The runtime view, where the words' bytes are read. */
  space: AnalysisSpace;
  map: ByteMap;
  tables: readonly TableHint[];
  startsRow: (addr: number) => boolean;
  /** True for a word that is not data, such as a .BAS program's line header, which is typed as words but holds a pointer and a line number. */
  skip: (addr: number) => boolean;
}

/**
 * Every word the emitters write on a DW row, in address order. A run of bytes
 * typed as words is cut at each row start and pairs up from its first byte; an
 * odd byte left over is written as DB, so it is not a word. Only the entries of
 * a declared table are code addresses. Another pair inside a table (one a name
 * or comment in the middle of an entry has shifted) is neither, and is left out.
 */
export function dataWords({ image, space, map, tables, startsRow, skip }: WordLayout): DataWord[] {
  const entries = new Set<number>();
  for (const t of tables) for (let i = 0; i < t.count; i++) entries.add((t.addr + i * t.width) & 0xffff);
  const inTable = (addr: number): boolean => tables.some((t) => addr >= t.addr && addr < t.addr + t.count * t.width);
  const bytes = space.image.bytes;
  const words: DataWord[] = [];
  const walk = (from: number, to: number): void => {
    let addr = from;
    while (addr <= to) {
      if (map.kind(addr) !== Kind.Word) {
        addr++;
        continue;
      }
      let n = 1;
      while (addr + n <= to && !startsRow(addr + n) && map.kind(addr + n) === Kind.Word) n++;
      for (let i = 0; i + 1 < n; i += 2) {
        const at = addr + i;
        if (skip(at)) continue;
        const word = { addr: at, value: bytes[at]! | (bytes[at + 1]! << 8) };
        if (entries.has(at)) words.push({ ...word, jump: true });
        else if (!inTable(at)) words.push({ ...word, jump: false });
      }
      addr += n;
    }
  };
  for (const run of image.runs()) {
    for (const piece of filePieces(run, space.relocations)) {
      if (piece.runAddr === null) walk(piece.start, piece.end);
      else walk(piece.runAddr, piece.runAddr + piece.end - piece.start);
    }
  }
  return words;
}
