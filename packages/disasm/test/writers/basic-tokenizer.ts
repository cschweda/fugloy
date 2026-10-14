/**
 * Synthetic Level II BASIC tokenizer and program writer for fixtures. It
 * mirrors the ROM's crunch behaviour the detokenizer must undo: greedy
 * longest-keyword matching outside literals, ELSE stored as `3A 95`, the
 * remark apostrophe as `3A 93 FB`, and literal copying after REM, after
 * DATA (to the next colon), and inside quotes.
 */
import { TOKENS, TOKEN_APOSTROPHE, TOKEN_BYTES, TOKEN_DATA, TOKEN_ELSE, TOKEN_REM } from '../../src/tokens.js';

const KEYWORDS: readonly string[] = [...TOKENS].sort((a, b) => b.length - a.length);

/** Tokenizes one line's text (no line number) into its body bytes, without the 00 terminator. */
export function tokenizeLine(text: string): Uint8Array {
  const out: number[] = [];
  const n = text.length;
  let i = 0;
  const push = (ch: string): void => { out.push(ch.charCodeAt(0) & 0xff); };
  const copyRest = (): void => { while (i < n) push(text[i++]!); };
  const copyData = (): void => {
    let quoted = false;
    while (i < n) {
      const c = text[i]!;
      if (c === '"') quoted = !quoted;
      if (c === ':' && !quoted) return;
      push(c);
      i++;
    }
  };
  while (i < n) {
    const ch = text[i]!;
    if (ch === '"') {
      push(ch);
      i++;
      while (i < n && text[i] !== '"') push(text[i++]!);
      if (i < n) { push('"'); i++; }
      continue;
    }
    const rest = text.slice(i).toUpperCase();
    const kw = KEYWORDS.find((k) => rest.startsWith(k));
    if (kw === undefined) {
      push(ch.toUpperCase());
      i++;
      continue;
    }
    i += kw.length;
    const code = TOKEN_BYTES.get(kw)!;
    if (code === TOKEN_APOSTROPHE) { out.push(0x3a, TOKEN_REM, TOKEN_APOSTROPHE); copyRest(); }
    else if (code === TOKEN_REM) { out.push(TOKEN_REM); copyRest(); }
    else if (code === TOKEN_ELSE) out.push(0x3a, TOKEN_ELSE);
    else if (code === TOKEN_DATA) { out.push(TOKEN_DATA); copyData(); }
    else out.push(code);
  }
  return Uint8Array.from(out);
}

export interface BasicLineSpec {
  number: number;
  /** BASIC text to tokenize. */
  text?: string;
  /** Body bytes written verbatim instead (hidden machine code). */
  raw?: ArrayLike<number>;
}

export interface WriteBasicOptions {
  /** Emit the leading FF byte Disk BASIC writes (default true). */
  header?: boolean;
  /** Bytes appended after the final 00 00. */
  trailing?: ArrayLike<number>;
}

/** Writes a tokenized program as saved from memory address `base`. */
export function writeBasic(lines: BasicLineSpec[], base: number, opts: WriteBasicOptions = {}): Uint8Array {
  const out: number[] = [];
  if (opts.header !== false) out.push(0xff);
  let addr = base & 0xffff;
  for (const line of lines) {
    if (!Number.isInteger(line.number) || line.number < 0 || line.number > 65529) {
      throw new RangeError(`line number ${line.number} is outside 0..65529`);
    }
    const body = line.raw !== undefined ? Array.from(line.raw, (b) => b & 0xff) : Array.from(tokenizeLine(line.text ?? ''));
    const next = (addr + 4 + body.length + 1) & 0xffff;
    out.push(next & 0xff, next >> 8, line.number & 0xff, line.number >> 8, ...body, 0x00);
    addr = next;
  }
  out.push(0x00, 0x00);
  if (opts.trailing !== undefined) for (let i = 0; i < opts.trailing.length; i++) out.push(opts.trailing[i]! & 0xff);
  return Uint8Array.from(out);
}
