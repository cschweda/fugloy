/**
 * Expressions: parsed from tokens into a tree, evaluated against a symbol
 * lookup. Precedence is zmac's, which is C's (a zmac probe settles it): from
 * loosest, `|`, `^`, `&`, `<< >> SHL SHR`, `+ -`, `* / % MOD`, then the unary
 * `+ - ~ HIGH LOW`. Arithmetic is on 32-bit integers, as zmac's is; division
 * truncates toward zero and MOD takes the sign of the dividend.
 */
import type { Token } from './lex.js';
import { CONDITIONS, OPERATOR_WORDS, REGISTERS } from './names.js';

interface Span {
  col: number;
  end: number;
}

export type Expr =
  | (Span & { k: 'num'; value: number })
  | (Span & { k: 'here' })
  | (Span & { k: 'sym'; name: string })
  | (Span & { k: 'str'; chars: number[]; text: string })
  | (Span & { k: 'un'; op: string; arg: Expr })
  | (Span & { k: 'bin'; op: string; left: Expr; right: Expr });

/** A problem in an expression, at a span of its line. A null message means it was reported already (a symbol that failed). */
export class ExprError extends Error {
  constructor(
    readonly sentence: string | null,
    readonly col: number,
    readonly end: number,
  ) {
    super(sentence ?? 'reported already');
  }
}

const LEVELS: readonly (readonly string[])[] = [['|'], ['^'], ['&'], ['<<', '>>', 'SHL', 'SHR'], ['+', '-'], ['*', '/', '%', 'MOD']];
const UNARY: ReadonlySet<string> = new Set(['+', '-', '~', 'HIGH', 'LOW']);

/** An operator token's name: the symbol, or an operator word in upper case. */
function opName(t: Token | undefined): string | undefined {
  if (t === undefined) return undefined;
  if (t.kind === 'op') return t.text;
  if (t.kind === 'ident') {
    const up = t.text.toUpperCase();
    if (OPERATOR_WORDS.has(up)) return up;
  }
  return undefined;
}

/** Parses `tokens[from..to)` as one expression; every token must belong to it. */
export function parseExpr(tokens: readonly Token[], from: number, to: number): Expr {
  let i = from;
  const peek = (): Token | undefined => (i < to ? tokens[i] : undefined);
  const lastEnd = (): number => (to > from ? tokens[to - 1]!.end : 1);

  function binary(level: number): Expr {
    if (level === LEVELS.length) return unary();
    let left = binary(level + 1);
    for (;;) {
      const op = opName(peek());
      if (op === undefined || !LEVELS[level]!.includes(op)) return left;
      i++;
      const right = binary(level + 1);
      left = { k: 'bin', op, left, right, col: left.col, end: right.end };
    }
  }

  function unary(): Expr {
    const t = peek();
    const op = opName(t);
    if (t !== undefined && op !== undefined && UNARY.has(op)) {
      i++;
      const arg = unary();
      return { k: 'un', op, arg, col: t.col, end: arg.end };
    }
    return primary();
  }

  function primary(): Expr {
    const t = peek();
    if (t === undefined) {
      const prev = i > from ? tokens[i - 1] : undefined;
      if (prev !== undefined) throw new ExprError(`The expression ends after ${prev.text}; a number or a name should follow it.`, prev.col, prev.end);
      throw new ExprError('A value is missing here.', lastEnd(), lastEnd());
    }
    i++;
    switch (t.kind) {
      case 'number':
        return { k: 'num', value: t.value!, col: t.col, end: t.end };
      case 'string':
        return { k: 'str', chars: t.chars!, text: t.text, col: t.col, end: t.end };
      case 'ident': {
        const up = t.text.toUpperCase();
        if (REGISTERS.has(up)) throw new ExprError(`${up} is a register; it cannot be part of an expression.`, t.col, t.end);
        if (CONDITIONS.has(up)) throw new ExprError(`${up} is a condition; it cannot be part of an expression.`, t.col, t.end);
        if (OPERATOR_WORDS.has(up)) throw new ExprError(`${up} needs a value on its ${up === 'HIGH' || up === 'LOW' ? 'right' : 'left'}.`, t.col, t.end);
        return { k: 'sym', name: t.text, col: t.col, end: t.end };
      }
      case 'op': {
        if (t.text === '$') return { k: 'here', col: t.col, end: t.end };
        if (t.text === '(') {
          const inner = binary(0);
          const close = peek();
          if (close === undefined || close.text !== ')') throw new ExprError('This ( has no matching ).', t.col, t.end);
          i++;
          // Grouping parentheses keep the inner tree; the span covers them.
          return { ...inner, col: t.col, end: close.end };
        }
        const next = peek();
        if (t.text === '%' && next !== undefined && next.kind === 'number' && /^[01]+$/.test(next.text)) {
          throw new ExprError(`zmac reads % as MOD, so %${next.text} is not a binary number; write ${next.text}B.`, t.col, next.end);
        }
        if (t.text === ')') throw new ExprError('This ) has no matching (.', t.col, t.end);
        throw new ExprError(`${t.text} cannot start a value.`, t.col, t.end);
      }
    }
  }

  const expr = binary(0);
  const extra = peek();
  if (extra !== undefined) {
    if (extra.text === ')') throw new ExprError('This ) has no matching (.', extra.col, extra.end);
    throw new ExprError(`${extra.text} does not belong after the value; an operator such as + should come between them.`, extra.col, extra.end);
  }
  return expr;
}

