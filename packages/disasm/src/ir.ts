/**
 * JSON intermediate representation of a Pass 1 analysis: what the web app
 * (phase 4) and Part 2 consume. Addresses are plain numbers. `fugloyIr`
 * changes only on a breaking shape change; sub-project B adds `symbols`, and
 * phase 3 adds `machine`, `dos`, and `tableNames`, only when tables were used.
 */
import type { Diagnostic, Pass1, Xref } from './analysis/descent.js';
import { inTableOrder } from './analysis/externals.js';
import { outsideComments } from './analysis/symbols.js';
import type { Symbol } from './analysis/symbols.js';
import type { MinedEntry } from './basic/entries.js';
import type { Relocation } from './analysis/relocate.js';
import { basicBlocks, regions } from './analysis/regions.js';
import type { BasicBlock, Region } from './analysis/regions.js';
import type { BasProgram } from './bas.js';
import type { CmdModule } from './cmd.js';
import { commentEntries } from './emit/operands.js';
import type { Analysis, HintsSummary, Proposal } from './pipeline.js';
import type { RawModule } from './raw.js';
import type { Cite, Dos, EntryKind, Machine, TableId } from './symbols/types.js';

export type Module = CmdModule | BasProgram | RawModule;

/** A ROM, hardware, or DOS name the program uses, with where it comes from. */
export interface IrTableName {
  /** The address, port number, or service call number. */
  key: number;
  name: string;
  kind: EntryKind;
  table: TableId;
  purpose: string;
  cite: readonly Cite[];
}

export interface Ir {
  fugloyIr: 1;
  source?: string;
  /** The machine whose tables named the program's references; present only when tables were used. */
  machine?: Machine;
  /** The DOS whose names were used; present only when tables were used. */
  dos?: Dos;
  format: 'cmd' | 'bas' | 'raw';
  entry: number | null;
  roots: number[];
  /** Entry points mined from a .BAS program's text, with evidence; empty for other formats. */
  entries: MinedEntry[];
  loaded: { start: number; end: number }[];
  regions: Region[];
  blocks: BasicBlock[];
  xrefs: Xref[];
  externals: number[];
  indirectJumps: number[];
  diagnostics: Diagnostic[];
  /** Pass 2 symbols in address order; empty when no analysis was supplied. */
  symbols: Symbol[];
  /** Every table name the listing shows, in table order then by key: operands, DW words, RST vectors, and service calls. Present only when tables were used. */
  tableNames?: IrTableName[];
  /** Heuristic suggestions with their hint lines; none are applied. */
  proposals: Proposal[];
  /** Regions that execute elsewhere; `regions` and every address but `loaded` are runtime addresses. */
  relocations: Relocation[];
  /** `at` comments on addresses no name takes; present only when there are some. */
  outsideComments?: { addr: number; text: string }[];
  hints?: HintsSummary;
}

export function buildIr(
  mod: Module,
  pass1: Pass1,
  source?: string,
  analysis?: Pick<Analysis, 'symbols' | 'annotations' | 'hints' | 'entries' | 'proposals' | 'space'> & Partial<Pick<Analysis, 'externals' | 'tablesUsed'>>,
): Ir {
  const selection = analysis?.externals?.selection;
  const tableNames: IrTableName[] | undefined =
    analysis?.externals === undefined || selection === undefined
      ? undefined
      : inTableOrder([...(analysis.tablesUsed ?? []), ...commentEntries(pass1.instructions, analysis.externals, analysis.symbols)]).map((e) => ({
          key: e.key,
          name: e.name,
          kind: e.kind,
          table: e.table,
          purpose: e.purpose,
          cite: e.cite,
        }));
  const outside = analysis === undefined ? [] : outsideComments(analysis.annotations, analysis.symbols, analysis.space.image);
  return {
    fugloyIr: 1,
    ...(source === undefined ? {} : { source }),
    ...(selection === undefined ? {} : { machine: selection.machine, dos: selection.dos }),
    format: mod.format,
    entry: mod.format === 'bas' ? null : mod.entry,
    roots: pass1.roots,
    entries: analysis?.entries ?? [],
    loaded: mod.image.runs().map((r) => ({ start: r.start, end: r.end })),
    regions: regions(analysis?.space.image ?? mod.image, pass1.map),
    blocks: basicBlocks(pass1),
    xrefs: pass1.xrefs,
    externals: pass1.externals,
    indirectJumps: pass1.indirectJumps,
    diagnostics: pass1.diagnostics,
    symbols: analysis?.symbols.list() ?? [],
    ...(tableNames === undefined ? {} : { tableNames }),
    proposals: analysis?.proposals ?? [],
    relocations: analysis?.space.relocations ?? [],
    ...(outside.length === 0 ? {} : { outsideComments: outside }),
    ...(analysis?.hints === undefined ? {} : { hints: analysis.hints }),
  };
}
