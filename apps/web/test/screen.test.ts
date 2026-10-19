// renderScreen: video RAM into an RGBA buffer, a canvas's ImageData, with no DOM. Each model's own
// character generator (glyphs.generated.ts, from xtrs): 6x12 cells on the Model I, 8x12 on the
// Model III and 4, 8x10 at the Model 4's 80x24; 80H-BFH as 2x3 blocks at the cell's width; the
// Model III/4 alternate set in C0H-FFH when the machine selects it; 32-column doubling; inverse
// video; and renderNotice's text drawn as video RAM would show it.
import { describe, expect, it } from 'vitest';
import { CG_MODEL1, CG_MODEL1_LOWERCASE, CG_MODEL3, CG_MODEL4 } from '../app/utils/emulator/glyphs.generated';
import type { GlyphSet } from '../app/utils/emulator/glyphs.generated';
import { Machine } from '@fugloy/emu';
import { SCREEN_BG, SCREEN_FG, renderNotice, renderScreen, screenSize, screenView, tubeAspect, tubeFit, panelFit, MODEL1_ASPECT, MODEL3_ASPECT } from '../app/utils/emulator/screen';
import type { ScreenView } from '../app/utils/emulator/screen';
import { stubRom } from '../app/utils/emulator/stub-rom';

const M3: ScreenView = { columns: 64, rows: 16, wide: false, inverse: false, font: 'model3', altCharset: false };
const M1: ScreenView = { ...M3, font: 'model1' };
const M1L: ScreenView = { ...M3, font: 'model1-lowercase' };
const M4: ScreenView = { ...M3, font: 'model4' };
const M4WIDE: ScreenView = { columns: 80, rows: 24, wide: true, inverse: true, font: 'model4', altCharset: false };

function render(raw: Uint8Array, view: ScreenView = M3): { out: Uint8ClampedArray; width: number; lit: (x: number, y: number) => boolean } {
  const { width, height } = screenSize(view);
  const out = new Uint8ClampedArray(width * height * 4);
  renderScreen(raw, view, out, width);
  return { out, width, lit: litIn(out, width) };
}

function litIn(out: Uint8ClampedArray, width: number): (x: number, y: number) => boolean {
  return (x, y) => {
    const i = (y * width + x) * 4;
    const px = [out[i], out[i + 1], out[i + 2], out[i + 3]];
    if (px.every((v, k) => v === SCREEN_FG[k])) return true;
    expect(px).toEqual([...SCREEN_BG]);
    return false;
  };
}

const spaces = (n: number): Uint8Array => new Uint8Array(n).fill(0x20);
const glyphBit = (set: GlyphSet, code: number, x: number, y: number): boolean => ((set.rows[code * 12 + y]! << x) & 0x80) !== 0;

/** Expects cell (0,0) to match `set`'s `code` pixel for pixel over a `w`x`h` cell; returns how many lit. */
function expectGlyph(lit: (x: number, y: number) => boolean, set: GlyphSet, code: number, w: number, h = 12, x0 = 0, y0 = 0): number {
  let on = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      expect(lit(x0 + x, y0 + y), `${code.toString(16)} ${x},${y}`).toBe(glyphBit(set, code, x, y));
      if (glyphBit(set, code, x, y)) on++;
    }
  return on;
}

describe('screenView', () => {
  it("reads the machine's layout, inverse video, font, and alternate set through emu's API", () => {
    const m = new Machine({ model: 4, roms: { level2: stubRom(4) } });
    expect(screenView(m)).toEqual({ columns: 64, rows: 16, wide: false, inverse: false, font: 'model4', altCharset: false });
    m.io.out(0x84, 0x0c); // 80x24, inverse video
    expect(screenView(m)).toEqual({ columns: 80, rows: 24, wide: true, inverse: true, font: 'model4', altCharset: false });
    m.io.out(0xec, 0x04 | 0x08); // half width, the alternate set
    expect(screenView(m)).toEqual({ columns: 40, rows: 24, wide: true, inverse: true, font: 'model4', altCharset: true });
    const m3 = new Machine({ roms: { level2: stubRom(3) } });
    expect(screenView(m3)).toEqual(M3);
    m3.io.out(0xec, 0x08);
    expect(screenView(m3).altCharset).toBe(true);
    expect(screenView(new Machine({ model: 1, roms: { level2: stubRom(1) } }))).toEqual(M1);
    expect(screenView(new Machine({ model: 1, lowercase: true, roms: { level2: stubRom(1) } }))).toEqual(M1L);
  });
});

