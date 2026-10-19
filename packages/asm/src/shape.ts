import type { Cond, Reg8, Reg16, TemplateOperand } from '@fugloy/z80';

/**
 * An operand's shape, as the parser sees it before any value is known.
 *
 * A register, pair, or condition is its name (`C` serves as both the register
 * and the condition; the template decides). A register in parentheses is
 * `(HL)` and so on. A number is an immediate: `n`, `nn`, `e`, or `num` (a bit
 * number, RST vector, or IM mode) all match any template slot that takes a
 * number, since no mnemonic has two forms that differ only in the size of an
 * immediate. A number in parentheses is `(nn)` or `(n)`, which likewise match
 * either memory slot. `(IX+d)` and `(IY+d)` carry the displacement as the value;
 * `(IX)` and `(IY)` mean the plain indirect form where one exists (`JP (IX)`)
 * and `(IX+0)` everywhere else. `F` fits no template; it exists so that
 * `IN F,(C)` reaches the encoder and gets its sentence.
 */
export type Shape =
  | 'F'
  | Reg8
  | Reg16
  | Cond
  | '(HL)'
  | '(BC)'
  | '(DE)'
  | '(SP)'
  | '(C)'
  | '(IX)'
  | '(IY)'
  | 'n'
  | 'nn'
  | '(nn)'
  | '(n)'
  | 'e'
  | '(IX+d)'
  | '(IY+d)'
  | 'num';

/** One operand handed to the encoder: its shape and, for a number, its value. */
export interface Operand {
  shape: Shape;
  value?: number;
}

const IMMEDIATE: ReadonlySet<string> = new Set(['n', 'nn', 'e', 'num']);
const MEMORY: ReadonlySet<string> = new Set(['(n)', '(nn)']);

export const isImmediate = (shape: Shape): boolean => IMMEDIATE.has(shape);
export const isMemory = (shape: Shape): boolean => MEMORY.has(shape);

/**
 * How a template slot reads in a form, in the Zilog manual's notation: the
 * register or condition by name, `n`, `nn`, `(nn)`, `(n)`, `e`, `(IX+d)`; a bit
 * number is `b` and an RST vector `p`, since the forms differ only in that
 * number; an IM mode is the mode itself.
 */
export function slotText(o: TemplateOperand): string {
  switch (o.t) {
    case 'fixed': {
      const op = o.op;
      switch (op.kind) {
        case 'reg':
        case 'reg16':
          return op.reg;
        case 'cc':
          return op.cond;
        case 'ind':
          return `(${op.reg})`;
        case 'bit':
          return 'b';
        case 'rst':
          return 'p';
        case 'im':
          return String(op.mode);
        default:
          return op.kind;
      }
    }
    case '(ix+d)':
      return `(${o.reg}+d)`;
    default:
      return o.t;
  }
}

/**
 * Whether an operand of `shape` fits template slot `o`. With `indexZero`,
 * `(IX)` and `(IY)` also fit an `(IX+d)` slot, as `(IX+0)`.
 */
export function fits(shape: Shape, o: TemplateOperand, indexZero: boolean): boolean {
  switch (o.t) {
    case 'fixed': {
      const op = o.op;
      switch (op.kind) {
        case 'reg':
        case 'reg16':
          return shape === op.reg;
        case 'cc':
          return shape === op.cond;
        case 'ind':
          return shape === `(${op.reg})`;
        case 'bit':
        case 'rst':
        case 'im':
          return isImmediate(shape);
        default:
          return false;
      }
    }
    case 'n':
    case 'nn':
    case 'e':
    case 'd':
      return isImmediate(shape);
    case '(n)':
    case '(nn)':
      return isMemory(shape);
    case '(ix+d)':
      return shape === `(${o.reg}+d)` || (indexZero && shape === `(${o.reg})`);
  }
}

/** The number a fixed slot stands for (bit, vector, mode), or undefined for any other slot. */
export function fixedNumber(o: TemplateOperand): number | undefined {
  if (o.t !== 'fixed') return undefined;
  const op = o.op;
  if (op.kind === 'bit') return op.bit;
  if (op.kind === 'rst') return op.addr;
  if (op.kind === 'im') return op.mode;
  return undefined;
}
