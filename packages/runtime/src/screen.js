/**
 * The TRS-80 screen drawn into an RGBA buffer (a canvas's ImageData), with no DOM: the one renderer
 * the workbench (apps/web, phase 5D) and a port's player (M2) share. One pixel per character
 * generator pixel, each model in its own generator's cell: 6x12 on the Model I (64x16 is 384x192),
 * 8x12 on the Model III and 4 (512x192), and 8x10 at the Model 4's 80x24 (640x240); the canvas scales
 * it to the model's picture shape (tubeAspect).
 *
 * - The glyphs are the TRS-80's own character generators, from xtrs's trs_chars.c
 *   (glyphs.generated.js, under xtrs's licence: NOTICE.md): the Model I's stock generator, or the one
 *   sold with the lowercase kit when the machine has it; the Model III's (katakana alternates); the
 *   Model 4's (international alternates). 80x24 uses the Model 4 set's first ten rows.
 * - 00H-1FH: shown as 40H-5FH, as the character generator folds them (and emu's m.video.text()).
 * - 00H-7FH otherwise: the generator's glyph, 7FH included.
 * - 80H-BFH: 2x3 graphics blocks, each block half the cell wide. Bit 0 is top left, 1 top right,
 *   2 middle left, 3 middle right, 4 bottom left, 5 bottom right.
 * - C0H-FFH: on the Model III and 4, the generator's alternate set while the machine selects it
 *   (port $EC bit 3, emu's m.video.altCharset), and otherwise the block of the low six bits, as the
 *   hardware does; on the Model I always the block.
 * - Model 4 inverse video: a byte with bit 7 set is its character (bits 0-6), inverted.
 * - 32- and 40-column modes show each even-address byte two cells wide.
 *
 * What the screen is in (a ScreenView) comes from screenOf(z) for a port, and from the web app's
 * screenView(m) for an emulator (apps/web/app/utils/emulator/screen.ts).
 */
import { CG_MODEL1, CG_MODEL1_LOWERCASE, CG_MODEL3, CG_MODEL4 } from './glyphs.generated.js';

export { CG_MODEL1, CG_MODEL1_LOWERCASE, CG_MODEL3, CG_MODEL4, GLYPH_SOURCE } from './glyphs.generated.js';

/** @typedef {import('./glyphs.generated.js').GlyphSet} GlyphSet */
/** @typedef {'model1' | 'model1-lowercase' | 'model3' | 'model4'} ScreenFont */
/**
 * @typedef {object} ScreenView
 * @property {number} columns Characters across: 64 or 32, or on a Model 4 in 80-column mode 80 or 40.
 * @property {number} rows 16, or 24 in 80-column mode.
 * @property {boolean} wide The 80-column layout: rows of 80 bytes in video RAM, and 8x10 cells.
 * @property {boolean} inverse Model 4 inverse video (port $84 bit 3).
 * @property {ScreenFont} font Which character generator the machine has.
 * @property {boolean} altCharset The Model III/4 alternate set in C0H-FFH (port $EC bit 3); always false on the Model I.
 */

/** The phosphor and the tube, as RGBA. @type {readonly [number, number, number, number]} */
export const SCREEN_FG = [0xf2, 0xf2, 0xf2, 0xff];
/** @type {readonly [number, number, number, number]} */
export const SCREEN_BG = [0, 0, 0, 0xff];

/** @type {Record<ScreenFont, GlyphSet>} */
const SETS = {
  model1: CG_MODEL1,
  'model1-lowercase': CG_MODEL1_LOWERCASE,
  model3: CG_MODEL3,
  model4: CG_MODEL4,
};

/** @param {ScreenView} view */
const cellHeight = (view) => (view.wide ? 10 : 12);

/**
 * The buffer size for a view, in pixels.
 * @param {ScreenView} view
 * @returns {{ width: number, height: number }}
 */
export function screenSize(view) {
  const across = view.wide ? 80 : 64;
  return { width: across * SETS[view.font].width, height: view.rows * cellHeight(view) };
}

// The picture's shape (phase 6A). Both machines draw a line in the same 63.13 us, but the Model I's
// 384 active dots take 384 / 10.6445 MHz (48k.ca "Beamhacking: Video Timing",
// https://48k.ca/beamhack4.html; MAME src/mame/trs/trs80.cpp, set_raw(10.6445_MHz_XTAL, 672, 0, 384,
// 264, 0, 192)) and the Model III's 512 take 512 / 10.1376 MHz (emu models.js: clockHz 2027520, the
// 10.1376 MHz crystal / 5). At equal height the Model I's picture is narrower by that ratio. The
// Model III (and the Model 4, both sizes) is shown at 4:3, as xtrs and trsjs show it.
const MODEL1_DOT_HZ = 10.6445e6;
const MODEL3_DOT_HZ = 10.1376e6;
/** The Model III's and 4's picture, width / height. */
export const MODEL3_ASPECT = 4 / 3;
/** The Model I's picture, width / height: about 0.952. */
export const MODEL1_ASPECT = MODEL3_ASPECT * (384 / MODEL1_DOT_HZ) / (512 / MODEL3_DOT_HZ);

