/**
 * `callees`: the routines a routine called since load, as a tree (docs/fugloy-mcp-spec.md §5
 * Debugging; Ruling 4 of the MCP phases D–F plan). Built from coverage's callers map: the CALL
 * and RST edges whose instruction lies inside the routine's extent, which runs from its address
 * to its first executed RET as `suggest` defines it (`routineEnd` in src/attribution.js). Each
 * callee's own callees follow, indented, down to `depth` levels. Like `suggest`, the extent is a
 * heuristic: a routine that jumps elsewhere is credited only with the calls inside its bytes.
 */
import { COVERAGE } from '@fugloy/emu';
import { z } from 'zod';
import { hex4, parseAddr, parseCount } from '../args.js';
import { routineEnd } from '../attribution.js';
import { routineOf } from '../points.js';
import { routineName } from './disasm.js';

/** The deepest tree `callees` draws. */
export const MAX_DEPTH = 4;

/**
 * The CALL and RST targets reached from inside `start`–`end`, most calls first.
 * @param {Map<number, { from: number, kind: string, count: number }[]>} callerMap
 * @param {number} start
 * @param {number} end
 */
function calledFrom(callerMap, start, end) {
  /** @type {{ addr: number, calls: number, sites: number, rst: boolean }[]} */
  const out = [];
  for (const [to, edges] of callerMap) {
    let calls = 0;
    let rst = false;
    const sites = new Set();
    for (const e of edges) {
      if ((e.kind !== 'call' && e.kind !== 'rst') || e.from < start || e.from > end) continue;
      calls += e.count;
      sites.add(e.from);
      if (e.kind === 'rst') rst = true;
    }
    if (calls > 0) out.push({ addr: to, calls, sites: sites.size, rst });
  }
  return out.sort((a, b) => b.calls - a.calls || a.addr - b.addr);
}

const plural = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export default {
  name: 'callees',
  description:
    'Show the routines the routine at addr called since load, as a tree: each callee with its call count and the number of call sites, then its own callees indented, down to depth levels (a decimal count from 1 to 4, default 2). A routine runs from its address to its first executed RET (as suggest defines it); only CALL and RST instructions inside those bytes count, so this is a heuristic for a routine that jumps elsewhere. Recorded with coverage from the load. The counterpart of callers.',
  inputSchema: {
    addr: z.union([z.string(), z.number()]).describe('The routine\'s address: 5200, 0x5200, $5200, 5200h, a decimal number, or a label name'),
    depth: z.number().int().optional().describe('Levels of the tree to show, a decimal count from 1 to 4 (default 2)'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ addr: string | number, depth?: number }} args
   */
  handler(session, { addr, depth = 2 }) {
    const m = session.requireMachine();
    const root = parseAddr(addr, session.labels);
    const levels = parseCount(depth, { name: 'depth', min: 1, max: MAX_DEPTH });
    const bits = m.debug.coverage.bits;
    if (!(bits[root] & COVERAGE.EXEC)) {
      let text = `${hex4(root)} has not run as an instruction since load, so it has no callees yet.`;
      const routine = routineOf(m, root);
      if (routine !== null && routine !== root) text += ` The nearest call target below it is ${hex4(routine)}; try callees with addr ${hex4(routine)}.`;
      return text;
    }
    const callerMap = m.debug.callerMap();
    const named = (/** @type {number} */ a) => {
      const name = routineName(session.labels, a, m.model);
      return name === undefined ? '' : `  ; ${name}`;
    };
    const rootEnd = routineEnd(m, root);
    const top = calledFrom(callerMap, root, rootEnd);
    const span = `${hex4(root)}–${hex4(rootEnd)}`;
    if (top.length === 0) return `The routine at ${hex4(root)} (${span}, to its first executed RET) made no CALL or RST since load.${named(root)}`;

    const lines = [`Callees of ${hex4(root)} (${span}, to its first executed RET), ${plural(levels, 'level', 'levels')}, calls since load:`, `${hex4(root)}${named(root)}`];
    /** @type {Set<number>} Routines whose callees are already listed above. */
    const expanded = new Set([root]);
    /**
     * @param {{ addr: number, calls: number, sites: number, rst: boolean }[]} children
     * @param {number} level 1 for the root's callees
     * @param {number[]} path the routines from the root down to these children's caller
     */
    const draw = (children, level, path) => {
      for (const c of children) {
        const counts = `${plural(c.calls, 'call', 'calls')} from ${plural(c.sites, 'site', 'sites')}${c.rst ? ' (RST)' : ''}`;
        let tail = '';
        let next = null;
        if (path.includes(c.addr)) tail = '  (recursive; see above)';
        else if (level < levels) {
          if (expanded.has(c.addr)) tail = '  (callees listed above)';
          else {
            expanded.add(c.addr);
            next = calledFrom(callerMap, c.addr, routineEnd(m, c.addr));
          }
        }
        lines.push(`${'  '.repeat(level)}${hex4(c.addr)}  ${counts}${named(c.addr)}${tail}`);
        if (next !== null) draw(next, level + 1, [...path, c.addr]);
      }
    };
    draw(top, 1, [root]);
    return lines.join('\n');
  },
};
