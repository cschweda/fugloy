/** The screen as text and as a cell diff (docs/fugloy-mcp-spec.md §4). */

/** One screen character from a video RAM byte, as `m.video.text()` folds it, with `·` where it shows nothing printable. */
function glyph(/** @type {number} */ byte) {
  const b = byte < 0x20 ? byte + 0x40 : byte;
  return b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '·';
}

/**
 * Video RAM ($3C00-$3FFF, 1,024 bytes) as a fenced screen under a two-line ruler (tens, then
 * ones). Bytes below $20 fold to +$40 like `m.video.text()`; graphics and $7F-$FF show as `·`.
 * In 32-column mode only the even-address bytes show.
 * @param {ArrayLike<number>} ram
 * @param {boolean} [columns32]
 * @returns {string}
 */
export function screenText(ram, columns32 = false) {
  const step = columns32 ? 2 : 1;
  const width = 64 / step;
  let tens = '';
  let ones = '';
  for (let i = 0; i < width; i++) {
    tens += i < 10 ? ' ' : String(Math.floor(i / 10) % 10);
    ones += String(i % 10);
  }
  const lines = [];
  for (let row = 0; row < 16; row++) {
    let line = '';
    for (let col = 0; col < width; col++) line += glyph(ram[row * 64 + col * step] ?? 0x20);
    lines.push(line);
  }
  return ['```', tens, ones, ...lines, '```'].join('\n');
}

const cell = (/** @type {number} */ b) => (b >= 0x20 && b <= 0x7e ? `'${String.fromCharCode(b)}'` : `$${b.toString(16).toUpperCase().padStart(2, '0')}`);

/**
 * Cells that differ between two copies of video RAM, a count line first. Positions are screen
 * positions: in 32-column mode only even-address bytes show, so odd ones are ignored and the
 * column is halved.
 * @param {ArrayLike<number>} before
 * @param {ArrayLike<number>} after
 * @param {boolean} [columns32]
 * @returns {string}
 */
export function screenDiff(before, after, columns32 = false) {
  const rows = [];
  const n = Math.max(before.length, after.length);
  for (let i = 0; i < n; i++) {
    const ramCol = i % 64;
    if (columns32 && ramCol % 2 === 1) continue;
    const a = before[i] ?? 0x20;
    const b = after[i] ?? 0x20;
    if (a !== b) rows.push(`(${Math.floor(i / 64)},${columns32 ? ramCol / 2 : ramCol}) ${cell(a)}→${cell(b)}`);
  }
  return [`${rows.length} ${rows.length === 1 ? 'cell' : 'cells'} changed`, ...rows].join('\n');
}
