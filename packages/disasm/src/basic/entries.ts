/**
 * Entry-point miner for tokenized BASIC (spec §3, §5.2). Hidden machine code
 * is reached through an address the BASIC text plants: `DEFUSR[n]=addr`, the
 * USR vector poked at 16526/16527, or a JP (195) poked at some `a` with its
 * address poked at `a+1` and `a+2`. Addresses come from a small abstract
 * evaluator over constants and "program start plus N": Level II keeps the
 * program start at 16548/16549, so `PEEK(16548)+256*PEEK(16549)` (operands in
 * either order) is the start, `INT(x/256)` and `x-hi*256` split a value into
 * its high and low bytes, and assignments are tracked in file order by each
 * variable's two significant characters. Anything else is unknown, and an
 * idiom with an unknown address comes back as a note with `addr: null`.
 */
import type { BasProgram } from '../bas.js';
import type { Expr } from './parser.js';

export type AbstractValue =
  | { kind: 'const'; value: number }
  | { kind: 'base'; offset: number }
  | { kind: 'hi' | 'lo'; of: AbstractValue }
  | { kind: 'unknown' };

export interface MinedEntry {
  /** Null when the idiom is there but its address cannot be resolved. */
  addr: number | null;
  evidence: string;
  /** The line whose statement completed the idiom. */
  line: number;
}

/** 256 × hi(of): the intermediate both byte idioms pass through. */
type Value = AbstractValue | { kind: 'hi256'; of: AbstractValue };

const TXTTAB = 16548; // $40A4/$40A5: where Level II keeps the program's start address
const USR_VECTOR = 16526; // $408E/$408F
const JP = 195;
const UNKNOWN: AbstractValue = { kind: 'unknown' };
const PROGRAM_START: AbstractValue = { kind: 'base', offset: 0 };
const konst = (value: number): AbstractValue => ({ kind: 'const', value });
const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');

