/**
 * `trace`: the instructions recorded by traced runs and steps (docs/fugloy-mcp-spec.md §5). The
 * rule: `run` with `trace: true` and every `step` record; nothing else does, since tracing slows
 * emulation about fourfold. The server keeps the newest limits.traceDepth instructions across
 * all of them (a step never erases a traced run), until `load` or `reset` (src/trace-log.js).
 */
import { z } from 'zod';
import { parseCount } from '../args.js';
import { collapse, traceLines } from '../format/trace.js';

export default {
  name: 'trace',
  description:
    'Show the newest n recorded instructions (a decimal count, default 100, at most limits.traceDepth, 2,000 by default), oldest first, loops collapsed as ×N. Only run with trace: true and step record instructions; nothing else does (tracing slows emulation). The newest limits.traceDepth are kept across every traced run and step, and only load and reset empty them; a "… (N cycles ran untraced)" line marks execution that was not recorded between two stretches. regs: true adds the registers before each instruction and shows every instruction uncollapsed.',
  inputSchema: {
    n: z.number().int().optional().describe('How many of the newest instructions to show, a decimal count (default 100)'),
    regs: z.boolean().optional().describe('Show A, F, BC, DE, HL, and SP before each instruction, uncollapsed (default false)'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ n?: number, regs?: boolean }} args
   */
  handler(session, { n = 100, regs = false }) {
    session.requireMachine();
    const log = session.trace;
    const count = parseCount(n, { name: 'n', min: 1, max: log.depth });
    const size = log.size;
    if (size === 0) throw new Error('Nothing has been traced yet: run with trace: true, or step, records instructions; then call trace.');
    const groups = log.last(count);
    const shown = groups.reduce((k, g) => k + g.entries.length, 0);
    const lines = [
      `The newest ${shown.toLocaleString('en-US')} of ${size.toLocaleString('en-US')} instructions recorded, oldest first (run with trace: true and step record them; nothing else does):`,
    ];
    for (const g of groups) {
      if (g.untraced > 0) lines.push(`  … (${g.untraced.toLocaleString('en-US')} cycles ran untraced)`);
      const entries = regs ? g.entries : g.entries.map(({ pc, bytes, cycles }) => ({ pc, bytes, cycles }));
      lines.push(traceLines(regs ? entries : collapse(entries), session.labels));
    }
    return lines.join('\n');
  },
};
