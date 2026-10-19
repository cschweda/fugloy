// renderScreen: video RAM into an RGBA buffer, a canvas's ImageData, with no DOM. Characters
// 20H-7EH from the generated glyph table, 80H-BFH (and C0H-FFH) as 2x3 blocks, 32-column
// doubling, and the Model 4's 80x24 with inverse video.
import { describe, expect, it } from 'vitest';
import { GLYPHS_6X10, GLYPHS_6X12 } from '../app/utils/emulator/glyphs.generated';
import { Machine } from '@fugloy/emu';
import { SCREEN_BG, SCREEN_FG, renderScreen, screenSize, screenView } from '../app/utils/emulator/screen';
import { stubRom } from '../app/utils/emulator/stub-rom';

const NARROW = { columns: 64, rows: 16, wide: false, inverse: false };

function render(raw: Uint8Array, view = NARROW): { out: Uint8ClampedArray; width: number; lit: (x: number, y: number) => boolean } {
  const { width, height } = screenSize(view);
  const out = new Uint8ClampedArray(width * height * 4);
  renderScreen(raw, view, out, width);
  const lit = (x: number, y: number): boolean => {
    const i = (y * width + x) * 4;
    const px = [out[i], out[i + 1], out[i + 2], out[i + 3]];
    if (px.every((v, k) => v === SCREEN_FG[k])) return true;
    expect(px).toEqual([...SCREEN_BG]);
    return false;
  };
  return { out, width, lit };
}

const spaces = (n: number): Uint8Array => new Uint8Array(n).fill(0x20);
const glyphBit = (rows: Uint8Array, h: number, code: number, x: number, y: number): boolean => ((rows[(code - 0x20) * h + y]! << x) & 0x80) !== 0;

describe('screenView', () => {
  it("reads the machine's layout and inverse video through emu's video API", () => {
    const m = new Machine({ model: 4, roms: { level2: stubRom(4) } });
    expect(screenView(m)).toEqual({ columns: 64, rows: 16, wide: false, inverse: false });
    m.io.out(0x84, 0x0c); // 80x24, inverse video
    expect(screenView(m)).toEqual({ columns: 80, rows: 24, wide: true, inverse: true });
    m.io.out(0xec, 0x04); // half width
    expect(screenView(m)).toEqual({ columns: 40, rows: 24, wide: true, inverse: true });
    const m3 = new Machine({ roms: { level2: stubRom(3) } });
    expect(screenView(m3)).toEqual({ columns: 64, rows: 16, wide: false, inverse: false });
  });
});

describe('renderScreen', () => {
  it('sizes the screen: 384x192 for 64x16, 480x240 for 80x24', () => {
    expect(screenSize(NARROW)).toEqual({ width: 384, height: 192 });
    expect(screenSize({ columns: 32, rows: 16, wide: false, inverse: false })).toEqual({ width: 384, height: 192 });
    expect(screenSize({ columns: 80, rows: 24, wide: true, inverse: true })).toEqual({ width: 480, height: 240 });
  });

  it("draws 'A' from the glyph table", () => {
    const raw = spaces(1024);
    raw[0] = 0x41;
    const { lit } = render(raw);
    let on = 0;
    for (let y = 0; y < 12; y++)
      for (let x = 0; x < 6; x++) {
        expect(lit(x, y), `${x},${y}`).toBe(glyphBit(GLYPHS_6X12.rows, 12, 0x41, x, y));
        if (lit(x, y)) on++;
      }
    expect(on).toBeGreaterThan(8);
    // The next cell is a space.
    for (let y = 0; y < 12; y++) for (let x = 6; x < 12; x++) expect(lit(x, y)).toBe(false);
  });

  it('folds 00H-1FH to 40H-5FH, as the character generator does', () => {
    const a = spaces(1024);
    const b = spaces(1024);
    a[0] = 0x01;
    b[0] = 0x41;
    expect(render(a).out).toEqual(render(b).out);
  });

  it('draws 0BFH as a full cell and 81H as the top-left block only', () => {
    const raw = spaces(1024);
    raw[0] = 0xbf;
    raw[1] = 0x81;
    const { lit } = render(raw);
    for (let y = 0; y < 12; y++)
      for (let x = 0; x < 6; x++) {
        expect(lit(x, y), `BF ${x},${y}`).toBe(true);
        expect(lit(6 + x, y), `81 ${x},${y}`).toBe(x < 3 && y < 4);
      }
  });

  it('draws C0H-FFH as the block of the low six bits', () => {
    const a = spaces(1024);
    const b = spaces(1024);
    a[0] = 0xc5;
    b[0] = 0x85;
    expect(render(a).out).toEqual(render(b).out);
  });

  it('doubles each even-address byte across two cells in 32-column mode', () => {
    const raw = spaces(1024);
    raw[0] = 0x41;
    raw[1] = 0xbf; // odd bytes are not shown
    raw[2] = 0x81;
    const { lit } = render(raw, { columns: 32, rows: 16, wide: false, inverse: false });
    for (let y = 0; y < 12; y++)
      for (let x = 0; x < 12; x++) {
        expect(lit(x, y), `A ${x},${y}`).toBe(glyphBit(GLYPHS_6X12.rows, 12, 0x41, x >> 1, y));
        expect(lit(12 + x, y), `81 ${x},${y}`).toBe(x < 6 && y < 4);
      }
  });

  it('draws 80x24 with the 6x10 glyphs, and inverse video inverts a byte with bit 7 set', () => {
    const view = { columns: 80, rows: 24, wide: true, inverse: true };
    const raw = spaces(2048);
    raw[79] = 0x41; // the end of the first row
    raw[80] = 0x80 | 0x41; // row 1, column 0: 'A' inverted
    const { lit } = render(raw, view);
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 6; x++) {
        expect(lit(79 * 6 + x, y)).toBe(glyphBit(GLYPHS_6X10.rows, 10, 0x41, x, y));
        expect(lit(x, 10 + y)).toBe(!glyphBit(GLYPHS_6X10.rows, 10, 0x41, x, y));
      }
    // Without inverse video the same byte is a graphics block (81H's: top-left).
    const plain = render(raw, { ...view, inverse: false });
    expect(plain.lit(0, 10)).toBe(true);
    expect(plain.lit(5, 19)).toBe(false);
  });

  it('returns false when nothing changed since the last call into the same buffer', () => {
    const raw = spaces(1024);
    const { width, height } = screenSize(NARROW);
    const out = new Uint8ClampedArray(width * height * 4);
    expect(renderScreen(raw, NARROW, out, width)).toBe(true);
    expect(renderScreen(raw, NARROW, out, width)).toBe(false);
    raw[5] = 0x42;
    expect(renderScreen(raw, NARROW, out, width)).toBe(true);
    expect(renderScreen(raw, NARROW, out, width)).toBe(false);
    expect(renderScreen(raw, { ...NARROW, columns: 32 }, out, width)).toBe(true);
  });
});
