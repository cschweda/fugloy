/**
 * What is known about the registers along a path: one rule shared by the LDIR
 * mover finder and the Explain tab's value tracker. A register holds a number
 * only when an instruction on the path put it there; everything else, and every
 * instruction not listed here that might write a register, makes it unknown.
 * The rule never claims a value it has not proven. SP, I, R and the flags are
 * not tracked.
 */
import type { Instruction, Operand } from '@fugloy/z80';

export type Reg8Name = 'A' | 'B' | 'C' | 'D' | 'E' | 'H' | 'L' | 'IXH' | 'IXL' | 'IYH' | 'IYL';
/** Known 8-bit values (null = unknown); pairs are read through `pair`. */
export type RegState = Record<Reg8Name, number | null>;
type PairName = 'BC' | 'DE' | 'HL' | 'IX' | 'IY';

const HALVES: Readonly<Record<PairName, readonly [Reg8Name, Reg8Name]>> = {
  BC: ['B', 'C'],
  DE: ['D', 'E'],
  HL: ['H', 'L'],
  IX: ['IXH', 'IXL'],
  IY: ['IYH', 'IYL'],
};
const ALL: readonly Reg8Name[] = ['A', 'B', 'C', 'D', 'E', 'H', 'L', 'IXH', 'IXL', 'IYH', 'IYL'];
const REG8: ReadonlySet<string> = new Set(ALL);
const isReg8 = (name: string): name is Reg8Name => REG8.has(name);
/** Mnemonics that write their register operand: the first one, or for RES and SET the second. */
const WRITES_OPERAND: ReadonlySet<string> = new Set(['ADD', 'ADC', 'SBC', 'IN', 'RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SLL', 'SRL', 'RES', 'SET']);
/** One-operand ALU forms and the no-operand ones that write A. */
const WRITES_A: ReadonlySet<string> = new Set(['SUB', 'AND', 'OR', 'XOR', 'NEG', 'CPL', 'DAA', 'RLCA', 'RRCA', 'RLA', 'RRA', 'RLD', 'RRD']);
/** The block and I/O-repeat group: the pairs and registers each one changes. */
const BLOCK: Readonly<Record<string, readonly Reg8Name[]>> = {
  LDI: ['B', 'C', 'D', 'E', 'H', 'L'],
  LDD: ['B', 'C', 'D', 'E', 'H', 'L'],
  LDIR: ['B', 'C', 'D', 'E', 'H', 'L'],
  LDDR: ['B', 'C', 'D', 'E', 'H', 'L'],
  CPI: ['B', 'C', 'H', 'L'],
  CPD: ['B', 'C', 'H', 'L'],
  CPIR: ['B', 'C', 'H', 'L'],
  CPDR: ['B', 'C', 'H', 'L'],
  INI: ['B', 'H', 'L'],
  IND: ['B', 'H', 'L'],
  INIR: ['B', 'H', 'L'],
  INDR: ['B', 'H', 'L'],
  OUTI: ['B', 'H', 'L'],
  OUTD: ['B', 'H', 'L'],
  OTIR: ['B', 'H', 'L'],
  OTDR: ['B', 'H', 'L'],
  DJNZ: ['B'],
  EXX: ['B', 'C', 'D', 'E', 'H', 'L'],
};

export const unknownRegs = (): RegState => ({ A: null, B: null, C: null, D: null, E: null, H: null, L: null, IXH: null, IXL: null, IYH: null, IYL: null });

export function pair(r: RegState, p: PairName): number | null {
  const [hi, lo] = HALVES[p];
  const h = r[hi];
  const l = r[lo];
  return h === null || l === null ? null : (h << 8) | l;
}

const isPair = (name: string): name is PairName => name in HALVES;

/** The 8-bit registers an operand names: a register, or the halves of a trackable pair. AF writes A only. */
function regsOf(o: Operand | undefined): readonly Reg8Name[] {
  if (o?.kind === 'reg') return isReg8(o.reg) ? [o.reg] : [];
  if (o?.kind === 'reg16') return isPair(o.reg) ? HALVES[o.reg] : o.reg === 'AF' ? ['A'] : [];
  return [];
}

const setPair = (r: RegState, p: PairName, v: number | null): void => {
  const [hi, lo] = HALVES[p];
  r[hi] = v === null ? null : (v >> 8) & 0xff;
  r[lo] = v === null ? null : v & 0xff;
};

/** What one instruction does to what is known; LDIR/LDDR clear BC, DE, HL; CALL/RST clear everything. */
export function stepRegs(ins: Instruction, r: RegState): void {
  const [a, b] = ins.operands;
  const forget = (names: readonly Reg8Name[]): void => {
    for (const n of names) r[n] = null;
  };
  const m = ins.mnemonic;
  // CALL and RST run unknown code; a DB fallback is an undocumented form (DDCB copies, ED NEG duplicates) that may write anything.
  if (m === 'CALL' || m === 'RST' || m === 'DB') return forget(ALL);
  const block = BLOCK[m];
  if (block !== undefined) return forget(block);
  if (m === 'LD') {
    if (a?.kind === 'reg16' && isPair(a.reg) && b?.kind === 'imm16') return setPair(r, a.reg, b.value);
    if (a?.kind === 'reg' && isReg8(a.reg)) {
      const t = a.reg;
      if (b?.kind === 'imm8') r[t] = b.value & 0xff;
      else if (b?.kind === 'reg' && isReg8(b.reg)) r[t] = r[b.reg];
      else r[t] = null;
      return;
    }
    return forget(regsOf(a));
  }
  if (m === 'XOR' && a?.kind === 'reg' && a.reg === 'A' && b === undefined) {
    r.A = 0;
    return;
  }
  if (m === 'INC' || m === 'DEC') {
    const d = m === 'INC' ? 1 : -1;
    if (a?.kind === 'reg' && isReg8(a.reg)) {
      const t = a.reg;
      if (r[t] !== null) r[t] = (r[t]! + d) & 0xff;
    } else if (a?.kind === 'reg16' && isPair(a.reg)) {
      const v = pair(r, a.reg);
      setPair(r, a.reg, v === null ? null : (v + d) & 0xffff);
    }
    return;
  }
  if (m === 'EX') {
    if (a?.kind === 'reg16' && a.reg === 'DE' && b?.kind === 'reg16' && b.reg === 'HL') {
      const [d, h] = [pair(r, 'DE'), pair(r, 'HL')];
      setPair(r, 'DE', h);
      setPair(r, 'HL', d);
      return;
    }
    forget(regsOf(a));
    return forget(regsOf(b));
  }
  if (m === 'POP') return forget(regsOf(a));
  if (WRITES_A.has(m)) return forget(['A']);
  if (WRITES_OPERAND.has(m)) return forget(regsOf(m === 'RES' || m === 'SET' ? b : a));
}
