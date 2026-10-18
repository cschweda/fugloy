/** The screen as text and as a cell diff (docs/fugloy-mcp-spec.md §4). */

/**
 * The screen's layout over video RAM: `width` bytes a row (64, or 80 on a Model 4 in 80-column
 * mode), `rows` rows (16, or 24 there), every `step`th byte shown (2 in the 32- and 40-column
 * modes), and whether inverse video is on (a Model 4's port $84 bit 3: a byte with bit 7 set
 * shows as its character, bits 0-6). The Model III and Model I are always 64 by 16.
 * @typedef {{ width: 64 | 80, rows: 16 | 24, step: 1 | 2, inverse?: boolean }} Geometry
 */

/** @param {boolean | Geometry | undefined} g a geometry, or (as before the Model 4) true for 32 columns @returns {Geometry} */
const geometry = (g) => (typeof g === 'object' ? g : { width: 64, rows: 16, step: g ? 2 : 1 });

/**
 * The machine's screen layout now, from `m.video` (emu devices/video.js).
 * @param {import('@fugloy/emu').Machine} m
 * @returns {Geometry}
 */
export function geometryOf(m) {
  const columns = m.video.columns;
  const width = columns === 80 || columns === 40 ? 80 : 64;
  const inverse = /** @type {any} */ (m.system.memory).inverse === true;
  return { width, rows: m.video.rows, step: columns === width ? 1 : 2, ...(inverse ? { inverse } : {}) };
}

/** True when two geometries lay the screen out alike (inverse video aside). */
export const sameGeometry = (/** @type {Geometry} */ a, /** @type {Geometry} */ b) => a.width === b.width && a.rows === b.rows && a.step === b.step;

/** `64 columns`, or `80 columns by 24 rows` for a 24-row screen. */
export const geometryText = (/** @type {Geometry} */ g) => `${g.width / g.step} columns${g.rows === 16 ? '' : ` by ${g.rows} rows`}`;

/** One screen character from a video RAM byte, as `m.video.text()` folds it, with `·` where it shows nothing printable. */
function glyph(/** @type {number} */ byte, /** @type {boolean | undefined} */ inverse) {
  if (inverse) byte &= 0x7f;
  const b = byte < 0x20 ? byte + 0x40 : byte;
  return b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '·';
}

/**
 * Video RAM as a fenced screen under a two-line ruler (tens, then ones): 16 lines of 64 columns
 * over the first 1,024 bytes, or the geometry given (a Model 4's 80 by 24). Bytes below $20 fold
 * to +$40 like `m.video.text()`; graphics and $7F-$FF show as `·` (with inverse video on, a byte
 * with bit 7 set shows as its character). In the 32- and 40-column modes only the even-address
 * bytes show.
 * @param {ArrayLike<number>} ram
 * @param {boolean | Geometry} [layout] a geometry, or true for the Model III's 32 columns
 * @returns {string}
 */
export function screenText(ram, layout = false) {
  const { width: rowBytes, rows, step, inverse } = geometry(layout);
  const width = rowBytes / step;
  let tens = '';
  let ones = '';
  for (let i = 0; i < width; i++) {
    tens += i < 10 ? ' ' : String(Math.floor(i / 10) % 10);
    ones += String(i % 10);
  }
  const lines = [];
  for (let row = 0; row < rows; row++) {
    let line = '';
    for (let col = 0; col < width; col++) line += glyph(ram[row * rowBytes + col * step] ?? 0x20, inverse);
    lines.push(line);
  }
  return ['```', tens, ones, ...lines, '```'].join('\n');
}

const cell = (/** @type {number} */ b) => (b >= 0x20 && b <= 0x7e ? `'${String.fromCharCode(b)}'` : `$${b.toString(16).toUpperCase().padStart(2, '0')}`);

/**
 * Cells that differ between two copies of video RAM, a count line first. Positions are screen
 * positions: in the 32- and 40-column modes only even-address bytes show, so odd ones are ignored
 * and the column is halved. Bytes past the screen (a Model 4's 2K holds more than 64 by 16 or 80
 * by 24 shows) are not cells; when any of them changed, a last line counts them as off screen.
 * @param {ArrayLike<number>} before
 * @param {ArrayLike<number>} after
 * @param {boolean | Geometry} [layout] a geometry, or true for the Model III's 32 columns
 * @returns {string}
 */
export function screenDiff(before, after, layout = false) {
  const { width, rows: height, step } = geometry(layout);
  const rows = [];
  const n = Math.max(before.length, after.length);
  const onScreen = Math.min(n, width * height);
  for (let i = 0; i < onScreen; i++) {
    const ramCol = i % width;
    if (step === 2 && ramCol % 2 === 1) continue;
    const a = before[i] ?? 0x20;
    const b = after[i] ?? 0x20;
    if (a !== b) rows.push(`(${Math.floor(i / width)},${ramCol / step}) ${cell(a)}→${cell(b)}`);
  }
  let off = 0;
  for (let i = onScreen; i < n; i++) if ((before[i] ?? 0x20) !== (after[i] ?? 0x20)) off++;
  const tail = off === 0 ? [] : [`(${off.toLocaleString('en-US')} ${off === 1 ? 'byte' : 'bytes'} of video RAM off screen also changed, at offsets ${onScreen}–${n - 1}; not shown)`];
  return [`${rows.length} ${rows.length === 1 ? 'cell' : 'cells'} changed`, ...rows, ...tail].join('\n');
}
