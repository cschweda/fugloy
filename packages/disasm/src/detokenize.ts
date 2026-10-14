/**
 * Turns one tokenized BASIC line body back into text, the way LIST would,
 * and says whether the body parsed. Phase 1 "parses" means: terminated by a
 * single trailing 00, every byte 80H..FBH outside a literal region is a
 * token, and no control byte appears outside a literal region. Operand
 * well-formedness (the plan's hidden-code test) is phase 2.
 */
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

export function detokenize(body: Uint8Array): Detokenized {
  let text = '';
  let ok = true;
  let reason: string | undefined;
  const fail = (why: string): void => {
    if (ok) { ok = false; reason = why; }
  };
  const n = body.length;
  const terminated = n > 0 && body[n - 1] === 0;
  if (!terminated) fail('no 00 terminator');
  const end = terminated ? n - 1 : n;
  let mode: Mode = 'normal';
  let quoted = false;
  let i = 0;
  while (i < end) {
    const b = body[i]!;
    if (b === 0) {
      fail(`embedded 00 at +${i}`);
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
        if (b > TOKEN_LAST) fail(`invalid token ${hex2(b)}H at +${i}`);
        else if (!printable(b)) fail(`control byte ${hex2(b)}H at +${i}`);
        text += literal(b);
        i++;
        break;
    }
  }
  return reason === undefined ? { text, ok } : { text, ok, reason };
}
