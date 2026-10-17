/**
 * A session: one program opened and analyzed, the same way for the CLI and the
 * workbench. Load (or detect), choose the identity normalizer, apply a hint
 * file, run the analysis, and render. Sessions are immutable; each `with...`
 * returns a new one, re-analyzed. Pure: bytes in, text out.
 */
import { analyze } from './pipeline.js';
import type { Analysis, HintsSummary } from './pipeline.js';
import { loadBas } from './bas.js';
import { loadCmd } from './cmd.js';
import { loadRaw } from './raw.js';
import { detectFormat } from './detect.js';
import { emitZmac } from './emit/zmac.js';
import { applyHints, emptyAnnotations } from './hints/apply.js';
import type { Applied } from './hints/apply.js';
import { parseHints } from './hints/format.js';
import type { HintFile } from './hints/format.js';
import { basIdentityNormalizer, blockIdentities, programHash } from './hints/identity.js';
import type { IdentityNormalizer } from './hints/identity.js';
import { buildIr } from './ir.js';
import type { Module } from './ir.js';
import { renderBasListing, renderPass1Listing } from './listing.js';
import { selectSymbols } from './symbols/select.js';
import type { SymbolSelection } from './symbols/select.js';

export interface OpenOptions {
  /** The name the listing header and zmac output carry. */
  name?: string;
  /** Load the bytes as a raw binary at this address, skipping format detection. */
  base?: number;
  /** The ROM, hardware, and DOS names to use; without it nothing outside the image is named. */
  selection?: SymbolSelection;
  /** Extra entry points. */
  entries?: number[];
  /** The base a rebased .BAS program was saved from; `bytes` are the rebased ones. */
  rebasedFrom?: number;
}

export interface Session {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly module: Module;
  /** programHash of `bytes`. */
  readonly hash: string;
  readonly normalize: IdentityNormalizer | undefined;
  readonly selection: SymbolSelection | undefined;
  readonly entries: readonly number[];
  readonly hintFile: HintFile;
  /** Where the hint file came from (a file name), for the listing header. */
  readonly hintSource: string | undefined;
  readonly applied: Applied;
  readonly analysis: Analysis;
  /** A .BAS with nothing but BASIC in it lists as BASIC. */
  readonly plainBasic: boolean;
}

export class OpenError extends Error {
  constructor(
    readonly kind: 'format' | 'hints',
    message: string,
    readonly details: readonly string[] = [],
  ) {
    super(message);
    this.name = 'OpenError';
  }
}

/** Version 1, the program's hash, every block's identity, and no hints. */
export function skeletonHints(mod: Module, bytes: Uint8Array): HintFile {
  return {
    version: 1,
    program: programHash(bytes),
    blocks: blockIdentities(mod.image, mod.format === 'bas' ? basIdentityNormalizer(mod) : undefined).map((b) => ({ index: b.index, length: b.length, hash: b.hash, start: b.start })),
    hints: [],
  };
}

const noHintsApplied = (): Applied => ({ annotations: emptyAnnotations(), matched: [], unmatched: [], warnings: [], rejected: 0, errors: [] });

interface Parts {
  name: string;
  bytes: Uint8Array;
  module: Module;
  hash: string;
  normalize: IdentityNormalizer | undefined;
  selection: SymbolSelection | undefined;
  entries: readonly number[];
  hintFile: HintFile;
  hintSource: string | undefined;
  applied: Applied;
  /** Whether a hint file was applied; the analysis header then carries a summary. */
  hinted: boolean;
  rebasedFrom: number | undefined;
}

function build(p: Parts): Session {
  const skipped = p.applied.unmatched.reduce((n, u) => n + u.hints, 0);
  const summary: HintsSummary | undefined = p.hinted
    ? {
        ...(p.hintSource === undefined ? {} : { source: p.hintSource }),
        matched: p.applied.matched.length,
        unmatched: p.applied.unmatched.length,
        applied: p.hintFile.hints.length - skipped - p.applied.rejected,
        warnings: p.applied.warnings,
      }
    : undefined;
  const analysis = analyze(p.module, {
    entries: [...p.entries],
    annotations: p.applied.annotations,
    ...(p.selection === undefined ? {} : { tables: selectSymbols(p.selection) }),
    ...(summary === undefined ? {} : { hints: summary }),
    ...(p.rebasedFrom === undefined ? {} : { rebasedFrom: p.rebasedFrom }),
  });
  // A .BAS with neither hidden code nor a planted entry lists as plain BASIC unless pass 1 was asked for.
  const plainBasic =
    p.module.format === 'bas' && p.entries.length === 0 && p.hintFile.hints.length === 0 && p.rebasedFrom === undefined && analysis.entries.length === 0 && p.module.lines.every((l) => l.parsed);
  return { ...p, analysis, plainBasic };
}

