/** Loader output to Pass 1: the roots are the module's entry plus any user entries. */
import { recursiveDescent } from './analysis/descent.js';
import type { Pass1 } from './analysis/descent.js';
import { synthesizeSymbols } from './analysis/symbols.js';
import type { SymbolTable } from './analysis/symbols.js';
import { emptyAnnotations } from './hints/apply.js';
import type { Annotations } from './hints/apply.js';
import type { Module } from './ir.js';

export interface AnalyzeOptions {
  /** Extra entry points (`--entry`). */
  entries?: number[];
  /** Hint-file decisions, already matched to this image. */
  annotations?: Annotations;
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
}

/** Roots in order: module entry, --entry addresses, hint entries, code hints; tables add theirs inside descent. */
export function analyze(mod: Module, opts: AnalyzeOptions = {}): Analysis {
  const annotations = opts.annotations ?? emptyAnnotations();
  const entry = mod.format === 'bas' ? null : mod.entry;
  const roots: number[] = entry === null ? [] : [entry];
  for (const e of opts.entries ?? []) roots.push(e & 0xffff);
  roots.push(...annotations.entries);
  for (const o of annotations.overrides) if (o.kind === 'code') roots.push(o.addr);
  const pass1 = recursiveDescent(mod.image, roots, annotations);
  const transfer = mod.format === 'cmd' ? (mod.entrySource === 'transfer' ? mod.entry : null) : mod.format === 'raw' ? mod.entry : null;
  const symbols = synthesizeSymbols(pass1, annotations, mod.image);
  return { module: mod, pass1, entry, roots: pass1.roots, transfer, annotations, symbols };
}
