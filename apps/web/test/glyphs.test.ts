// Glyph provenance (Review Focus 5): the screen's characters come from X.Org's public-domain
// font-misc-misc, converted once by scripts/build-glyphs.ts. The converter refuses a BDF whose
// header does not say it is public domain, and the generated table names its source and hash.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { convertBdf } from '../scripts/build-glyphs';
import { GLYPHS_6X10, GLYPHS_6X12, GLYPH_SOURCES } from '../app/utils/emulator/glyphs.generated';

/** A tiny BDF with one glyph ('A', a 2-pixel bar on the top row of its box). */
const bdf = (copyright: string | null): string =>
  [
    'STARTFONT 2.1',
    'COMMENT a test font',
    'FONTBOUNDINGBOX 6 12 0 -2',
    'STARTPROPERTIES 3',
    'FONT_ASCENT 10',
    'FONT_DESCENT 2',
    ...(copyright === null ? [] : [`COPYRIGHT "${copyright}"`]),
    'ENDPROPERTIES',
    'CHARS 1',
    'STARTCHAR A',
    'ENCODING 65',
    'SWIDTH 0 0',
    'DWIDTH 6 0',
    'BBX 3 2 1 0',
    'BITMAP',
    'C0',
    '20',
    'ENDCHAR',
    'ENDFONT',
  ].join('\n');

describe('the glyph converter', () => {
  it('refuses a BDF without the public-domain statement', () => {
    expect(() => convertBdf(bdf(null), { width: 6, height: 12, first: 0x41, last: 0x41 })).toThrow(/public domain/i);
    expect(() => convertBdf(bdf('Copyright 1999 Somebody'), { width: 6, height: 12, first: 0x41, last: 0x41 })).toThrow(/public domain/i);
  });

  it('places each glyph in its cell from the baseline', () => {
    const rows = convertBdf(bdf('Public domain font.  Share and enjoy.'), { width: 6, height: 12, first: 0x41, last: 0x41 });
    // BBX 3x2 at x 1, y 0: its two rows sit just above the baseline, which is 10 rows down.
    expect([...rows]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0b0110_0000, 0b0001_0000, 0, 0]);
  });

  it('the generated table names its source and hash, and covers 20H-7EH', () => {
    const text = readFileSync(new URL('../app/utils/emulator/glyphs.generated.ts', import.meta.url), 'utf8');
    for (const s of GLYPH_SOURCES) {
      expect(s.url).toMatch(/^https:\/\/gitlab\.freedesktop\.org\/xorg\/font\/misc-misc\/-\/raw\/[0-9a-f]{40}\/6x1[02]\.bdf$/);
      expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(s.statement).toMatch(/public domain/i);
      expect(text.slice(0, text.indexOf('export'))).toContain(s.url);
      expect(text.slice(0, text.indexOf('export'))).toContain(s.sha256);
    }
    expect(GLYPH_SOURCES.map((s) => s.file)).toEqual(['6x12.bdf', '6x10.bdf']);
    expect(GLYPHS_6X12.rows.length).toBe((0x7e - 0x20 + 1) * 12);
    expect(GLYPHS_6X10.rows.length).toBe((0x7e - 0x20 + 1) * 10);
    // A space is empty, and 'A' is not.
    expect(GLYPHS_6X12.rows.slice(0, 12).every((b) => b === 0)).toBe(true);
    expect(GLYPHS_6X12.rows.slice((0x41 - 0x20) * 12, (0x42 - 0x20) * 12).some((b) => b !== 0)).toBe(true);
  });
});
