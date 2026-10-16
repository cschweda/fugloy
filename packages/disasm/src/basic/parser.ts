/**
 * Level II BASIC statement parser (spec §4). A line is BASIC when the lexer
 * accepts it and every statement matches its keyword's argument shape over
 * one expression grammar. The statements come back for the entry miner, which
 * reads assignments, POKEs, and DEFUSR; an IF contributes its branches'
 * statements in order after its own entry. Disk BASIC statements are accepted
 * alongside Level II's, since programs saved under DOS use them. Types are not
 * checked, and a string may run to the end of the line, as Level II allows.
 */
import { lexLine } from './lexer.js';
import type { Token } from './lexer.js';

export type Expr =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'var'; name: string; subscripts: Expr[] }
  | { kind: 'call'; fn: string; args: Expr[] }
  | { kind: 'unary'; op: '-' | 'NOT'; expr: Expr }
  | { kind: 'binary'; op: string; left: Expr; right: Expr }
  | { kind: 'fn'; name: string; args: Expr[] };

export type Statement =
  | { kind: 'assign'; name: string; subscripts: Expr[]; expr: Expr }
  | { kind: 'poke'; addr: Expr; value: Expr }
  | { kind: 'defusr'; n: number; expr: Expr }
  | { kind: 'other'; keyword: string };

export interface ParsedLine {
  ok: boolean;
  /** The first failure, with its byte offset in the body. */
  reason?: string;
  /** Empty when the line does not parse. */
  statements: Statement[];
}

type Shape =
  | 'none' | 'optnum' | 'linelist' | 'onlist' | 'print' | 'input' | 'line' | 'varlist' | 'next' | 'twoexpr'
  | 'setpoint' | 'assign' | 'midstr' | 'for' | 'if' | 'def' | 'deftype' | 'error' | 'raw' | 'disk';

const shape = (s: Shape, ...keywords: string[]): [string, Shape][] => keywords.map((k) => [k, s]);

/** The argument shape of every keyword that may start a statement. */
const SHAPES: ReadonlyMap<string, Shape> = new Map([
  ...shape('none', 'END', 'STOP', 'RETURN', 'CLS', 'TRON', 'TROFF', 'CONT', 'NEW', 'RANDOM', 'SYSTEM'),
  ...shape('optnum', 'CLEAR', 'RESTORE', 'RUN', 'LIST', 'LLIST', 'DELETE', 'AUTO', 'EDIT', 'RESUME'),
  ...shape('linelist', 'GOTO', 'GOSUB'),
  ...shape('onlist', 'ON'),
  ...shape('print', 'PRINT', 'LPRINT'),
  ...shape('input', 'INPUT'),
  ...shape('line', 'LINE'),
  ...shape('varlist', 'READ', 'DIM'),
  ...shape('next', 'NEXT'),
  ...shape('twoexpr', 'POKE', 'OUT'),
  ...shape('setpoint', 'SET', 'RESET'),
  ...shape('assign', 'LET'),
  ...shape('midstr', 'MID$'),
  ...shape('for', 'FOR'),
  ...shape('if', 'IF'),
  ...shape('def', 'DEF'),
  ...shape('deftype', 'DEFSTR', 'DEFINT', 'DEFSNG', 'DEFDBL'),
  ...shape('error', 'ERROR'),
  ...shape('raw', 'DATA', 'REM', "'"),
  ...shape('disk', 'OPEN', 'FIELD', 'GET', 'PUT', 'CLOSE', 'LOAD', 'MERGE', 'NAME', 'KILL', 'LSET', 'RSET', 'SAVE', 'CLOAD', 'CSAVE', 'CMD'),
]);

