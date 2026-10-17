/**
 * The constant memory addresses a tokenized BASIC line reads, writes, or calls
 * (design spec §5.4): the argument of `PEEK(n)`, the address of `POKE n,v`, and
 * the value of `DEFUSRn=n`, where n is a number or a minus sign and a number.
 * Level II takes an address above 32767 written negative (`-1` is 65535), so a
 * negative literal stands for 65536 less its size. The parser keeps the
 * expressions of assignments, POKEs, and DEFUSRs, so a PEEK is found anywhere
 * inside those; it keeps only the keyword of the other statements, so a PEEK in
 * a PRINT or an IF condition is not seen. Pure: the listing looks the addresses
 * up in the tables.
 */
import type { Expr, Statement } from './parser.js';

/** A constant address in a BASIC line and what the line does with it. */
export interface BasAddress {
  addr: number;
  /** `data` for a PEEK or POKE, which reach memory; `code` for a DEFUSR, which names a routine to call. */
  use: 'data' | 'code';
}

/** The address a number, or a minus sign and a number, stands for; undefined for anything else or a value BASIC would refuse. */
function constant(e: Expr): number | undefined {
  const n = e.kind === 'num' ? e.value : e.kind === 'unary' && e.op === '-' && e.expr.kind === 'num' ? -e.expr.value : undefined;
  return n !== undefined && Number.isInteger(n) && n >= -32768 && n <= 65535 ? n & 0xffff : undefined;
}

/** Hands every constant-address PEEK in `e` to `add`, in the order the line reads them. */
function peeks(e: Expr, add: (addr: number) => void): void {
  switch (e.kind) {
    case 'num':
    case 'str':
      return;
    case 'var':
      for (const s of e.subscripts) peeks(s, add);
      return;
    case 'unary':
      peeks(e.expr, add);
      return;
    case 'binary':
      peeks(e.left, add);
      peeks(e.right, add);
      return;
    case 'fn':
      for (const a of e.args) peeks(a, add);
      return;
    case 'call': {
      const addr = e.fn === 'PEEK' && e.args.length === 1 ? constant(e.args[0]!) : undefined;
      if (addr !== undefined) add(addr);
      else for (const a of e.args) peeks(a, add);
      return;
    }
  }
}

/**
 * The constant addresses a line's PEEKs, POKEs, and DEFUSRs use, each once, in
 * the order it first appears, with what the line does with it. A line that did
 * not parse has none. `line` is a parsed line, or a loaded one, which keeps the
 * same statements.
 */
export function basReferences(line: { readonly statements: readonly Statement[] }): BasAddress[] {
  const found = new Map<number, BasAddress>();
  const add = (addr: number, use: BasAddress['use']): void => {
    if (!found.has(addr)) found.set(addr, { addr, use });
  };
  const dataPeeks = (e: Expr): void => peeks(e, (addr) => add(addr, 'data'));
  for (const s of line.statements) {
    switch (s.kind) {
      case 'assign':
        for (const subscript of s.subscripts) dataPeeks(subscript);
        dataPeeks(s.expr);
        break;
      case 'poke': {
        const addr = constant(s.addr);
        if (addr === undefined) dataPeeks(s.addr);
        else add(addr, 'data');
        dataPeeks(s.value);
        break;
      }
      case 'defusr': {
        const addr = constant(s.expr);
        if (addr === undefined) dataPeeks(s.expr);
        else add(addr, 'code');
        break;
      }
      case 'other':
        break;
    }
  }
  return [...found.values()];
}

/** The addresses of `basReferences`, without what the line does with them. */
export function basAddresses(line: { readonly statements: readonly Statement[] }): number[] {
  return basReferences(line).map((r) => r.addr);
}
