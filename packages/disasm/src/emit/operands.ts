/** Operand text and spans with symbol names where a symbol exists and the operand is a reference; shared by the emitter and the listing. */
import { hexByte, hexWord } from '@fugloy/z80';
import type { Instruction, Operand } from '@fugloy/z80';
import { inTableOrder } from '../analysis/externals.js';
import type { ExternalNames } from '../analysis/externals.js';
import { operandUse, operandValue } from '../analysis/symbols.js';
import type { SymbolTable } from '../analysis/symbols.js';
import type { Span } from '../rows.js';
import type { TableEntry } from '../symbols/types.js';

/** A name an operand takes: its text, the address, port, or service call it stands for, and the table entry when it is a table name. */
export interface OperandName {
  text: string;
  target: number;
  entry?: TableEntry;
}

/**
 * The name an operand takes, if any: the program's own symbol at its address
 * first, then the table name `externals` gives it. A port number is not an
 * address, so only the port names apply to it. Which lookup an operand uses is
 * `operandUse`, which `externalUses` follows too.
 */
function operandName(ins: Instruction, op: Operand, symbols: SymbolTable | undefined, externals: ExternalNames | undefined): OperandName | undefined {
  const use = operandUse(ins, op);
  const value = operandValue(op);
  if (use === undefined || value === undefined) return undefined;
  const own = use === 'port' ? undefined : symbols?.get(value);
  if (own !== undefined) return { text: own.name, target: value };
  const table = use === 'port' ? externals?.port(value) : use === 'code' ? externals?.code(value) : externals?.data(value);
  return table === undefined ? undefined : { text: table.text, target: value, entry: table.entry };
}

const punct = (text: string): Span => ({ text, kind: 'punct' });
const num = (text: string): Span => ({ text, kind: 'number' });

/** A program name is a `label` span, a table name a `table` span; both carry what they stand for. */
export function nameSpan(name: OperandName): Span {
  return name.entry === undefined ? { text: name.text, kind: 'label', target: name.target } : { text: name.text, kind: 'table', target: name.target, entry: name.entry };
}

/** The spans of one operand, spelled as `formatOperand` spells it unless a name replaces the number. */
function operandSpans(op: Operand, name: OperandName | undefined): Span[] {
  if (name !== undefined) return op.kind === 'mem' || op.kind === 'port' ? [punct('('), nameSpan(name), punct(')')] : [nameSpan(name)];
  switch (op.kind) {
    case 'reg':
    case 'reg16':
      return [{ text: op.reg, kind: 'register' }];
    case 'ind':
      return [punct('('), { text: op.reg, kind: 'register' }, punct(')')];
    case 'idx':
      return [punct('('), { text: op.reg, kind: 'register' }, punct(op.disp < 0 ? '-' : '+'), num(hexByte(Math.abs(op.disp))), punct(')')];
    case 'imm8':
    case 'byte':
      return [num(hexByte(op.value))];
    case 'imm16':
      return [num(hexWord(op.value))];
    case 'mem':
      return [punct('('), num(hexWord(op.addr)), punct(')')];
    case 'port':
      return [punct('('), num(hexByte(op.value)), punct(')')];
    case 'rel':
      return [num(hexWord(op.target))];
    case 'cc':
      return [{ text: op.cond, kind: 'condition' }];
    case 'bit':
      return [num(String(op.bit))];
    case 'rst':
      return [num(hexByte(op.addr))];
    case 'im':
      return [num(String(op.mode))];
  }
}

/** `items` with a `,` span between each two. */
export function commaSeparated(items: Span[][]): Span[] {
  return items.flatMap((spans, i) => (i === 0 ? spans : [punct(','), ...spans]));
}

/** The operand spans of `ins`, comma-separated, with symbol and table names. */
export function operandListSpans(ins: Instruction, symbols?: SymbolTable, externals?: ExternalNames): Span[] {
  return commaSeparated(ins.operands.map((op) => operandSpans(op, operandName(ins, op, symbols, externals))));
}

/** `LD`, ` `, `HL`, `,`, `DATA_7000`: the spans of `renderInstruction`. An undocumented form's `DB` is a directive. */
export function instructionSpans(ins: Instruction, symbols?: SymbolTable, externals?: ExternalNames): Span[] {
  const operands = operandListSpans(ins, symbols, externals);
  const mnemonic: Span = { text: ins.mnemonic, kind: ins.mnemonic === 'DB' ? 'directive' : 'mnemonic' };
  return operands.length === 0 ? [mnemonic] : [mnemonic, punct(' '), ...operands];
}

export const spanText = (spans: readonly Span[]): string => spans.map((s) => s.text).join('');

export function renderOperands(ins: Instruction, symbols?: SymbolTable, externals?: ExternalNames): string {
  return spanText(operandListSpans(ins, symbols, externals));
}

/** `LD HL,DATA_7000` — mnemonic and operands with symbol names. */
export function renderInstruction(ins: Instruction, symbols?: SymbolTable, externals?: ExternalNames): string {
  return spanText(instructionSpans(ins, symbols, externals));
}

