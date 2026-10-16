export const VERSION = '0.2.0';

export type {
  Cond, Flow, FlowKind, IndexReg, IndReg, Instruction, Operand, Reader, Reg8, Reg16, Template, TemplateOperand,
} from './types.js';
export { generateTables, TABLES } from './tables.js';
export type { Tables } from './tables.js';
export { decode, decodeAt } from './decode.js';
export { formatInstruction, formatOperand, hex4, hexByte, hexWord } from './format.js';
