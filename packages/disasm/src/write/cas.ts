/**
 * `.CAS` cassette images: the decoded byte stream of a tape. SYSTEM tapes
 * carry `3C` blocks with checksums and a `78` entry; BASIC tapes carry the
 * tokenized program rebased to the cassette BASIC start, `$42E9`.
 */
import { loadBas } from '../bas.js';
import { rebaseBas } from '../bas-rebase.js';
import type { MemoryImage } from '../memory.js';

const LEADER = 256;
const BASIC_BASE = 0x42e9;

/** Upper-cased, padded with spaces or cut to `n` characters, as bytes. */
const fixed = (name: string, n: number): number[] => {
  const s = name.toUpperCase().slice(0, n).padEnd(n, ' ');
  return Array.from(s, (c) => (c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) <= 0x7e ? c.charCodeAt(0) : 0x3f));
};

/** A SYSTEM tape: leader, `A5 55`, 6-byte name, `3C` blocks, `78` entry. */
export function writeSystemCas(image: MemoryImage, opts: { entry: number; name: string }): Uint8Array {
  const out: number[] = new Array<number>(LEADER).fill(0);
  out.push(0xa5, 0x55, ...fixed(opts.name, 6));
  for (const run of image.runs()) {
    for (let off = 0; off < run.length; off += 256) {
      const n = Math.min(256, run.length - off);
      const addr = run.start + off;
      const lo = addr & 0xff;
      const hi = addr >> 8;
      let sum = lo + hi;
      out.push(0x3c, n & 0xff, lo, hi);
      for (let i = 0; i < n; i++) {
        const b = image.bytes[addr + i]!;
        out.push(b);
        sum += b;
      }
      out.push(sum & 0xff);
    }
  }
  out.push(0x78, opts.entry & 0xff, (opts.entry >> 8) & 0xff);
  return Uint8Array.from(out);
}

/**
 * A BASIC tape from tokenized file bytes: leader, `A5 D3 D3 D3`, the name's
 * first character, the lines rebased to `$42E9`, and the `00 00` end.
 */
export function writeBasicCas(bytes: Uint8Array, name: string): Uint8Array {
  const rebased = rebaseBas(bytes, BASIC_BASE);
  const prog = loadBas(rebased);
  const start = prog.lines[0]!.offset;
  const body = rebased.subarray(start, start + (prog.end + 2 - BASIC_BASE));
  const out = new Uint8Array(LEADER + 5 + body.length);
  out.set([0xa5, 0xd3, 0xd3, 0xd3, fixed(name, 1)[0]!], LEADER);
  out.set(body, LEADER + 5);
  return out;
}