/** Function tokens called with a parenthesized argument list. */
const FUNCTIONS: ReadonlySet<string> = new Set([
  'SGN', 'INT', 'ABS', 'FRE', 'INP', 'POS', 'SQR', 'RND', 'LOG', 'EXP', 'COS', 'SIN', 'TAN', 'ATN', 'PEEK', 'CVI', 'CVS', 'CVD',
  'EOF', 'LOC', 'LOF', 'MKI$', 'MKS$', 'MKD$', 'CINT', 'CSNG', 'CDBL', 'FIX', 'LEN', 'STR$', 'VAL', 'ASC', 'CHR$', 'LEFT$',
  'RIGHT$', 'MID$', 'STRING$', 'INSTR', 'POINT', 'VARPTR', 'USR',
]);
/** Function tokens that take no arguments. */
const NULLARY: ReadonlySet<string> = new Set(['TIME$', 'MEM', 'INKEY$', 'ERL', 'ERR']);
/** Relational tokens, ranked so a pair in either order normalizes (`=<` is `<=`, `><` is `<>`). */
const RELATIONAL: ReadonlyMap<string, number> = new Map([['<', 0], ['>', 1], ['=', 2]]);

const describe = (t: Token): string => {
  switch (t.t) {
    case 'kw':
    case 'id':
      return t.name;
    case 'num':
      return t.text;
    case 'str':
      return 'string';
    case 'punct':
      return t.ch;
    case 'raw':
      return 'text';
  }
};

class Failure {
  constructor(readonly message: string) {}
}

