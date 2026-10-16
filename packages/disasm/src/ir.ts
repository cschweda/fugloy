/**
 * JSON intermediate representation of a Pass 1 analysis: what the web app
 * (phase 4) and Part 2 consume. Addresses are plain numbers. `fugloyIr`
 * changes only on a breaking shape change; sub-project B adds `symbols`.
 */
import type { Diagnostic, Pass1, Xref } from './analysis/descent.js';
import type { Symbol } from './analysis/symbols.js';
import type { MinedEntry } from './basic/entries.js';
import type { Relocation } from './analysis/relocate.js';
import { basicBlocks, regions } from './analysis/regions.js';
import type { BasicBlock, Region } from './analysis/regions.js';
import type { BasProgram } from './bas.js';
import type { CmdModule } from './cmd.js';
import type { Analysis, HintsSummary, Proposal } from './pipeline.js';
import type { RawModule } from './raw.js';

export type Module = CmdModule | BasProgram | RawModule;

export interface Ir {
  fugloyIr: 1;
  source?: string;
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
  /** Heuristic suggestions with their hint lines; none are applied. */
  proposals: Proposal[];
  /** Regions that execute elsewhere; `regions` and every address but `loaded` are runtime addresses. */
  relocations: Relocation[];
  hints?: HintsSummary;
}

export function buildIr(mod: Module, pass1: Pass1, source?: string, analysis?: Pick<Analysis, 'symbols' | 'hints' | 'entries' | 'proposals' | 'space'>): Ir {
  return {
    fugloyIr: 1,
    ...(source === undefined ? {} : { source }),
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
    proposals: analysis?.proposals ?? [],
    relocations: analysis?.space.relocations ?? [],
    ...(analysis?.hints === undefined ? {} : { hints: analysis.hints }),
  };
}
