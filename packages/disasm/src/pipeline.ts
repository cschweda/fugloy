/**
 * Loader output to Pass 1: the roots are the module's entry plus any user
 * entries; a .BAS program also brings its structure (typed headers, bodies,
 * and terminators), the entries its text plants, and its code lines.
 */
import { recursiveDescent } from './analysis/descent.js';
import type { Pass1 } from './analysis/descent.js';
import { ExternalNames, externalUses } from './analysis/externals.js';
import { findStrings, proposeTables } from './analysis/heuristics.js';
import type { TableProposal } from './analysis/heuristics.js';
import { Kind } from './analysis/map.js';
import { proposeMovers } from './analysis/movers.js';
import type { MoverProposal } from './analysis/movers.js';
import { analysisSpace } from './analysis/relocate.js';
import type { AnalysisSpace } from './analysis/relocate.js';
import { synthesizeSymbols } from './analysis/symbols.js';
import type { SymbolTable } from './analysis/symbols.js';
import { dataWords, rowStarts } from './analysis/words.js';
import type { BasProgram } from './bas.js';
import { mineEntries } from './basic/entries.js';
import type { MinedEntry } from './basic/entries.js';
import { basStructure, codeLineLabel } from './basic/structure.js';
import { emptyAnnotations } from './hints/apply.js';
import type { Annotations, Override } from './hints/apply.js';
import type { LabelsSummary } from './labels/apply.js';
import { blockIdentities } from './hints/identity.js';
import type { Module } from './ir.js';
import type { SymbolSet } from './symbols/select.js';
import type { TableEntry } from './symbols/types.js';

/** A heuristic suggestion: reported with the hint line that would declare it, never applied. */
export type Proposal = TableProposal | MoverProposal;

/** How a hint file applied to this image, for headers and the IR. */
export interface HintsSummary {
  source?: string;
  matched: number;
  unmatched: number;
  applied: number;
  warnings: string[];
}

export interface AnalyzeOptions {
  /** Extra entry points (`--entry`). */
  entries?: number[];
  /** Hint-file decisions, already matched to this image. */
  annotations?: Annotations;
  /** Where the annotations came from, for the listing header and the IR. */
  hints?: HintsSummary;
  /** How a label and coverage file applied; its decisions are already merged into `annotations`. */
  labels?: LabelsSummary;
  /** The base a rebased .BAS program was saved from; operands into the old range are then stale. */
  rebasedFrom?: number;
  /** The ROM, hardware, and DOS names to give addresses outside the image, from `selectSymbols`; without it nothing is named. */
  tables?: SymbolSet;
}

export interface Analysis {
  module: Module;
  pass1: Pass1;
  /** The root taken from the module: its transfer address, or the lowest loaded address, or the raw base. */
  entry: number | null;
  roots: number[];
  /** The address `END` may carry: the file's own transfer address or the raw base; null when the file had none. */
  transfer: number | null;
  annotations: Annotations;
  /** Pass 2: names for referenced addresses, user names on top. */
  symbols: SymbolTable;
  /** Table names for addresses outside the image, minus any the program already uses as its own; names nothing without `tables`. */
  externals: ExternalNames;
  /** The table entries the instructions' operands and the DW words are named with (each gets a zmac EQU), in table order then by key; empty without `tables`. An RST vector or service call that only a comment names is not here. */
  tablesUsed: TableEntry[];
  hints?: HintsSummary;
  labels?: LabelsSummary;
  /** Entry points a .BAS program's text plants, with evidence (null address when unresolved); empty for other formats. */
  entries: MinedEntry[];
  /** Heuristic suggestions that change nothing until declared in a hint file. */
  proposals: Proposal[];
  /** Set when the program was rebased: the base it was originally saved from. */
  rebasedFrom?: number;
  /** The image Pass 1 ran on: the file image with each relocated region at its runtime address. */
  space: AnalysisSpace;
  /** Relocations the space refused, and why; empty for annotations from applyHints, which reports these itself. */
  relocationErrors: string[];
}

/** A .BAS program's structure under the hint annotations: a hint override wins wherever it overlaps the structure's typing. */
function withStructure(prog: BasProgram, hints: Annotations): { annotations: Annotations; candidates: number[]; frame: Set<number> } {
  const structure = basStructure(prog);
  const claimed = (o: Override): boolean =>
    hints.overrides.some((h) => h.kind !== 'nocode' && h.addr < o.addr + o.length && o.addr < h.addr + Math.max(h.length, 1));
  const comments = new Map<number, string>();
  for (const line of prog.lines) if (!line.parsed) comments.set(line.addr, codeLineLabel(line));
  for (const [addr, text] of structure.texts) comments.set(addr, text);
  for (const [addr, text] of hints.comments) comments.set(addr, text);
  return {
    annotations: { ...hints, overrides: [...structure.annotations.overrides.filter((o) => !claimed(o)), ...hints.overrides], comments },
    candidates: structure.annotations.entries,
    frame: structure.frame,
  };
}

