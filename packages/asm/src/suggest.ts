/** "Did you mean …?": the nearest names by edit distance, and a register glued to a mnemonic split off. */
import { forms, mnemonics } from './encode.js';
import { DIRECTIVES, REGISTERS } from './names.js';

/** Edit distance with adjacent transpositions (LDRI to LDIR is one edit). */
export function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
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
    let score = distance(w, c);
    if (score > limit) {
      score = Infinity;
      if (w.length >= 3) {
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