/**
 * The picture's width / height for a character generator's machine.
 * @param {ScreenFont} font
 * @returns {number}
 */
export function tubeAspect(font) {
  return font === 'model1' || font === 'model1-lowercase' ? MODEL1_ASPECT : MODEL3_ASPECT;
}

/**
 * The tube's size in CSS pixels for a raster `rasterHeight` rows high, at `aspect` (width / height),
 * in a space `availWidth` x `availHeight`: the largest whose height is a whole multiple k of the
 * rows (each row k screen pixels high on every model; across, the scale follows the aspect). When
 * not even k = 1 fits, the largest tube at the aspect within the space.
 * @param {number} rasterHeight
 * @param {number} aspect
 * @param {number} availWidth
 * @param {number} [availHeight]
 * @returns {{ width: number, height: number }}
 */
export function tubeFit(rasterHeight, aspect, availWidth, availHeight = Infinity) {
  const k = Math.floor(Math.min(availHeight / rasterHeight, availWidth / (rasterHeight * aspect)));
  if (k >= 1) {
    const height = k * rasterHeight;
    return { width: height * aspect, height };
  }
  const width = Math.max(0, Math.min(availWidth, availHeight * aspect));
  return { width, height: width / aspect };
}

/**
 * The tube in a panel `availWidth` wide for a raster `rasterWidth` x `rasterHeight` dots. The
 * Model III and 4 (4:3) get tubeFit's own whole-row fit, as before. The Model I takes the Model
 * III's height for that width (narrower at the same height, as on the same monitor) unless that
 * would draw it narrower than its dots (drawing fewer pixels than dots drops dot columns); then the
 * smallest whole-row height at least `rasterWidth` wide that fits the width; and when none does,
 * the host's width at the aspect. Full screen does not use this rule: it takes tubeFit's largest
 * whole-row tube for the window, and a window too small for 384 px across is accepted as it is.
 * @param {number} rasterHeight
 * @param {number} rasterWidth
 * @param {number} aspect
 * @param {number} availWidth
 * @returns {{ width: number, height: number }}
 */
export function panelFit(rasterHeight, rasterWidth, aspect, availWidth) {
  const base = tubeFit(rasterHeight, aspect, availWidth, tubeFit(rasterHeight, MODEL3_ASPECT, availWidth).height);
  if (aspect === MODEL3_ASPECT || base.width >= rasterWidth) return base;
  for (let k = 1; k * rasterHeight * aspect <= availWidth; k++) {
    const height = k * rasterHeight;
    if (height * aspect >= rasterWidth) return { width: height * aspect, height };
  }
  return { width: availWidth, height: availWidth / aspect };
}

/** The mode register's ENALTSET bit, port $EC bit 3 on the Model III (emu's MODE_ALTSET_BIT, machine/io.js:75). */
const MODE_ALTSET_BIT = 0x08;

/**
 * The view a port's screen is in now: a port's counterpart of the web app's screenView(m). 64 or 32
 * columns (the runtime's `columns32`, the mode register's width bit) by 16 rows; the Model I's stock
 * generator (the runtime's Model I has no lowercase kit: its video RAM has no bit 6) or the Model
 * III's, with the alternate set while port $EC bit 3 selects it, as emu's m.video.altCharset reads
 * it. The bytes are the port's video RAM: `renderScreen(z.mem.subarray(0x3c00, 0x4000), screenOf(z),
 * out, width)`.
 * @param {import('./z.js').Z} z
 * @returns {ScreenView}
 */
export function screenOf(z) {
  if (z.model !== 1 && z.model !== 3) throw new Error(`A ${z.model} machine has no screen; screenOf needs a Model I or Model III Z.`);
  return {
    columns: z.columns32 ? 32 : 64,
    rows: 16,
    wide: false,
    inverse: false,
    font: z.model === 1 ? 'model1' : 'model3',
    altCharset: z.model === 3 && (z.modeRegister & MODE_ALTSET_BIT) !== 0,
  };
}

/**
 * The rows (from the top) where each band of a 2x3 block starts, for a cell `h` high; then `h`.
 * @param {number} h
 * @returns {[number, number, number, number]}
 */
const bands = (h) => (h === 12 ? [0, 4, 8, 12] : [0, 3, 7, 10]);

/**
 * One cell's pixel rows (`h` bytes, leftmost pixel in bit 7) for a byte as shown.
 * @param {number} code
 * @param {GlyphSet} set
 * @param {number} h
 * @param {boolean} altCharset
 * @param {Uint8Array} out
 */