/** The parts a Session shares with the Parts it was built from. */
const partsOf = (s: Session, hinted: boolean): Parts => ({
  name: s.name,
  bytes: s.bytes,
  module: s.module,
  hash: s.hash,
  normalize: s.normalize,
  selection: s.selection,
  entries: s.entries,
  hintFile: s.hintFile,
  hintSource: s.hintSource,
  applied: s.applied,
  hinted,
  rebasedFrom: s.analysis.rebasedFrom,
});

export function openProgram(bytes: Uint8Array, opts: OpenOptions = {}): Session {
  let module: Module;
  if (opts.base !== undefined) module = loadRaw(bytes, opts.base);
  else {
    const kind = detectFormat(bytes);
    if (kind === 'bas') module = loadBas(bytes);
    else if (kind === 'cmd') module = loadCmd(bytes);
    else throw new OpenError('format', 'not a .CMD load module or a tokenized BASIC program');
  }
  // A .BAS block's identity reads its line pointers as offsets, so hints survive a rebase.
  const normalize = module.format === 'bas' ? basIdentityNormalizer(module) : undefined;
  return build({
    name: opts.name ?? 'program',
    bytes,
    module,
    hash: programHash(bytes),
    normalize,
    selection: opts.selection,
    entries: opts.entries ?? [],
    hintFile: skeletonHints(module, bytes),
    hintSource: undefined,
    applied: noHintsApplied(),
    hinted: false,
    rebasedFrom: opts.rebasedFrom,
  });
}

export function withHintFile(s: Session, file: HintFile, source?: string): Session {
  const applied = applyHints(file, s.module.image, s.hash, s.normalize);
  if (applied.errors.length > 0) throw new OpenError('hints', 'the hint file cannot apply', applied.errors);
  return build({ ...partsOf(s, true), hintFile: file, hintSource: source, applied });
}

export function withHintText(s: Session, text: string, source?: string): Session {
  const parsed = parseHints(text);
  if (parsed.errors.length > 0) throw new OpenError('hints', 'the hint file does not parse', parsed.errors.map((e) => `line ${e.line}: ${e.message}`));
  return withHintFile(s, parsed.file, source);
}

export function withSelection(s: Session, selection: SymbolSelection | undefined): Session {
  return build({ ...partsOf(s, s.analysis.hints !== undefined), selection });
}

/** The hint key for a runtime address; a relocated address maps through the analysis space to its file address. Null when nothing is loaded there. */
export function addressKey(s: Session, addr: number): { block: number; offset: number } | null {
  const file = s.analysis.space.toFile(addr & 0xffff);
  if (file === null) return null;
  const runs = s.module.image.runs();
  const block = runs.findIndex((r) => file >= r.start && file <= r.end);
  return block < 0 ? null : { block, offset: file - runs[block]!.start };
}

export function renderSession(s: Session, format: 'listing' | 'zmac' | 'ir'): string {
  const { module: mod, analysis, name: source } = s;
  if (format === 'listing' && s.plainBasic && mod.format === 'bas') {
    return renderBasListing(mod, { source, ...(s.selection === undefined ? {} : { tables: selectSymbols(s.selection) }) });
  }
  if (format === 'zmac') {
    return emitZmac(mod.image, analysis.pass1, analysis.transfer, { source, symbols: analysis.symbols, annotations: analysis.annotations, space: analysis.space, externals: analysis.externals, tablesUsed: analysis.tablesUsed });
  }
  if (format === 'ir') return `${JSON.stringify(buildIr(mod, analysis.pass1, source, analysis), null, 2)}\n`;
  return renderPass1Listing(analysis, { source });
}
