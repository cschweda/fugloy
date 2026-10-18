/** `screen`: the screen as text, or the cells changed since the previous `screen` call (docs/fugloy-mcp-spec.md §4, §5). */
import { z } from 'zod';
import { screenDiff, screenText } from '../format/screen.js';

export default {
  name: 'screen',
  description:
    'Show the screen: 16 lines inside a fence under a column ruler, non-printables as ·. diff: true shows only the cells changed since the previous screen call (or since load), as (row,col) old→new.',
  inputSchema: {
    diff: z.boolean().optional().describe('Only the cells changed since the previous screen call (default false)'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ diff?: boolean }} args
   */
  handler(session, { diff = false }) {
    const m = session.requireMachine();
    const now = Uint8Array.from(m.video.raw);
    const columns32 = m.video.columns === 32;
    const before = session.screenBaseline ?? now;
    session.screenBaseline = now;
    return diff ? screenDiff(before, now, columns32) : screenText(now, columns32);
  },
};
