/** `break`: stop `run` before the instruction at an address (docs/fugloy-mcp-spec.md §5, Ruling 2). */
import { z } from 'zod';
import { hex4, parseAddr } from '../args.js';
import { compileCondition } from '../condition.js';

export default {
  name: 'break',
  description:
    'Set a breakpoint: run stops before the instruction at addr executes (step ignores breakpoints). once removes it after its first hit. condition gates each hit: <reg> <op> <value> clauses joined by && (such as "A == 0D && HL >= 3C00"); reg is A F B C D E H L I R, AF BC DE HL IX IY SP PC, or a flag ZF CF SF PVF HF NF (Z S PV N also work; C and H are the registers); op is == != < <= > >=; value is a number written like an address (bare digits are hex; write 0xDE, since DE is the register) or a label, never another register. Returns the breakpoint id and the condition as it was read.',
  inputSchema: {
    addr: z.union([z.string(), z.number()]).describe('Address to stop at: 5200, 0x5200, $5200, 5200h, a decimal number, or a label name'),
    once: z.boolean().optional().describe('Remove the breakpoint after its first hit (default false)'),
    condition: z.string().optional().describe('Stop only when this holds, such as "A == 0D && HL >= 3C00"; values are hex like addresses'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ addr: string | number, once?: boolean, condition?: string }} args
   */
  handler(session, { addr, once = false, condition }) {
    const m = session.requireMachine();
    const at = parseAddr(addr, session.labels);
    const when = condition === undefined ? undefined : compileCondition(condition, session.labels);
    const id = m.debug.break(at, { once, ...(when ? { when } : {}) });
    return `breakpoint #${id} at ${hex4(at)}${once ? ' (once)' : ''}${when ? ` when ${when.text}` : ''}`;
  },
};
