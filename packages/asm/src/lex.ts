/**
 * The lexer: one source line into tokens, each with its 1-based column and
 * the column just past its end. A comment (`;` outside a string) ends the
 * line. Numbers are read in every form zmac reads; a malformed one stops the
 * line with a sentence.
 */

export type TokenKind = 'ident' | 'number' | 'string' | 'op';

export interface Token {
  kind: TokenKind;
  /** The token as written. */
  text: string;
  /** 1-based column of the first character. */
  col: number;
  /** Column just past the last character. */
  end: number;
  /** A number's value. */
  value?: number;
  /** A string's character codes, quotes removed and doubled quotes undone. */
  chars?: number[];
}

export interface LexError {
  message: string;
  col: number;
  end: number;
}

export interface Lexed {
  tokens: Token[];
  error?: LexError;
}

const IDENT_START = /[A-Za-z_.@?]/;
const IDENT_PART = /[A-Za-z0-9_.$@?]/;
const WORD_PART = /[A-Za-z0-9_]/;
const OPS2 = ['<<', '>>'];
const OPS1 = '(),:+-*/%&|^~=$';

const NUMBER_FORMS = 'Write decimal 255, hex 0FFH, $FF, or 0xFF, binary 1010B, or octal 17O.';

/**
 * A number's digits as a 32-bit value, wrapped to two's complement as zmac
 * does (0FFFFFFFFH is -1); past 32 bits it is the sentence saying so.
 */
function bounded(text: string, digits: string, radix: number): number | string {
  const value = parseInt(digits, radix);
  if (value > 0xffffffff) return `${text} is too large: numbers have 32 bits, at most 0FFFFFFFFH (4294967295).`;
  return value | 0;
}

/** The value of a number written starting with a digit, or the sentence for why it is not one. */
function readNumber(text: string): number | string {
  let m: RegExpMatchArray | null;
  if ((m = /^0[xX]([0-9A-Fa-f]+)$/.exec(text))) return bounded(text, m[1]!, 16);
  if ((m = /^([0-9][0-9A-Fa-f]*)[hH]$/.exec(text))) return bounded(text, m[1]!, 16);
  if ((m = /^([01]+)[bB]$/.exec(text))) return bounded(text, m[1]!, 2);
  if ((m = /^([0-7]+)[oOqQ]$/.exec(text))) return bounded(text, m[1]!, 8);
  if ((m = /^([0-9]+)[dD]?$/.exec(text))) return bounded(text, m[1]!, 10);
  if ((m = /^0[bB]([01]+)$/.exec(text))) return `${text} is not a number; write binary as ${m[1]}B.`;
  return `${text} is not a number. ${NUMBER_FORMS}`;
}

export function lex(line: string): Lexed {
  const tokens: Token[] = [];
  let i = 0;
  const fail = (message: string, from: number, to: number): Lexed => ({ tokens, error: { message, col: from + 1, end: to + 1 } });
  while (i < line.length) {
    const c = line[i]!;
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if (c === ';') break;
    const start = i;
    if (IDENT_START.test(c)) {
      while (i < line.length && IDENT_PART.test(line[i]!)) i++;
      // AF' is one name; anywhere else a quote starts a string.
      if (line.slice(start, i).toUpperCase() === 'AF' && line[i] === "'") i++;
      tokens.push({ kind: 'ident', text: line.slice(start, i), col: start + 1, end: i + 1 });
      continue;
    }
    if (/[0-9]/.test(c)) {
      while (i < line.length && WORD_PART.test(line[i]!)) i++;
      const text = line.slice(start, i);
      const value = readNumber(text);
      if (typeof value === 'string') return fail(value, start, i);
      tokens.push({ kind: 'number', text, col: start + 1, end: i + 1, value });
      continue;
    }
    // zmac's `$` rules: `$` alone is the address of the line; `$` and hex digits only is a
    // hex number ($FF); `$` and any other name characters is a name ($KBWAIT, $1G, $$), as
    // the emitter's ROM names are.
    if (c === '$' && i + 1 < line.length && IDENT_PART.test(line[i + 1]!)) {
      i++;
      while (i < line.length && IDENT_PART.test(line[i]!)) i++;
      const text = line.slice(start, i);
      if (!/^\$[0-9A-Fa-f]+$/.test(text)) {
        tokens.push({ kind: 'ident', text, col: start + 1, end: i + 1 });
        continue;
      }
      const value = bounded(text, text.slice(1), 16);
      if (typeof value === 'string') return fail(value, start, i);
      tokens.push({ kind: 'number', text, col: start + 1, end: i + 1, value });
      continue;
    }
    if (c === "'" || c === '"') {
      const chars: number[] = [];
      i++;
      for (;;) {
        if (i >= line.length) return fail(`This string has no closing ${c}.`, start, line.length);
        const ch = line[i]!;
        if (ch === c) {
          if (line[i + 1] === c) {
            chars.push(c.charCodeAt(0));
            i += 2;
            continue;
          }
          i++;
          break;
        }
        const code = ch.codePointAt(0)!;
        if (code > 0x7f) return fail(`This string holds ${String.fromCodePoint(code)}, which is not plain ASCII; write its code as a number instead.`, i, i + 1);
        chars.push(code);
        i++;
      }
      tokens.push({ kind: 'string', text: line.slice(start, i), col: start + 1, end: i + 1, chars });
      continue;
    }
    const two = line.slice(i, i + 2);
    if (OPS2.includes(two)) {
      i += 2;
      tokens.push({ kind: 'op', text: two, col: start + 1, end: i + 1 });
      continue;
    }
    if (OPS1.includes(c)) {
      i++;
      tokens.push({ kind: 'op', text: c, col: start + 1, end: i + 1 });
      continue;
    }
    return fail(`${c} has no meaning here.`, start, start + 1);
  }
  return { tokens };
}
