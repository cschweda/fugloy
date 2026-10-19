/** The reserved words of the source language: registers, conditions, operator words, and directives. */
import { mnemonics } from './encode.js';

/** Register and pair names an operand can be. `F` exists only so `IN F,(C)` reaches its sentence. */
export const REGISTERS: ReadonlySet<string> = new Set([
  'A', 'B', 'C', 'D', 'E', 'H', 'L', 'I', 'R', 'F',
  'IXH', 'IXL', 'IYH', 'IYL',
  'AF', 'BC', 'DE', 'HL', 'SP', 'IX', 'IY', "AF'",
]);

/** Condition names (`C` is listed as a register). */
export const CONDITIONS: ReadonlySet<string> = new Set(['NZ', 'Z', 'NC', 'PO', 'PE', 'P', 'M']);

/** Registers that may stand alone in parentheses: `(HL)`, `(C)`, `(IX)`. */
export const INDIRECT: ReadonlySet<string> = new Set(['HL', 'BC', 'DE', 'SP', 'C', 'IX', 'IY']);

/** Words that are operators inside expressions. */
export const OPERATOR_WORDS: ReadonlySet<string> = new Set(['HIGH', 'LOW', 'MOD', 'SHL', 'SHR']);

/**
 * Every directive the language has, handled or not yet. Task 2 assembles ORG,
 * EQU, DB/DEFB/DEFM, and DW/DEFW; the rest belong to Task 3.
 */
export const DIRECTIVES: readonly string[] = ['ORG', 'EQU', 'DEFL', '=', 'DB', 'DEFB', 'DEFM', 'DW', 'DEFW', 'DS', 'DEFS', '.PHASE', '.DEPHASE', 'END'];

const MNEMONICS: ReadonlySet<string> = new Set(mnemonics());
const DIRECTIVE_SET: ReadonlySet<string> = new Set(DIRECTIVES);

export const isMnemonic = (upper: string): boolean => MNEMONICS.has(upper);
export const isDirective = (upper: string): boolean => DIRECTIVE_SET.has(upper);
/** A word that names an instruction or a directive. */
export const isKeyword = (upper: string): boolean => MNEMONICS.has(upper) || DIRECTIVE_SET.has(upper);
/** A word that defines the name in front of it. */
export const isDefiner = (upper: string): boolean => upper === 'EQU' || upper === 'DEFL' || upper === '=';
