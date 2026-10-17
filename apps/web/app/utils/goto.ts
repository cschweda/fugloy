/**
 * The G box: an address in any form `parseNumber` takes, or a program label's name,
 * or else bare hex with a letter in it (`4B9E`). All digits stay decimal, and a label
 * spelled like hex (`CAFE`) wins over the address.
 */
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
  if (sym !== undefined) return { ok: true, addr: sym.addr };
  if (/^[0-9a-f]+$/i.test(t)) {
    const hex = parseInt(t, 16);
    return hex <= 0xffff ? { ok: true, addr: hex } : { ok: false, reason: `${t} is past $FFFF.` };
  }
  return { ok: false, reason: `No address or label ${t}.` };
}
