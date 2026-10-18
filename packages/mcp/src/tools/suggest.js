/**
 * `suggest`: the call targets worth naming next (docs/fugloy-mcp-spec.md §5, Ruling 4). Raw
 * counts first (calls, distinct call sites), then what the routine's instructions were seen
 * doing, attributed by address (src/attribution.js). ROM routines are left out: the ROM symbol
 * tables name them. The ROM ends at $37FF on the Model III and at $2FFF on the Model I, whose
 * $3000-$37FF is not ROM (like poke).
 */
import { SYNTH_NAME } from '@fugloy/disasm';
import { z } from 'zod';
import { hex4, parseCount, romEndOf } from '../args.js';
import { routineNotes } from '../attribution.js';
import { sharedNote } from './coverage.js';

export default {
  name: 'suggest',
  description:
    'List the call targets with no name yet (no label, or only a generated SUB_hhhh) that CALL or RST reached at least minCalls times since load (a decimal count, default 5), most calls first: calls, callers (distinct call sites), and notes on what the routine\'s instructions did, by address and heuristic: "writes video RAM", "reads the keyboard", "writes port FFh (sound)", "loops ≥ 1000× a call". The routine runs from the target to its first executed RET. ROM routines are left out. The starting list for naming a program\'s routines with disasm, callers, and label.',
  inputSchema: {
    minCalls: z.number().int().optional().describe('The fewest calls a target needs to be listed, a decimal count (default 5)'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ minCalls?: number }} args
   */
  handler(session, { minCalls = 5 }) {
    const { m, program } = session.requireProgram();
    const shared = program.sharesCoverageWith === undefined ? '' : `\n${sharedNote(program)}`;
    const least = parseCount(minCalls, { name: 'minCalls', min: 1 });
    const callerMap = m.debug.callerMap();
    /** @type {{ addr: number, calls: number, sites: number }[]} */
    const targets = [];
    const romEnd = romEndOf(m.model);
    for (const [addr, edges] of callerMap) {
      if (addr < romEnd) continue;
      const label = session.labels.get(addr);
      if (label !== undefined && !SYNTH_NAME.test(label.name)) continue;
      let calls = 0;
      const sites = new Set();
      for (const e of edges) {
        if (e.kind !== 'call' && e.kind !== 'rst') continue;
        calls += e.count;
        sites.add(e.from);
      }
      if (calls > 0) targets.push({ addr, calls, sites: sites.size });
    }
    targets.sort((a, b) => b.calls - a.calls || a.addr - b.addr);
    const listed = targets.filter((t) => t.calls >= least);
    if (listed.length === 0) {
      const top = targets[0];
      return `No unlabelled call target has ${least.toLocaleString('en-US')} or more calls since load${top === undefined ? '' : ` (the most is ${hex4(top.addr)}, with ${top.calls.toLocaleString('en-US')}); lower minCalls to see more`}.${shared}`;
    }
    const width = Math.max(5, ...listed.map((t) => t.calls.toLocaleString('en-US').length));
    const lines = [
      `Unlabelled call targets with at least ${least.toLocaleString('en-US')} ${least === 1 ? 'call' : 'calls'}, most calls first:`,
      `addr   ${'calls'.padStart(width)}  callers  notes (by address, heuristic)`,
    ];
    for (const t of listed) {
      const notes = routineNotes(m, session.facts, t.addr, t.calls, callerMap);
      lines.push(`${hex4(t.addr)}  ${t.calls.toLocaleString('en-US').padStart(width)}  ${String(t.sites).padStart(7)}  ${notes.join(', ')}`.trimEnd());
    }
    return lines.join('\n') + shared;
  },
};