describe('renderScreen', () => {
  it('sizes the screen per model: 6-pixel cells on the Model I, 8 on the III and 4', () => {
    expect(screenSize(M1)).toEqual({ width: 384, height: 192 });
    expect(screenSize(M1L)).toEqual({ width: 384, height: 192 });
    expect(screenSize(M3)).toEqual({ width: 512, height: 192 });
    expect(screenSize({ ...M3, columns: 32 })).toEqual({ width: 512, height: 192 });
    expect(screenSize(M4)).toEqual({ width: 512, height: 192 });
    expect(screenSize(M4WIDE)).toEqual({ width: 640, height: 240 });
  });

  it("draws 'A' from each model's own generator", () => {
    const raw = spaces(1024);
    raw[0] = 0x41;
    const m3 = render(raw, M3);
    expect(expectGlyph(m3.lit, CG_MODEL3, 0x41, 8)).toBeGreaterThan(8);
    for (let y = 0; y < 12; y++) for (let x = 8; x < 16; x++) expect(m3.lit(x, y)).toBe(false);
    const m1 = render(raw, M1);
    expect(expectGlyph(m1.lit, CG_MODEL1, 0x41, 6)).toBeGreaterThan(8);
    for (let y = 0; y < 12; y++) for (let x = 6; x < 12; x++) expect(m1.lit(x, y)).toBe(false);
    expect(expectGlyph(render(raw, M4).lit, CG_MODEL4, 0x41, 8)).toBeGreaterThan(8);
    // The sets differ: the Model III's 'A' starts at the top, the Model 4's a row down.
    expect(m3.lit(3, 0) || m3.lit(4, 0)).toBe(true);
  });

  it("draws lowercase 'a' from the lowercase kit's generator on a Model I with the kit", () => {
    const raw = spaces(1024);
    raw[0] = 0x61;
    expect(expectGlyph(render(raw, M1L).lit, CG_MODEL1_LOWERCASE, 0x61, 6)).toBeGreaterThan(4);
    expect(expectGlyph(render(raw, M1).lit, CG_MODEL1, 0x61, 6)).toBeGreaterThan(4);
  });

  it('folds 00H-1FH to 40H-5FH, as the character generator does', () => {
    for (const view of [M1, M3]) {
      const a = spaces(1024);
      const b = spaces(1024);
      a[0] = 0x01;
      b[0] = 0x41;
      expect(render(a, view).out).toEqual(render(b, view).out);
    }
  });

  it("draws 7FH as the generator's own glyph", () => {
    const raw = spaces(1024);
    raw[0] = 0x7f;
    expectGlyph(render(raw, M3).lit, CG_MODEL3, 0x7f, 8);
    expectGlyph(render(raw, M1).lit, CG_MODEL1, 0x7f, 6);
  });

  it('draws 0BFH as a full cell and 81H as the top-left block only, at both widths', () => {
    const raw = spaces(1024);
    raw[0] = 0xbf;
    raw[1] = 0x81;
    for (const [view, w] of [[M3, 8], [M1, 6]] as const) {
      const { lit } = render(raw, view);
      for (let y = 0; y < 12; y++)
        for (let x = 0; x < w; x++) {
          expect(lit(x, y), `BF ${w} ${x},${y}`).toBe(true);
          expect(lit(w + x, y), `81 ${w} ${x},${y}`).toBe(x < w / 2 && y < 4);
        }
    }
  });

  it('draws C0H-FFH as blocks, or on the Model III/4 as the alternate set when the machine selects it', () => {
    const block = spaces(1024);
    const alt = spaces(1024);
    block[0] = 0x80;
    alt[0] = 0xc0; // low six bits 0: an empty block
    expect(render(alt, M3).out).toEqual(render(block, M3).out);
    expect(render(alt, M1).out).toEqual(render(block, M1).out);
    expect(render(alt, { ...M1, altCharset: true }).out).toEqual(render(block, M1).out);
    const c5 = spaces(1024);
    const b85 = spaces(1024);
    c5[0] = 0xc5;
    b85[0] = 0x85;
    expect(render(c5, M3).out).toEqual(render(b85, M3).out);
    expect(expectGlyph(render(alt, { ...M3, altCharset: true }).lit, CG_MODEL3, 0xc0, 8)).toBeGreaterThan(4);
    expectGlyph(render(alt, { ...M4, altCharset: true }).lit, CG_MODEL4, 0xc0, 8);
  });

  it('doubles each even-address byte across two cells in 32-column mode', () => {
    const raw = spaces(1024);
    raw[0] = 0x41;
    raw[1] = 0xbf; // odd bytes are not shown
    raw[2] = 0x81;
    for (const [view, w, set] of [[M3, 8, CG_MODEL3], [M1, 6, CG_MODEL1]] as const) {
      const { lit } = render(raw, { ...view, columns: 32 });
      for (let y = 0; y < 12; y++)
        for (let x = 0; x < 2 * w; x++) {
          expect(lit(x, y), `A ${x},${y}`).toBe(glyphBit(set, 0x41, x >> 1, y));
          expect(lit(2 * w + x, y), `81 ${x},${y}`).toBe(x < w && y < 4);
        }
    }
  });

  it("draws 80x24 in 8x10 cells from the Model 4's first ten rows, and inverse video inverts a byte with bit 7 set", () => {
    const raw = spaces(2048);
    raw[79] = 0x41; // the end of the first row
    raw[80] = 0x80 | 0x41; // row 1, column 0: 'A' inverted
    const { lit } = render(raw, M4WIDE);
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 8; x++) {
        expect(lit(79 * 8 + x, y)).toBe(glyphBit(CG_MODEL4, 0x41, x, y));
        expect(lit(x, 10 + y)).toBe(!glyphBit(CG_MODEL4, 0x41, x, y));
      }
    // Without inverse video the same byte is a graphics block (81H's: top-left, bands 0-2 of 10).
    const plain = render(raw, { ...M4WIDE, inverse: false });
    expect(plain.lit(0, 10)).toBe(true);
    expect(plain.lit(3, 12)).toBe(true);
    expect(plain.lit(4, 10)).toBe(false);
    expect(plain.lit(0, 13)).toBe(false);
  });

  it('returns false when nothing changed since the last call into the same buffer', () => {
    const raw = spaces(1024);
    const { width, height } = screenSize(M3);
    const out = new Uint8ClampedArray(width * height * 4);
    expect(renderScreen(raw, M3, out, width)).toBe(true);
    expect(renderScreen(raw, M3, out, width)).toBe(false);
    raw[5] = 0x42;
    expect(renderScreen(raw, M3, out, width)).toBe(true);
    expect(renderScreen(raw, M3, out, width)).toBe(false);
    expect(renderScreen(raw, { ...M3, columns: 32 }, out, width)).toBe(true);
    expect(renderScreen(raw, { ...M3, columns: 32 }, out, width)).toBe(false);
    expect(renderScreen(raw, { ...M3, columns: 32, altCharset: true }, out, width)).toBe(true);
    expect(renderScreen(raw, { ...M4, columns: 32, altCharset: true }, out, width)).toBe(true);
  });
});

