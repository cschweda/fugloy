/**
 * The directives: their names, the rules for their values, and their pass-1
 * handlers (ORG, .PHASE, .DEPHASE, END, DS). Each rule follows zmac, probed in
 * test/zmac-probes.test.ts:
 *
 * - DS without a fill leaves a gap (nothing is loaded there), except inside
 *   .PHASE, where zmac writes zeros. Its fill is 0 to 127: zmac calls 80H a
 *   Value error, though DB takes it, and a negative fill draws its "Phase
 *   error" though the bytes come out right.
 * - In DB and DW, `$` is the address of each value, not of the line.
 * - A label on an ORG or .PHASE line takes the address before the directive;
 *   one on .DEPHASE takes the run address before it.
 * - An EQU may be repeated with the same value; DEFL and `=` redefine, and a
 *   use above every definition takes the last one (zmac's extra passes).
 * - Everything after END is ignored, unread.
 */
import type { Assembly, Item } from './assemble.js';
import { show } from './encode.js';
import { CONDITIONS } from './names.js';
import type { OperandNode, Statement } from './parse.js';

export const DATA_BYTES: ReadonlySet<string> = new Set(['DB', 'DEFB', 'DEFM']);
export const DATA_WORDS: ReadonlySet<string> = new Set(['DW', 'DEFW']);
export const RESERVE: ReadonlySet<string> = new Set(['DS', 'DEFS']);
/** Directives that redefine the name in front of them. */
export const REDEFINERS: ReadonlySet<string> = new Set(['DEFL', '=']);

/** Why a DS count is out of range, or undefined. */
export function countProblem(name: string, count: number): string | undefined {
  if (count >= 0 && count <= 0xffff) return undefined;
  return `${name} reserves 0 to 65535 bytes; ${show(count)} is out of range.`;
}

/** Why a DS fill is out of range (zmac takes 0 to 127 there), or undefined. */
export function fillProblem(name: string, fill: number): string | undefined {
  if (fill >= 0 && fill <= 127) return undefined;
  let message = `${name} fills with a byte from 0 to 127, as zmac requires; ${show(fill)} is out of range.`;
  if (fill >= -128 && fill <= 255) message += ' Write the bytes with DB instead.';
  return message;
}

/** Why an address (ORG, .PHASE, END) is out of range, or undefined. */
export function addressProblem(name: string, value: number): string | undefined {
  if (value >= 0 && value <= 0xffff) return undefined;
  return `${name} takes an address, 0 to 65535; ${show(value)} is out of range.`;
}

