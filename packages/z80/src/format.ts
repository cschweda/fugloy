import type { Instruction, Operand } from './types.js';

const hex = (n: number, width: number): string => n.toString(16).toUpperCase().padStart(width, '0');
/** Assembler form: a leading 0 keeps a value starting with A-F from reading as a label. */
const asm = (digits: string): string => (/^[A-F]/.test(digits) ? `0${digits}H` : `${digits}H`);

/** `0DDH`, `05H` */
export const hexByte = (n: number): string => asm(hex(n & 0xff, 2));
/** `0A000H`, `3C00H` */
export const hexWord = (n: number): string => asm(hex(n & 0xffff, 4));
/** `A000` — the address column of a listing. */
export const hex4 = (n: number): string => hex(n & 0xffff, 4);

export function formatOperand(op: Operand): string {
  switch (op.kind) {
    case 'reg':
    case 'reg16':
      return op.reg;
    case 'ind':
      return `(${op.reg})`;
    case 'idx':
      return op.disp < 0 ? `(${op.reg}-${hexByte(-op.disp)})` : `(${op.reg}+${hexByte(op.disp)})`;
    case 'imm8':
      return hexByte(op.value);
    case 'imm16':
      return hexWord(op.value);
    case 'mem':
      return `(${hexWord(op.addr)})`;
    case 'port':
      return `(${hexByte(op.value)})`;
    case 'rel':
      return hexWord(op.target);
    case 'cc':
      return op.cond;
    case 'bit':
      return String(op.bit);
    case 'rst':
      return hexByte(op.addr);
    case 'im':
      return String(op.mode);
    case 'byte':
      return hexByte(op.value);
  }
}

/** `LD A,(IX+05H)` — mnemonic and comma-separated operands in zmac spelling. */
export function formatInstruction(ins: Instruction): string {
  return ins.operands.length === 0 ? ins.mnemonic : `${ins.mnemonic} ${ins.operands.map(formatOperand).join(',')}`;
}
