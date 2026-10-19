/**
 * The parser: one line into a statement (label, operation, operands). It
 * knows zmac's line rules (each settled by a zmac probe):
 *
 * - A word in column 1 is a label, colon or not; with a colon a label may be
 *   indented. A name in front of EQU, DEFL, or `=` is defined wherever it is.
 * - A mnemonic alone in column 1 is an instruction; with operands it is an
 *   error (zmac: syntax error).
 * - An operand entirely inside one pair of parentheses is memory; parentheses
 *   that enclose only part of it group (zmac's rule; whether a memory operand
 *   falls back to the number is the assembler's call, by form).
 */
import { ExprError, parseExpr } from './expr.js';
import type { Expr } from './expr.js';
import { lex } from './lex.js';
import type { LexError, Token } from './lex.js';
import { CONDITIONS, INDIRECT, isDefiner, isKeyword, REGISTERS } from './names.js';

interface Span {
  col: number;
  end: number;
}

/**
 * One operand. `reg` is a register, pair, or condition by name; `ind` a
 * register in parentheses; `index` is `(IX+d)` with the displacement; `mem` a
 * parenthesised expression; `imm` an expression; `str` a lone string (DB
 * writes its characters; elsewhere it is a number).
 */
export type OperandNode = Span & { text: string } & (
    | { kind: 'reg'; reg: string }
    | { kind: 'ind'; reg: string }
    | { kind: 'index'; reg: 'IX' | 'IY'; expr: Expr }
    | { kind: 'mem'; expr: Expr; inner: string }
    | { kind: 'imm'; expr: Expr }
    | { kind: 'str'; chars: number[]; expr: Expr }
  );

export interface Statement {
  /** 1-based line number. */
  line: number;
  text: string;
  label?: Span & { name: string };
  /** The operation in upper case (`LD`, `ORG`, `=`), as written in `written`. */
  op?: Span & { name: string; written: string };
  operands: OperandNode[];
  /** A problem that stops the line; nothing else on it is used. */
  error?: LexError;
}

const isOp = (t: Token | undefined, text: string): boolean => t !== undefined && t.kind === 'op' && t.text === text;
const isDefinerToken = (t: Token | undefined): boolean =>
  t !== undefined && ((t.kind === 'ident' && isDefiner(t.text.toUpperCase())) || isOp(t, '='));

/** The index of the `)` that closes the `(` at `open`, or -1. */
function closing(tokens: readonly Token[], open: number, to: number): number {
  let depth = 0;
  for (let i = open; i < to; i++) {
    const t = tokens[i]!;
    if (isOp(t, '(')) depth++;
    else if (isOp(t, ')') && --depth === 0) return i;
  }
  return -1;
}

const BINARY_WORDS: ReadonlySet<string> = new Set(['MOD', 'SHL', 'SHR']);
const BINARY_OPS: ReadonlySet<string> = new Set(['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>']);

/**
 * `LD A B` or `LD (HL) 5`: an operand that starts with a register or a group
 * in parentheses, followed by something that is not an operator, lacks a comma.
 */
function missingComma(line: string, tokens: readonly Token[], from: number, to: number): void {
  const first = tokens[from]!;
  let last = -1;
  if (first.kind === 'ident' && (REGISTERS.has(first.text.toUpperCase()) || CONDITIONS.has(first.text.toUpperCase()))) last = from;
  else if (isOp(first, '(')) last = closing(tokens, from, to);
  if (last < 0 || last + 1 >= to) return;
  const next = tokens[last + 1]!;
  const isBinary = (next.kind === 'op' && BINARY_OPS.has(next.text)) || (next.kind === 'ident' && BINARY_WORDS.has(next.text.toUpperCase()));
  if (isBinary || isOp(next, ')')) return;
  const before = line.slice(first.col - 1, tokens[last]!.end - 1);
  throw new ExprError(`A comma is missing between ${before} and ${next.text}.`, first.col, next.end);
}

