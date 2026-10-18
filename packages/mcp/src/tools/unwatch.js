/** `unwatch`: remove a watch, or all of them; their hits stay in the log (docs/fugloy-mcp-spec.md §5). */
import { z } from 'zod';
import { watchList, watchSpan } from '../points.js';

export default {
  name: 'unwatch',
  description: 'Remove a watch by id, or every watch with all: true. The hits they logged stay for hits until it is cleared.',
  inputSchema: {
    id: z.number().int().optional().describe('The watch id that watch returned'),
    all: z.boolean().optional().describe('Remove every watch'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ id?: number, all?: boolean }} args
   */
  handler(session, { id, all = false }) {
    const m = session.requireMachine();
    if (id === undefined && !all) throw new Error('Give id or all.');
    if (id !== undefined && all) throw new Error('Give id or all, not both.');
    const watches = m.debug.watches;
    if (all) {
      for (const w of watches) m.debug.unwatch(w.id);
      if (watches.length === 0) return 'No watches were set.';
      return watches.length === 1 ? 'Removed 1 watch; its hits stay in the log.' : `Removed ${watches.length} watches; their hits stay in the log.`;
    }
    const w = watches.find((x) => x.id === id);
    if (w === undefined) {
      if (m.debug.breaks.some((b) => b.id === id)) throw new Error(`#${id} is a breakpoint, not a watch; use unbreak.`);
      throw new Error(`There is no watch #${id}; ${watchList(m)}.`);
    }
    m.debug.unwatch(/** @type {number} */ (id));
    return `Removed watch #${id} on ${watchSpan(w)}; its hits stay in the log.`;
  },
};
