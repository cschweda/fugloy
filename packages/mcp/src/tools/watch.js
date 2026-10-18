/** `watch`: log reads or writes of a memory range, and optionally stop `run` (docs/fugloy-mcp-spec.md §5). */
import { z } from 'zod';
import { parseAddr, parseCount } from '../args.js';
import { watchSpan } from '../points.js';

const ON = { read: 'read', write: 'write', both: 'read and write' };

export default {
  name: 'watch',
  description:
    'Watch len bytes from addr (a decimal count, default 1; 1024 from 3C00h is all of video RAM) for writes (on: "write", the default), reads ("read"; instruction fetches are not reads), or both. Every access is logged for hits, with the cycle, the PC of the instruction, the address, the value, and the byte a write replaced. stop: true also makes run stop right after the instruction that touched it. Returns the watch id.',
  inputSchema: {
    addr: z.union([z.string(), z.number()]).describe('First address: 5200, 0x5200, $5200, 5200h, a decimal number, or a label name'),
    len: z.number().int().optional().describe('Bytes to watch, a decimal count (default 1); the range wraps at FFFFh'),
    on: z.enum(['read', 'write', 'both']).optional().describe('"write" (default), "read", or "both"'),
    stop: z.boolean().optional().describe('Make run stop after an access (default false: only log it)'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ addr: string | number, len?: number, on?: 'read' | 'write' | 'both', stop?: boolean }} args
   */
  handler(session, { addr, len = 1, on = 'write', stop = false }) {
    const m = session.requireMachine();
    const at = parseAddr(addr, session.labels);
    const n = parseCount(len, { name: 'len', min: 1, max: 0x10000 });
    const id = m.debug.watch(at, n, { read: on !== 'write', write: on !== 'read', stop });
    return `watch #${id} on ${watchSpan({ addr: at, len: n })} (${ON[on]}${stop ? ', stops run' : ''})`;
  },
};
