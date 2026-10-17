/**
 * Pass 2, external names (design spec §4.5, §5.2): the table names the renderer
 * may give an address outside the program, and the table entries a program's
 * instructions end up using. Only addresses outside the loaded image take table
 * names, and never one the program has already taken for itself.
 */
import { hexWord } from '@fugloy/z80';
import type { Instruction } from '@fugloy/z80';
import type { SymbolSelection, SymbolSet } from '../symbols/select.js';
import { TABLE_IDS } from '../symbols/types.js';
import type { TableEntry } from '../symbols/types.js';
import { dataReference } from './symbols.js';
import type { SymbolTable } from './symbols.js';

/** The table entry an address takes as its name, and the text to write for it: `NAME`, or `NAME+0140H` inside a span. */
export interface ExternalName {
  entry: TableEntry;
  text: string;
}

export class ExternalNames {
  /** The selected tables' entries that the program's own names turned away, in table order; none of them is ever returned. */
  readonly dropped: readonly TableEntry[];
  /** The machine and DOS the tables were chosen for; undefined without tables. */
  readonly selection: SymbolSelection | undefined;
  private readonly set: SymbolSet | undefined;
  private readonly isLoaded: (addr: number) => boolean;
  private readonly droppedEntries: ReadonlySet<TableEntry>;

  /**
   * `set` is the selected tables; undefined names nothing. `isLoaded` says which
   * addresses the program occupies at run time (the analysis space's), and
   * `programNames` are the names it already uses, synthesized and its own. zmac
   * folds case, so an entry whose name equals one of them ignoring case would
   * define a symbol twice: it is dropped, and its address stays numeric.
   */
  constructor(set: SymbolSet | undefined, isLoaded: (addr: number) => boolean, programNames: Iterable<string>) {
    this.set = set;
    this.isLoaded = isLoaded;
    this.selection = set?.selection;
    const taken = new Set<string>();
    for (const name of programNames) taken.add(name.toUpperCase());
    this.dropped = set === undefined ? [] : set.entries().filter((e) => taken.has(e.name.toUpperCase()));
    this.droppedEntries = new Set(this.dropped);
  }

  /** The routine or vector a jump or call to `addr` can name, when `addr` is outside the program. */
  code(addr: number): ExternalName | undefined {
    return this.isLoaded(addr) ? undefined : this.named(this.set?.code(addr));
  }

  /** The variable, vector, or region that covers `addr`, with the offset into it, when `addr` is outside the program. */
  data(addr: number): ExternalName | undefined {
    const found = this.isLoaded(addr) ? undefined : this.set?.data(addr);
    if (found === undefined || this.droppedEntries.has(found.entry)) return undefined;
    const { entry, offset } = found;
    return { entry, text: offset === 0 ? entry.name : `${entry.name}+${hexWord(offset)}` };
  }

  /** The entry for port `n`. A port number is not an address, so the program's memory does not hide it. */
  port(n: number): ExternalName | undefined {
    return this.named(this.set?.port(n));
  }

  /** The service call numbered `n`; for comments only, since the operand stays a number. */
  svc(n: number): TableEntry | undefined {
    return this.allowed(this.set?.svc(n));
  }

  /** `[Model III]` or `[Model I]` where the ROM name's address differs between the two machines. */
  machineTag(entry: TableEntry): string | undefined {
    return this.set?.machineTag(entry);
  }

  private allowed(entry: TableEntry | undefined): TableEntry | undefined {
    return entry === undefined || this.droppedEntries.has(entry) ? undefined : entry;
  }

  private named(entry: TableEntry | undefined): ExternalName | undefined {
    const allowed = this.allowed(entry);
    return allowed === undefined ? undefined : { entry: allowed, text: allowed.name };
  }
}

/**
 * The table entries a program's instructions are named with, which are the ones
 * the renderer (emit/operands.ts) takes once the program's own symbols miss: a
 * `rel` operand or a JP/CALL `imm16` from the code names; an `imm16` that
 * `dataReference` reads as an address, and every `(nn)` operand, from the data
 * names; an IN/OUT port from the port names. An RST, an 8-bit immediate, and any
 * other 16-bit immediate (`LD SP,nn`) keep their numbers, and a service call
 * appears only in a comment, so neither is listed. Each entry once, in table
 * order and then by key, so an `EQU` list and a legend come out the same every run.
 * `symbols` are the program's own: an operand at one of their addresses takes
 * the program's name, not a table's.
 */
export function externalUses(instructions: Iterable<Instruction>, names: ExternalNames, symbols?: SymbolTable): TableEntry[] {
  const used = new Set<TableEntry>();
  const own = (addr: number): boolean => symbols?.has(addr) ?? false;
  const use = (name: ExternalName | undefined): void => {
    if (name !== undefined) used.add(name.entry);
  };
  for (const ins of instructions) {
    const transfer = ins.flow.kind === 'jump' || ins.flow.kind === 'call';
    const ref = dataReference(ins);
    for (const op of ins.operands) {
      switch (op.kind) {
        case 'rel':
          if (!own(op.target)) use(names.code(op.target));
          break;
        case 'imm16':
          if (own(op.value)) break;
          if (transfer) use(names.code(op.value));
          else if (ref === op.value) use(names.data(op.value));
          break;
        case 'mem':
          if (!own(op.addr)) use(names.data(op.addr));
          break;
        case 'port':
          use(names.port(op.value));
          break;
      }
    }
  }
  return [...used].sort((a, b) => TABLE_IDS.indexOf(a.table) - TABLE_IDS.indexOf(b.table) || a.key - b.key);
}
