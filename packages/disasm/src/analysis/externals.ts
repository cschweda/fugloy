/**
 * Pass 2, external names (design spec §4.5, §5.2): the table names the renderer
 * may give an address outside the program, and the table entries a program's
 * instructions and DW words end up using. Only addresses outside the loaded
 * image take table names, and never one the program has already taken for itself.
 */
import { hexWord } from '@fugloy/z80';
import type { Instruction } from '@fugloy/z80';
import type { SymbolSelection, SymbolSet } from '../symbols/select.js';
import { TABLE_IDS } from '../symbols/types.js';
import type { TableEntry } from '../symbols/types.js';
import { operandUse, operandValue } from './symbols.js';
import type { SymbolTable } from './symbols.js';
import type { DataWord } from './words.js';

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
  private readonly words: readonly DataWord[];
  private readonly wordAt: ReadonlyMap<number, DataWord>;

  /**
   * `set` is the selected tables; undefined names nothing. `isLoaded` says which
   * addresses the program occupies at run time (the analysis space's), and
   * `programNames` are the names it already uses, synthesized and its own. zmac
   * folds case, so an entry whose name equals one of them ignoring case would
   * define a symbol twice: it is dropped, and its address stays numeric.
   * `words` are the DW words the emitters write (`dataWords`), which `word` names.
   */
  constructor(set: SymbolSet | undefined, isLoaded: (addr: number) => boolean, programNames: Iterable<string>, words: Iterable<DataWord> = []) {
    this.set = set;
    this.isLoaded = isLoaded;
    this.selection = set?.selection;
    const taken = new Set<string>();
    for (const name of programNames) taken.add(name.toUpperCase());
    this.dropped = set === undefined ? [] : set.entries().filter((e) => taken.has(e.name.toUpperCase()));
    this.droppedEntries = new Set(this.dropped);
    this.words = [...words];
    this.wordAt = new Map(this.words.map((w) => [w.addr, w]));
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

  /**
   * The name a DW word takes: `value` as written at `addr`, when `addr` is a word
   * the emitters write (`dataWords`). An entry of a declared jump table names
   * from the code names, any other typed word from the data names. Only the
   * word as listed is named, so a row that pairs bytes differently is never
   * given a name that `externalUses` did not count.
   */
  word(addr: number, value: number): ExternalName | undefined {
    const found = this.wordAt.get(addr);
    return found === undefined || found.value !== value ? undefined : this.nameWord(found);
  }

  /** The DW words that take a table name, with the name each takes. */
  namedWords(): { addr: number; value: number; name: ExternalName }[] {
    const out: { addr: number; value: number; name: ExternalName }[] = [];
    for (const w of this.words) {
      const name = this.nameWord(w);
      if (name !== undefined) out.push({ addr: w.addr, value: w.value, name });
    }
    return out;
  }

  /** The same tables and words with no program names to give way to: what would be named had no name of the program's collided with a table's. */
  ignoringCollisions(): ExternalNames {
    return new ExternalNames(this.set, this.isLoaded, [], this.words);
  }

  /** `[Model III]` or `[Model I]` where the ROM name's address differs between the two machines. */
  machineTag(entry: TableEntry): string | undefined {
    return this.set?.machineTag(entry);
  }

  private nameWord(w: DataWord): ExternalName | undefined {
    return w.jump ? this.code(w.value) : this.data(w.value);
  }

  private allowed(entry: TableEntry | undefined): TableEntry | undefined {
    return entry === undefined || this.droppedEntries.has(entry) ? undefined : entry;
  }

  private named(entry: TableEntry | undefined): ExternalName | undefined {
    const allowed = this.allowed(entry);
    return allowed === undefined ? undefined : { entry: allowed, text: allowed.name };
  }
}

/** Entries once each, in table order and then by key, so an `EQU` list, a legend, and the IR come out the same every run. */
export function inTableOrder(entries: Iterable<TableEntry>): TableEntry[] {
  return [...new Set(entries)].sort((a, b) => TABLE_IDS.indexOf(a.table) - TABLE_IDS.indexOf(b.table) || a.key - b.key);
}

/**
 * The table entries a program's instructions and DW words are named with, which
 * are the ones the renderer (emit/operands.ts) takes once the program's own
 * symbols miss. Which operand takes which lookup is `operandUse`, the rule the
 * renderer follows too: a `rel` operand or a JP/CALL `imm16` from the code
 * names; an `imm16` that `dataReference` reads as an address, and every `(nn)`
 * operand, from the data names; an IN/OUT port from the port names. An RST, an
 * 8-bit immediate, and any other 16-bit immediate (`LD SP,nn`) keep their
 * numbers, and a service call appears only in a comment, so neither is listed.
 * A DW word takes the name `names.word` gives it. Each entry once, in table
 * order and then by key. `symbols` are the program's own: an operand or word at
 * one of their addresses takes the program's name, not a table's.
 */
export function externalUses(instructions: Iterable<Instruction>, names: ExternalNames, symbols: SymbolTable): TableEntry[] {
  const used = new Set<TableEntry>();
  const use = (name: ExternalName | undefined): void => {
    if (name !== undefined) used.add(name.entry);
  };
  for (const ins of instructions) {
    for (const op of ins.operands) {
      const kind = operandUse(ins, op);
      const value = operandValue(op);
      if (kind === undefined || value === undefined) continue;
      // A port number is not an address, so the program's symbols never hide it.
      if (kind === 'port') use(names.port(value));
      else if (!symbols.has(value)) use(kind === 'code' ? names.code(value) : names.data(value));
    }
  }
  for (const { value, name } of names.namedWords()) if (!symbols.has(value)) use(name);
  return inTableOrder(used);
}
