// The Space Invaders chapters' change marks (phase 6C Task 1): which lines of a chapter's program are
// new or changed since the previous chapter's, and which of that program's lines it took out. A
// longest-common-subsequence diff over lines, each compared with its trailing whitespace trimmed. The
// lines between two kept ones are a hunk: its removed and added lines pair up in order as changed
// (the new line takes the old one's place); the added lines left over are new, and the removed lines
// left over are listed as removed, before the line that follows the hunk in the new text. Lines are
// numbered as the editor numbers them, but the empty line after a text's last line break is not a
// line of the program, so it is never marked (fix round 1); the empty text has no lines, so against it
// every line is new. No DOM, no Vue.

export type LineMark = 'new' | 'changed';

export interface LineDiff {
  /** 1-based lines of the new text, each new or changed (a changed line replaces a removed one in place). */
  marks: Map<number, LineMark>;
  /** Removed lines of the old text, each with the new-text line it sat before (1-based; text length + 1 at the end). */
  removed: { before: number; text: string }[];
}

/** The text's lines, without the empty one after a final line break. */
function linesOf(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

export function lineDiff(oldText: string, newText: string): LineDiff {
  const a = linesOf(oldText);
  const b = linesOf(newText);
  const ka = a.map((l) => l.trimEnd());
  const kb = b.map((l) => l.trimEnd());
  const n = a.length;
  const m = b.length;

  // lcs[i][j]: the longest common subsequence of a[i..] and b[j..], in one flat array.
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = ka[i] === kb[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    }
  }

  const marks = new Map<number, LineMark>();
  const removed: LineDiff['removed'] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && ka[i] === kb[j]) {
      i++;
      j++;
      continue;
    }
    // A hunk: the removed and added lines up to the next kept line.
    const out: string[] = [];
    const inStart = j;
    while (i < n || j < m) {
      if (i < n && j < m && ka[i] === kb[j]) break;
      if (j < m && (i >= n || lcs[i * w + j + 1]! >= lcs[(i + 1) * w + j]!)) j++;
      else out.push(a[i++]!);
    }
    const added = j - inStart;
    const paired = Math.min(out.length, added);
    for (let k = 0; k < added; k++) marks.set(inStart + k + 1, k < paired ? 'changed' : 'new');
    for (const text of out.slice(paired)) removed.push({ before: j + 1, text });
  }
  return { marks, removed };
}
