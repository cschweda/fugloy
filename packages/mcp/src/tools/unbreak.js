/** `unbreak`: remove breakpoints by id, by address, or all (docs/fugloy-mcp-spec.md §5). */
import { z } from 'zod';
import { hex4, parseAddr } from '../args.js';
import { breakList } from '../points.js';

export default {
  name: 'unbreak',
  description: 'Remove breakpoints: give id (one breakpoint), addr (every breakpoint at that address), or all: true. Says what it removed.',
  inputSchema: {
    id: z.number().int().optional().describe('The breakpoint id that break returned'),
    addr: z.union([z.string(), z.number()]).optional().describe('Remove every breakpoint at this address'),
    all: z.boolean().optional().describe('Remove every breakpoint'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ id?: number, addr?: string | number, all?: boolean }} args
   */
  handler(session, { id, addr, all = false }) {
    const m = session.requireMachine();
    const given = [id !== undefined, addr !== undefined, all].filter(Boolean).length;
    if (given === 0) throw new Error('Give id, addr, or all.');
    if (given > 1) throw new Error('Give one of id, addr, or all, not several.');
    const breaks = m.debug.breaks;
    if (all) {
      for (const b of breaks) m.debug.unbreak(b.id);
      return breaks.length === 0 ? 'No breakpoints were set.' : `Removed ${breaks.length} ${breaks.length === 1 ? 'breakpoint' : 'breakpoints'}.`;
    }
    if (id !== undefined) {
      const b = breaks.find((x) => x.id === id);
      if (b === undefined) {
        if (m.debug.watches.some((w) => w.id === id)) throw new Error(`#${id} is a watch, not a breakpoint; use unwatch.`);
        throw new Error(`There is no breakpoint #${id}; ${breakList(m)}.`);
      }
      m.debug.unbreak(id);
      return `Removed breakpoint #${id} at ${hex4(b.addr)}.`;
    }
    const at = parseAddr(addr, session.labels);
    const here = breaks.filter((b) => b.addr === at);
    if (here.length === 0) throw new Error(`No breakpoint is set at ${hex4(at)}; ${breakList(m)}.`);
    for (const b of here) m.debug.unbreak(b.id);
    return `Removed ${here.length === 1 ? 'breakpoint' : 'breakpoints'} ${here.map((b) => `#${b.id}`).join(', ')} at ${hex4(at)}.`;
  },
};