function operand(line: string, tokens: readonly Token[], from: number, to: number): OperandNode {
  const first = tokens[from]!;
  const last = tokens[to - 1]!;
  const span = { col: first.col, end: last.end, text: line.slice(first.col - 1, last.end - 1) };
  const count = to - from;
  missingComma(line, tokens, from, to);
  if (count === 1 && first.kind === 'ident' && REGISTERS.has(first.text.toUpperCase())) return { ...span, kind: 'reg', reg: first.text.toUpperCase() };
  if (count === 1 && first.kind === 'ident' && isConditionName(first.text)) return { ...span, kind: 'reg', reg: first.text.toUpperCase() };
  if (count === 1 && first.kind === 'string') return { ...span, kind: 'str', chars: first.chars!, expr: parseExpr(tokens, from, to) };
  if (isOp(first, '(') && closing(tokens, from, to) === to - 1) {
    const a = from + 1;
    const b = to - 1;
    const head = tokens[a];
    const up = head?.kind === 'ident' ? head.text.toUpperCase() : '';
    if (b - a === 1 && INDIRECT.has(up)) return { ...span, kind: 'ind', reg: up };
    if ((up === 'IX' || up === 'IY') && b - a > 1 && (isOp(tokens[a + 1], '+') || isOp(tokens[a + 1], '-'))) {
      // The sign stays with the expression, as a unary operator: (IX-3) is IX plus -3.
      return { ...span, kind: 'index', reg: up, expr: parseExpr(tokens, a + 1, b) };
    }
    if (b === a) throw new ExprError('These parentheses are empty.', first.col, last.end);
    const inner = line.slice(tokens[a]!.col - 1, tokens[b - 1]!.end - 1);
    return { ...span, kind: 'mem', expr: parseExpr(tokens, a, b), inner };
  }
  return { ...span, kind: 'imm', expr: parseExpr(tokens, from, to) };
}

const isConditionName = (text: string): boolean => CONDITIONS.has(text.toUpperCase());

/**
 * Parses one line. A line the lexer stopped on still keeps the label (and
 * operation) read before the bad token, so its uses elsewhere raise nothing
 * more; the lexer's sentence is the line's error.
 */
export function parseLine(text: string, line: number): Statement {
  const lexed = lex(text);
  const stmt = structure(text, line, lexed.tokens, lexed.error !== undefined);
  if (lexed.error !== undefined && stmt.error === undefined) stmt.error = lexed.error;
  return stmt;
}

function structure(text: string, line: number, t: readonly Token[], partial: boolean): Statement {
  const stmt: Statement = { line, text, operands: [] };
  if (t.length === 0) return stmt;
  const fail = (message: string, col: number, end: number): Statement => {
    stmt.error = { message, col, end };
    return stmt;
  };

  let i = 0;
  const first = t[0]!;
  if (first.kind === 'ident') {
    const up = first.text.toUpperCase();
    const label = (next: number): void => {
      stmt.label = { name: first.text, col: first.col, end: first.end };
      i = next;
    };
    if (isOp(t[1], ':')) label(isOp(t[2], ':') ? 3 : 2);
    else if (isDefinerToken(t[1])) label(1);
    else if (first.col === 1) {
      if (!isKeyword(up)) label(1);
      else if (t.length > 1) return fail(`${up} starts in column 1, where a word is a label. Put a space or tab before it.`, first.col, first.end);
    }
  } else if (first.kind === 'number' && first.text.startsWith('$')) {
    // zmac takes `$AB EQU 1` as a name with a "$hex constant interpreted as symbol" warning; asm does not.
    return fail(`${first.text} is the hex number ${first.text.slice(1).toUpperCase()}H, so it cannot be a name. Rename it, for example ${first.text.slice(1).toUpperCase()}_ or X${first.text.slice(1).toUpperCase()}.`, first.col, first.end);
  } else if (!isOp(first, '=')) {
    return fail(`A line starts with a label or an instruction; ${first.text} is neither.`, first.col, first.end);
  }
  if (i >= t.length) return stmt;
  if (partial && t[i]!.kind !== 'ident') return stmt;

  const opTok = t[i]!;
  if (opTok.kind !== 'ident' && !isOp(opTok, '=')) return fail(`${opTok.text} is not an instruction; an instruction or directive name should come here.`, opTok.col, opTok.end);
  stmt.op = { name: opTok.text.toUpperCase(), written: opTok.text, col: opTok.col, end: opTok.end };
  if (partial) return stmt;

  // Operands: split on commas outside parentheses.
  const start = i + 1;
  if (start >= t.length) return stmt;
  const parts: [number, number][] = [];
  let depth = 0;
  let from = start;
  for (let j = start; j < t.length; j++) {
    const tok = t[j]!;
    if (isOp(tok, '(')) depth++;
    else if (isOp(tok, ')')) depth--;
    else if (depth === 0 && isOp(tok, ',')) {
      parts.push([from, j]);
      from = j + 1;
    }
  }
  parts.push([from, t.length]);
  for (let p = 0; p < parts.length; p++) {
    const [a, b] = parts[p]!;
    if (a === b) {
      const comma = p === 0 ? t[b]! : t[a - 1]!;
      return fail(p === 0 ? 'An operand is missing before the comma.' : 'An operand is missing after the comma.', comma.col, comma.end);
    }
    try {
      stmt.operands.push(operand(text, t, a, b));
    } catch (e) {
      if (e instanceof ExprError) return fail(e.sentence ?? 'This operand cannot be read.', e.col, e.end);
      throw e;
    }
  }
  return stmt;
}
