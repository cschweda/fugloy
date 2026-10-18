/** `hits`: the watch hit log, newest last, with the PCs that made the accesses (docs/fugloy-mcp-spec.md §5). */
import { z } from 'zod';
import { hex4, parseCount } from '../args.js';
import { routineOf, watchList } from '../points.js';

const h2 = (/** @type {number} */ n) => n.toString(16).toUpperCase().padStart(2, '0');
/** How many PCs the `By pc:` line names before it says how many more there are. */
const BY_PC = 8;

export default {
  name: 'hits',
  description:
    'Show the watch hit log, newest last: cycle, pc (the instruction that made the access), addr, value, prev (the byte a write replaced). id limits it to one watch; n is how many of the newest to show (a decimal count, default 50). A "By pc:" line first counts every hit by the PC that made it, with the routine each PC is in (the nearest call target at or below it since load, a heuristic): that is usually the routine to look at next with callers and disasm. clear: true empties the whole log after showing it. format: "json" gives the hits as JSON.',
  inputSchema: {
    id: z.number().int().optional().describe('Only this watch\'s hits'),
    n: z.number().int().optional().describe('How many of the newest hits to show, a decimal count (default 50)'),
    clear: z.boolean().optional().describe('Empty the hit log (every watch\'s hits) after showing it (default false)'),
    format: z.enum(['text', 'json']).optional().describe('"text" (default) or "json"'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ id?: number, n?: number, clear?: boolean, format?: 'text' | 'json' }} args
   */
  handler(session, { id, n = 50, clear = false, format = 'text' }) {
    const m = session.requireMachine();
    const count = parseCount(n, { name: 'n', min: 1, max: 65536 });
    const all = m.debug.hits(id);
    if (id !== undefined && all.length === 0 && !m.debug.watches.some((w) => w.id === id)) {
      if (m.debug.breaks.some((b) => b.id === id)) throw new Error(`#${id} is a breakpoint, not a watch; breakpoints log no hits.`);
      throw new Error(`There is no watch #${id}; ${watchList(m)}.`);
    }
    const shown = all.slice(-count);
    const overflowed = m.debug.hitsOverflowed;
    if (clear) m.debug.clearHits();
    if (format === 'json') return JSON.stringify({ total: all.length, shown: shown.length, overflowed, hits: shown }, null, 2);

    const whose = id === undefined ? '' : ` for watch #${id}`;
    if (all.length === 0) return `No hits are logged${whose}.`;
    const lines = [`Hits (${id === undefined ? 'all watches' : `watch #${id}`}): the newest ${shown.length.toLocaleString('en-US')} of ${all.length.toLocaleString('en-US')}, newest last`];
    if (overflowed) lines.push('(older hits were dropped: the log keeps the newest 65,536)');

    /** @type {Map<number, number>} */
    const byPc = new Map();
    for (const h of all) byPc.set(h.pc, (byPc.get(h.pc) ?? 0) + 1);
    const ranked = [...byPc].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const named = ranked.slice(0, BY_PC).map(([pc, k]) => {
      const routine = routineOf(m, pc);
      const label = routine === null ? undefined : session.labels.get(routine);
      return `${hex4(pc)} ×${k.toLocaleString('en-US')}${routine === null ? '' : ` (in the routine called at ${hex4(routine)}${label ? `, ${label.name}` : ''})`}`;
    });
    lines.push(`By pc: ${named.join(', ')}${ranked.length > BY_PC ? `, and ${ranked.length - BY_PC} more` : ''}`);

    const width = Math.max(5, ...shown.map((h) => h.cycle.toLocaleString('en-US').length));
    lines.push(`${'cycle'.padStart(width)}  pc     addr   value  prev  watch`);
    for (const h of shown) {
      lines.push(`${h.cycle.toLocaleString('en-US').padStart(width)}  ${hex4(h.pc)}  ${hex4(h.addr)}  ${h2(h.value).padEnd(5)}  ${h2(h.prev).padEnd(4)}  #${h.id} ${h.kind}`);
    }
    if (clear) lines.push("Cleared the hit log (every watch's hits).");
    return lines.join('\n');
  },
};
