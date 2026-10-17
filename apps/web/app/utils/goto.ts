/** The G box: an address in any form `parseNumber` takes, or a program label's name. */
import { parseNumber } from '@fugloy/disasm';
import type { Analysis } from '@fugloy/disasm';

export type GoTo = { ok: true; addr: number } | { ok: false; reason: string };

export function resolveGoTo(analysis: Analysis, input: string): GoTo {
  const t = input.trim();
  if (t === '') return { ok: false, reason: 'Type an address or a label.' };
  const n = parseNumber(t);
  if (n !== null) return n <= 0xffff ? { ok: true, addr: n } : { ok: false, reason: `${t} is past $FFFF.` };
  const lower = t.toLowerCase();
  const sym = analysis.symbols.list().find((s) => s.name.toLowerCase() === lower);
  return sym === undefined ? { ok: false, reason: `No address or label ${t}.` } : { ok: true, addr: sym.addr };
}
