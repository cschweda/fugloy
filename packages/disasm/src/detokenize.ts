/**
 * Turns one tokenized BASIC line body back into text, the way LIST would,
 * and says whether the body is BASIC: terminated by a single trailing 00, no
 * other 00 inside, and accepted by the parser, lexically and by statement
 * shape (basic/parser.ts). The reason names the first failure. The text is
 * rendered whatever the verdict, so a code line still lists.
 */
import { parseLine } from './basic/parser.js';
import { TOKENS, TOKEN_APOSTROPHE, TOKEN_DATA, TOKEN_ELSE, TOKEN_FIRST, TOKEN_LAST, TOKEN_REM } from './tokens.js';

export interface Detokenized {
  text: string;
  ok: boolean;
  reason?: string;
}

const hex2 = (b: number): string => b.toString(16).toUpperCase().padStart(2, '0');
const printable = (b: number): boolean => b >= 0x20 && b <= 0x7e;
/** A literal byte: as a character when printable, else `{hh}`. */
const literal = (b: number): string => (printable(b) ? String.fromCharCode(b) : `{${hex2(b)}}`);

type Mode = 'normal' | 'string' | 'rest' | 'data';

/** Why a body (with its terminator) is not BASIC, or undefined when it is. */
function verdict(body: Uint8Array): string | undefined {
  const n = body.length;
  if (n === 0 || body[n - 1] !== 0) return 'no 00 terminator';
  const inner = body.subarray(0, n - 1);
  const zero = inner.indexOf(0);
  if (zero >= 0) return `embedded 00 at +${zero}`;
  return parseLine(inner).reason;
}

export function detokenize(body: Uint8Array): Detokenized {
  let text = '';
  const n = body.length;
  const end = n > 0 && body[n - 1] === 0 ? n - 1 : n;
  let mode: Mode = 'normal';
  let quoted = false;
  let i = 0;
  while (i < end) {
    const b = body[i]!;
    if (b === 0) {
      text += '{00}';
      i++;
      continue;
    }
    switch (mode) {
      case 'rest':
        text += literal(b);
        i++;
        break;
      case 'string':
        if (b === 0x22) mode = 'normal';
        text += literal(b);
        i++;
        break;
      case 'data':
        if (b === 0x22) quoted = !quoted;
        if (b === 0x3a && !quoted) { mode = 'normal'; break; }
        text += literal(b);
        i++;
        break;
      case 'normal':
        if (b === 0x22) { mode = 'string'; text += '"'; i++; break; }
        if (b === 0x3a && body[i + 1] === TOKEN_ELSE) { text += 'ELSE'; i += 2; break; }
        if (b === 0x3a && body[i + 1] === TOKEN_REM && body[i + 2] === TOKEN_APOSTROPHE) { text += "'"; mode = 'rest'; i += 3; break; }
        if (b >= TOKEN_FIRST && b <= TOKEN_LAST) {
          text += TOKENS[b - TOKEN_FIRST]!;
          if (b === TOKEN_REM || b === TOKEN_APOSTROPHE) mode = 'rest';
          else if (b === TOKEN_DATA) { mode = 'data'; quoted = false; }
          i++;
          break;
        }
        text += literal(b);
        i++;
        break;
    }
  }
  const reason = verdict(body);
  return reason === undefined ? { text, ok: true } : { text, ok: false, reason };
}
