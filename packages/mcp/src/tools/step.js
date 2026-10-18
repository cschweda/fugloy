/** `step`: execute n instructions and show each (docs/fugloy-mcp-spec.md §5). Breakpoints do not stop a step. */
import { z } from 'zod';
import { parseCount } from '../args.js';
import { withTrace } from '../execute.js';
import { regsBlock } from '../format/regs.js';
import { traceLines } from '../format/trace.js';

export default {
  name: 'step',
  description: 'Execute n instructions (a decimal count, default 1, at most limits.stepMax, 100 by default) and show each as a trace line, then the register block. Breakpoints and watch stops do not stop a step.',
  inputSchema: {
    n: z.number().int().optional().describe('Instructions to execute, a decimal count (default 1)'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ n?: number }} args
   */
  handler(session, { n = 1 }) {
    const m = session.requireMachine();
    const count = parseCount(n, { name: 'n', min: 1, max: session.config.limits.stepMax });
    // Ruling 3: a step always records its own instructions.
    const entries = withTrace(session, true, () => {
      m.step(count);
      return m.debug.trace.last(count);
    });
    const lines = [];
    if (entries.length > 0) lines.push(traceLines(entries, session.labels));
    if (entries.length < count) {
      lines.push(m.system.cpu.halted
        ? `(${count - entries.length} of the ${count} steps found the CPU halted, waiting for an interrupt)`
        : `(${count - entries.length} of the ${count} steps were taken by the ROM keyboard hook returning a fed key)`);
    }
    lines.push(regsBlock(m.cpu.regs, m.cpu.flags, m.cycles));
    return lines.join('\n');
  },
};
