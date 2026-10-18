/** `poke`: write bytes into memory and show what they replaced (docs/fugloy-mcp-spec.md §4, §5, §7). */
import { z } from 'zod';
import { hex4, parseAddr, parseBytes, ROM_END } from '../args.js';
import { h2 } from '../format/hex.js';

const KEYBOARD_END = 0x3c00;
/** The top of the Model I's 12K Level II ROM; $3000-$37FF holds the Expansion Interface's registers ($37E0-$37EF) and nothing else. */
const MODEL1_ROM_END = 0x3000;

export default {
  name: 'poke',
  description:
    'Write bytes at addr and show the old and new values. bytes is a hex string ("21003C") or an array of numbers. Writing into ROM (0000h-37FFh; 0000h-2FFFh on the Model I) is refused unless force is true; the keyboard (3800h-3BFFh), and on the Model I the Expansion Interface\'s space (3000h-37FFh), cannot be written.',
  inputSchema: {
    addr: z.union([z.string(), z.number()]).describe('Start address: 5200, 0x5200, $5200, 5200h, a decimal number, or a label name'),
    bytes: z.union([z.string(), z.array(z.number())]).describe('Hex string such as "21003C", or an array such as [33, 0, 60]'),
    force: z.boolean().optional().describe('Allow writing into ROM, 0000h-37FFh (0000h-2FFFh on the Model I; default false)'),
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
    const model1 = m.model === 1;
    const romEnd = model1 ? MODEL1_ROM_END : ROM_END;
    if (model1 && start < ROM_END && end >= MODEL1_ROM_END) {
      throw new Error(`${hex4(Math.max(start, MODEL1_ROM_END))} is in the Model I's Expansion Interface space (3000h-37FFh: its registers at 37E0h-37EFh, nothing else), which cannot be poked; nothing was written.`);
    }
    if (start < romEnd && !force) {
      throw new Error(`${hex4(start)}-${hex4(end)} is in ROM (0000h-${hex4(romEnd - 1)}); nothing was written. Pass force: true to patch the ROM image anyway.`);
    }
    const old = m.mem.read(start, data.length);
    if (start < romEnd) m.system.memory.rom.set(data, start);
    else m.mem.write(start, data);
    const now = m.mem.read(start, data.length);
    const lines = [`Wrote ${data.length} ${data.length === 1 ? 'byte' : 'bytes'} at ${hex4(start)}${start < romEnd ? ' (into ROM, forced)' : ''}:`];
    for (let off = 0; off < data.length; off += 16) {
      const a = Array.from(old.subarray(off, off + 16), h2).join(' ');
      const b = Array.from(now.subarray(off, off + 16), h2).join(' ');
      lines.push(`${hex4(start + off)}  ${a} → ${b}`);
    }
    return lines.join('\n');
  },
};
