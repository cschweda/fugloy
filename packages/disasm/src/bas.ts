/**
 * Tokenized Level II BASIC (.BAS) loader. Optional FF header, then per line a
 * 2-byte pointer to the next line, a 2-byte line number, the body, and 00; two
 * zero bytes end the program. The pointers are absolute, so the file records
 * the address it was saved from, and the whole program is loaded there.
 */
import { detokenize } from './detokenize.js';
import { MemoryImage } from './memory.js';

export interface BasLine {
  number: number;
  /** Address of the line's next-line pointer, i.e. where the line starts in memory. */
  addr: number;
  /** addr + 4: where the body bytes sit, which is what hidden code cares about. */
  bodyAddr: number;
  /** File offset of the line start. */
  offset: number;
  /** Whole line in bytes: header, body, and terminator, as the pointer chain implies. */
  length: number;
  /** Body bytes through the end of the line, including the terminator when present. */
  body: Uint8Array;
  text: string;
  parsed: boolean;
  reason?: string;
}

export interface BasProgram {
  format: 'bas';
  /** Address the program was saved from (where line 1 starts). */
  base: number;
  header: boolean;
  lines: BasLine[];
  /** Address of the 00 00 terminator. */
  end: number;
  image: MemoryImage;
  /** Bytes after the terminator. */
  trailing: number;
  warnings: string[];
}

type ChainLine = Omit<BasLine, 'text' | 'parsed' | 'reason'>;

interface Chain {
  base: number;
  lines: ChainLine[];
  /** File offset just past the 00 00 terminator. */
  endOffset: number;
}

const MAX_LINE_NUMBER = 65529;

/** Follows the pointer chain from `start` assuming line 1 sits at `base`; null when it does not hold together. */
function walk(bytes: Uint8Array, start: number, base: number): Chain | null {
  const n = bytes.length;
  const le16 = (o: number): number => bytes[o]! | (bytes[o + 1]! << 8);
  const lines: ChainLine[] = [];
  let off = start;
  let addr = base;
  let lastNumber = -1;
  for (;;) {
    if (off + 2 > n) return null;
    const ptr = le16(off);
    if (ptr === 0) return { base, lines, endOffset: off + 2 };
    if (off + 4 > n) return null;
    const number = le16(off + 2);
    if (number > MAX_LINE_NUMBER || number <= lastNumber) return null;
    const length = ptr - addr;
    if (length < 5 || off + length > n) return null;
    lines.push({ number, addr, bodyAddr: addr + 4, offset: off, length, body: bytes.subarray(off + 4, off + length) });
    lastNumber = number;
    addr = ptr;
    off += length;
  }
}

export function loadBas(bytes: Uint8Array): BasProgram {
  const image = new MemoryImage();
  const warnings: string[] = [];
  const header = bytes[0] === 0xff;
  const start = header ? 1 : 0;
  const n = bytes.length;
  const prog: BasProgram = { format: 'bas', base: 0, header, lines: [], end: 0, image, trailing: 0, warnings };
  if (n - start < 2) {
    warnings.push('too short to hold a BASIC program');
    return prog;
  }
  const p1 = bytes[start]! | (bytes[start + 1]! << 8);
  if (p1 === 0) {
    warnings.push('empty program');
    prog.trailing = n - start - 2;
    return prog;
  }
  // The base address is not stored: line 1 ends at its first 00, so its size
  // gives base = ptr(1) - size. Execution starts at line 1, so line 1 must be
  // BASIC; a later 00 could only belong to a line with an embedded 00, which
  // would not parse, so no other candidate is tried.
  const k = bytes.indexOf(0, start + 4);
  const size1 = k < 0 ? -1 : k - start + 1;
  const chain = k < 0 || p1 < size1 ? null : walk(bytes, start, p1 - size1);
  if (chain === null) {
    warnings.push('next-line pointer chain does not validate; not a tokenized BASIC program');
    return prog;
  }
  const lines = chain.lines.map((l): BasLine => {
    const d = detokenize(l.body);
    return d.reason === undefined ? { ...l, text: d.text, parsed: d.ok } : { ...l, text: d.text, parsed: d.ok, reason: d.reason };
  });
  if (lines[0]?.parsed !== true) {
    warnings.push(`line 1 does not parse as BASIC (${lines[0]?.reason ?? 'empty'}); not a tokenized BASIC program`);
    return prog;
  }
  prog.base = chain.base;
  prog.lines = lines;
  prog.end = chain.base + (chain.endOffset - 2 - start);
  image.load(chain.base, bytes.subarray(start, chain.endOffset));
  prog.trailing = n - chain.endOffset;
  if (prog.trailing > 0) warnings.push(`${prog.trailing} bytes after the program end ignored`);
  return prog;
}

/** Content-based detection: the pointer chain validates and holds at least one line. */
export function isBas(bytes: Uint8Array): boolean {
  return loadBas(bytes).lines.length > 0;
}
