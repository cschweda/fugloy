/**
 * Lexer for one tokenized Level II BASIC line body (without its terminator):
 * keyword bytes become keyword tokens by name, text becomes identifiers,
 * numbers, strings, and punctuation, and the regions the ROM stores verbatim
 * (REM and ' remarks, DATA items) become raw tokens. Lexical errors use the
 * same wording as the phase-1 check in detokenize.ts.
 */
import { TOKENS, TOKEN_APOSTROPHE, TOKEN_DATA, TOKEN_ELSE, TOKEN_FIRST, TOKEN_LAST, TOKEN_REM } from '../tokens.js';

export type Punct = ':' | ',' | ';' | '(' | ')' | '#';

export type Token =
  | { t: 'kw'; name: string; at: number }
  | { t: 'id'; name: string; at: number }
  | { t: 'num'; text: string; value: number; at: number }
  | { t: 'str'; value: Uint8Array; at: number }
  | { t: 'punct'; ch: Punct; at: number }
  | { t: 'raw'; bytes: Uint8Array; at: number };

export interface LexError {
  at: number;
  message: string;
}

export interface LexResult {
  tokens: Token[];
  error?: LexError;
}

const hex2 = (b: number): string => b.toString(16).toUpperCase().padStart(2, '0');
const isDigit = (b: number): boolean => b >= 0x30 && b <= 0x39;
const isLetter = (b: number): boolean => (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a);
const PUNCT: ReadonlySet<number> = new Set([':', ',', ';', '(', ')', '#'].map((c) => c.charCodeAt(0)));
/** The ROM tokenizes the sign of an exponent like any operator: `1E-2` is stored as 31 45 CE 32. */
const EXPONENT_SIGNS: ReadonlyMap<number, string> = new Map([
  [TOKEN_FIRST + TOKENS.indexOf('+'), '+'],
  [TOKEN_FIRST + TOKENS.indexOf('-'), '-'],
  [0x2b, '+'],
  [0x2d, '-'],
]);
const TYPE_SUFFIXES: ReadonlySet<number> = new Set(['$', '%', '!', '#'].map((c) => c.charCodeAt(0)));

export function lexLine(body: Uint8Array): LexResult {
  const tokens: Token[] = [];
  const n = body.length;
  let i = 0;
  const ascii = (from: number, to: number): string => String.fromCharCode(...body.subarray(from, to));
  const rawTo = (end: number): void => {
    tokens.push({ t: 'raw', bytes: body.subarray(i, end), at: i });
    i = end;
  };
  while (i < n) {
    const b = body[i]!;
    if (b === 0x20) {
      i++;
      continue;
    }
    if (b === 0x22) {
      const start = i++;
      while (i < n && body[i] !== 0x22) i++;
      tokens.push({ t: 'str', value: body.subarray(start + 1, i), at: start });
      if (i < n) i++;
      continue;
    }
    if (b === 0x3a && body[i + 1] === TOKEN_ELSE) {
      tokens.push({ t: 'kw', name: 'ELSE', at: i });
      i += 2;
      continue;
    }
    if (b === 0x3a && body[i + 1] === TOKEN_REM && body[i + 2] === TOKEN_APOSTROPHE) {
      tokens.push({ t: 'kw', name: "'", at: i });
      i += 3;
      rawTo(n);
      continue;
    }
    if (b >= TOKEN_FIRST && b <= TOKEN_LAST) {
      tokens.push({ t: 'kw', name: TOKENS[b - TOKEN_FIRST]!, at: i });
      i++;
      if (b === TOKEN_REM || b === TOKEN_APOSTROPHE) rawTo(n);
      else if (b === TOKEN_DATA) {
        let end = i;
        let quoted = false;
        while (end < n) {
          const c = body[end]!;
          if (c === 0x22) quoted = !quoted;
          if (c === 0x3a && !quoted) break;
          end++;
        }
        rawTo(end);
      }
      continue;
    }
    if (b > TOKEN_LAST) return { tokens, error: { at: i, message: `invalid token ${hex2(b)}H at +${i}` } };
    if (b < 0x20 || b === 0x7f) return { tokens, error: { at: i, message: `control byte ${hex2(b)}H at +${i}` } };
    if (PUNCT.has(b)) {
      tokens.push({ t: 'punct', ch: String.fromCharCode(b) as Punct, at: i });
      i++;
      continue;
    }
    if (isDigit(b) || (b === 0x2e && isDigit(body[i + 1] ?? 0))) {
      const start = i;
      let text = '';
      const digits = (): void => {
        const from = i;
        while (i < n && isDigit(body[i]!)) i++;
        text += ascii(from, i);
      };
      digits();
      if (body[i] === 0x2e) {
        text += '.';
        i++;
        digits();
      }
      const marker = body[i];
      if (marker === 0x45 || marker === 0x65 || marker === 0x44 || marker === 0x64) {
        const sign = EXPONENT_SIGNS.get(body[i + 1] ?? -1);
        const after = sign === undefined ? i + 1 : i + 2;
        if (isDigit(body[after] ?? 0)) {
          text += String.fromCharCode(marker & 0xdf) + (sign ?? '');
          i = after;
          digits();
        }
      }
      const value = Number(text.replace('D', 'E'));
      if (TYPE_SUFFIXES.has(body[i] ?? 0) && body[i] !== 0x24) {
        text += String.fromCharCode(body[i]!);
        i++;
      }
      tokens.push({ t: 'num', text, value, at: start });
      continue;
    }
    if (isLetter(b)) {
      const start = i++;
      while (i < n && (isLetter(body[i]!) || isDigit(body[i]!))) i++;
      if (TYPE_SUFFIXES.has(body[i] ?? 0)) i++;
      tokens.push({ t: 'id', name: ascii(start, i).toUpperCase(), at: start });
      continue;
    }
    return { tokens, error: { at: i, message: `unexpected byte ${hex2(b)}H at +${i}` } };
  }
  return { tokens };
}