function cellRows(code, set, h, altCharset, out) {
  if (code >= 0x80 && !(code >= 0xc0 && altCharset && set.width === 8)) {
    const b = code & 0x3f;
    const edges = bands(h);
    const half = set.width / 2;
    const leftMask = (0xff << (8 - half)) & 0xff;
    const rightMask = leftMask >> half;
    for (let band = 0; band < 3; band++) {
      const left = (b >> (band * 2)) & 1 ? leftMask : 0;
      const right = (b >> (band * 2 + 1)) & 1 ? rightMask : 0;
      for (let y = edges[band]; y < edges[band + 1]; y++) out[y] = left | right;
    }
    return;
  }
  if (code < 0x20) code += 0x40;
  out.set(set.rows.subarray(code * 12, code * 12 + h));
}

/**
 * Draws video RAM `raw` as `view` into `out`, unconditionally.
 * @param {Uint8Array} raw
 * @param {ScreenView} view
 * @param {Uint8ClampedArray} out
 * @param {number} width
 */
function draw(raw, view, out, width) {
  const across = view.wide ? 80 : 64;
  const set = SETS[view.font];
  const h = cellHeight(view);
  const step = across / view.columns; // 1, or 2 in 32- and 40-column modes
  const cellW = set.width * step;
  const mask = (0xff << (8 - set.width)) & 0xff;
  const rows = new Uint8Array(h);
  const [fr, fg, fb, fa] = SCREEN_FG;
  const [br, bg, bb, ba] = SCREEN_BG;
  for (let row = 0; row < view.rows; row++) {
    for (let col = 0; col < view.columns; col++) {
      let code = raw[row * across + col * step];
      let invert = false;
      if (view.inverse && code >= 0x80) {
        code &= 0x7f;
        invert = true;
      }
      cellRows(code, set, h, view.altCharset, rows);
      const x0 = col * cellW;
      for (let y = 0; y < h; y++) {
        let bits = rows[y];
        if (invert) bits = ~bits & mask;
        let i = ((row * h + y) * width + x0) * 4;
        for (let x = 0; x < cellW; x++, i += 4) {
          if ((bits << Math.floor(x / step)) & 0x80) {
            out[i] = fr;
            out[i + 1] = fg;
            out[i + 2] = fb;
            out[i + 3] = fa;
          } else {
            out[i] = br;
            out[i + 1] = bg;
            out[i + 2] = bb;
            out[i + 3] = ba;
          }
        }
      }
    }
  }
}

/**
 * What each buffer last showed, so an unchanged screen costs one comparison.
 * @type {WeakMap<Uint8ClampedArray, { raw: Uint8Array, key: string }>}
 */
const last = new WeakMap();

/**
 * Draws video RAM `raw` as `view` into `out`, an RGBA buffer `width` pixels across (at least
 * screenSize(view).width). Returns false, drawing nothing, when neither the bytes nor the view
 * changed since the last call with the same buffer.
 * @param {Uint8Array} raw
 * @param {ScreenView} view
 * @param {Uint8ClampedArray} out
 * @param {number} width
 * @returns {boolean}
 */
export function renderScreen(raw, view, out, width) {
  const shown = view.rows * (view.wide ? 80 : 64);
  const key = `${view.columns}/${view.rows}/${view.wide}/${view.inverse}/${view.font}/${view.altCharset}/${width}`;
  const prev = last.get(out);
  if (prev !== undefined && prev.key === key && prev.raw.length === shown) {
    let same = true;
    for (let i = 0; i < shown; i++)
      if (prev.raw[i] !== raw[i]) {
        same = false;
        break;
      }
    if (same) return false;
  }
  last.set(out, { raw: raw.slice(0, shown), key });
  draw(raw, view, out, width);
  return true;
}

/**
 * Draws `lines` of text (uppercased; one per screen row from the top, cut at the row's end) into
 * `out` as video RAM holding them would show, in the view's own font: the no-ROM notice. The
 * next renderScreen into the same buffer always draws.
 * @param {readonly string[]} lines
 * @param {ScreenView} view
 * @param {Uint8ClampedArray} out
 * @param {number} width
 */
export function renderNotice(lines, view, out, width) {
  const across = view.wide ? 80 : 64;
  const step = across / view.columns;
  const raw = new Uint8Array(view.rows * across).fill(0x20);
  lines.slice(0, view.rows).forEach((line, row) => {
    const text = line.toUpperCase();
    for (let col = 0; col < Math.min(text.length, view.columns); col++) {
      const c = text.charCodeAt(col);
      raw[row * across + col * step] = c >= 0x20 && c < 0x7f ? c : 0x20;
    }
  });
  last.delete(out);
  draw(raw, view, out, width);
}
