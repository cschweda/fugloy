/** 8-bit registers, including the undocumented IX/IY halves. */
export type Reg8 = 'A' | 'B' | 'C' | 'D' | 'E' | 'H' | 'L' | 'I' | 'R' | 'IXH' | 'IXL' | 'IYH' | 'IYL';
/** 16-bit register pairs. */
export type Reg16 = 'AF' | 'BC' | 'DE' | 'HL' | 'SP' | 'IX' | 'IY' | "AF'";
/** Registers that appear in parentheses: (HL), (BC), (DE), (SP), (IX), (IY), (C). */
export type IndReg = 'BC' | 'DE' | 'HL' | 'SP' | 'IX' | 'IY' | 'C';
export type IndexReg = 'IX' | 'IY';
export type Cond = 'NZ' | 'Z' | 'NC' | 'C' | 'PO' | 'PE' | 'P' | 'M';

/** A fully resolved operand of a decoded instruction. */
export type Operand =
  | { kind: 'reg'; reg: Reg8 }
  | { kind: 'reg16'; reg: Reg16 }
  | { kind: 'ind'; reg: IndReg }
  | { kind: 'idx'; reg: IndexReg; disp: number }
  | { kind: 'imm8'; value: number }
  | { kind: 'imm16'; value: number }
  | { kind: 'mem'; addr: number }
  | { kind: 'port'; value: number }
  | { kind: 'rel'; disp: number; target: number }
  | { kind: 'cc'; cond: Cond }
  | { kind: 'bit'; bit: number }
  | { kind: 'rst'; addr: number }
  | { kind: 'im'; mode: 0 | 1 | 2 }
  | { kind: 'byte'; value: number };

export type FlowKind = 'next' | 'jump' | 'call' | 'return' | 'halt';

/** What the instruction does to control flow. */
export interface Flow {
  kind: FlowKind;
  conditional: boolean;
  /** True for JP (HL), JP (IX), JP (IY): the target is not in the instruction bytes. */
  indirect: boolean;
}

export interface Instruction {
  mnemonic: string;
  operands: Operand[];
  /** Total bytes consumed, including prefixes, displacement, and immediates. */
  length: number;
  bytes: number[];
  /** T-states; for conditional instructions the taken (longer) path. */
  cycles: number;
  cyclesNotTaken?: number;
  flow: Flow;
  /** False for undocumented forms (SLL, IXH/IXL) and for DB fallbacks. */
  documented: boolean;
  /** True when the bytes ran out and a one-byte DB was returned instead. */
  truncated?: boolean;
}

/**
 * An operand slot in a generated table entry. Fixed operands are known from the
 * opcode alone; the others are filled from the bytes that follow it.
 */
export type TemplateOperand =
  | { t: 'fixed'; op: Operand }
  | { t: 'n' }
  | { t: 'nn' }
  | { t: '(nn)' }
  | { t: '(n)' }
  | { t: 'e' }
  | { t: '(ix+d)'; reg: IndexReg }
  | { t: 'd' };

export interface Template {
  mnemonic: string;
  operands: TemplateOperand[];
  length: number;
  cycles: number;
  cyclesNotTaken?: number;
  flow: Flow;
  documented: boolean;
  /** Set on the table slot of a prefix byte; the decoder dispatches to the prefixed table instead. */
  prefix?: 'CB' | 'DD' | 'ED' | 'FD';
}

/** Reads the byte at `index` relative to the instruction start, or undefined past the end. */
export type Reader = (index: number) => number | undefined;