/** How evaluation finds a symbol's value; it throws an ExprError when it cannot. */
export interface EvalContext {
  /** The address of the line, for `$`. */
  here: number;
  lookup(node: Extract<Expr, { k: 'sym' }>): number;
}

/** A string as a number: one character is its code, two make a word with the first in the low byte (zmac). */
function stringValue(node: Extract<Expr, { k: 'str' }>): number {
  const c = node.chars;
  if (c.length > 2) throw new ExprError(`${node.text} has ${c.length} characters; as a number a string can have at most 2.`, node.col, node.end);
  return (c[0] ?? 0) | ((c[1] ?? 0) << 8);
}

export function evaluate(node: Expr, ctx: EvalContext): number {
  switch (node.k) {
    case 'num':
      return node.value;
    case 'here':
      return ctx.here;
    case 'sym':
      return ctx.lookup(node);
    case 'str':
      return stringValue(node);
    case 'un': {
      const v = evaluate(node.arg, ctx);
      switch (node.op) {
        case '-':
          return -v | 0;
        case '~':
          return ~v;
        case 'HIGH':
          return (v >> 8) & 0xff;
        case 'LOW':
          return v & 0xff;
        default:
          return v;
      }
    }
    case 'bin': {
      const l = evaluate(node.left, ctx);
      const r = evaluate(node.right, ctx);
      switch (node.op) {
        case '|':
          return l | r;
        case '^':
          return l ^ r;
        case '&':
          return l & r;
        case '<<':
        case 'SHL':
          return r >= 32 || r < 0 ? 0 : l << r;
        case '>>':
        case 'SHR':
          return r >= 32 || r < 0 ? (l < 0 ? -1 : 0) : l >> r;
        case '+':
          return (l + r) | 0;
        case '-':
          return (l - r) | 0;
        case '*':
          return Math.imul(l, r);
        case '/':
        case '%':
        case 'MOD':
          if (r === 0) throw new ExprError('This expression divides by zero.', node.col, node.end);
          return node.op === '/' ? Math.trunc(l / r) | 0 : l % r | 0;
        default:
          throw new ExprError(`${node.op} is not an operator Fugløy knows.`, node.col, node.end);
      }
    }
  }
}

/** The symbol an expression is, when it is nothing but one name (for messages). */
export const loneSymbol = (node: Expr): string | undefined => (node.k === 'sym' ? node.name : undefined);
