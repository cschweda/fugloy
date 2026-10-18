/** `callers`: who transferred control to an address, by coverage's callers map (docs/fugloy-mcp-spec.md §5). */
import { z } from 'zod';
import { hex4, parseAddr } from '../args.js';
import { routineOf } from '../points.js';

export default {
  name: 'callers',
  description:
    'Show where control reached addr from since load, one row each: from (the instruction\'s address), kind (call, jp, jr, rst, or ret-to for a RET that landed there), and count (times taken). Recorded as the program runs; nothing needs turning on. For an address inside a routine that nothing jumps to, it names the nearest call target at or below it. format: "json" gives the rows as JSON.',
  inputSchema: {
    addr: z.union([z.string(), z.number()]).describe('The target address: 5200, 0x5200, $5200, 5200h, a decimal number, or a label name'),
    format: z.enum(['text', 'json']).optional().describe('"text" (default) or "json"'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ addr: string | number, format?: 'text' | 'json' }} args
   */
  handler(session, { addr, format = 'text' }) {
    const m = session.requireMachine();
    const at = parseAddr(addr, session.labels);
    const edges = m.debug.callers(at);
    if (format === 'json') return JSON.stringify({ addr: at, callers: edges }, null, 2);
    if (edges.length === 0) {
      let text = `Nothing has transferred control to ${hex4(at)} since load (coverage records calls, jumps, RSTs, and returns as they run).`;
      const routine = routineOf(m, at);
      if (routine !== null && routine !== at) {
        const back = at - routine;
        text += ` The nearest call target at or below it is ${hex4(routine)}, ${back} ${back === 1 ? 'byte' : 'bytes'} before; try callers with addr ${hex4(routine)}.`;
      }
      return text;
    }
    const times = edges.reduce((n, e) => n + e.count, 0);
    const places = new Set(edges.map((e) => e.from)).size;
    const lines = [`Control reached ${hex4(at)} from ${places} ${places === 1 ? 'place' : 'places'}, ${times.toLocaleString('en-US')} ${times === 1 ? 'time' : 'times'}:`, 'from   kind  count'];
    for (const e of edges) {
      const label = session.labels.get(e.from);
      lines.push(`${hex4(e.from)}  ${e.kind.padEnd(4)}  ${e.count.toLocaleString('en-US')}${label ? `  ; ${label.name}` : ''}`);
    }
    return lines.join('\n');
  },
};
