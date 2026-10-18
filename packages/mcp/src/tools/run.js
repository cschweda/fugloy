/**
 * `run`: run the machine until a stop condition or a cap (docs/fugloy-mcp-spec.md §5, §7).
 * Reasons: break, watch, halt, screen, pc, cycles (the budget or the emulated cap), wallclock.
 */
import { CPU_CLOCK_HZ } from '@fugloy/emu';
import { z } from 'zod';
import { parseAddr, parseCount } from '../args.js';
import { capCycles, runMachine, seconds, stoppedLine, withTrace } from '../execute.js';
import { regsBlock } from '../format/regs.js';
import { screenDiff } from '../format/screen.js';

/**
 * `until` as the run loop takes it.
 * @param {string} until
 * @param {import('../session.js').Session} session
 * @returns {{ kind: 'break' | 'halt' | 'screen' | 'settled' } | { kind: 'pc', pc: number }}
 */
function parseUntil(until, session) {
  if (until === 'break' || until === 'halt' || until === 'screen' || until === 'settled') return { kind: until };
  const m = /^pc:(.+)$/i.exec(until.trim());
  if (m) return { kind: 'pc', pc: parseAddr(/** @type {string} */ (m[1]).trim(), session.labels) };
  throw new Error(`until must be "break", "halt", "screen", "settled", or "pc:<addr>" (such as "pc:5200"), not ${JSON.stringify(until)}.`);
}

export default {
  name: 'run',
  description:
    'Run the machine. Stops at a breakpoint or stop watch, or at until ("break": only those; "halt": the CPU runs HALT; "screen": video RAM changes, checked every 2,000 T-states; "settled": after video RAM first changes, it returns to a state already seen since (an animation or blink cycle closed) or stays the same for 0.5 s emulated, which reaches a title screen drawn in pieces; "pc:<addr>": the PC reaches addr), or after cycles (decimal T-states) or seconds (emulated), and always at the emulated cap (limits.runSecondsEmulated, 10 s) or the wall-clock cap (limits.runSecondsWall, 5 s). trace: true records the instructions while it runs. Returns the stop reason, the cycles run, the register block, and with until "screen" or "settled" the screen diff.',
  inputSchema: {
    cycles: z.number().int().optional().describe('T-states to run at most, a decimal count'),
    seconds: z.number().optional().describe('Emulated seconds to run at most (at most limits.runSecondsEmulated)'),
    until: z.string().optional().describe('"break", "halt", "screen", "settled", or "pc:<addr>"'),
    trace: z.boolean().optional().describe('Record the executed instructions while running (default false)'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ cycles?: number, seconds?: number, until?: string, trace?: boolean }} args
   */
  handler(session, args) {
    const m = session.requireMachine();
    const { limits } = session.config;
    const cap = capCycles(session.config);
    if (args.cycles !== undefined && args.seconds !== undefined) throw new Error('Give cycles or seconds, not both.');
    let budget = cap;
    let asked;
    if (args.cycles !== undefined) {
      budget = parseCount(args.cycles, { name: 'cycles', min: 1, max: cap });
      asked = `${budget.toLocaleString('en-US')} cycles`;
    } else if (args.seconds !== undefined) {
      if (!(args.seconds > 0) || args.seconds > limits.runSecondsEmulated) {
        throw new Error(`seconds must be more than 0 and at most ${limits.runSecondsEmulated} (limits.runSecondsEmulated), not ${args.seconds}.`);
      }
      budget = Math.max(1, Math.round(args.seconds * CPU_CLOCK_HZ));
      asked = `${args.seconds} s`;
    }
    const until = args.until === undefined ? undefined : parseUntil(args.until, session);
    const before = Uint8Array.from(m.video.raw);
    const stop = withTrace(session, args.trace === true, () =>
      runMachine(session, {
        budget,
        ...(until?.kind === 'halt' ? { until: 'halt' } : until?.kind === 'pc' ? { until: { pc: until.pc } } : {}),
        ...(until?.kind === 'screen' || until?.kind === 'settled' ? { screenFrom: before, settle: until.kind === 'settled' } : {}),
      }),
    );
    const lines = [
      stoppedLine(stop, session, { capped: asked === undefined || budget === cap, ...(asked ? { asked } : {}), ...(until?.kind === 'pc' ? { pc: until.pc } : {}) }),
      `Ran ${stop.cycles.toLocaleString('en-US')} cycles (${seconds(stop.cycles)} emulated)`,
    ];
    if (until?.kind === 'break' && m.debug.breaks.length === 0) lines.push('(no breakpoints are set, so only a stop watch or a cap could stop it)');
    if (args.trace) lines.push(`Trace: recorded while running (the last ${limits.traceDepth.toLocaleString('en-US')} instructions are kept)`);
    lines.push(regsBlock(m.cpu.regs, m.cpu.flags, m.cycles));
    if (until?.kind === 'screen' || until?.kind === 'settled') lines.push(screenDiff(before, m.video.raw, m.video.columns === 32));
    return lines.join('\n');
  },
};