/**
 * Roots in order: module entry, --entry addresses, hint entries, code hints,
 * then for a .BAS the mined entries and each code line's body start, so the
 * strongest evidence decodes first; tables add theirs inside descent.
 */
export function analyze(mod: Module, opts: AnalyzeOptions = {}): Analysis {
  const hints = opts.annotations ?? emptyAnnotations();
  const basic = mod.format === 'bas' ? withStructure(mod, hints) : null;
  let annotations = basic?.annotations ?? hints;
  const entries = mod.format === 'bas' ? mineEntries(mod) : [];
  const entry = mod.format === 'bas' ? null : mod.entry;
  const roots: number[] = entry === null ? [] : [entry];
  for (const e of opts.entries ?? []) roots.push(e & 0xffff);
  roots.push(...hints.entries);
  for (const o of hints.overrides) if (o.kind === 'code') roots.push(o.addr);
  for (const m of entries) if (m.addr !== null) roots.push(m.addr);
  roots.push(...(basic?.candidates ?? []));
  // A root only a label file gave is an instruction that ran or a code label; one that is a root for any other reason stays an
  // entry in the listing, and a read-only run of the label file never ends a path there.
  if (hints.executed !== undefined || hints.labelRoots !== undefined) {
    const fromLabels = new Set([...(hints.executed ?? []), ...(hints.labelRoots ?? [])]);
    const other = new Set<number>(roots.filter((r) => !fromLabels.has(r)));
    for (const r of [entry, ...(opts.entries ?? []).map((e) => e & 0xffff), ...hints.overrides.filter((o) => o.kind === 'code').map((o) => o.addr)]) if (r !== null) other.add(r);
    for (const m of entries) if (m.addr !== null) other.add(m.addr);
    for (const c of basic?.candidates ?? []) other.add(c);
    annotations = {
      ...annotations,
      ...(hints.executed === undefined ? {} : { executed: hints.executed.filter((a) => !other.has(a)) }),
      ...(hints.labelRoots === undefined ? {} : { labelRoots: hints.labelRoots.filter((a) => !other.has(a)) }),
    };
  }
  // applyHints refuses bad relocations and reports them; annotations built directly are checked here.
  const { space, errors: relocationErrors } = analysisSpace(mod.image, annotations.relocations);
  const pass1 = recursiveDescent(space.image, roots, annotations);
  if (mod.format === 'bas') {
    // Keyword-shaped code (XOR A / RET reads as LPRINT INKEY$) passes the grammar; say which line a jump hit and how to override it.
    pass1.diagnostics = pass1.diagnostics.map((d) => {
      if (d.kind !== 'in-data') return d;
      const line = mod.lines.find((l) => l.parsed && d.addr >= l.bodyAddr && d.addr < l.bodyAddr + l.body.length - 1);
      if (line === undefined) return d;
      const offset = (d.addr - mod.base).toString(16).toUpperCase().padStart(4, '0');
      return { ...d, message: `${d.message} (inside line ${line.number}, which parses as BASIC; declare block 0:$${offset} code if it is machine code)` };
    });
  }
  const transfer = mod.format === 'cmd' ? (mod.entrySource === 'transfer' ? mod.entry : null) : mod.format === 'raw' ? mod.entry : null;
  // Symbols name references, not byte kinds, so they come first and bound the strings typed after descent.
  const symbols = synthesizeSymbols(pass1, annotations, space.image);
  const frame = basic?.frame;
  for (const s of findStrings(space.image, pass1.map, new Set(symbols.list().map((x) => x.addr)), frame === undefined ? undefined : (a) => frame.has(a))) {
    pass1.map.mark(s.addr, s.length, Kind.String);
  }
  const identities = blockIdentities(mod.image);
  const proposals: Proposal[] = [...proposeTables(space.image, pass1, identities, space.toFile), ...proposeMovers(mod.image, pass1, identities, space.relocations)];
  // Table names come last: they give way to the loaded image and to every name above, so those must be final. A .BAS program's line headers
  // are typed as words but are a pointer and a line number, never an address to name.
  const words =
    opts.tables === undefined
      ? []
      : dataWords({
          image: mod.image,
          space,
          map: pass1.map,
          tables: annotations.tables,
          startsRow: rowStarts(symbols, annotations, pass1.instructions),
          skip: (addr) => frame?.has(addr) ?? false,
        });
  const externals = new ExternalNames(opts.tables, (addr) => space.image.isLoaded(addr), symbols.list().map((s) => s.name), words);
  const tablesUsed = externalUses(pass1.instructions.values(), externals, symbols);
  const analysis: Analysis = { module: mod, pass1, entry, roots: pass1.roots, transfer, annotations, symbols, externals, tablesUsed, entries, proposals, space, relocationErrors };
  if (opts.hints !== undefined) analysis.hints = opts.hints;
  if (opts.labels !== undefined) analysis.labels = opts.labels;
  if (opts.rebasedFrom !== undefined) analysis.rebasedFrom = opts.rebasedFrom & 0xffff;
  return analysis;
}
