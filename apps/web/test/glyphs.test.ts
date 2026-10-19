// Glyph provenance: the screen's characters are the TRS-80's own character generators, from xtrs's
// trs_chars.c at a pinned commit, converted once by scripts/build-glyphs.ts. The converter checks
// the file's SHA-256 and the licence's notice; the generated table names its source and carries
// the notice.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildTable, parseTrsChars, toGlyphSet } from '../scripts/build-glyphs';
import { CG_MODEL1, CG_MODEL1_LOWERCASE, CG_MODEL3, CG_MODEL4, GLYPH_SOURCE } from '../app/utils/emulator/glyphs.generated';
import type { GlyphSet } from '../app/utils/emulator/glyphs.generated';

/** Two charsets in trs_chars.c's syntax: two characters, then one. */
const SNIPPET = `
/* a header comment */
char trs_char_data[][MAXCHARS][TRS_CHAR_HEIGHT] = {
{
  /* CG 0 - a test set */
  { 0x00,0x1f,0x11,0x11,0x11,0x11,0x11,0x1f,0x00,0x00,0x00,0x00 },
  { 0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08,0x09,0x0a,0x0b,0x0c },
},
{
  /* CG 1 - another,
     over two lines { 0x99 } */
  { 0xff,0x80,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x7e }
}
};
`;

const cell = (set: GlyphSet, code: number): number[] => [...set.rows.subarray(code * 12, code * 12 + 12)];
const empty = (set: GlyphSet, code: number): boolean => cell(set, code).every((b) => b === 0);

describe('the glyph converter', () => {
  it("parses trs_chars.c's charsets, skipping comments", () => {
    expect(parseTrsChars(SNIPPET)).toEqual([
      [
        [0x00, 0x1f, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1f, 0, 0, 0, 0],
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      ],
      [[0xff, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x7e]],
    ]);
  });

  it('reverses each row so bit 7 is the leftmost pixel, at both widths, and pads to 256 characters', () => {
    const raw = [[0x01, 0x80, 0x0f, 0, 0, 0, 0, 0, 0, 0, 0, 0]];
    const eight = toGlyphSet(raw, 8);
    expect(eight.width).toBe(8);
    expect(eight.height).toBe(12);
    expect(eight.rows.length).toBe(256 * 12);
    expect(cell(eight, 0).slice(0, 3)).toEqual([0x80, 0x01, 0xf0]);
    const six = toGlyphSet([[0x01, 0x20, 0x1f, 0, 0, 0, 0, 0, 0, 0, 0, 0]], 6);
    expect(six.width).toBe(6);
    // Bit 0 (leftmost) goes to bit 7; bit 5 (the field's rightmost) to bit 2.
    expect(cell(six, 0).slice(0, 3)).toEqual([0x80, 0x04, 0xf8]);
    expect(empty(six, 1)).toBe(true);
    expect(six.rows.slice(12).every((b) => b === 0)).toBe(true);
  });

  it('refuses a row with pixels outside a 6-wide cell', () => {
    expect(() => toGlyphSet([[0x40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], 6)).toThrow(/6/);
  });
});

describe('the converter refuses', () => {
  const chars = new TextEncoder().encode(SNIPPET);
  it("a LICENSE without Timothy P. Mann's notice", () => {
    expect(() => buildTable(chars, new TextEncoder().encode('Copyright (C) 1992 Clarendon Hill Software.\n'))).toThrow(/Timothy P\. Mann/);
  });
  it('a trs_chars.c that is not the pinned file', () => {
    expect(() => buildTable(chars, new TextEncoder().encode('Copyright (c) 1996-2020, Timothy P. Mann\n'))).toThrow(/SHA-256/);
  });
});

describe('the generated table', () => {
  it('names its source, pinned commit, and the xtrs CG of each set, and carries the licence notice', () => {
    expect(GLYPH_SOURCE.commit).toBe('3a2180c063811a715faa28d39a94739c33e0abd0');
    expect(GLYPH_SOURCE.url).toBe('https://raw.githubusercontent.com/TimothyPMann/xtrs/3a2180c063811a715faa28d39a94739c33e0abd0/trs_chars.c');
    expect(GLYPH_SOURCE.sha256).toBe('1b8bbb9d63a8d598e58f64e831fc11a08f61a82e5c2eb0f631e5cc7be1464166');
    expect(GLYPH_SOURCE.sets).toEqual({ model1: 1, model1Lowercase: 2, model3: 4, model4: 8 });
    const text = readFileSync(new URL('../app/utils/emulator/glyphs.generated.ts', import.meta.url), 'utf8');
    const header = text.slice(0, text.indexOf('export'));
    expect(header).toContain('Copyright (C) 1992 Clarendon Hill Software.');
    expect(header).toContain('Copyright (c) 1996-2020, Timothy P. Mann');
    expect(header).toContain(GLYPH_SOURCE.url);
  });

  it('holds four sets of 256 characters, 12 rows each, at their widths', () => {
    for (const set of [CG_MODEL1, CG_MODEL1_LOWERCASE]) expect(set.width).toBe(6);
    for (const set of [CG_MODEL3, CG_MODEL4]) expect(set.width).toBe(8);
    for (const set of [CG_MODEL1, CG_MODEL1_LOWERCASE, CG_MODEL3, CG_MODEL4]) {
      expect(set.height).toBe(12);
      expect(set.rows.length).toBe(256 * 12);
    }
  });

  it('pins the right sets by their shapes', () => {
    // Model III letters start at the cell's top; the Model 4's one row down.
    expect(empty(CG_MODEL3, 0x41)).toBe(false);
    expect(cell(CG_MODEL3, 0x41)[0]).not.toBe(0);
    expect(cell(CG_MODEL4, 0x41)[0]).toBe(0);
    expect(empty(CG_MODEL4, 0x41)).toBe(false);
    expect(empty(CG_MODEL1, 0x41)).toBe(false);
    // The Model I generators hold 128 characters; 80H-FFH are drawn as blocks.
    for (let c = 0x80; c < 0x100; c++) {
      expect(empty(CG_MODEL1, c), c.toString(16)).toBe(true);
      expect(empty(CG_MODEL1_LOWERCASE, c), c.toString(16)).toBe(true);
    }
    // The Model III's alternate set (katakana) is in C0H-FFH.
    expect(empty(CG_MODEL3, 0xc0)).toBe(false);
    // Orientation: the Model I 'L' is the column at x 0 with a 5-pixel foot; the Model III's at x 1, 6 wide.
    expect(cell(CG_MODEL1, 0x4c).slice(1, 8)).toEqual([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0xf8]);
    expect(cell(CG_MODEL3, 0x4c).slice(0, 7)).toEqual([0x40, 0x40, 0x40, 0x40, 0x40, 0x40, 0x7e]);
    // The lowercase kit moves letters without descenders up a row: its 'A' starts at the top.
    expect(cell(CG_MODEL1_LOWERCASE, 0x41)[0]).not.toBe(0);
    expect(cell(CG_MODEL1, 0x41)[0]).toBe(0);
    expect(empty(CG_MODEL1_LOWERCASE, 0x61)).toBe(false);
  });
});
