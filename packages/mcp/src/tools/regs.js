/** `regs`: the register block, or the same facts as JSON (docs/fugloy-mcp-spec.md §4, §5). */
import { z } from 'zod';
import { regsBlock, regsJson } from '../format/regs.js';

export default {
  name: 'regs',
  description: 'Show the registers, decoded flags, and the cycle count. format: "json" gives the same facts as JSON numbers.',
  inputSchema: {
    format: z.enum(['text', 'json']).optional().describe('"text" (default) or "json"'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ format?: 'text' | 'json' }} args
   */
  handler(session, { format = 'text' }) {
    const m = session.requireMachine();
    return (format === 'json' ? regsJson : regsBlock)(m.cpu.regs, m.cpu.flags, m.cycles);
  },
};
