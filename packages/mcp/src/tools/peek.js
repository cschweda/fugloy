/** `peek`: a hex dump of memory with labels on their own lines (docs/fugloy-mcp-spec.md §4, §5). */
import { z } from 'zod';
import { hex4, parseAddr, parseCount } from '../args.js';
import { hexDump } from '../format/hex.js';

export default {
  name: 'peek',
  description: 'Hex dump of memory from addr, 16 bytes a line with an ASCII gutter and labels interleaved. len is a decimal byte count (default 64, at most limits.peekMax, 1,024 by default).',
  inputSchema: {
    addr: z.union([z.string(), z.number()]).describe('Start address: 5200, 0x5200, $5200, 5200h, a decimal number, or a label name'),
    len: z.number().int().optional().describe('Bytes to show, a decimal count (default 64)'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ addr: string | number, len?: number }} args
   */
  handler(session, { addr, len = 64 }) {
    const m = session.requireMachine();
    const start = parseAddr(addr, session.labels);
    const n = parseCount(len, { name: 'len', min: 1, max: session.config.limits.peekMax });
    if (start + n > 0x10000) throw new Error(`${hex4(start)} + ${n} bytes runs past FFFFh; ask for at most ${0x10000 - start}.`);
    return hexDump(m.mem.read(start, n), start, session.labels);
  },
};
