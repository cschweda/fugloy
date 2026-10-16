/**
 * Pass 2: what each referenced address is called. Names are synthesized from
 * use (L for jump targets, SUB_ for call targets, DATA_ for data references,
 * TBL_ for declared tables) and user names from the hint file replace them.
 * Pass 2 never changes what a byte is.
 */
import type { Instruction } from '@fugloy/z80';
import type { Annotations } from '../hints/apply.js';
import type { MemoryImage } from '../memory.js';
import type { Pass1 } from './descent.js';

export type SymbolKind = 'code' | 'sub' | 'data' | 'table';

export interface Symbol {
  addr: number;
  name: string;
  kind: SymbolKind;
  source: 'synth' | 'user';
}

/** Higher wins when two uses meet at one address. */
const RANK: Record<SymbolKind, number> = { data: 0, table: 1, code: 2, sub: 3 };
const PREFIX: Record<SymbolKind, string> = { code: 'L', sub: 'SUB_', data: 'DATA_', table: 'TBL_' };
const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');

export class SymbolTable {
  private readonly byAddr = new Map<number, Symbol>();

  get(addr: number): Symbol | undefined {
    return this.byAddr.get(addr & 0xffff);
  }

  has(addr: number): boolean {
    return this.byAddr.has(addr & 0xffff);
  }

  /** All symbols in address order. */
  list(): Symbol[] {
    return [...this.byAddr.values()].sort((a, b) => a.addr - b.addr);
  }

  /** @internal */
  set(symbol: Symbol): void {
    this.byAddr.set(symbol.addr & 0xffff, symbol);
  }
}

const DATA_REGS = new Set(['BC', 'DE', 'HL', 'IX', 'IY']);

/**
 * The address an instruction references as data: the immediate of
 * LD BC|DE|HL|IX|IY,nn or any (nn) memory operand. LD SP,nn, ports, and
 * other immediates are constants.
 */
export function dataReference(ins: Instruction): number | null {
  for (const op of ins.operands) if (op.kind === 'mem') return op.addr;
  const [first, second] = ins.operands;
  if (ins.mnemonic === 'LD' && first?.kind === 'reg16' && DATA_REGS.has(first.reg) && second?.kind === 'imm16') return second.value;
  return null;
}

export function synthesizeSymbols(pass1: Pass1, annotations: Annotations, image: MemoryImage): SymbolTable {
  const table = new SymbolTable();
  const propose = (addr: number, kind: SymbolKind): void => {
    if (!image.isLoaded(addr)) return;
    const current = table.get(addr);
    if (current !== undefined && RANK[current.kind] >= RANK[kind]) return;
    table.set({ addr: addr & 0xffff, name: `${PREFIX[kind]}${hex4(addr)}`, kind, source: 'synth' });
  };
  for (const x of pass1.xrefs) {
    if (x.kind === 'rst') continue;
    propose(x.to, x.kind === 'call' || x.kind === 'ccall' ? 'sub' : 'code');
  }
  for (const t of annotations.tables) propose(t.addr, 'table');
  for (const ins of pass1.instructions.values()) {
    const ref = dataReference(ins);
    if (ref !== null) propose(ref, 'data');
  }
  for (const [addr, name] of annotations.names) {
    const current = table.get(addr);
    table.set({ addr: addr & 0xffff, name, kind: current?.kind ?? 'data', source: 'user' });
  }
  return table;
}
