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
    'Show the screen: 16 lines inside a fence under a column ruler, non-printables as ·. diff: true shows only the cells changed since the previous screen call (or since load or restore), as (row,col) old→new; diff: "<snapshot name>" shows the cells changed since that snapshot (or, when the snapshot was taken in the other of the 32- and 64-column widths, both screens, each in its own width).',
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
    const snap = typeof diff === 'string' ? session.useSnapshot(diff) : undefined;
    const before = snap !== undefined ? snap.memory.subarray(0, 1024) : (session.screenBaseline ?? now);
    session.screenBaseline = now;
    if (diff === false) return screenText(now, columns32);
    // A snapshot of another program: the same note diff gives, after the first line.
    const current = session.program?.name ?? '(none)';
    const theirs = snap === undefined ? current : (snap.program?.name ?? '(none)');
    const note = theirs !== current ? [`Note: ${diff} belongs to ${theirs} and now to ${current}.`] : [];
    const withNote = (/** @type {string} */ text) => {
      const [first, ...rest] = text.split('\n');
      return [first, ...note, ...rest].join('\n');
    };
    // Cells are screen positions, so a snapshot taken in the other width has no cell-by-cell
    // diff: say so, and show each screen in its own width.
    if (snap !== undefined && snap.columns32 !== columns32) {
      const width = (/** @type {boolean} */ c32) => (c32 ? '32 columns' : '64 columns');
      return withNote([
        `The widths differ: snapshot ${JSON.stringify(snap.name)} was taken at ${width(snap.columns32)} and the screen is now ${width(columns32)}, so cells cannot be compared one by one. The two screens, each in its own width:`,
        `Snapshot ${JSON.stringify(snap.name)} (${width(snap.columns32)}):`,
        screenText(before, snap.columns32),
        `Now (${width(columns32)}):`,
        screenText(now, columns32),
      ].join('\n'));
    }
    return withNote(screenDiff(before, now, columns32));
  },
};
