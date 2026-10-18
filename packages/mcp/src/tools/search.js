/**
 * `search`: every address where a byte string or a piece of text sits in memory
 * (docs/fugloy-mcp-spec.md §5 Inspection; Ruling 3 of the MCP phases D–F plan). The 64K address
 * space is scanned as the CPU sees it, ROM and the keyboard included, unless `range` narrows it;
 * a match lies wholly inside the range. Results stop at `MAX_MATCHES` addresses, with a line
 * counting the rest.
 */
import { z } from 'zod';
import { hex4, parseBytes, parseRange } from '../args.js';
import { h2 } from '../format/hex.js';

/** The most addresses one search lists. */
export const MAX_MATCHES = 256;

/** Addresses on one line of the result. */
const PER_LINE = 8;

/**
 * The bytes each character of `text` may be, as sets: the ASCII byte, and with `fold` the other
 * case of a letter and, for a character from 40h to 5Fh (`@`, `A`–`Z`, `[`…`_`) or a lower-case
 * letter, the 00h–1Fh byte the Model III's character generator shows as it (video RAM written
 * by the ROM display routines can hold either form).
 * @param {string} text
 * @param {boolean} fold
 * @returns {number[][]}
 */
function textPattern(text, fold) {
  return [...text].map((ch) => {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x20 || c > 0x7e) {
      throw new Error(`text holds ${JSON.stringify(ch)}, which is not a printable ASCII character (20h–7Eh); search for it with bytes instead.`);
    }
    const set = [c];
    if (!fold) return set;
    const isLower = c >= 0x61 && c <= 0x7a;
    const isUpper = c >= 0x41 && c <= 0x5a;
    if (isLower) set.push(c - 0x20);
    if (isUpper) set.push(c + 0x20);
    const upper = isLower ? c - 0x20 : c;
    if (upper >= 0x40 && upper <= 0x5f) set.push(upper - 0x40);
    return set;
  });
}

export default {
  name: 'search',
  description:
    'Find every address where bytes (a hex string such as "CD3070" or an array of numbers) or text (printable ASCII, matched byte for byte) sits in memory, as the CPU sees it: all of 0000h-FFFFh, ROM included, unless range narrows it. fold: true makes text match either case and the 00h-1Fh bytes the Model III screen shows as @, A-Z, and [ to _ (how text can sit in video RAM). Lists at most 256 addresses, then a line counting the rest.',
  inputSchema: {
    bytes: z.union([z.string(), z.array(z.number())]).optional().describe('The bytes to find: a hex string such as "CD3070", or an array such as [205, 48, 112]'),
    text: z.string().optional().describe('The text to find, printable ASCII'),
    range: z.union([z.string(), z.object({ addr: z.union([z.string(), z.number()]), len: z.number().int() })]).optional()
      .describe('Only matches wholly inside this range: "4000-FFFF" (both ends included) or { addr, len } (default 0000h-FFFFh)'),
    fold: z.boolean().optional().describe('With text: match either case and the screen\'s 00h-1Fh forms (default false)'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ bytes?: string | number[], text?: string, range?: string | { addr: string | number, len: number }, fold?: boolean }} args
   */
  handler(session, { bytes, text, range, fold = false }) {
    const m = session.requireMachine();
    if ((bytes === undefined) === (text === undefined)) {
      throw new Error(bytes === undefined ? 'Give bytes or text to search for.' : 'Give bytes or text, not both.');
    }
    if (fold && text === undefined) throw new Error('fold applies to text; bytes are always matched exactly.');
    /** @type {number[][]} */
    let pattern;
    let what;
    if (text !== undefined) {
      if (text === '') throw new Error('text is empty; give at least one character.');
      pattern = textPattern(text, fold);
      what = `text ${JSON.stringify(text)}${fold ? ' (folded)' : ''}`;
    } else {
      const data = parseBytes(/** @type {string | number[]} */ (bytes));
      pattern = data.map((b) => [b]);
      what = `bytes ${data.map(h2).join(' ')}`;
    }
    let addr = 0;
    let len = 0x10000;
    if (range !== undefined) ({ addr, len } = parseRange(range, session.labels));
    const end = addr + len;
    const mem = m.mem.read(0, 0x10000);
    const sets = pattern.map((allowed) => {
      const ok = new Uint8Array(256);
      for (const b of allowed) ok[b] = 1;
      return ok;
    });
    /** @type {number[]} */
    const found = [];
    let total = 0;
    for (let a = addr; a + sets.length <= end; a++) {
      let k = 0;
      while (k < sets.length && /** @type {Uint8Array} */ (sets[k])[/** @type {number} */ (mem[a + k])]) k++;
      if (k < sets.length) continue;
      total++;
      if (found.length < MAX_MATCHES) found.push(a);
    }
    const over = `search ${what} over ${hex4(addr)}–${hex4(end - 1)}`;
    if (total === 0) return `${over}: no matches`;
    const lines = [`${over}: ${total.toLocaleString('en-US')} ${total === 1 ? 'match' : 'matches'}`];
    for (let k = 0; k < found.length; k += PER_LINE) lines.push(found.slice(k, k + PER_LINE).map(hex4).join('  '));
    if (total > found.length) {
      const more = total - found.length;
      lines.push(`… and ${more.toLocaleString('en-US')} more ${more === 1 ? 'match' : 'matches'} past the first ${MAX_MATCHES}; narrow range to see them.`);
    }
    return lines.join('\n');
  },
};
