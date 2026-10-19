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
