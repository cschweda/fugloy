/**
 * The G box (UI input only; the hint file keeps `parseNumber`'s rules):
 * 1. an explicit address: `$4B9E`, `0x4B9E`, or `4B9EH`;
 * 2. else a program label's name, ignoring case, so a label spelled like hex (`CAFE`) wins;
 * 3. else bare hex of one to four digits: `4000` is $4000, `B` is $000B;
 * 4. decimal only with a `#`: `#19358` is $4B9E.
 * Anything past $FFFF is refused, and an unknown token says so.
 */
import type { Analysis } from '@fugloy/disasm';

export type GoTo = { ok: true; addr: number } | { ok: false; reason: string };

/** What the G box accepts, for its placeholder and error text. */
export const GOTO_HELP = '$4B9E, 4B9E, #19358 (decimal), or a label';
/** The G box's placeholder: hex is the default, decimal takes a #. */
export const GOTO_PLACEHOLDER = '4B9E, #19358, or a label';

const at = (t: string, n: number): GoTo => (n <= 0xffff ? { ok: true, addr: n } : { ok: false, reason: `${t} is past $FFFF.` });

export function resolveGoTo(analysis: Analysis, input: string): GoTo {
  const t = input.trim();
  if (t === '') return { ok: false, reason: `Type an address or a label: ${GOTO_HELP}.` };
  const explicit = /^\$([0-9a-f]+)$/i.exec(t) ?? /^0x([0-9a-f]+)$/i.exec(t) ?? /^([0-9a-f]+)h$/i.exec(t);
  if (explicit !== null) return at(t, parseInt(explicit[1]!, 16));
  const decimal = /^#([0-9]+)$/.exec(t);
  if (decimal !== null) return at(t, parseInt(decimal[1]!, 10));
  const lower = t.toLowerCase();
  const sym = analysis.symbols.list().find((s) => s.name.toLowerCase() === lower);
  if (sym !== undefined) return { ok: true, addr: sym.addr };
  if (/^[0-9a-f]{1,4}$/i.test(t)) return { ok: true, addr: parseInt(t, 16) };
  if (/^[0-9a-f]+$/i.test(t)) return { ok: false, reason: `${t} is past $FFFF.` };
  return { ok: false, reason: `No address or label ${t}. Type ${GOTO_HELP}.` };
}
