// The screen as text (phase 5C Ruling 13), DOM-free, for the screen-reader mirror under the
// TRS-80 screen. Graphics bytes read as spaces, trailing spaces are trimmed (a blank row is ''),
// 00H-1FH fold to 40H-5FH as the character generator folds them, 7FH reads as a space, Model 4
// inverse video reads as its character, and 32- and 40-column modes read every other byte.
import type { ScreenView } from './screen';

/** The most changed rows read out one by one; more are summarised. */
export const SPOKEN_ROWS = 3;

function charOf(b: number, inverse: boolean): string {
  if (b >= 0x80) {
    if (!inverse) return ' ';
    b &= 0x7f;
  }
  if (b < 0x20) b += 0x40;
  return b === 0x7f ? ' ' : String.fromCharCode(b);
}

/** Each row of video RAM `raw` as shown in `view`, as text. */
export function screenRows(raw: Uint8Array, view: Pick<ScreenView, 'columns' | 'rows' | 'wide' | 'inverse'>): string[] {
  const across = view.wide ? 80 : 64;
  const stride = view.columns < across ? 2 : 1;
  const rows: string[] = [];
  for (let y = 0; y < view.rows; y++) {
    let s = '';
    for (let x = 0; x < across; x += stride) s += charOf(raw[y * across + x] ?? 0x20, view.inverse);
    rows.push(s.trimEnd());
  }
  return rows;
}

/** The indexes (from 0) of the rows that differ between `a` and `b`. */
export function changedRows(a: readonly string[], b: readonly string[]): number[] {
  const out: number[] = [];
  for (let k = 0; k < Math.max(a.length, b.length); k++) if (a[k] !== b[k]) out.push(k);
  return out;
}

/** What "Speak screen changes" says for `changed` rows of `rows`, or null for none. */
export function screenAnnouncement(rows: readonly string[], changed: readonly number[]): string | null {
  if (changed.length === 0) return null;
  if (changed.length > SPOKEN_ROWS) return `The screen changed (${changed.length} rows).`;
  return changed.map((k) => `Row ${k + 1}: ${rows[k] || 'blank'}.`).join(' ');
}
