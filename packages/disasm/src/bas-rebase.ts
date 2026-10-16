/**
 * Rebasing a tokenized BASIC program (spec §3, §5.6): the program as it would
 * have been saved from another address. Only the next-line pointers are
 * absolute, so only they change; the header byte, every line body, the end
 * marker, and any trailing bytes stay as they were.
 */
import { hex4 } from '@fugloy/z80';
import { loadBas } from './bas.js';

export function rebaseBas(bytes: Uint8Array, newBase: number): Uint8Array {
  const prog = loadBas(bytes);
  if (prog.lines.length === 0) throw new Error('not a tokenized BASIC program');
  const length = prog.end + 2 - prog.base;
  if (newBase < 0 || newBase + length > 0x10000) {
    throw new RangeError(`a ${length}-byte program saved from $${hex4(newBase & 0xffff)} does not fit below $10000`);
  }
  const out = Uint8Array.from(bytes);
  for (const line of prog.lines) {
    const ptr = newBase + (line.addr + line.length - prog.base);
    out[line.offset] = ptr & 0xff;
    out[line.offset + 1] = (ptr >> 8) & 0xff;
  }
  return out;
}
