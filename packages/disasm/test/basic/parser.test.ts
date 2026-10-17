import { describe, expect, it } from 'vitest';
import { parseLine } from '../../src/basic/parser.js';
import type { Expr, Statement } from '../../src/basic/parser.js';
import { SIX_LINES } from '../fixtures.js';
import { tokenizeLine } from '../writers/basic-tokenizer.js';

/** Parses BASIC text as a program would store it. */
const parse = (text: string) => parseLine(tokenizeLine(text));
const raw = (...bytes: number[]) => parseLine(Uint8Array.from(bytes));
const num = (value: number): Expr => ({ kind: 'num', value });
const v = (name: string, subscripts: Expr[] = []): Expr => ({ kind: 'var', name, subscripts });
const bin = (op: string, left: Expr, right: Expr): Expr => ({ kind: 'binary', op, left, right });
const call = (fn: string, ...args: Expr[]): Expr => ({ kind: 'call', fn, args });
/** The expression assigned by a one-statement `X=...` line. */
const rhs = (text: string): Expr => {
  const s = parse(text).statements[0];
  if (s?.kind !== 'assign') throw new Error(`${text} is not an assignment`);
  return s.expr;
};

describe('parseLine', () => {
  it('accepts an example of every statement shape', () => {
    const lines = [
      'END', 'STOP', 'RETURN', 'CLS:TRON:TROFF', 'CONT', 'NEW', 'RANDOM', 'SYSTEM',
      'CLEAR 500', 'RESTORE', 'RUN 100', 'RUN"GAME/BAS"', 'LIST 10-20', 'LLIST', 'DELETE 10-20', 'AUTO 100,10', 'EDIT 10', 'RESUME', 'RESUME NEXT', 'RESUME 0',
      'GOTO 100', 'GOSUB 1000',
      'ON X GOSUB 100,200', 'ON I GOTO 10,20,30', 'ON ERROR GOTO 0',
      'PRINT', 'PRINT "A";B,C', 'PRINT TAB(5);"X",Y;', 'LPRINT USING"##";X', 'PRINT #1,"X";', 'PRINT#-1,A,B', 'PRINT@512,"HI"', 'PRINT"X="X',
      'INPUT A', 'INPUT "NAME";N$', 'INPUT#-1,A,B', 'LINE INPUT "X";A$', 'LINE INPUT A$',
      'READ A,B$,C(1)', 'DIM A(10),B$(5,5)',
      'NEXT', 'NEXT I', 'NEXT I,J',
      'POKE 16421,195:POKE16422,Q0', 'OUT 255,0',
      'SET(10,20)', 'RESET(X,Y)',
      'LET A=1', 'A(I,J)=B*2^-1', 'A$="X"', 'MID$(A$,2,1)="Z"',
      'FOR I=1 TO 10', 'FOR I=A TO B STEP -1',
      'IF A THEN 10 ELSE PRINT"X"', 'IF A GOTO 10', 'IF X>0 THEN GOSUB 100 ELSE END', 'IF A THEN IF B THEN 1 ELSE 2 ELSE 3', 'IF A THEN PRINT "X":GOTO 10',
      'DEF FNA(X)=X*X', 'DEFFNB=1', 'DEFUSR1=24576', 'DEFUSR=&H7000',
      'DEFINT A-Z', 'DEFSTR A,B,C-D', 'DEFDBL D', 'DEFSNG S',
      'ERROR 5',
      'DATA 1,"A:B",X', 'REM ANYTHING: GOES', "' NOTE", 'PRINT"X":\' NOTE',
      'OPEN "R",1,"FILE/DAT",32', 'FIELD 1,20 AS A$,10 AS B$', 'GET 1,5', 'PUT 1', 'CLOSE', 'CLOSE 1', 'LOAD "X",R', 'MERGE"X"', 'KILL "X"',
      'LSET A$=B$', 'RSET A$=MKI$(5)', 'SAVE "X",A', 'CLOAD "A"', 'CSAVE "A"', 'CMD"S"', 'NAME "A" AS "B"',
    ];
    for (const text of lines) expect(parse(text).reason, text).toBeUndefined();
    // CLOAD? is stored as CLOAD followed by the PRINT token; FIELD's AS may fuse with the next name.
    expect(raw(0xb9, 0xb2, 0x22, 0x41, 0x22).ok).toBe(true);
    expect(parse('FIELD1,20ASN$,30ASA$').ok).toBe(true);
  });

  it('accepts the quirky but legal forms a real program uses (Review Focus 1)', () => {
    for (const text of ['IF A GOTO 10', 'IF A,THEN 10', 'PRINT #1,"X";', 'ON ERROR GOTO 0', 'DEFINT A-Z', 'FOR I=A TO B STEP -1', 'PRINT"HELLO', 'X=1E-2'])
      expect(parse(text).reason, text).toBeUndefined();
    expect(raw(0xb2, 0x22, 0x81, 0xbf, 0xfc, 0x0d, 0x22).ok).toBe(true); // tokens and graphics bytes inside a string
    expect(parseLine(new Uint8Array())).toEqual({ ok: true, statements: [] });
  });

  it('accepts IF without THEN, as the ROM does: after the condition a line number is a GOTO, anything else a statement', () => {
    // The Level II IF handler ($2039) skips one comma, then THEN only if present (Super Star Trek relies on it).
    for (const text of ['IF A PRINT', 'IF A>0 PRINT@105,"X";', 'IF A,100', 'IF P(Q)=0 RETURN ELSE PRINT 1', 'IF A X=1:GOTO 10 ELSE 20', 'IF A THEN 10', 'IF A,THEN 10', 'IF A GOTO 10'])
      expect(parse(text).reason, text).toBeUndefined();
    expect(parse('IF A POKE 1,2').statements).toEqual<Statement[]>([
      { kind: 'other', keyword: 'IF', exprs: [v('A')] },
      { kind: 'poke', addr: num(1), value: num(2) },
    ]);
  });

  it('rejects code whose bytes happen to spell keywords', () => {
    expect(raw(0xcd, 0x50, 0x41, 0xc9)).toEqual({ ok: false, reason: 'unexpected + at +0', statements: [] }); // CALL 4150H / RET
    expect(raw(0xc3, 0x41, 0x42).reason).toBe('unexpected ERR at +0'); // JP 4241H
    expect(raw(0x44, 0x79, 0xfe, 0x0d, 0xc8, 0x2a, 0xa4, 0x40).reason).toBe('invalid token FEH at +2'); // a Valkyrie-style code line
  });

  it('names the offset of every grammar failure', () => {
    const cases: [string, string][] = [
      ['PRINT 1+', 'expected expression at +4'],
      ['GOTO', 'expected line number at +1'],
      ['GOTO X', 'expected line number at +2'],
      ['FOR I=1', 'expected TO at +5'],
      ['PRINT(1))', 'unexpected ) at +4'],
      ['PRINT (1', 'expected ) at +4'],
      ['A B', 'expected = at +2'],
      ['X=A B', 'unexpected B at +4'],
      ['A=FOR', 'unexpected FOR at +2'],
      ['THEN', 'unexpected THEN at +0'],
      ['"X"', 'unexpected string at +0'],
      ['IF', 'expected expression at +1'],
      ['ON X PRINT', 'expected GOTO or GOSUB at +4'],
      ['DEF X', 'expected FN or USR at +2'],
      ['LINE PRINT', 'expected INPUT at +2'],
      ['DEFINT AB', 'expected letter at +2'],
      ['POKE 1', 'expected , at +3'],
      ['A=&10', 'unexpected byte 26H at +2'],
    ];
    for (const [text, reason] of cases) expect(parse(text), text).toEqual({ ok: false, reason, statements: [] });
  });

  it('reads a string far longer than any line without hitting a call-size limit', () => {
    const s = parseLine(Uint8Array.from([0x41, 0x24, 0xd5, 0x22, ...new Array<number>(200_000).fill(0x41), 0x22])).statements[0]; // A$="AAAA…"
    expect(s?.kind === 'assign' && s.expr.kind === 'str' ? s.expr.value.length : -1).toBe(200_000);
  });

  it('does not check types: a string where a number belongs still parses', () => {
    expect(parse('POKE "A",1').ok).toBe(true);
    expect(parse('X=1+"A"').ok).toBe(true);
  });

  it('parses the six-line fixture', () => {
    for (const line of SIX_LINES) expect(parse(line.text!).reason, line.text).toBeUndefined();
  });

  it('builds expressions with Level II precedence', () => {
    expect(rhs('X=A+B*C')).toEqual(bin('+', v('A'), bin('*', v('B'), v('C'))));
    expect(rhs('X=-A^2')).toEqual({ kind: 'unary', op: '-', expr: bin('^', v('A'), num(2)) });
    expect(rhs('X=NOT A=B')).toEqual({ kind: 'unary', op: 'NOT', expr: bin('=', v('A'), v('B')) });
    expect(rhs('X=A<>B')).toEqual(bin('<>', v('A'), v('B')));
    expect(rhs('X=A=<B')).toEqual(bin('<=', v('A'), v('B')));
    expect(rhs('X=A>=B')).toEqual(bin('>=', v('A'), v('B')));
    expect(rhs('X=A OR B AND C')).toEqual(bin('OR', v('A'), bin('AND', v('B'), v('C'))));
    expect(rhs('X=((A))')).toEqual(v('A'));
    expect(rhs('X=2^-1')).toEqual(bin('^', num(2), { kind: 'unary', op: '-', expr: num(1) }));
    expect(rhs('X=FNA(1)+USR(0)+MEM')).toEqual(bin('+', bin('+', { kind: 'fn', name: 'A', args: [num(1)] }, call('USR', num(0))), call('MEM')));
    expect(rhs('X=USR1(0)')).toEqual(call('USR1', num(0)));
    expect(rhs('X=A(I,J+1)')).toEqual(v('A', [v('I'), bin('+', v('J'), num(1))]));
    expect(rhs('X=1E-2')).toEqual(num(0.01));
    expect(rhs('X=&H6000')).toEqual(num(0x6000));
  });

  it('returns the statements the entry miner reads, with IF branches in order', () => {
    expect(parse('POKE 16421,195:POKE16422,Q0').statements).toEqual([
      { kind: 'poke', addr: num(16421), value: num(195) },
      { kind: 'poke', addr: num(16422), value: v('Q0') },
    ]);
    expect(parse('DEFUSR1=24576').statements).toEqual([{ kind: 'defusr', n: 1, expr: num(24576) }]);
    expect(parse('DEFUSR=&H7000').statements).toEqual([{ kind: 'defusr', n: 0, expr: num(0x7000) }]);
    expect(parse('FOR I=1 TO 10').statements).toEqual([{ kind: 'other', keyword: 'FOR', exprs: [num(1), num(10)] }]);
    expect(parse('IF A THEN POKE 1,2 ELSE X=3').statements).toEqual<Statement[]>([
      { kind: 'other', keyword: 'IF', exprs: [v('A')] },
      { kind: 'poke', addr: num(1), value: num(2) },
      { kind: 'assign', name: 'X', subscripts: [], expr: num(3) },
    ]);
    const line250 = parse('CLS:Q0=PEEK(16549)*256+PEEK(16548)+14:Q1=INT(Q0/256):Q0=Q0-Q1*256:POKE16422,Q0:POKE16423,Q1:POKE16421,195');
    expect(line250.ok).toBe(true);
    expect(line250.statements.map((s) => s.kind)).toEqual(['other', 'assign', 'assign', 'assign', 'poke', 'poke', 'poke']);
    expect(line250.statements[1]).toEqual({
      kind: 'assign', name: 'Q0', subscripts: [],
      expr: bin('+', bin('+', bin('*', call('PEEK', num(16549)), num(256)), call('PEEK', num(16548))), num(14)),
    });
    expect(line250.statements[2]).toEqual({ kind: 'assign', name: 'Q1', subscripts: [], expr: call('INT', bin('/', v('Q0'), num(256))) });
    expect(line250.statements[3]).toEqual({ kind: 'assign', name: 'Q0', subscripts: [], expr: bin('-', v('Q0'), bin('*', v('Q1'), num(256))) });
  });

  describe('the expressions every other statement reads', () => {
    // An `other` statement keeps its keyword and the expressions it reads (a condition, a bound, an item, a selector, a subscript, a body):
    // the outermost ones only, in the order it reads them, so a PEEK inside one can be found (basic/addresses.ts).
    const peek = (n: number): Expr => call('PEEK', num(n));
    const others = (text: string): [string, Expr[]][] =>
      parse(text).statements.flatMap((s): [string, Expr[]][] => (s.kind === 'other' ? [[s.keyword, s.exprs]] : []));

    it('keeps an IF condition, a FOR start, end, and step, an ON selector, and a DEF FN body', () => {
      expect(others('IF PEEK(14400)=128 THEN 255')).toEqual([['IF', [bin('=', peek(14400), num(128))]]]);
      expect(others('FOR I=PEEK(16548) TO 10 STEP S')).toEqual([['FOR', [peek(16548), num(10), v('S')]]]);
      expect(others('ON PEEK(14400) GOTO 100,200')).toEqual([['ON', [peek(14400)]]]);
      expect(others('ON X GOSUB 100')).toEqual([['ON', [v('X')]]]);
      expect(others('DEF FNA(X)=PEEK(14400)+X')).toEqual([['DEF', [bin('+', peek(14400), v('X'))]]]);
    });

    it('keeps every item of a PRINT: values, positions, TAB, USING, and a file number', () => {
      expect(others('PRINT "A";PEEK(1),B')).toEqual([['PRINT', [{ kind: 'str', value: 'A' }, peek(1), v('B')]]]);
      expect(others('PRINT@PEEK(1),"X"')).toEqual([['PRINT', [peek(1), { kind: 'str', value: 'X' }]]]);
      expect(others('PRINT TAB(PEEK(1));A')).toEqual([['PRINT', [peek(1), v('A')]]]);
      expect(others('PRINT #1,A')).toEqual([['PRINT', [num(1), v('A')]]]);
      expect(others('LPRINT PEEK(1)')).toEqual([['LPRINT', [peek(1)]]]);
    });

    it('keeps the arguments of the statements that take expressions, and the subscripts of their variables', () => {
      expect(others('OUT 255,PEEK(1)')).toEqual([['OUT', [num(255), peek(1)]]]);
      expect(others('SET(PEEK(1),2)')).toEqual([['SET', [peek(1), num(2)]]]);
      expect(others('CLEAR PEEK(1)')).toEqual([['CLEAR', [peek(1)]]]);
      expect(others('ERROR PEEK(1)')).toEqual([['ERROR', [peek(1)]]]);
      expect(others('READ A(PEEK(1)),B')).toEqual([['READ', [peek(1)]]]);
      expect(others('INPUT "X";A(PEEK(1))')).toEqual([['INPUT', [peek(1)]]]);
      expect(others('OPEN "R",1,"FILE/DAT",32')).toEqual([['OPEN', [{ kind: 'str', value: 'R' }, num(1), { kind: 'str', value: 'FILE/DAT' }, num(32)]]]);
    });

    it('keeps nothing for a statement that reads no expression', () => {
      expect(others('CLS:END')).toEqual([['CLS', []], ['END', []]]);
      expect(others('ON ERROR GOTO 0')).toEqual([['ON', []]]);
      expect(others('GOTO 100')).toEqual([['GOTO', []]]);
      expect(others('REM PEEK(1)')).toEqual([['REM', []]]);
      expect(others('DATA 1,2')).toEqual([['DATA', []]]);
    });

    it('keeps only the outermost expressions: an argument of a function is part of its call', () => {
      expect(others('PRINT INT(PEEK(1)/2)')[0]![1]).toEqual([call('INT', bin('/', peek(1), num(2)))]);
      expect(others('PRINT A(PEEK(1))')[0]![1]).toEqual([v('A', [peek(1)])]);
    });

    it('gives each statement its own: the condition to the IF, the branches theirs', () => {
      expect(others('IF A THEN PRINT B ELSE PRINT C')).toEqual([['IF', [v('A')]], ['PRINT', [v('B')]], ['PRINT', [v('C')]]]);
      expect(others('IF A THEN IF B THEN PRINT C ELSE PRINT D ELSE FOR I=1 TO E')).toEqual([
        ['IF', [v('A')]],
        ['IF', [v('B')]],
        ['PRINT', [v('C')]],
        ['PRINT', [v('D')]],
        ['FOR', [num(1), v('E')]],
      ]);
    });

    it('leaves what a line is, and why it is not, as it was', () => {
      expect(parse('IF PEEK(14400)=128 THEN 255').ok).toBe(true);
      expect(parse('IF').reason).toBe('expected expression at +1');
      expect(parse('FOR I=PEEK(1) TO').reason).toBe('expected expression at +10');
    });
  });
});
