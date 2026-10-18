/** The screen as text and as a cell diff (docs/fugloy-mcp-spec.md §4). */

const printable = (/** @type {string} */ s) => s.replace(/[^\x20-\x7e]/g, '·');

/**
 * The lines of `m.video.text()` inside a fence, under a two-line ruler (tens, then ones).
 * @param {string[]} lines
 * @returns {string}
 */
export function screenText(lines) {
  const width = lines.reduce((w, l) => Math.max(w, l.length), 0) || 64;
  let tens = '';
  let ones = '';
  for (let i = 0; i < width; i++) {
    tens += i < 10 ? ' ' : String(Math.floor(i / 10) % 10);
    ones += String(i % 10);
  }
  return ['```', tens, ones, ...lines.map(printable), '```'].join('\n');
}

const cell = (/** @type {number} */ b) => (b >= 0x20 && b <= 0x7e ? `'${String.fromCharCode(b)}'` : `$${b.toString(16).toUpperCase().padStart(2, '0')}`);

/**
 * Cells that differ between two copies of video RAM (64 columns a row), a count line first.
 * @param {ArrayLike<number>} before
 * @param {ArrayLike<number>} after
 * @returns {string}
 */
export function screenDiff(before, after) {
  const rows = [];
  const n = Math.max(before.length, after.length);
  for (let i = 0; i < n; i++) {
    const a = before[i] ?? 0x20;
    const b = after[i] ?? 0x20;
    if (a !== b) rows.push(`(${Math.floor(i / 64)},${i % 64}) ${cell(a)}→${cell(b)}`);
  }
  return [`${rows.length} ${rows.length === 1 ? 'cell' : 'cells'} changed`, ...rows].join('\n');
}
