/**
 * Loader output to Pass 1: the roots are the module's entry plus any user
 * entries; a .BAS program also brings its structure (typed headers, bodies,
 * and terminators), the entries its text plants, and its code lines.
 */
import { recursiveDescent } from './analysis/descent.js';
import type { Pass1 } from './analysis/descent.js';
import { findStrings, proposeTables } from './analysis/heuristics.js';
import type { TableProposal } from './analysis/heuristics.js';
import { Kind } from './analysis/map.js';
import { proposeMovers } from './analysis/movers.js';
import type { MoverProposal } from './analysis/movers.js';
import { analysisSpace } from './analysis/relocate.js';
import type { AnalysisSpace } from './analysis/relocate.js';
import { synthesizeSymbols } from './analysis/symbols.js';
import type { SymbolTable } from './analysis/symbols.js';
import type { BasProgram } from './bas.js';
import { mineEntries } from './basic/entries.js';
import type { MinedEntry } from './basic/entries.js';
import { basStructure, codeLineLabel } from './basic/structure.js';
import { emptyAnnotations } from './hints/apply.js';
import type { Annotations, Override } from './hints/apply.js';
import { blockIdentities } from './hints/identity.js';
import type { Module } from './ir.js';

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
  /** The base a rebased .BAS program was saved from; operands into the old range are then stale. */
  rebasedFrom?: number;
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
  hints?: HintsSummary;
  /** Entry points a .BAS program's text plants, with evidence (null address when unresolved); empty for other formats. */
  entries: MinedEntry[];
  /** Heuristic suggestions that change nothing until declared in a hint file. */
  proposals: Proposal[];
  /** Set when the program was rebased: the base it was originally saved from. */
  rebasedFrom?: number;
  /** The image Pass 1 ran on: the file image with each relocated region at its runtime address. */
  space: AnalysisSpace;
}

/** A .BAS program's structure under the hint annotations: a hint override wins wherever it overlaps the structure's typing. */
function withStructure(prog: BasProgram, hints: Annotations): { annotations: Annotations; candidates: number[] } {
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
  const annotations = basic?.annotations ?? hints;
  const entries = mod.format === 'bas' ? mineEntries(mod) : [];
  const entry = mod.format === 'bas' ? null : mod.entry;
  const roots: number[] = entry === null ? [] : [entry];
  for (const e of opts.entries ?? []) roots.push(e & 0xffff);
  roots.push(...hints.entries);
  for (const o of hints.overrides) if (o.kind === 'code') roots.push(o.addr);
  for (const m of entries) if (m.addr !== null) roots.push(m.addr);
  roots.push(...(basic?.candidates ?? []));
  // Relocations were validated when the hints applied; here they only place the bytes.
  const { space } = analysisSpace(mod.image, annotations.relocations);
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
  for (const s of findStrings(space.image, pass1.map, new Set(symbols.list().map((x) => x.addr)))) pass1.map.mark(s.addr, s.length, Kind.String);
  const identities = blockIdentities(mod.image);
  const proposals: Proposal[] = [...proposeTables(space.image, pass1, identities, space.toFile), ...proposeMovers(mod.image, pass1, identities, space.relocations)];
  const analysis: Analysis = { module: mod, pass1, entry, roots: pass1.roots, transfer, annotations, symbols, entries, proposals, space };
  if (opts.hints !== undefined) analysis.hints = opts.hints;
  if (opts.rebasedFrom !== undefined) analysis.rebasedFrom = opts.rebasedFrom & 0xffff;
  return analysis;
}
