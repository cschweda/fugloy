/**
 * Choosing the symbol tables for a machine and DOS (design spec §4.4) and
 * looking addresses, ports, and service calls up in them (§5.1). Pure: the
 * tables are the generated module's, or any a caller passes in.
 */
import { hex4 } from '@fugloy/z80';
import { ROM_COMPARISON, TABLES } from './tables.generated.js';
import { SELECTIONS } from './types.js';
import type { Dos, EntryKind, Machine, RomComparison, TableEntry, TableId } from './types.js';

/** A machine and the DOS whose names to use with it. */
export interface SymbolSelection {
  machine: Machine;
  dos: Dos;
}

/** A machine and DOS that no tables are defined for, such as TRSDOS on a Model I. */
export class SelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelectionError';
  }
}

/** Tandy's own DOS on a Model III, LDOS on a Model I, and nothing on a Model 4 (spec §4.4). */
const DEFAULT_DOS: Readonly<Record<Machine, Dos>> = { 1: 'ldos', 3: 'trsdos', 4: 'none' };

export function defaultDos(machine: Machine): Dos {
  return DEFAULT_DOS[machine];
}

const orList = (words: readonly string[]): string => (words.length < 3 ? words.join(' or ') : `${words.slice(0, -1).join(', ')}, or ${words.at(-1)}`);

/** `machine 1 with ldos or none; machine 3 with trsdos, ldos, or none; machine 4 with none`, from SELECTIONS. */
function validPairs(): string {
  const doses = new Map<Machine, Dos[]>();
  for (const { machine, dos } of SELECTIONS) doses.set(machine, [...(doses.get(machine) ?? []), dos]);
  return [...doses].map(([machine, list]) => `machine ${machine} with ${orList(list)}`).join('; ');
}

/** The `SELECTIONS` row for a pair, or a SelectionError naming the pairs that have one. */
function rowFor(sel: SymbolSelection): (typeof SELECTIONS)[number] {
  const row = SELECTIONS.find((s) => s.machine === sel.machine && s.dos === sel.dos);
  if (row === undefined) throw new SelectionError(`machine ${sel.machine} with DOS ${sel.dos} has no symbol tables; the valid pairs are ${validPairs()}`);
  return row;
}

/** The tables a selection names from, in lookup order; a pair `SELECTIONS` does not list throws a SelectionError. */
export function tablesFor(sel: SymbolSelection): TableId[] {
  return [...rowFor(sel).tables];
}

const DOS_TEXT: Readonly<Record<Dos, string>> = { trsdos: 'TRSDOS 1.3', ldos: 'LDOS 5.1', none: 'no DOS' };

/** What a listing header calls the tables a selection uses: `Model III ROM, hardware, TRSDOS 1.3`. */
export function describeSelection(sel: SymbolSelection): string {
  rowFor(sel); // a pair with no tables has nothing to describe
  if (sel.machine === 4) return 'Model 4 service calls (LS-DOS 6)';
  return `${sel.machine === 1 ? 'Model I' : 'Model III'} ROM, hardware, ${DOS_TEXT[sel.dos]}`;
}

const CODE_KINDS: readonly EntryKind[] = ['routine', 'vector'];
const DATA_KINDS: readonly EntryKind[] = ['variable', 'vector', 'region'];
/** The tag a ROM table's names carry where the two machines' ROMs differ (spec §4.6). */
const ROM_TAGS: Readonly<Partial<Record<TableId, string>>> = { 'rom-model1': '[Model I]', 'rom-model3': '[Model III]' };

/** Keeps the first entry for an address, port, or call number, so a repeated one answers with the earlier entry. */
function addFirst(map: Map<number, TableEntry>, e: TableEntry): void {
  if (!map.has(e.key)) map.set(e.key, e);
}

/** The names one machine-and-DOS selection offers, indexed for the lookups the renderer makes. */
export class SymbolSet {
  readonly selection: SymbolSelection;
  private readonly all: readonly TableEntry[];
  private readonly comparison: RomComparison;
  private readonly codeAt = new Map<number, TableEntry>();
  private readonly portAt = new Map<number, TableEntry>();
  private readonly svcAt = new Map<number, TableEntry>();
  /** The entries a data operand can fall inside, by address. Memory entries do not overlap (validation), so the last one starting at or below an address is the only one that can cover it. */
  private readonly spans: readonly TableEntry[];

  /** `entries` are the selection's tables in order; `comparison` classes each ROM address across the two machines. Use `selectSymbols`. */
  constructor(selection: SymbolSelection, entries: readonly TableEntry[], comparison: RomComparison) {
    this.selection = { machine: selection.machine, dos: selection.dos };
    this.all = entries;
    this.comparison = comparison;
    for (const e of entries) {
      if (CODE_KINDS.includes(e.kind)) addFirst(this.codeAt, e);
      else if (e.kind === 'port') addFirst(this.portAt, e);
      else if (e.kind === 'svc') addFirst(this.svcAt, e);
    }
    this.spans = entries.filter((e) => DATA_KINDS.includes(e.kind)).sort((a, b) => a.key - b.key);
  }

  /** Every entry of the selection's tables, in table order. */
  entries(): readonly TableEntry[] {
    return this.all;
  }

  /** The routine or vector at exactly `addr`, which is what a jump or call target can name. */
  code(addr: number): TableEntry | undefined {
    return this.codeAt.get(addr);
  }

  /** The variable, vector, or region that covers `addr`, with `addr`'s offset into it. */
  data(addr: number): { entry: TableEntry; offset: number } | undefined {
    let low = 0;
    let high = this.spans.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.spans[mid]!.key <= addr) low = mid + 1;
      else high = mid;
    }
    const entry = this.spans[low - 1];
    if (entry === undefined || addr >= entry.key + entry.length) return undefined;
    return { entry, offset: addr - entry.key };
  }

  /** The entry for port `n`; the first in table order, since IN and OUT can mean different things. */
  port(n: number): TableEntry | undefined {
    return this.portAt.get(n);
  }

  /** The service call numbered `n`. */
  svc(n: number): TableEntry | undefined {
    return this.svcAt.get(n);
  }

  /**
   * `[Model III]` or `[Model I]` for a ROM name whose address the comparison
   * does not class as shared (an address it does not list is not known to be
   * shared), so a listing can say which machine it assumed; undefined for every
   * other entry.
   */
  machineTag(entry: TableEntry): string | undefined {
    const tag = ROM_TAGS[entry.table];
    return tag !== undefined && this.comparison[hex4(entry.key)] !== 'shared' ? tag : undefined;
  }
}

/**
 * The symbol set for a machine and DOS, merged from that pair's tables. `tables`
 * and `comparison` default to the generated ones; a pair `SELECTIONS` does not
 * list throws a SelectionError.
 */
export function selectSymbols(
  sel: SymbolSelection,
  tables: Readonly<Record<TableId, readonly TableEntry[]>> = TABLES,
  comparison: RomComparison = ROM_COMPARISON,
): SymbolSet {
  return new SymbolSet(sel, tablesFor(sel).flatMap((id) => tables[id]), comparison);
}
