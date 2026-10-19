/** "Did you mean …?": the nearest names by edit distance, and a register glued to a mnemonic split off. */
import { forms, mnemonics } from './encode.js';
import { DIRECTIVES, REGISTERS } from './names.js';

/** Three rows reused by every call, so a distance allocates nothing once they are long enough. */
let rows: [Int32Array, Int32Array, Int32Array] = [new Int32Array(32), new Int32Array(32), new Int32Array(32)];

/** Edit distance with adjacent transpositions (LDRI to LDIR is one edit). */
export function distance(a: string, b: string): number {
  const n = b.length;
  if (rows[0].length <= n) rows = [new Int32Array(n + 1), new Int32Array(n + 1), new Int32Array(n + 1)];
  // Rows i-2, i-1, and i of the table, rotated as i grows.
  let [before, prev, cur] = rows;
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, before[j - 2]! + 1);
      cur[j] = v;
    }
    [before, prev, cur] = [prev, cur, before];
  }
  return prev[n]!;
}

/** `a`, `a or b`, `a, b, or c`. */
export function orList(items: readonly string[]): string {
  if (items.length <= 2) return items.join(' or ');
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;
}

/**
 * The candidates nearest `word` (compared in upper case): within one edit for
 * a word of up to three letters, two otherwise; ties go to the closest length;
 * at most three.
 */
export function nearest(word: string, candidates: Iterable<string>): string[] {
  const w = word.toUpperCase();
  const limit = w.length <= 3 ? 1 : 2;
  let best: { name: string; d: number; len: number }[] = [];
  for (const name of candidates) {
    // Each edit changes the length by at most one, so a name further off in length cannot be near.
    if (Math.abs(name.length - w.length) > limit) continue;
    const d = distance(w, name.toUpperCase());
    if (d === 0 || d > limit) continue;
    const len = Math.abs(name.length - w.length);
    const top = best[0];
    if (top === undefined || d < top.d || (d === top.d && len < top.len)) best = [{ name, d, len }];
    else if (d === top.d && len === top.len) best.push({ name, d, len });
  }
  return best.map((b) => b.name).sort().slice(0, 3);
}

const MNEMONICS_LONGEST_FIRST = mnemonics().sort((a, b) => b.length - a.length);

/** For an unknown operation, what it most likely meant: `LD A,…` for LDA, `INC A` for INCA, `JP` for JMP. */
export function suggestOperation(upper: string): string | undefined {
  for (const m of MNEMONICS_LONGEST_FIRST) {
    if (!upper.startsWith(m) || upper.length === m.length) continue;
    const rest = upper.slice(m.length);
    if (!REGISTERS.has(rest)) continue;
    const fs = forms(m);
    if (fs.some((f) => f.startsWith(`${rest},`))) return `${m} ${rest},…`;
    if (fs.includes(rest)) return `${m} ${rest}`;
  }
  const near = nearest(upper, [...mnemonics(), ...DIRECTIVES.filter((d) => d !== '=')]);
  return near.length > 0 ? orList(near) : undefined;
}

/** A table name without the `$` or `@` its source spells it with. */
const core = (name: string): string => name.toUpperCase().replace(/^[$@]/, '');

/**
 * The ROM, hardware, or DOS names nearest `word`, at most three. A name is
 * near when, without its leading `$` or `@`, it is within one edit of the
 * word (two for a word of six letters or more), or it holds the word with one letter changed, added, or
 * dropped (CLSS finds $VDCLS); the first kind ranks above the second, and
 * among the second a closer piece, then the name closest in length to the word, wins.
 */
export function nearestRomName(word: string, names: Iterable<string>): string[] {
  const w = core(word);
  // The tables hold hundreds of names, so a short word gets one edit, not two.
  const limit = w.length <= 5 ? 1 : 2;
  const lengths = w.length >= 4 ? [w.length - 1, w.length, w.length + 1] : [w.length, w.length + 1];
  let best: { name: string; score: number }[] = [];
  for (const name of names) {
    const c = core(name);
    if (c === w && name.toUpperCase() === word.toUpperCase()) continue;
    let score = Math.abs(c.length - w.length) > limit ? Infinity : distance(w, c);
    if (score > limit) {
      score = Infinity;
      // A piece one edit from a word of three letters or more keeps its first or its last letter.
      if (w.length >= 3 && (c.includes(w[0]!) || c.includes(w[w.length - 1]!))) {
        for (const n of lengths) {
          for (let i = 0; i + n <= c.length; i++) {
            // Closer pieces first; ties go to the name closest in length to the word.
            const d = distance(w, c.slice(i, i + n));
            if (d <= 1) score = Math.min(score, limit + 1 + d + Math.abs(c.length - w.length) / 100);
          }
        }
      }
    }
    if (score === Infinity) continue;
    const top = best[0];
    if (top === undefined || score < top.score) best = [{ name, score }];
    else if (score === top.score) best.push({ name, score });
  }
  return best.map((b) => b.name).sort().slice(0, 3);
}
