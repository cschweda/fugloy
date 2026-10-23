/** `step`: execute n instructions and show each (docs/fugloy-mcp-spec.md §5). Breakpoints do not stop a step. */
import { z } from 'zod';
import { parseCount } from '../args.js';
import { haltNext, withTrace } from '../execute.js';
import { regsBlock } from '../format/regs.js';
import { traceLines } from '../format/trace.js';

export default {
  name: 'step',
  description: 'Execute n instructions (a decimal count, default 1, at most limits.stepMax, 100 by default) and show each as a trace line, then the register block; they are also recorded for the trace tool. Breakpoints and watch stops do not stop a step.',
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
    withTrace(session, true, () => m.step(count));
    // The registers recorded with each entry are for the trace tool; a step shows the block once.
    const entries = session.trace.latest.slice(-count).map(({ pc, bytes, cycles }) => ({ pc, bytes, cycles }));
    const lines = [];
    if (entries.length > 0) lines.push(traceLines(entries, session.labels));
    // A Model I's HALT raises an NMI at the next boundary (emu spec §5), so no step idles halted there:
    // a step with no entry is the hook's, and a CPU left halted says where the next step goes.
    const model1 = m.model === 1;
    if (entries.length < count) {
      lines.push(m.system.cpu.halted && !model1
        ? `(${count - entries.length} of the ${count} steps found the CPU halted, waiting for an interrupt)`
        : `(${count - entries.length} of the ${count} steps were taken by the ROM keyboard hook returning a fed key)`);
    }
    if (model1 && m.system.cpu.halted) lines.push(`(${haltNext(1)})`);
    lines.push(regsBlock(m.cpu.regs, m.cpu.flags, m.cycles));
    return lines.join('\n');
  },
};