/** Level II tells variables apart by their first two characters and type suffix. */
function significant(name: string): string {
  const suffix = /[$%!#]$/.test(name) ? name.slice(-1) : '';
  return name.slice(0, name.length - suffix.length).slice(0, 2) + suffix;
}

function same(a: AbstractValue, b: AbstractValue): boolean {
  if (a.kind === 'const' && b.kind === 'const') return a.value === b.value;
  if (a.kind === 'base' && b.kind === 'base') return a.offset === b.offset;
  if ((a.kind === 'hi' || a.kind === 'lo') && a.kind === b.kind) return same(a.of, (b as typeof a).of);
  return false;
}

const hiOf = (v: Value): Value =>
  v.kind === 'const' ? konst((Math.trunc(v.value) >> 8) & 0xff) : v.kind === 'base' ? { kind: 'hi', of: v } : UNKNOWN;

function binary(op: string, l: Value, r: Value): Value {
  if (l.kind === 'const' && r.kind === 'const') {
    switch (op) {
      case '+': return konst(l.value + r.value);
      case '-': return konst(l.value - r.value);
      case '*': return konst(l.value * r.value);
      case '/': return r.value === 0 ? UNKNOWN : konst(l.value / r.value);
      default: return UNKNOWN;
    }
  }
  switch (op) {
    case '+':
      if (l.kind === 'base' && r.kind === 'const') return { kind: 'base', offset: l.offset + r.value };
      if (l.kind === 'const' && r.kind === 'base') return { kind: 'base', offset: r.offset + l.value };
      if (l.kind === 'lo' && r.kind === 'hi256' && same(l.of, r.of)) return l.of;
      if (l.kind === 'hi256' && r.kind === 'lo' && same(l.of, r.of)) return r.of;
      return UNKNOWN;
    case '-':
      if (l.kind === 'base' && r.kind === 'const') return { kind: 'base', offset: l.offset - r.value };
      if (l.kind === 'base' && r.kind === 'hi256' && same(l, r.of)) return { kind: 'lo', of: l };
      return UNKNOWN;
    case '*':
      if (l.kind === 'hi' && r.kind === 'const' && r.value === 256) return { kind: 'hi256', of: l.of };
      if (l.kind === 'const' && l.value === 256 && r.kind === 'hi') return { kind: 'hi256', of: r.of };
      return UNKNOWN;
    default:
      return UNKNOWN;
  }
}

function evaluate(e: Expr, vars: ReadonlyMap<string, Value>): Value {
  switch (e.kind) {
    case 'num':
      return konst(e.value);
    case 'var':
      return e.subscripts.length > 0 ? UNKNOWN : (vars.get(significant(e.name)) ?? UNKNOWN);
    case 'unary': {
      const v = evaluate(e.expr, vars);
      return e.op === '-' && v.kind === 'const' ? konst(-v.value) : UNKNOWN;
    }
    case 'binary':
      return binary(e.op, evaluate(e.left, vars), evaluate(e.right, vars));
    case 'call': {
      const arg = e.args.length === 1 ? e.args[0]! : undefined;
      if (arg === undefined) return UNKNOWN;
      if (e.fn === 'PEEK') {
        const a = evaluate(arg, vars);
        if (a.kind === 'const' && a.value === TXTTAB) return { kind: 'lo', of: PROGRAM_START };
        if (a.kind === 'const' && a.value === TXTTAB + 1) return { kind: 'hi', of: PROGRAM_START };
        return UNKNOWN;
      }
      if (e.fn === 'INT') {
        if (arg.kind === 'binary' && arg.op === '/') {
          const d = evaluate(arg.right, vars);
          if (d.kind === 'const' && d.value === 256) {
            const x = evaluate(arg.left, vars);
            return x.kind === 'const' ? konst(Math.floor(x.value / 256)) : hiOf(x);
          }
        }
        const v = evaluate(arg, vars);
        return v.kind === 'const' ? konst(Math.floor(v.value)) : UNKNOWN;
      }
      return UNKNOWN;
    }
    case 'str':
    case 'fn':
      return UNKNOWN;
  }
}

/** The 16-bit value two poked bytes form, or null. */
function combine(lo: Value | undefined, hi: Value | undefined): AbstractValue | null {
  if (lo === undefined || hi === undefined) return null;
  if (lo.kind === 'const' && hi.kind === 'const') return konst((lo.value & 0xff) | ((hi.value & 0xff) << 8));
  if (lo.kind === 'lo' && hi.kind === 'hi' && same(lo.of, hi.of)) return lo.of;
  return null;
}

const resolve = (v: Value, base: number): number | null =>
  v.kind === 'const' ? Math.trunc(v.value) & 0xffff : v.kind === 'base' ? (base + v.offset) & 0xffff : null;

const describe = (v: AbstractValue): string =>
  v.kind === 'const'
    ? `$${hex4(Math.trunc(v.value) & 0xffff)}`
    : v.kind === 'base' && v.offset !== 0
      ? `program start ${v.offset > 0 ? '+' : '-'} ${Math.abs(v.offset)}`
      : 'program start';

export function mineEntries(prog: BasProgram): MinedEntry[] {
  const vars = new Map<string, Value>();
  const pokes = new Map<number, Value>();
  /** JP opcode address → line of its POKE, while the address after it is unresolved. */
  const jpPending = new Map<number, number>();
  let usrPending: number | null = null;
  const out: MinedEntry[] = [];
  const seen = new Set<string>();
  const emit = (addr: number | null, evidence: string, line: number): void => {
    if (seen.has(evidence)) return;
    seen.add(evidence);
    out.push({ addr, evidence, line });
  };
  for (const line of prog.lines) {
    if (!line.parsed) continue;
    const n = line.number;
    for (const s of line.statements) {
      if (s.kind === 'assign') {
        if (s.subscripts.length === 0) vars.set(significant(s.name), evaluate(s.expr, vars));
      } else if (s.kind === 'defusr') {
        const v = evaluate(s.expr, vars);
        const addr = resolve(v, prog.base);
        if (addr === null || v.kind === 'hi256') emit(null, `line ${n}: DEFUSR${s.n} with a value the miner cannot resolve`, n);
        else emit(addr, `line ${n}: DEFUSR${s.n} = ${describe(v)}`, n);
      } else if (s.kind === 'poke') {
        const a = evaluate(s.addr, vars);
        if (a.kind !== 'const') continue;
        const at = Math.trunc(a.value) & 0xffff;
        pokes.set(at, evaluate(s.value, vars));
        if (at === USR_VECTOR || at === USR_VECTOR + 1) {
          const v = combine(pokes.get(USR_VECTOR), pokes.get(USR_VECTOR + 1));
          const addr = v === null ? null : resolve(v, prog.base);
          if (v !== null && addr !== null) {
            emit(addr, `line ${n}: POKE 16526/16527 (the USR vector) = ${describe(v)}`, n);
            usrPending = null;
          } else usrPending = n;
        }
        for (const j of [at, at - 1, at - 2]) {
          const op = pokes.get(j & 0xffff);
          if (op?.kind !== 'const' || op.value !== JP) continue;
          const v = combine(pokes.get((j + 1) & 0xffff), pokes.get((j + 2) & 0xffff));
          const addr = v === null ? null : resolve(v, prog.base);
          if (v !== null && addr !== null) {
            emit(addr, `line ${n}: POKE ${j},195 with address ${describe(v)}`, n);
            jpPending.delete(j);
          } else if (!jpPending.has(j)) jpPending.set(j, n);
        }
      }
    }
  }
  if (usrPending !== null) emit(null, `line ${usrPending}: POKE 16526/16527 (the USR vector) with a value the miner cannot resolve`, usrPending);
  for (const [j, n] of jpPending) emit(null, `line ${n}: POKE ${j},195 with an address the miner cannot resolve`, n);
  return out;
}