/** What a comment says about an instruction, and the table entry it speaks of. */
export interface ExternalNote {
  entry: TableEntry;
  text: string;
}

/** The number `prev` loads into A, when it is `LD A,n`. */
function loadedIntoA(prev: Instruction | undefined): number | undefined {
  if (prev?.mnemonic !== 'LD') return undefined;
  const [dest, src] = prev.operands;
  return dest?.kind === 'reg' && dest.reg === 'A' && src?.kind === 'imm8' ? src.value : undefined;
}

/** `text`, then the machine tag (`[Model III]`, `[Model I]`) where the ROM name's address differs between the machines (spec §4.6). */
function withTag(text: string, entry: TableEntry, externals: ExternalNames): string {
  const tag = externals.machineTag(entry);
  return tag === undefined ? text : `${text} ${tag}`;
}

/**
 * The comment for `RST vector`: `NAME: purpose` of the routine at that address,
 * tagged like any ROM name; or on a Model 4 the service call the instruction
 * before it selected, which is no ROM name and carries no tag.
 */
function rstNote(vector: number, prev: Instruction | undefined, externals: ExternalNames, symbols: SymbolTable | undefined): ExternalNote | undefined {
  if (vector === 0x28 && externals.selection?.machine === 4) {
    const number = loadedIntoA(prev);
    const call = number === undefined ? undefined : externals.svc(number);
    if (call !== undefined) return { entry: call, text: `${call.name} (SVC ${number}): ${call.purpose}` };
  }
  if (symbols?.has(vector)) return undefined;
  const found = externals.code(vector);
  return found === undefined ? undefined : { entry: found.entry, text: withTag(`${found.entry.name}: ${found.entry.purpose}`, found.entry, externals) };
}

/**
 * The table entry a comment on `ins` explains and the comment itself (design
 * spec §4.5): the purpose of a routine or vector that a jump, call, or relative
 * branch was named after; for RST n, `NAME: purpose` of the routine at n. Both
 * carry the machine tag where the ROM name's address differs between machines
 * (§4.6). On a Model 4, for RST 28H right after `LD A,n`, `NAME (SVC n):
 * purpose` of service call n, which is no ROM name and so is never tagged.
 * Nothing for any other instruction, and nothing where the program's own
 * symbol names the target. `prev` is the instruction directly before `ins`
 * (`previousInstruction`).
 */
export function externalNote(ins: Instruction, prev: Instruction | undefined, externals: ExternalNames, symbols?: SymbolTable): ExternalNote | undefined {
  for (const op of ins.operands) {
    if (op.kind === 'rst') return rstNote(op.addr, prev, externals, symbols);
    const value = operandValue(op);
    if (operandUse(ins, op) !== 'code' || value === undefined || (symbols?.has(value) ?? false)) continue;
    const found = externals.code(value);
    if (found === undefined) continue;
    return { entry: found.entry, text: withTag(found.entry.purpose, found.entry, externals) };
  }
  return undefined;
}

/** The text of `externalNote`, for the comment column of a listing and of zmac source. */
export function externalComment(ins: Instruction, prev: Instruction | undefined, externals: ExternalNames, symbols?: SymbolTable): string | undefined {
  return externalNote(ins, prev, externals, symbols)?.text;
}

/**
 * The instruction that ends right before `addr`, for `externalComment`: nothing
 * when data lies between, and nothing when the program has a symbol at `addr`,
 * since another path reaches it there and what the instruction before it left in
 * a register says nothing about that path.
 */
export function previousInstruction(instructions: ReadonlyMap<number, Instruction>, symbols: SymbolTable | undefined, addr: number): Instruction | undefined {
  if (symbols?.has(addr) ?? false) return undefined;
  for (let length = 1; length <= 4; length++) {
    const ins = instructions.get((addr - length) & 0xffff);
    if (ins !== undefined && ins.length === length) return ins;
  }
  return undefined;
}

/**
 * `externalNote` of every instruction, by address, worked out once: the
 * comment column of a listing and the legend of its header both read it.
 */
export function externalNotes(instructions: ReadonlyMap<number, Instruction>, externals: ExternalNames, symbols?: SymbolTable): Map<number, ExternalNote> {
  const notes = new Map<number, ExternalNote>();
  for (const [addr, ins] of instructions) {
    const note = externalNote(ins, previousInstruction(instructions, symbols, addr), externals, symbols);
    if (note !== undefined) notes.set(addr, note);
  }
  return notes;
}

/** The table entries `notes` speak of, in table order, each once. */
export function noteEntries(notes: ReadonlyMap<number, ExternalNote>): TableEntry[] {
  return inTableOrder([...notes.values()].map((n) => n.entry));
}

/**
 * The table entries the comments of these instructions speak of, in table order,
 * each once: the routines named after transfers, RST vectors, and service calls.
 * An RST or service call is named only in its comment, so these are the entries
 * a legend needs beyond `externalUses`.
 */
export function commentEntries(instructions: ReadonlyMap<number, Instruction>, externals: ExternalNames, symbols?: SymbolTable): TableEntry[] {
  return noteEntries(externalNotes(instructions, externals, symbols));
}
