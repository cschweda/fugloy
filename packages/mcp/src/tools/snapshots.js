/** `snapshots`: the snapshots kept, least recently used first (docs/fugloy-mcp-spec.md §5 Snapshots). */
import { snapshotCap } from '../session.js';

export default {
  name: 'snapshots',
  description: 'List the snapshots: name, the cycle each was taken at, and the program it belongs to, least recently used first (the first is evicted when a new snapshot would pass the cap). Safe before load.',
  /** @param {import('../session.js').Session} session */
  handler(session) {
    const cap = snapshotCap(session.config);
    const all = [...session.snapshots.values()];
    if (all.length === 0) return `No snapshots yet (at most ${cap} are kept; call snapshot name=…).`;
    const rows = [['name', 'cycle', 'program'], ...all.map((s) => [s.name, s.cycles.toLocaleString('en-US'), s.program?.name ?? '(none)'])];
    const w0 = Math.max(...rows.map((r) => r[0].length));
    const w1 = Math.max(...rows.map((r) => r[1].length));
    return [
      `${all.length} of ${cap} snapshots, least recently used first (the first goes when a new one would pass the cap):`,
      ...rows.map(([n, c, p]) => `${n.padEnd(w0)}  ${c.padStart(w1)}  ${p}`),
    ].join('\n');
  },
};
