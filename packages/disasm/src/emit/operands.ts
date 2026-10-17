/** Operand text with symbol names where a symbol exists and the operand is a reference; shared by the emitter and the listing. */
import { formatOperand } from '@fugloy/z80';
import type { Instruction, Operand } from '@fugloy/z80';
import { inTableOrder } from '../analysis/externals.js';
import type { ExternalNames } from '../analysis/externals.js';
import { operandUse, operandValue } from '../analysis/symbols.js';
import type { SymbolTable } from '../analysis/symbols.js';
import type { TableEntry } from '../symbols/types.js';

/**
 * The name an operand takes, if any: the program's own symbol at its address
 * first, then the table name `externals` gives it. A port number is not an
 * address, so only the port names apply to it. Which lookup an operand uses is
 * `operandUse`, which `externalUses` follows too.
 */
function operandName(ins: Instruction, op: Operand, symbols: SymbolTable | undefined, externals: ExternalNames | undefined): string | undefined {
  const use = operandUse(ins, op);
  const value = operandValue(op);
  if (use === undefined || value === undefined) return undefined;
  if (use === 'port') return externals?.port(value)?.text;
  const own = symbols?.get(value);
  if (own !== undefined) return own.name;
  return (use === 'code' ? externals?.code(value) : externals?.data(value))?.text;
}

export function renderOperands(ins: Instruction, symbols?: SymbolTable, externals?: ExternalNames): string {
  if (symbols === undefined && externals === undefined) return ins.operands.map(formatOperand).join(',');
  return ins.operands
    .map((op) => {
      const name = operandName(ins, op, symbols, externals);
      if (name === undefined) return formatOperand(op);
      return op.kind === 'mem' || op.kind === 'port' ? `(${name})` : name;
    })
    .join(',');
}

/** `LD HL,DATA_7000` — mnemonic and operands with symbol names. */
export function renderInstruction(ins: Instruction, symbols?: SymbolTable, externals?: ExternalNames): string {
  const operands = renderOperands(ins, symbols, externals);
  return operands === '' ? ins.mnemonic : `${ins.mnemonic} ${operands}`;
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

/** The comment for `RST vector`: the routine at that address, or on a Model 4 the service call the instruction before it selected. */
function rstNote(vector: number, prev: Instruction | undefined, externals: ExternalNames, symbols: SymbolTable | undefined): ExternalNote | undefined {
  if (vector === 0x28 && externals.selection?.machine === 4) {
    const number = loadedIntoA(prev);
    const call = number === undefined ? undefined : externals.svc(number);
    if (call !== undefined) return { entry: call, text: `${call.name} (SVC ${number}): ${call.purpose}` };
  }
  if (symbols?.has(vector)) return undefined;
  const found = externals.code(vector);
  return found === undefined ? undefined : { entry: found.entry, text: `${found.entry.name}: ${found.entry.purpose}` };
}

/**
 * The table entry a comment on `ins` explains and the comment itself (design
 * spec §4.5): the purpose of a routine or vector that a jump, call, or relative
 * branch was named after, with the machine tag where the ROM name's address
 * differs between machines; for RST n, `NAME: purpose` of the routine at n; on
 * a Model 4, for RST 28H right after `LD A,n`, `NAME (SVC n): purpose` of
 * service call n. Nothing for any other instruction, and nothing where the
 * program's own symbol names the target. `prev` is the instruction directly
 * before `ins` (`previousInstruction`).
 */
export function externalNote(ins: Instruction, prev: Instruction | undefined, externals: ExternalNames, symbols?: SymbolTable): ExternalNote | undefined {
  for (const op of ins.operands) {
    if (op.kind === 'rst') return rstNote(op.addr, prev, externals, symbols);
    const value = operandValue(op);
    if (operandUse(ins, op) !== 'code' || value === undefined || (symbols?.has(value) ?? false)) continue;
    const found = externals.code(value);
    if (found === undefined) continue;
    const tag = externals.machineTag(found.entry);
    return { entry: found.entry, text: tag === undefined ? found.entry.purpose : `${found.entry.purpose} ${tag}` };
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
 * The table entries the comments of these instructions speak of, in table order,
 * each once: the routines named after transfers, RST vectors, and service calls.
 * An RST or service call is named only in its comment, so these are the entries
 * a legend needs beyond `externalUses`.
 */
export function commentEntries(instructions: ReadonlyMap<number, Instruction>, externals: ExternalNames, symbols?: SymbolTable): TableEntry[] {
  const found: TableEntry[] = [];
  for (const [addr, ins] of instructions) {
    const note = externalNote(ins, previousInstruction(instructions, symbols, addr), externals, symbols);
    if (note !== undefined) found.push(note.entry);
  }
  return inTableOrder(found);
}
