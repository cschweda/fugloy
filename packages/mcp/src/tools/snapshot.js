/** `snapshot`: save the machine under a name (docs/fugloy-mcp-spec.md §3, §5 Snapshots). */
import { z } from 'zod';
import { CONTROL } from '../args.js';
import { snapshotCap } from '../session.js';

/** The longest snapshot name. */
const NAME_MAX = 64;

export default {
  name: 'snapshot',
  description:
    'Save the whole machine (CPU, memory, devices, cycle count) under a name, for restore and diff. A second snapshot of one name replaces the first. At most limits.snapshots (16 by default) are kept; past that the least recently used one (taken, restored, or diffed longest ago) is evicted, and the result says which. Coverage, callers, the hit log, the trace, breakpoints, watches, and labels are not part of a snapshot.',
  inputSchema: {
    name: z.string().describe('The snapshot\'s name, up to 64 characters; "now" is reserved for the running machine in diff'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ name: string }} args
   */
  handler(session, { name }) {
    session.requireMachine();
    if (name.trim() === '') throw new Error('name is empty; give the snapshot a name, such as before.');
    if (name.toLowerCase() === 'now') throw new Error('"now" means the running machine in diff, so it cannot name a snapshot; choose another name.');
    if (CONTROL.test(name)) throw new Error(`The snapshot name ${JSON.stringify(name)} holds a control character; use letters, digits, and punctuation.`);
    if (name.length > NAME_MAX) throw new Error(`A snapshot name is at most ${NAME_MAX} characters; ${JSON.stringify(name.slice(0, 16))}… has ${name.length}.`);
    const { snap, replaced, evicted } = session.takeSnapshot(name);
    const lines = [`snapshot ${JSON.stringify(name)} at cycle ${snap.cycles.toLocaleString('en-US')} (${snap.kb} KB)`];
    if (replaced) lines.push('Replaced the earlier snapshot of that name.');
    if (evicted !== null) lines.push(`Evicted ${JSON.stringify(evicted)}, the least recently used snapshot (at most ${snapshotCap(session.config)} are kept).`);
    return lines.join('\n');
  },
};
