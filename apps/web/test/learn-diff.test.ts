// The chapters' change marks (phase 6C Task 1): a line diff between the previous chapter's program and
// this one's, over lines compared with trailing whitespace trimmed. Inside each hunk, removed and added
// lines pair up in order as changed; extra added lines are new; extra removed lines are listed, each
// with the new-text line it sat before (Review Focus 1: the numbers stay right after a removal).
import { describe, expect, it } from 'vitest';
import { lineDiff } from '../app/utils/learn/diff';
import type { LineMark } from '../app/utils/learn/diff';

const text = (...lines: string[]): string => lines.join('\n') + '\n';
const marksOf = (m: Map<number, LineMark>): [number, LineMark][] => [...m].sort((a, b) => a[0] - b[0]);

describe('lineDiff', () => {
  it('gives no marks and no removals for identical texts', () => {
    const t = text('a', 'b', 'c');
    const d = lineDiff(t, t);
    expect(d.marks.size).toBe(0);
    expect(d.removed).toEqual([]);
  });

  it('marks an appended line new', () => {
    const d = lineDiff(text('a', 'b'), text('a', 'b', 'c'));
    expect(marksOf(d.marks)).toEqual([[3, 'new']]);
    expect(d.removed).toEqual([]);
  });

  it('marks an edited line changed, at its line', () => {
    const d = lineDiff(text('a', 'b', 'c', 'd'), text('a', 'b', 'C', 'd'));
    expect(marksOf(d.marks)).toEqual([[3, 'changed']]);
    expect(d.removed).toEqual([]);
  });

  it('lists a deleted line as removed, before the line that now follows it', () => {
    const d = lineDiff(text('a', 'b', 'c', 'd'), text('a', 'c', 'd'));
    expect(d.marks.size).toBe(0);
    expect(d.removed).toEqual([{ before: 2, text: 'b' }]);
  });

  it('puts a line deleted from the end before the text length + 1', () => {
    const d = lineDiff('a\nb\nc', 'a\nb');
    expect(d.removed).toEqual([{ before: 3, text: 'c' }]);
  });

  it('pairs a rework of 3 lines out and 5 in as 3 changed and 2 new, in order', () => {
    const d = lineDiff(text('top', 'x1', 'x2', 'x3', 'end'), text('top', 'y1', 'y2', 'y3', 'y4', 'y5', 'end'));
    expect(marksOf(d.marks)).toEqual([
      [2, 'changed'],
      [3, 'changed'],
      [4, 'changed'],
      [5, 'new'],
      [6, 'new'],
    ]);
    expect(d.removed).toEqual([]);
  });

  it('lists the extra removed lines of a rework of 4 out and 2 in after its changed lines', () => {
    const d = lineDiff(text('top', 'x1', 'x2', 'x3', 'x4', 'end', 'more'), text('top', 'y1', 'y2', 'end', 'more'));
    expect(marksOf(d.marks)).toEqual([
      [2, 'changed'],
      [3, 'changed'],
    ]);
    expect(d.removed).toEqual([
      { before: 4, text: 'x3' },
      { before: 4, text: 'x4' },
    ]);
  });

  it('keeps the line numbers right after a removal earlier in the text (Review Focus 1)', () => {
    const d = lineDiff(text('a', 'gone', 'b', 'c', 'd'), text('a', 'b', 'c', 'D', 'e'));
    expect(d.removed).toEqual([{ before: 2, text: 'gone' }]);
    expect(marksOf(d.marks)).toEqual([
      [4, 'changed'],
      [5, 'new'],
    ]);
  });

  it('sees a change of trailing spaces only as no change', () => {
    const d = lineDiff(text('a', 'b  ', 'c\t'), text('a  ', 'b', 'c'));
    expect(d.marks.size).toBe(0);
    expect(d.removed).toEqual([]);
  });

  it('marks every line new against the empty text, as for chapter 1, but not the empty line after the last line break', () => {
    const d = lineDiff('', text('a', '', 'b'));
    // "a\n\nb\n": a, an empty line, and b; the editor's empty fourth line after the final break is not marked.
    expect(marksOf(d.marks)).toEqual([
      [1, 'new'],
      [2, 'new'],
      [3, 'new'],
    ]);
    expect(d.removed).toEqual([]);
    expect(lineDiff('', 'a\nb').marks.size).toBe(2);
  });

  it('sees adding or dropping the final line break as no change', () => {
    expect(lineDiff('a\nb', 'a\nb\n')).toEqual({ marks: new Map(), removed: [] });
    expect(lineDiff('a\nb\n', 'a\nb')).toEqual({ marks: new Map(), removed: [] });
  });

  it('lists every old line as removed against an empty new text', () => {
    expect(lineDiff('a\nb', '')).toEqual({ marks: new Map(), removed: [{ before: 1, text: 'a' }, { before: 1, text: 'b' }] });
  });
});
