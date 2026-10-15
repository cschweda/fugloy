/** Loader output to Pass 1: the roots are the module's entry plus any user entries. */
import { recursiveDescent } from './analysis/descent.js';
import type { Pass1 } from './analysis/descent.js';
import type { Module } from './ir.js';

export interface AnalyzeOptions {
  /** Extra entry points (`--entry`). */
  entries?: number[];
}

export interface Analysis {
  module: Module;
  pass1: Pass1;
  entry: number | null;
  roots: number[];
}

export function analyze(mod: Module, opts: AnalyzeOptions = {}): Analysis {
  const entry = mod.format === 'bas' ? null : mod.entry;
  const roots: number[] = entry === null ? [] : [entry];
  for (const e of opts.entries ?? []) roots.push(e & 0xffff);
  const pass1 = recursiveDescent(mod.image, roots);
  return { module: mod, pass1, entry, roots: pass1.roots };
}
