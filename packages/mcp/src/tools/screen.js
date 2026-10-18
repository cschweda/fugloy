/**
 * `screen`: the screen as text, or the cells changed since the previous `screen` call or since a
 * snapshot (docs/fugloy-mcp-spec.md §4, §5). Every call makes the screen it saw the baseline the
 * next `diff: true` compares with; `load` and `restore` set it too.
 */
import { z } from 'zod';
import { screenDiff, screenText } from '../format/screen.js';

export default {
  name: 'screen',
  description:
    'Show the screen: 16 lines inside a fence under a column ruler, non-printables as ·. diff: true shows only the cells changed since the previous screen call (or since load or restore), as (row,col) old→new; diff: "<snapshot name>" shows the cells changed since that snapshot.',
  inputSchema: {
    diff: z.union([z.boolean(), z.string()]).optional()
      .describe('true: only the cells changed since the previous screen call; a snapshot name: only the cells changed since that snapshot (default false)'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ diff?: boolean | string }} args
   */
  handler(session, { diff = false }) {
    const m = session.requireMachine();
    const now = Uint8Array.from(m.video.raw);
    const columns32 = m.video.columns === 32;
    // A snapshot's memory starts with video RAM ($3C00, DIFF_START), 1,024 bytes.
    const before = typeof diff === 'string' ? session.useSnapshot(diff).memory.subarray(0, 1024) : (session.screenBaseline ?? now);
    session.screenBaseline = now;
    return diff === false ? screenText(now, columns32) : screenDiff(before, now, columns32);
  },
};
