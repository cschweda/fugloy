/** Operand text with symbol names where a symbol exists and the operand is a reference; shared by the emitter and the listing. */
import { formatOperand } from '@fugloy/z80';
import type { Instruction } from '@fugloy/z80';
import { dataReference } from '../analysis/symbols.js';
import type { SymbolTable } from '../analysis/symbols.js';

export function renderOperands(ins: Instruction, symbols?: SymbolTable): string {
  if (symbols === undefined) return ins.operands.map(formatOperand).join(',');
  const transfer = ins.flow.kind === 'jump' || ins.flow.kind === 'call';
  const ref = dataReference(ins);
  return ins.operands
    .map((op) => {
      if (op.kind === 'rel') return symbols.get(op.target)?.name ?? formatOperand(op);
      if (op.kind === 'imm16' && (transfer || ref === op.value)) return symbols.get(op.value)?.name ?? formatOperand(op);
      if (op.kind === 'mem') {
        const s = symbols.get(op.addr);
        return s === undefined ? formatOperand(op) : `(${s.name})`;
      }
      return formatOperand(op);
    })
    .join(',');
}

/** `LD HL,DATA_7000` — mnemonic and operands with symbol names. */
export function renderInstruction(ins: Instruction, symbols?: SymbolTable): string {
  const operands = renderOperands(ins, symbols);
  return operands === '' ? ins.mnemonic : `${ins.mnemonic} ${operands}`;
}
