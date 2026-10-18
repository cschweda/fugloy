/** `poke`: write bytes into memory and show what they replaced (docs/fugloy-mcp-spec.md §4, §5, §7). */
import { z } from 'zod';
import { hex4, MODEL1_ROM_END, parseAddr, parseBytes, ROM_END, romEndOf } from '../args.js';
import { h2 } from '../format/hex.js';

/**
 * Where the CPU sees ROM and the keyboard matrix now: [romEnd, keyboard start, keyboard end).
 * The Model III and Model I, and a Model 4 in map 0, have ROM from 0000h and the keyboard at
 * 3800h-3BFFh; a Model 4 in map 1 has RAM in place of the ROM, in map 2 RAM up to F3FFh with the
 * keyboard at F400h-F7FFh, and in map 3 RAM everywhere (emu memory.js, Model4Memory).
 * @param {import('@fugloy/emu').Machine} m
 * @returns {{ romEnd: number, kb: [number, number] | null }}
 */
function layoutOf(m) {
  const map = m.mem.map?.map ?? 0;
  if (map === 3) return { romEnd: 0, kb: null };
  if (map === 2) return { romEnd: 0, kb: [0xf400, 0xf800] };
  return { romEnd: map === 1 ? 0 : romEndOf(m.model), kb: [ROM_END, 0x3c00] };
}

export default {
  name: 'poke',
  description:
    'Write bytes at addr and show the old and new values. bytes is a hex string ("21003C") or an array of numbers. Writing into ROM (0000h-37FFh; 0000h-2FFFh on the Model I) is refused unless force is true; the keyboard (3800h-3BFFh), and on the Model I the Expansion Interface\'s space (3000h-37FFh), cannot be written. On a Model 4 the memory map in force decides: map 0 as the Model III; map 1 has RAM in place of the ROM; map 2 is RAM with the keyboard at F400h-F7FFh; map 3 is all RAM.',
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
    const { romEnd, kb } = layoutOf(m);
    if (kb !== null && start < kb[1] && end >= kb[0]) {
      const where = `${hex4(kb[0])}-${hex4(kb[1] - 1)}${m.model === 4 ? `, in memory map ${m.mem.map?.map}` : ''}`;
      throw new Error(`${hex4(Math.max(start, kb[0]))} is in the keyboard matrix (${where}), which cannot be written; nothing was written.`);
    }
    const model1 = m.model === 1;
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
