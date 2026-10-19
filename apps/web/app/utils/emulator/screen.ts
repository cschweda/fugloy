// The TRS-80 screen drawn into an RGBA buffer (a canvas's ImageData), with no DOM (phase 5B
// Ruling 4). One pixel per font pixel: a 6x12 cell for 64x16 (384x192, the Model III's own
// raster) and a 6x10 cell for the Model 4's 80x24 (480x240); the canvas scales it up.
//
// - 20H-7EH: X.Org font-misc-misc's public-domain glyphs (glyphs.generated.ts).
// - 7FH: drawn here, as a hollow box (the font table stops at 7EH).
// - 00H-1FH: shown as 40H-5FH, as the character generator folds them (and m.video.text()).
// - 80H-BFH: 2x3 graphics blocks. Bit 0 is top left, 1 top right, 2 middle left, 3 middle right,
//   4 bottom left, 5 bottom right.
// - C0H-FFH: the block of the low six bits, as on the Model I. The Model III's special and
//   katakana sets are not drawn: their only source is the ROM's character generator.
// - Model 4 inverse video: a byte with bit 7 set is its character (bits 0-6), inverted.
// - 32- and 40-column modes show each even-address byte two cells wide.
import type { Machine } from '@fugloy/emu';
import { GLYPHS_6X10, GLYPHS_6X12 } from './glyphs.generated';
import type { GlyphTable } from './glyphs.generated';

export interface ScreenView {
  /** Characters across: 64 or 32, or on a Model 4 in 80-column mode 80 or 40. */
  columns: number;
  /** 16, or 24 in 80-column mode. */
  rows: number;
  /** The 80-column layout: rows of 80 bytes in video RAM, and 6x10 cells. */
  wide: boolean;
  /** Model 4 inverse video (port $84 bit 3). */
  inverse: boolean;
}

/** The phosphor and the tube, as RGBA. */
export const SCREEN_FG: readonly [number, number, number, number] = [0xe8, 0xf0, 0xe8, 0xff];
export const SCREEN_BG: readonly [number, number, number, number] = [0x10, 0x12, 0x10, 0xff];

const CELL_WIDTH = 6;

/** The buffer size for a view, in pixels. */
export function screenSize(view: ScreenView): { width: number; height: number } {
  const across = view.wide ? 80 : 64;
  return { width: across * CELL_WIDTH, height: view.rows * (view.wide ? GLYPHS_6X10.height : GLYPHS_6X12.height) };
}

/** The view a machine's screen is in now. */
export function screenView(m: Machine): ScreenView {
  const rows = m.video.rows;
  // Inverse video has no stable API yet; emu's Video reads the same flag (video.js).
  return { columns: m.video.columns, rows, wide: rows === 24, inverse: m.system.memory.inverse === true };
}

/** The rows (from the top) where each band of a 2x3 block starts, for a cell `h` high; then `h`. */
const bands = (h: number): [number, number, number, number] => (h === 12 ? [0, 4, 8, 12] : [0, 3, 7, 10]);

/** One cell's pixel rows (`height` bytes, leftmost pixel in bit 7) for a byte as shown. */
function cellRows(code: number, table: GlyphTable, out: Uint8Array): void {
  const h = table.height;
  if (code >= 0x80) {
    const b = code & 0x3f;
    const edges = bands(h);
    for (let band = 0; band < 3; band++) {
      const left = (b >> (band * 2)) & 1 ? 0b1110_0000 : 0;
      const right = (b >> (band * 2 + 1)) & 1 ? 0b0001_1100 : 0;
      for (let y = edges[band]!; y < edges[band + 1]!; y++) out[y] = left | right;
    }
    return;
  }
  if (code < 0x20) code += 0x40;
  if (code === 0x7f) {
    out.fill(0);
    for (let y = 1; y < h - 2; y++) out[y] = 0b1000_1000;
    out[1] = out[h - 3] = 0b1111_1000;
    return;
  }
  out.set(table.rows.subarray((code - table.first) * h, (code - table.first + 1) * h));
}

/** What each buffer last showed, so an unchanged screen costs one comparison. */
const last = new WeakMap<Uint8ClampedArray, { raw: Uint8Array; key: string }>();

/**
 * Draws video RAM `raw` as `view` into `out`, an RGBA buffer `width` pixels across (at least
 * screenSize(view).width). Returns false, drawing nothing, when neither the bytes nor the view
 * changed since the last call with the same buffer.
 */
export function renderScreen(raw: Uint8Array, view: ScreenView, out: Uint8ClampedArray, width: number): boolean {
  const across = view.wide ? 80 : 64;
  const shown = view.rows * across;
  const key = `${view.columns}/${view.rows}/${view.wide}/${view.inverse}/${width}`;
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

  const table = view.wide ? GLYPHS_6X10 : GLYPHS_6X12;
  const h = table.height;
  const step = across / view.columns; // 1, or 2 in 32- and 40-column modes
  const cellW = CELL_WIDTH * step;
  const rows = new Uint8Array(h);
  const [fr, fg, fb, fa] = SCREEN_FG;
  const [br, bg, bb, ba] = SCREEN_BG;
  for (let row = 0; row < view.rows; row++) {
    for (let col = 0; col < view.columns; col++) {
      let code = raw[row * across + col * step]!;
      let invert = false;
      if (view.inverse && code >= 0x80) {
        code &= 0x7f;
        invert = true;
      }
      cellRows(code, table, rows);
      const x0 = col * cellW;
      for (let y = 0; y < h; y++) {
        let bits = rows[y]!;
        if (invert) bits = ~bits & 0xfc;
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
  return true;
}