describe('renderNotice', () => {
  it('draws text lines as video RAM would show them', () => {
    const { width, height } = screenSize(M3);
    const out = new Uint8ClampedArray(width * height * 4);
    renderNotice(['NO ROM'], M3, out, width);
    const raw = spaces(1024);
    raw.set([...'NO ROM'].map((c) => c.charCodeAt(0)));
    expect(out).toEqual(render(raw, M3).out);
    const lit = litIn(out, width);
    expectGlyph(lit, CG_MODEL3, 0x4e, 8);
    expectGlyph(lit, CG_MODEL3, 0x4d, 8, 12, 5 * 8);
    // The rest of the screen is dark.
    for (let y = 12; y < height; y++) for (let x = 0; x < width; x++) expect(lit(x, y)).toBe(false);
  });

  it('draws a second line on the second row, and leaves the next renderScreen to draw', () => {
    const { width, height } = screenSize(M1);
    const out = new Uint8ClampedArray(width * height * 4);
    renderNotice(['A', 'B'], M1, out, width);
    const lit = litIn(out, width);
    expectGlyph(lit, CG_MODEL1, 0x41, 6);
    expectGlyph(lit, CG_MODEL1, 0x42, 6, 12, 0, 12);
    const raw = spaces(1024);
    raw[0] = 0x41;
    raw[64] = 0x42;
    expect(renderScreen(raw, M1, out, width)).toBe(true);
  });
});

