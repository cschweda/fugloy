/**
 * `restore`: put the machine back as a snapshot saved it (docs/fugloy-mcp-spec.md §5 Snapshots;
 * Ruling 1 of the MCP phases D–F plan). Debugger state (coverage, callers, the hit log, the
 * trace) survives, as in the emu spec §7, unless `clearDebug` clears all but the trace. A
 * snapshot of another program is refused: its memory would sit under this program's labels
 * and sidecar.
 */
import { z } from 'zod';
import { regsBlock } from '../format/regs.js';

export default {
  name: 'restore',
  description:
    'Restore a snapshot: the CPU, memory, devices, and cycle count return exactly; the key queue and sound are emptied. Coverage, callers, the hit log, the trace, breakpoints, watches, and labels are kept; clearDebug: true clears coverage, callers, and the hit log (not the trace), so a branch explored and abandoned does not count as covered. A snapshot of a program other than the loaded one is refused (load that program first). The next screen diff compares with the restored screen. Returns the register block.',
  inputSchema: {
    name: z.string().describe('The snapshot to restore'),
    clearDebug: z.boolean().optional().describe('Also clear coverage, callers, and the hit log (default false)'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ name: string, clearDebug?: boolean }} args
   */
  handler(session, { name, clearDebug = false }) {
    const m = session.requireMachine();
    const snap = session.snapshots.get(name);
    const here = session.program;
    if (snap !== undefined && (snap.program?.sha256 ?? null) !== (here?.sha256 ?? null)) {
      const mix = "restoring it would mix one program's memory with the other's labels and sidecar";
      const loaded = here === null ? 'no program is loaded' : `the loaded program is ${here.name}`;
      if (snap.program === null) throw new Error(`Snapshot ${JSON.stringify(name)} was taken before any program was loaded, and ${loaded}; ${mix}.`);
      throw new Error(`Snapshot ${JSON.stringify(name)} belongs to ${snap.program.name} (${snap.program.path}), and ${loaded}; ${mix}. Load ${snap.program.path} first, then restore.`);
    }
    const MODEL = { 1: 'Model I', 3: 'Model III', 4: 'Model 4' };
    if (snap !== undefined && snap.model !== m.model) {
      throw new Error(`Snapshot ${JSON.stringify(name)} was taken on a ${MODEL[snap.model]}, and the machine is a ${MODEL[m.model]}; a save state restores only into the model that saved it. Load the program with model: ${snap.model} first, then restore.`);
    }
    const used = session.useSnapshot(name);
    m.debug.restore(used.state);
    // The next `screen diff` compares with the restored screen, not one from the abandoned branch.
    session.screenBaseline = Uint8Array.from(m.video.raw);
    let kept = 'Kept coverage, callers, the hit log, and the trace (clearDebug: true clears all but the trace).';
    if (clearDebug) {
      m.debug.coverage.clear();
      m.debug.clearHits();
      session.facts.fill(0);
      kept = 'Cleared coverage, callers, and the hit log; kept the trace.';
    }
    return [
      `Restored ${JSON.stringify(name)} (cycle ${used.cycles.toLocaleString('en-US')}, ${used.program?.name ?? 'no program'}).`,
      kept,
      regsBlock(m.cpu.regs, m.cpu.flags, m.cycles),
    ].join('\n');
  },
};
