/**
 * The TRS-80 character set as data the web draws a data region's picture
 * with: $20-$7F as text characters, $80-$BF as the 2x3 block graphics (bit i
 * lights sub-cell i, row-major from the top left), anything else as a dim dot.
 * On the Model I and III, $5B-$5E show as arrows where ASCII has [ \ ] ^.
 */

/** What one byte draws as. */
export type Glyph = { kind: 'text'; char: string } | { kind: 'block'; cells: boolean[] } | { kind: 'other' };

/** The arrows the Model I and III character generators show at $5B-$5E. */
const ARROWS: Record<number, string> = { 0x5b: '↑', 0x5c: '↓', 0x5d: '←', 0x5e: '→' };

/** 2×3 block cell for $80–$BF: bit i set → sub-cell i lit (row-major, top-left first). Six cells. */
export function blockCells(byte: number): boolean[] {
  const bits = byte & 0x3f;
  return Array.from({ length: 6 }, (_, i) => ((bits >> i) & 1) === 1);
}

/** What `byte` draws as in the picture. */
export function trsGlyph(byte: number): Glyph {
  const b = byte & 0xff;
  if (b >= 0x20 && b <= 0x7f) return { kind: 'text', char: ARROWS[b] ?? String.fromCharCode(b) };
  if (b >= 0x80 && b <= 0xbf) return { kind: 'block', cells: blockCells(b) };
  return { kind: 'other' };
}
