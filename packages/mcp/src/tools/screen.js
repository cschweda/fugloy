/**
 * `screen`: the screen as text, or the cells changed since the previous `screen` call or since a
 * snapshot (docs/fugloy-mcp-spec.md §4, §5). Every call makes the screen it saw the baseline the
 * next `diff: true` compares with; `load` and `restore` set it too.
 */
import { z } from 'zod';
import { geometryOf, geometryText, sameGeometry, screenDiff, screenText } from '../format/screen.js';

export default {
  name: 'screen',
  description:
    'Show the screen: 16 lines (24 on a Model 4 in 80-column mode) inside a fence under a column ruler, non-printables as ·. diff: true shows only the cells changed since the previous screen call (or since load or restore), as (row,col) old→new; diff: "<snapshot name>" shows the cells changed since that snapshot (or, when the snapshot was taken in another screen width, both screens, each in its own width). On a Model 4, video RAM bytes the screen does not show are counted on a last line, not listed.',
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
    const layout = geometryOf(m);
    const snap = typeof diff === 'string' ? session.useSnapshot(diff) : undefined;
    const before = snap !== undefined ? snap.video : (session.screenBaseline ?? now);
    session.screenBaseline = now;
    if (diff === false) return screenText(now, layout);
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
    if (snap !== undefined && !sameGeometry(snap.geometry, layout)) {
      const width = geometryText;
      return withNote([
        `The widths differ: snapshot ${JSON.stringify(snap.name)} was taken at ${width(snap.geometry)} and the screen is now ${width(layout)}, so cells cannot be compared one by one. The two screens, each in its own width:`,
        `Snapshot ${JSON.stringify(snap.name)} (${width(snap.geometry)}):`,
        screenText(before, snap.geometry),
        `Now (${width(layout)}):`,
        screenText(now, layout),
      ].join('\n'));
    }
    return withNote(screenDiff(before, now, layout));
  },
};
