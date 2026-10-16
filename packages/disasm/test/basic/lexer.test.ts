import { describe, expect, it } from 'vitest';
import { lexLine } from '../../src/basic/lexer.js';
import type { Token } from '../../src/basic/lexer.js';
import { tokenizeLine } from '../writers/basic-tokenizer.js';

/** Lexes BASIC text through the synthetic tokenizer, as a program would store it. */
const lex = (text: string) => lexLine(tokenizeLine(text));
const brief = (tokens: Token[]) =>
  tokens.map((t) => {
    switch (t.t) {
      case 'kw': return `kw:${t.name}`;
      case 'id': return `id:${t.name}`;
      case 'num': return `num:${t.text}`;
      case 'str': return `str:${new TextDecoder().decode(t.value)}`;
      case 'punct': return `p:${t.ch}`;
      case 'raw': return `raw:${new TextDecoder().decode(t.bytes)}`;
    }
  });

describe('lexLine', () => {
  it('turns keyword bytes, identifiers, numbers, strings, and punctuation into tokens with offsets', () => {
    const r = lex('PRINT"HI"');
    expect(r.error).toBeUndefined();
    expect(brief(r.tokens)).toEqual(['kw:PRINT', 'str:HI']);
    expect(r.tokens.map((t) => t.at)).toEqual([0, 1]);
    expect(brief(lex('FOR I=1 TO 10').tokens)).toEqual(['kw:FOR', 'id:I', 'kw:=', 'num:1', 'kw:TO', 'num:10']);
    expect(brief(lex('X=PEEK(16548)+256*PEEK(16549)').tokens)).toEqual(['id:X', 'kw:=', 'kw:PEEK', 'p:(', 'num:16548', 'p:)', 'kw:+', 'num:256', 'kw:*', 'kw:PEEK', 'p:(', 'num:16549', 'p:)']);
    expect(brief(lex('PRINT#1,A;B,C:GOSUB100').tokens)).toEqual(['kw:PRINT', 'p:#', 'num:1', 'p:,', 'id:A', 'p:;', 'id:B', 'p:,', 'id:C', 'p::', 'kw:GOSUB', 'num:100']);
  });

  it('lexes numbers in every Level II spelling and identifiers with type suffixes', () => {
    const r = lex('A=1:B=2.5:C=1E3:D=.5:E=5.:F=1E-2:G=3!:H#=4:AB%=5:Q0=6:S$="X"');
    expect(r.error).toBeUndefined();
    expect(brief(r.tokens).filter((t) => t.startsWith('num:'))).toEqual(['num:1', 'num:2.5', 'num:1E3', 'num:.5', 'num:5.', 'num:1E-2', 'num:3!', 'num:4', 'num:5', 'num:6']);
    expect(r.tokens.filter((t): t is Extract<Token, { t: 'num' }> => t.t === 'num').map((t) => t.value)).toEqual([1, 2.5, 1000, 0.5, 5, 0.01, 3, 4, 5, 6]);
    expect(brief(r.tokens).filter((t) => t.startsWith('id:'))).toEqual(['id:A', 'id:B', 'id:C', 'id:D', 'id:E', 'id:F', 'id:G', 'id:H#', 'id:AB%', 'id:Q0', 'id:S$']);
  });

  it('keeps a string that runs to the end of the line, as Level II allows', () => {
    expect(brief(lex('PRINT"HELLO').tokens)).toEqual(['kw:PRINT', 'str:HELLO']);
    expect(lex('PRINT"HELLO').error).toBeUndefined();
  });

  it('folds the stored forms of ELSE and the remark apostrophe', () => {
    expect(brief(lex('IF A THEN 1 ELSE 2').tokens)).toEqual(['kw:IF', 'id:A', 'kw:THEN', 'num:1', 'kw:ELSE', 'num:2']);
    expect(brief(lex("' NOTE: GOTO").tokens)).toEqual(["kw:'", 'raw: NOTE: GOTO']);
    expect(brief(lexLine(Uint8Array.from([0xfb, 0x20, 0x48, 0x49])).tokens)).toEqual(["kw:'", 'raw: HI']);
    expect(brief(lex('REM FOR I').tokens)).toEqual(['kw:REM', 'raw: FOR I']);
  });

  it('keeps DATA items raw up to the next colon outside quotes, then resumes', () => {
    expect(brief(lex('DATA 1,"A:B",FOR:PRINT').tokens)).toEqual(['kw:DATA', 'raw: 1,"A:B",FOR', 'p::', 'kw:PRINT']);
  });

  it('keeps TAB( as one keyword', () => {
    expect(brief(lex('PRINT TAB(5);"X"').tokens)).toEqual(['kw:PRINT', 'kw:TAB(', 'num:5', 'p:)', 'p:;', 'str:X']);
  });

  it('reports lexical errors with their offsets, in the phase-1 wording', () => {
    expect(lexLine(Uint8Array.from([0xb2, 0xfc, 0x41])).error).toEqual({ at: 1, message: 'invalid token FCH at +1' });
    expect(lexLine(Uint8Array.from([0x01, 0x41])).error).toEqual({ at: 0, message: 'control byte 01H at +0' });
    expect(lexLine(Uint8Array.from([0x41, 0xd5, 0x40])).error).toEqual({ at: 2, message: 'unexpected byte 40H at +2' });
    expect(lexLine(Uint8Array.from([0x41, 0xd5, 0x26, 0x48, 0x31, 0x30])).error).toEqual({ at: 2, message: 'unexpected byte 26H at +2' });
    expect(lexLine(Uint8Array.from([0x22, 0xfc, 0x22])).error).toBeUndefined(); // inside a string
    expect(lexLine(Uint8Array.from([0x93, 0x01, 0xfc])).error).toBeUndefined(); // inside a remark
  });

  it('lexes an empty body to no tokens', () => {
    expect(lexLine(new Uint8Array()).tokens).toEqual([]);
  });
});
