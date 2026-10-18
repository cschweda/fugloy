/** `unlabel`: remove a label by address or name, of any source, and rewrite the sidecar (docs/fugloy-mcp-spec.md §5, Ruling 6). */
import { z } from 'zod';
import { hex4, parseAddr } from '../args.js';
import { writeSidecar } from '../sidecar.js';

export default {
  name: 'unlabel',
  description: 'Remove the label at addr, or the label called name (any case), whatever its source, and rewrite the sidecar file. Give one of addr and name.',
  inputSchema: {
    addr: z.union([z.string(), z.number()]).optional().describe('The labelled address: 5200, 0x5200, $5200, 5200h, or a decimal number'),
    name: z.string().optional().describe('The label\'s name'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ addr?: string | number, name?: string }} args
   */
  handler(session, { addr, name }) {
    const { sidecar } = session.requireProgram();
    if (addr === undefined && name === undefined) throw new Error('Give addr or name.');
    if (addr !== undefined && name !== undefined) throw new Error('Give addr or name, not both.');
    let label;
    if (name !== undefined) {
      label = [...session.labels.values()].find((l) => l.name.toUpperCase() === name.toUpperCase());
      if (label === undefined) throw new Error(`No label is named ${name}.`);
    } else {
      const at = parseAddr(addr, session.labels);
      label = session.labels.get(at);
      if (label === undefined) throw new Error(`No label is at ${hex4(at)}.`);
    }
    session.labels.delete(label.addr);
    const done = `Removed ${label.name} at ${hex4(label.addr)}`;
    if (sidecar.ignored !== null) {
      return { text: `${done} for this session only: the sidecar ${sidecar.readFrom} was ignored at load (${sidecar.ignored}), so it was not overwritten.`, isError: true };
    }
    try {
      return `${done}.\nWrote ${writeSidecar(session)}.`;
    } catch (err) {
      return { text: `${done} in this session, but ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  },
};