describe('tubeAspect', () => {
  it('is 4:3 on the Model III and 4, and on the Model I narrower by its dot clock: (4/3) x (384 / 10.6445 MHz) / (512 / 10.1376 MHz)', () => {
    expect(MODEL1_ASPECT).toBe((4 / 3) * (384 / 10.6445e6) / (512 / 10.1376e6));
    expect(MODEL1_ASPECT).toBeGreaterThan(0.95);
    expect(MODEL1_ASPECT).toBeLessThan(0.955);
    expect(MODEL3_ASPECT).toBe(4 / 3);
    expect(tubeAspect('model1')).toBe(MODEL1_ASPECT);
    expect(tubeAspect('model1-lowercase')).toBe(MODEL1_ASPECT);
    expect(tubeAspect('model3')).toBe(4 / 3);
    expect(tubeAspect('model4')).toBe(4 / 3);
  });
});

describe('tubeFit', () => {
  it('picks the largest tube at the aspect whose height is a whole multiple of the raster rows', () => {
    // Model III/4 (512x192) in 800 across: k=3, 768x576, three screen pixels per row.
    expect(tubeFit(screenSize(M3).height, 4 / 3, 800)).toEqual({ width: 768, height: 576 });
    // Model I (384x192) in 800x600: k=3 by height, narrower across.
    const m1 = tubeFit(screenSize(M1).height, MODEL1_ASPECT, 800, 600);
    expect(m1.height).toBe(576);
    expect(m1.width).toBe(576 * MODEL1_ASPECT);
    // Model 4 80x24 (640x240): steps of 320 across.
    expect(tubeFit(screenSize(M4WIDE).height, 4 / 3, 1000)).toEqual({ width: 960, height: 720 });
  });

  it('is bound by the height when the space is wider than the aspect (a full screen shorter than wide)', () => {
    const fit = tubeFit(192, 4 / 3, 2000, 500);
    expect(fit.height).toBe(384);
    expect(fit.width).toBe(512);
  });

  it('shows the tube at the space and the aspect when not even one whole row step fits (a phone-width panel)', () => {
    expect(tubeFit(192, 4 / 3, 200)).toEqual({ width: 200, height: 150 });
    const fit = tubeFit(192, MODEL1_ASPECT, 150, 100);
    expect(fit.height).toBeCloseTo(100, 10);
    expect(fit.width).toBeCloseTo(100 * MODEL1_ASPECT, 10);
    expect(fit.width).toBeLessThanOrEqual(150);
  });
});

describe('panelFit', () => {
  it('gives every model the Model III height for the width, so the Model I is narrower, never taller', () => {
    expect(panelFit(192, MODEL3_ASPECT, 800)).toEqual({ width: 768, height: 576 });
    const m1 = panelFit(192, MODEL1_ASPECT, 800);
    expect(m1.height).toBe(576);
    expect(m1.width).toBe(576 * MODEL1_ASPECT);
    // Where tubeFit alone would give the Model I a taller tube (600 wide: k=3 for it, k=2 for the III).
    expect(tubeFit(192, MODEL1_ASPECT, 600).height).toBe(576);
    expect(panelFit(192, MODEL1_ASPECT, 600)).toEqual({ width: 384 * MODEL1_ASPECT, height: 384 });
    // The Model 4's 80x24 is unchanged.
    expect(panelFit(240, MODEL3_ASPECT, 1000)).toEqual({ width: 960, height: 720 });
    // Narrower than one step: the Model III's height at the host's width, the Model I narrower.
    expect(panelFit(192, MODEL3_ASPECT, 200)).toEqual({ width: 200, height: 150 });
    const narrow = panelFit(192, MODEL1_ASPECT, 200);
    expect(narrow.height).toBeCloseTo(150, 10);
    expect(narrow.width).toBeCloseTo(150 * MODEL1_ASPECT, 10);
  });
});
