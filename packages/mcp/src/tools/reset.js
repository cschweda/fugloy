/** `reset`: the orange button (docs/fugloy-mcp-spec.md §5, Lifecycle). Before any load it powers on a machine with no program, so the ROM alone can be used. */
import { z } from 'zod';
import { regsBlock } from '../format/regs.js';

export default {
  name: 'reset',
  description:
    'Hardware reset: the CPU restarts at 0000h and the cycle count at 0. RAM is kept unless keepRam is false (then 4000h-FFFFh is zeroed). Breakpoints and watches stay unless clear is true; the trace and the hit log are cleared. Before any load it powers on a machine with no program. Returns the register block.',
  inputSchema: {
    keepRam: z.boolean().optional().describe('Keep RAM as it is (default true); false zeroes 4000h-FFFFh'),
    clear: z.boolean().optional().describe('Also remove every breakpoint and watch (default false)'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ keepRam?: boolean, clear?: boolean }} args
   */
  handler(session, { keepRam = true, clear = false }) {
    if (session.machine === null) session.install(session.createMachine());
    const m = session.requireMachine();
    if (clear) {
      for (const b of m.debug.breaks) m.debug.unbreak(b.id);
      for (const w of m.debug.watches) m.debug.unwatch(w.id);
    }
    m.debug.trace.clear();
    session.trace.clear();
    m.debug.clearHits();
    if (!keepRam) m.mem.ram.fill(0);
    m.reset();
    return regsBlock(m.cpu.regs, m.cpu.flags, m.cycles);
  },
};
