/** `status`: what the session holds, before or after a load (docs/fugloy-mcp-spec.md §5). */

const MODEL_NAMES = { 1: 'I', 3: 'III', 4: '4' };

/** @param {number} n as `5200h`. */
const hex4 = (n) => `${n.toString(16).toUpperCase().padStart(4, '0')}h`;

export default {
  name: 'status',
  description:
    'Show the session: model, loaded program, cycles, PC, counts of breakpoints, watches, and labels, how many traced instructions are kept, the ROM, and which config file was read. Safe to call at any time, including before load.',
  /** @param {import('../session.js').Session} session */
  handler(session) {
    const { config, machine, program } = session;
    const lines = [
      `Model: ${MODEL_NAMES[config.defaultModel] ?? config.defaultModel}`,
      `Program: ${program ? `${program.name} (${program.path})` : 'none (call load)'}`,
      `Cycles: ${machine ? machine.cycles.toLocaleString('en-US') : 0}`,
      `PC: ${machine ? hex4(machine.cpu.regs.pc) : 'none (no machine yet)'}`,
      `Breaks: ${machine ? machine.debug.breaks.length : 0}  Watches: ${machine ? machine.debug.watches.length : 0}  Labels: ${session.labels.size}`,
      `Trace: ${session.trace.size > 0 ? `${session.trace.size.toLocaleString('en-US')} instructions kept (call trace)` : 'none recorded'}`,
      `ROM: ${config.roms.model3 ?? 'none configured (set roms.model3 in fugloy.mcp.json)'}`,
      `Config: ${config.source ?? 'defaults (no fugloy.mcp.json found)'}`,
    ];
    return lines.join('\n');
  },
};
