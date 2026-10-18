/**
 * .BAS loader. A first byte of $FF means a tokenized program: per line a 2-byte next pointer, a
 * 2-byte line number, the body, and 00, with two zero bytes ending the program. Otherwise the
 * file is ASCII source, which the Machine feeds through the ROM keyboard hook.
 *
 * The pointers in a tokenized file are absolute from the machine that saved it, so they are
 * rebuilt for the load address. A line body may hold 00 (machine code in a REM), so the chain is
 * followed by pointer when it is self-consistent and by 00-scan when it is not.
 */
import { writeTokenizedProgram } from './cas-format.js';

const hex = (n) => `$${n.toString(16).toUpperCase()}`;

/** Follows the pointer chain with line 1 assumed at `base`; null when it does not hold together. */
function walk(bytes, start, base) {
  const n = bytes.length;
  const lines = [];
  let off = start;
  let addr = base;
  for (;;) {
    if (off + 2 > n) return null;
    const ptr = bytes[off] | (bytes[off + 1] << 8);
    if (ptr === 0) return lines;
    const len = ptr - addr;
    if (len < 5 || off + len > n || bytes[off + len - 1] !== 0) return null;
    lines.push({ lineNo: bytes[off + 2] | (bytes[off + 3] << 8), tokens: bytes.slice(off + 4, off + len - 1) });
    addr = ptr;
    off += len;
  }
}

/** Splits at each 00, ignoring the pointers; throws when the program runs off the end of the file. */
function scan(bytes, start) {
  const n = bytes.length;
  const lines = [];
  let off = start;
  for (;;) {
    if (off + 2 > n) throw new Error(`truncated .BAS: no 00 00 program terminator after ${lines.length} lines`);
    if (bytes[off] === 0 && bytes[off + 1] === 0) return lines;
    if (off + 4 > n) throw new Error(`truncated .BAS: line header cut off at offset ${off}`);
    const end = bytes.indexOf(0, off + 4);
    if (end < 0) throw new Error(`truncated .BAS: line at offset ${off} has no 00 terminator`);
    lines.push({ lineNo: bytes[off + 2] | (bytes[off + 3] << 8), tokens: bytes.slice(off + 4, end) });
    off = end + 1;
  }
}

function parseTokenized(bytes) {
  const start = 1;
  if (bytes.length - start < 2) throw new Error('truncated .BAS: no program after the $FF header');
  const ptr1 = bytes[start] | (bytes[start + 1] << 8);
  if (ptr1 === 0) return { kind: 'tokenized', lines: [] };
  // Line 1's base is unknown: try the stock TXTTAB, then each 00 in line 1 as its end.
  const bases = [0x42e9];
  for (let j = start + 4; j < bytes.length; j++) {
    if (bytes[j] === 0) {
      bases.push(ptr1 - (j + 1 - start));
      if (bases.length > 64) break;
    }
  }
  for (const base of bases) {
    const lines = walk(bytes, start, base);
    if (lines) return { kind: 'tokenized', lines };
  }
  return { kind: 'tokenized', lines: scan(bytes, start) };
}

/**
 * Parse a .BAS file.
 * @param {Uint8Array} bytes
 * @returns {{ kind: 'tokenized', lines: { lineNo: number, tokens: Uint8Array }[] } | { kind: 'ascii', text: string }}
 */
export function parseBas(bytes) {
  if (!bytes || bytes.length === 0) throw new Error('not a .BAS file: empty');
  if (bytes[0] === 0xff) return parseTokenized(bytes);
  let text = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0) throw new Error(`not a .BAS file: NUL at offset ${i} (a tokenized file starts with $FF)`);
    if (!((b >= 0x20 && b <= 0x7e) || b === 0x0d || b === 0x0a || b === 0x09)) {
      throw new Error(`not a .BAS file: byte ${hex(b)} at offset ${i} is neither tokenized ($FF first) nor ASCII text`);
    }
    text += String.fromCharCode(b);
  }
  text = text.replace(/\r\n?/g, '\n');
  if (!text.endsWith('\n')) text += '\n';
  return { kind: 'ascii', text };
}

/**
 * Load a .BAS file into a Machine. Tokenized: write at TXTTAB and fix the pointers. ASCII: feed
 * the text through the keyboard hook, which BASIC reads as the machine runs.
 * @param {import('../machine/machine.js').Machine} machine
 * @param {Uint8Array} bytes
 * @returns {{ format: 'bas', kind: 'tokenized' | 'ascii', start: number, end: number | null, blocks: { addr: number, len: number, why: string }[] }}
 */
export function loadBas(machine, bytes) {
  const parsed = parseBas(bytes);
  if (parsed.kind === 'ascii') {
    machine.keyboard.feed(parsed.text);
    return { format: 'bas', kind: 'ascii', start: machine.system.memory.readWord(0x40a4), end: null, blocks: [] };
  }
  const { start, end } = writeTokenizedProgram(machine.system, parsed.lines);
  return { format: 'bas', kind: 'tokenized', start, end, blocks: [{ addr: start, len: end - start, why: 'BASIC program' }] };
}
