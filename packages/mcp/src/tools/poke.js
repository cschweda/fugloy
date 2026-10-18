/** `poke`: write bytes into memory and show what they replaced (docs/fugloy-mcp-spec.md §4, §5, §7). */
import { z } from 'zod';
import { hex4, parseAddr, ROM_END } from '../args.js';
import { h2 } from '../format/hex.js';

const KEYBOARD_END = 0x3c00;

/** Bytes from a hex string ("21003C", spaces allowed) or an array of 0-255. */
function parseBytes(/** @type {string | number[]} */ value) {
  if (typeof value === 'string') {
    const text = value.replace(/\s+/g, '');
    if (!/^(?:[0-9a-f]{2})+$/i.test(text)) {
      throw new Error(`bytes ${JSON.stringify(value)} is not hex pairs; write "21003C" (two hex digits a byte) or an array such as [33, 0, 60].`);
    }
    return Array.from({ length: text.length / 2 }, (_, k) => Number.parseInt(text.slice(k * 2, k * 2 + 2), 16));
  }
  if (value.length === 0) throw new Error('bytes is empty; give at least one byte.');
  for (const b of value) if (!Number.isInteger(b) || b < 0 || b > 255) throw new Error(`bytes holds ${b}, and every byte must be a whole number from 0 to 255.`);
  return value;
}

export default {
  name: 'poke',
  description:
    'Write bytes at addr and show the old and new values. bytes is a hex string ("21003C") or an array of numbers. Writing into ROM (0000h-37FFh) is refused unless force is true; the keyboard (3800h-3BFFh) cannot be written.',
  inputSchema: {
    addr: z.union([z.string(), z.number()]).describe('Start address: 5200, 0x5200, $5200, 5200h, a decimal number, or a label name'),
    bytes: z.union([z.string(), z.array(z.number())]).describe('Hex string such as "21003C", or an array such as [33, 0, 60]'),
    force: z.boolean().optional().describe('Allow writing into ROM, 0000h-37FFh (default false)'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ addr: string | number, bytes: string | number[], force?: boolean }} args
   */
  handler(session, { addr, bytes, force = false }) {
    const m = session.requireMachine();
    const start = parseAddr(addr, session.labels);
    const data = parseBytes(bytes);
    const end = start + data.length - 1;
    if (end > 0xffff) throw new Error(`${data.length} bytes from ${hex4(start)} run past FFFFh.`);
    if (start < KEYBOARD_END && end >= ROM_END) {
      throw new Error(`${hex4(Math.max(start, ROM_END))} is in the keyboard matrix (3800h-3BFFh), which cannot be written; nothing was written.`);
    }
    if (start < ROM_END && !force) {
      throw new Error(`${hex4(start)}-${hex4(end)} is in ROM (0000h-37FFh); nothing was written. Pass force: true to patch the ROM image anyway.`);
    }
    const old = m.mem.read(start, data.length);
    if (start < ROM_END) m.system.memory.rom.set(data, start);
    else m.mem.write(start, data);
    const now = m.mem.read(start, data.length);
    const lines = [`Wrote ${data.length} ${data.length === 1 ? 'byte' : 'bytes'} at ${hex4(start)}${start < ROM_END ? ' (into ROM, forced)' : ''}:`];
    for (let off = 0; off < data.length; off += 16) {
      const a = Array.from(old.subarray(off, off + 16), h2).join(' ');
      const b = Array.from(now.subarray(off, off + 16), h2).join(' ');
      lines.push(`${hex4(start + off)}  ${a} → ${b}`);
    }
    return lines.join('\n');
  },
};