class Parser {
  readonly out: Statement[] = [];
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly end: number,
  ) {}

  /** A statement list: to the end of the line, or in an IF branch to the ELSE that closes it. */
  statements(inBranch: boolean): void {
    for (;;) {
      const t = this.peek();
      if (t === undefined) return;
      if (t.t === 'punct' && t.ch === ':') {
        this.pos++;
        continue;
      }
      if (t.t === 'kw' && t.name === 'ELSE') {
        if (inBranch) return;
        // A stray ELSE (its IF's branch already ended): read what follows as a branch.
        this.pos++;
        this.branch();
      } else this.statement();
      const after = this.peek();
      if (after !== undefined && !this.atStatementEnd()) this.unexpected(after);
    }
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private atKw(name: string): boolean {
    const t = this.peek();
    return t?.t === 'kw' && t.name === name;
  }

  private atPunct(ch: string): boolean {
    const t = this.peek();
    return t?.t === 'punct' && t.ch === ch;
  }

  /** The line's end, a colon, or a token the lexer folded a colon into (ELSE and '). */
  private atStatementEnd(): boolean {
    const t = this.peek();
    return t === undefined || (t.t === 'punct' && t.ch === ':') || (t.t === 'kw' && (t.name === 'ELSE' || t.name === "'"));
  }

  private expected(what: string): never {
    throw new Failure(`expected ${what} at +${this.peek()?.at ?? this.end}`);
  }

  private unexpected(t: Token): never {
    throw new Failure(`unexpected ${describe(t)} at +${t.at}`);
  }

  private eatKw(name: string): void {
    if (!this.atKw(name)) this.expected(name);
    this.pos++;
  }

  private eatPunct(ch: string): void {
    if (!this.atPunct(ch)) this.expected(ch);
    this.pos++;
  }

  private statement(): void {
    const t = this.peek()!;
    if (t.t === 'id') {
      this.assign();
      return;
    }
    if (t.t !== 'kw') this.unexpected(t);
    const s = SHAPES.get(t.name);
    if (s === undefined) this.unexpected(t);
    this.pos++;
    const keyword = t.name;
    switch (s) {
      case 'none':
        break;
      case 'optnum':
        this.optnum();
        break;
      case 'linelist':
        this.lineNumber();
        break;
      case 'onlist':
        this.onList();
        break;
      case 'print':
        this.print();
        break;
      case 'input':
        this.input();
        break;
      case 'line':
        this.eatKw('INPUT');
        this.input();
        break;
      case 'varlist':
        this.variables();
        break;
      case 'next':
        if (!this.atStatementEnd()) this.variables();
        break;
      case 'twoexpr': {
        const addr = this.expr();
        this.eatPunct(',');
        const value = this.expr();
        if (keyword === 'POKE') {
          this.out.push({ kind: 'poke', addr, value });
          return;
        }
        break;
      }
      case 'setpoint':
        this.eatPunct('(');
        this.expr();
        this.eatPunct(',');
        this.expr();
        this.eatPunct(')');
        break;
      case 'assign':
        this.assign();
        return;
      case 'midstr':
        // Disk BASIC's MID$(A$,start[,length])=expr.
        this.eatPunct('(');
        this.list();
        this.eatPunct(')');
        this.eatKw('=');
        this.expr();
        break;
      case 'for':
        this.simpleVariable();
        this.eatKw('=');
        this.expr();
        this.eatKw('TO');
        this.expr();
        if (this.atKw('STEP')) {
          this.pos++;
          this.expr();
        }
        break;
      case 'if':
        this.out.push({ kind: 'other', keyword });
        this.ifRest();
        return;
      case 'def':
        this.def();
        return;
      case 'deftype':
        this.letterRanges();
        break;
      case 'error':
        this.expr();
        break;
      case 'raw':
        if (this.peek()?.t === 'raw') this.pos++;
        break;
      case 'disk':
        this.disk(keyword);
        break;
    }
    this.out.push({ kind: 'other', keyword });
  }

  private assign(): void {
    const { name, subscripts } = this.variable();
    this.eatKw('=');
    this.out.push({ kind: 'assign', name, subscripts, expr: this.expr() });
  }

  private variable(): { name: string; subscripts: Expr[] } {
    const t = this.peek();
    if (t?.t !== 'id') this.expected('variable');
    this.pos++;
    return { name: t.name, subscripts: this.subscripts() };
  }

  private simpleVariable(): void {
    if (this.peek()?.t !== 'id') this.expected('variable');
    this.pos++;
  }

  private variables(): void {
    this.variable();
    while (this.atPunct(',')) {
      this.pos++;
      this.variable();
    }
  }

  private subscripts(): Expr[] {
    if (!this.atPunct('(')) return [];
    this.pos++;
    const args = this.list();
    this.eatPunct(')');
    return args;
  }

  private list(): Expr[] {
    const items = [this.expr()];
    while (this.atPunct(',')) {
      this.pos++;
      items.push(this.expr());
    }
    return items;
  }

  private lineNumber(): void {
    const t = this.peek();
    if (t?.t !== 'num' || !/^\d+$/.test(t.text) || t.value > 65529) this.expected('line number');
    this.pos++;
  }

  /** CLEAR RESTORE RUN LIST LLIST DELETE AUTO EDIT RESUME: nothing, NEXT, or an expression (a range is a subtraction) and an optional second. */
  private optnum(): void {
    if (this.atStatementEnd()) return;
    if (this.atKw('NEXT')) {
      this.pos++;
      return;
    }
    this.expr();
    if (this.atPunct(',')) {
      this.pos++;
      this.expr();
    }
  }

  private onList(): void {
    if (this.atKw('ERROR')) {
      this.pos++;
      this.eatKw('GOTO');
      this.lineNumber();
      return;
    }
    this.expr();
    if (!this.atKw('GOTO') && !this.atKw('GOSUB')) this.expected('GOTO or GOSUB');
    this.pos++;
    this.lineNumber();
    while (this.atPunct(',')) {
      this.pos++;
      this.lineNumber();
    }
  }

  /** PRINT and LPRINT: `#n,`, then items, `@pos`, `TAB(n)`, and `USING fmt` with or without separators between them. */
  private print(): void {
    if (this.atPunct('#')) {
      this.pos++;
      this.expr();
      this.eatPunct(',');
    }
    while (!this.atStatementEnd()) {
      const t = this.peek()!;
      if (t.t === 'punct' && (t.ch === ',' || t.ch === ';')) this.pos++;
      else if (t.t === 'punct' && t.ch === '@') {
        this.pos++;
        this.expr();
      } else if (t.t === 'kw' && t.name === 'TAB(') {
        this.pos++;
        this.expr();
        this.eatPunct(')');
      } else if (t.t === 'kw' && t.name === 'USING') {
        this.pos++;
        this.expr();
      } else this.expr();
    }
  }

  private input(): void {
    if (this.atPunct('#')) {
      this.pos++;
      this.expr();
      this.eatPunct(',');
    }
    if (this.peek()?.t === 'str') {
      this.pos++;
      if (!this.atPunct(';') && !this.atPunct(',')) this.expected(';');
      this.pos++;
    }
    this.variables();
  }

  private ifRest(): void {
    this.expr();
    // The ROM's IF ($2039) skips one comma, then THEN only if present: a line number
    // after that is a GOTO, anything else a statement (IF A GOTO 10 is the GOTO statement).
    if (this.atPunct(',')) this.pos++;
    if (this.atKw('THEN')) this.pos++;
    this.branch();
    if (this.atKw('ELSE')) {
      this.pos++;
      this.branch();
    }
  }

  /** After THEN or ELSE: a line number, or statements up to the ELSE that closes the branch. */
  private branch(): void {
    if (this.peek()?.t === 'num') this.lineNumber();
    else this.statements(true);
  }

  private def(): void {
    if (this.atKw('FN')) {
      this.pos++;
      if (this.peek()?.t !== 'id') this.expected('function name');
      this.pos++;
      if (this.atPunct('(')) {
        this.pos++;
        this.simpleVariable();
        while (this.atPunct(',')) {
          this.pos++;
          this.simpleVariable();
        }
        this.eatPunct(')');
      }
      this.eatKw('=');
      this.expr();
      this.out.push({ kind: 'other', keyword: 'DEF' });
      return;
    }
    if (this.atKw('USR')) {
      this.pos++;
      let n = 0;
      const t = this.peek();
      if (t?.t === 'num' && /^\d$/.test(t.text)) {
        n = t.value;
        this.pos++;
      }
      this.eatKw('=');
      this.out.push({ kind: 'defusr', n, expr: this.expr() });
      return;
    }
    this.expected('FN or USR');
  }

  private letterRanges(): void {
    for (;;) {
      this.letter();
      if (this.atKw('-')) {
        this.pos++;
        this.letter();
      }
      if (!this.atPunct(',')) return;
      this.pos++;
    }
  }

  private letter(): void {
    const t = this.peek();
    if (t?.t !== 'id' || !/^[A-Z]$/.test(t.name)) this.expected('letter');
    this.pos++;
  }

  /** File and cassette statements: expressions separated by `,` `;` FOR or AS, each optionally after `#`. */
  private disk(keyword: string): void {
    if (keyword === 'CLOAD' && this.atKw('PRINT')) this.pos++; // CLOAD? is stored as CLOAD PRINT
    let afterItem = false;
    while (!this.atStatementEnd()) {
      const t = this.peek()!;
      if ((t.t === 'punct' && (t.ch === ',' || t.ch === ';')) || (t.t === 'kw' && t.name === 'FOR')) {
        this.pos++;
        afterItem = false;
        continue;
      }
      if (afterItem) {
        // AS is plain text, so written without spaces it fuses with the next name: 20ASA$.
        if (t.t !== 'id' || !t.name.startsWith('AS')) this.unexpected(t);
        this.pos++;
        afterItem = t.name.length > 2;
        continue;
      }
      if (t.t === 'punct' && t.ch === '#') this.pos++;
      this.expr();
      afterItem = true;
    }
  }

  private expr(): Expr {
    let left = this.and();
    while (this.atKw('OR')) {
      this.pos++;
      left = { kind: 'binary', op: 'OR', left, right: this.and() };
    }
    return left;
  }

  private and(): Expr {
    let left = this.not();
    while (this.atKw('AND')) {
      this.pos++;
      left = { kind: 'binary', op: 'AND', left, right: this.not() };
    }
    return left;
  }

  private not(): Expr {
    if (this.atKw('NOT')) {
      this.pos++;
      return { kind: 'unary', op: 'NOT', expr: this.not() };
    }
    return this.relational();
  }

  private relational(): Expr {
    let left = this.additive();
    for (;;) {
      const a = this.peek();
      if (a?.t !== 'kw' || !RELATIONAL.has(a.name)) return left;
      this.pos++;
      let op = a.name;
      const b = this.peek();
      if (b?.t === 'kw' && RELATIONAL.has(b.name) && b.name !== a.name) {
        this.pos++;
        op = RELATIONAL.get(a.name)! < RELATIONAL.get(b.name)! ? a.name + b.name : b.name + a.name;
      }
      left = { kind: 'binary', op, left, right: this.additive() };
    }
  }

  private additive(): Expr {
    let left = this.multiplicative();
    for (;;) {
      const t = this.peek();
      if (t?.t !== 'kw' || (t.name !== '+' && t.name !== '-')) return left;
      this.pos++;
      left = { kind: 'binary', op: t.name, left, right: this.multiplicative() };
    }
  }

  private multiplicative(): Expr {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (t?.t !== 'kw' || (t.name !== '*' && t.name !== '/')) return left;
      this.pos++;
      left = { kind: 'binary', op: t.name, left, right: this.unary() };
    }
  }

  private unary(): Expr {
    if (this.atKw('-')) {
      this.pos++;
      return { kind: 'unary', op: '-', expr: this.unary() };
    }
    if (this.atKw('+')) {
      this.pos++;
      return this.unary();
    }
    if (this.atKw('NOT')) return this.not();
    return this.power();
  }

  private power(): Expr {
    let left = this.primary();
    while (this.atKw('^')) {
      this.pos++;
      left = { kind: 'binary', op: '^', left, right: this.exponent() };
    }
    return left;
  }

  /** The right operand of `^` may carry its own sign: `2^-1`. */
  private exponent(): Expr {
    if (this.atKw('-')) {
      this.pos++;
      return { kind: 'unary', op: '-', expr: this.exponent() };
    }
    if (this.atKw('+')) {
      this.pos++;
      return this.exponent();
    }
    return this.primary();
  }

  private primary(): Expr {
    const t = this.peek();
    if (t === undefined) this.expected('expression');
    switch (t.t) {
      case 'num':
        this.pos++;
        return { kind: 'num', value: t.value };
      case 'str':
        this.pos++;
        return { kind: 'str', value: Array.from(t.value, (b) => String.fromCharCode(b)).join('') };
      case 'id':
        this.pos++;
        return { kind: 'var', name: t.name, subscripts: this.subscripts() };
      case 'punct':
        if (t.ch === '(') {
          this.pos++;
          const e = this.expr();
          this.eatPunct(')');
          return e;
        }
        break;
      case 'kw':
        if (NULLARY.has(t.name)) {
          this.pos++;
          return { kind: 'call', fn: t.name, args: [] };
        }
        if (t.name === 'FN') {
          this.pos++;
          const name = this.peek();
          if (name?.t !== 'id') this.expected('function name');
          this.pos++;
          return { kind: 'fn', name: name.name, args: this.subscripts() };
        }
        if (FUNCTIONS.has(t.name)) {
          this.pos++;
          let fn = t.name;
          const digit = this.peek();
          if (fn === 'USR' && digit?.t === 'num' && /^\d$/.test(digit.text)) {
            fn += digit.text; // Disk BASIC's USR0..USR9
            this.pos++;
          }
          this.eatPunct('(');
          const args = this.list();
          this.eatPunct(')');
          return { kind: 'call', fn, args };
        }
        break;
      case 'raw':
        break;
    }
    this.unexpected(t);
  }
}

/** Parses one line body, without its 00 terminator. A lexical failure is reported the same way as a grammatical one. */
export function parseLine(body: Uint8Array): ParsedLine {
  const lexed = lexLine(body);
  if (lexed.error !== undefined) return { ok: false, reason: lexed.error.message, statements: [] };
  const parser = new Parser(lexed.tokens, body.length);
  try {
    parser.statements(false);
  } catch (e) {
    if (e instanceof Failure) return { ok: false, reason: e.message, statements: [] };
    throw e;
  }
  return { ok: true, statements: parser.out };
}
