// @fugloy/runtime is plain JavaScript with JSDoc types and no declarations of its own. These are the
// parts the site and its tests use: its screen entry (packages/runtime/src/screen.js, whose JSDoc
// they follow, and glyphs.generated.js); add to them as the site needs more. Only utils/emulator/
// and the tests import it.
declare module '@fugloy/runtime/screen' {
  export type ScreenFont = 'model1' | 'model1-lowercase' | 'model3' | 'model4';

  export interface ScreenView {
    /** Characters across: 64 or 32, or on a Model 4 in 80-column mode 80 or 40. */
    columns: number;
    /** 16, or 24 in 80-column mode. */
    rows: number;
    /** The 80-column layout: rows of 80 bytes in video RAM, and 8x10 cells. */
    wide: boolean;
    /** Model 4 inverse video (port $84 bit 3). */
    inverse: boolean;
    /** Which character generator the machine has. */
    font: ScreenFont;
    /** The Model III/4 alternate set in C0H-FFH (port $EC bit 3); always false on the Model I. */
    altCharset: boolean;
  }

  export interface GlyphSet {
    readonly width: 6 | 8;
    readonly height: 12;
    /** 256 characters x 12 bytes, one per pixel row, the leftmost pixel in bit 7. */
    readonly rows: Uint8Array;
  }

  export const CG_MODEL1: GlyphSet;
  export const CG_MODEL1_LOWERCASE: GlyphSet;
  export const CG_MODEL3: GlyphSet;
  export const CG_MODEL4: GlyphSet;

  /** The phosphor and the tube, as RGBA. */
  export const SCREEN_FG: readonly [number, number, number, number];
  export const SCREEN_BG: readonly [number, number, number, number];

  /** The buffer size for a view, in pixels. */
  export function screenSize(view: ScreenView): { width: number; height: number };
  /** The Model III's and 4's picture, width / height. */
  export const MODEL3_ASPECT: number;
  /** The Model I's picture, width / height: about 0.952. */
  export const MODEL1_ASPECT: number;
  /** The picture's width / height for a character generator's machine. */
  export function tubeAspect(font: ScreenFont): number;
  /** The tube's size in CSS pixels for a raster `rasterHeight` rows high, at `aspect`, in a space `availWidth` x `availHeight`. */
  export function tubeFit(rasterHeight: number, aspect: number, availWidth: number, availHeight?: number): { width: number; height: number };
  /** The tube in a panel `availWidth` wide for a raster `rasterWidth` x `rasterHeight` dots. */
  export function panelFit(rasterHeight: number, rasterWidth: number, aspect: number, availWidth: number): { width: number; height: number };
  /**
   * Draws video RAM `raw` as `view` into `out`, an RGBA buffer `width` pixels across. Returns false,
   * drawing nothing, when neither the bytes nor the view changed since the last call with the same buffer.
   */
  export function renderScreen(raw: Uint8Array, view: ScreenView, out: Uint8ClampedArray, width: number): boolean;
  /** Draws `lines` of text into `out` as video RAM holding them would show: the no-ROM notice. */
  export function renderNotice(lines: readonly string[], view: ScreenView, out: Uint8ClampedArray, width: number): void;
}