/** `$3C00`. */
export const address = (value: number): string => `$${(value & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;

/** `B is a register`, `NZ is a condition`, `(HL) is a register`, for an operand that should have been a value. */
export function registerWords(o: OperandNode): string {
  if (o.kind === 'reg') return `${o.reg} is a ${CONDITIONS.has(o.reg) ? 'condition' : 'register'}`;
  return `${o.text} is a register`;
}

/** The span of a statement from its operation to its last operand (or its label, if it has nothing else). */
export function spanOf(stmt: Statement): { col: number; end: number } {
  const from = stmt.op ?? stmt.label;
  const last = stmt.operands[stmt.operands.length - 1];
  return { col: from?.col ?? 1, end: last?.end ?? from?.end ?? Math.max(2, stmt.text.length + 1) };
}

// ---- the directives' pass-1 handlers ---------------------------------------

/** ORG: a new address for both pc and load; not allowed under .PHASE. */
export function org(asm: Assembly, stmt: Statement, item: Item): void {
  const op = stmt.op!;
  item.failed = true;
  // Even a failed ORG counts, so the lines after it raise nothing more.
  asm.sawOrg = true;
  if (asm.phase !== null) return asm.error(stmt.line, op.col, op.end, `ORG cannot be used inside .PHASE (line ${asm.phase}). End it with .DEPHASE first.`);
  const value = asm.addressOperand(stmt, 'ORG');
  if (value === undefined) return;
  item.failed = false;
  // zmac gives a label on the ORG line the address before the ORG; say so, since the new one is likelier meant.
  const label = stmt.label;
  const sym = label === undefined ? undefined : asm.syms.get(label.name.toUpperCase());
  if (label !== undefined && sym !== undefined && sym.line === stmt.line && sym.kind === 'label') {
    asm.report('warning', stmt.line, label.col, label.end, `${sym.name} is ${address(sym.value!)}, the address before this ORG, as in zmac. To name ${address(value)}, put ${sym.name} on the line after the ORG.`);
  }
  asm.pc = value;
  asm.load = value;
}

/** .PHASE: code from here runs at its address but keeps loading where it is. */
export function startPhase(asm: Assembly, stmt: Statement, item: Item): void {
  const op = stmt.op!;
  item.failed = true;
  if (asm.phase !== null) return asm.error(stmt.line, op.col, op.end, `.PHASE is already in effect since line ${asm.phase}. End it with .DEPHASE first.`);
  // Even a failed .PHASE opens, so its .DEPHASE raises nothing more.
  asm.phase = stmt.line;
  const value = asm.addressOperand(stmt, '.PHASE');
  if (value === undefined) return;
  item.failed = false;
  asm.pc = value;
}

/** .DEPHASE: the run address returns to the load address. */
export function endPhase(asm: Assembly, stmt: Statement, item: Item): void {
  const op = stmt.op!;
  item.failed = true;
  if (asm.phase === null) return asm.error(stmt.line, op.col, op.end, '.DEPHASE has no .PHASE to end.');
  if (stmt.operands.length > 0) return asm.error(stmt.line, op.col, spanOf(stmt).end, '.DEPHASE takes no operands.');
  item.failed = false;
  asm.phase = null;
  asm.pc = asm.load;
}

/** END: the entry, if any, is evaluated in pass 2. */
export function end(asm: Assembly, stmt: Statement, item: Item): void {
  const [operand, ...rest] = stmt.operands;
  if (operand === undefined) return;
  if (rest.length > 0) {
    item.failed = true;
    return asm.error(stmt.line, stmt.op!.col, spanOf(stmt).end, 'END takes at most one entry address.');
  }
  if (operand.kind === 'reg' || operand.kind === 'ind' || operand.kind === 'index') {
    item.failed = true;
    return asm.error(stmt.line, operand.col, operand.end, `END needs an entry address; ${registerWords(operand)}.`);
  }
  asm.endItem = item;
}

/** DS/DEFS: the count now (only names above count), the fill in pass 2. */
export function reserve(asm: Assembly, stmt: Statement, item: Item): void {
  const op = stmt.op!;
  const name = op.name;
  const [count, fill, ...rest] = stmt.operands;
  item.failed = true;
  if (count === undefined) return asm.error(stmt.line, op.col, op.end, `${name} needs a count after it, as in ${name} 10.`);
  if (rest.length > 0) return asm.error(stmt.line, op.col, spanOf(stmt).end, `${name} takes a count and at most one fill byte, as in ${name} 10 or ${name} 10,0.`);
  for (const [o, what] of [[count, 'a count'], [fill, 'a fill byte']] as const) {
    if (o !== undefined && (o.kind === 'reg' || o.kind === 'ind' || o.kind === 'index')) return asm.error(stmt.line, o.col, o.end, `${name} needs ${what}; ${registerWords(o)}.`);
  }
  let length: number;
  try {
    length = asm.evaluateNow((count as Exclude<OperandNode, { kind: 'reg' | 'ind' }>).expr, stmt.line, name);
  } catch (e) {
    return asm.exprError(stmt.line, e);
  }
  const problem = countProblem(name, length);
  if (problem !== undefined) return asm.error(stmt.line, count.col, count.end, problem);
  item.failed = false;
  item.length = length;
  if (fill !== undefined) item.fill = fill;
  // zmac writes zeros for a DS with no fill under .PHASE, and leaves a gap elsewhere.
  asm.place(item, fill !== undefined || asm.phase !== null ? 'fill' : 'space');
}
