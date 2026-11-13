/**
 * port(): a TRS-80 .CMD program to its port, one JavaScript module that runs on @fugloy/runtime.
 * @fugloy/disasm loads and analyses it (a hint file's decisions applied, the caller's names given to
 * its addresses); its IR's blocks are grouped into routines (routines.ts) and written out (emit.ts).
 * The module carries the program's non-code bytes as `DATA` and none of its code.
 */
import { analyze, applyHints, buildIr, detectFormat, emptyAnnotations, loadCmd, parseHints, programHash } from '@fugloy/disasm';
import type { Annotations } from '@fugloy/disasm';
import { emit } from './emit.js';
import { routinesOf } from './routines.js';

export interface PortOptions {
  /** The machine the port runs on: 1, the Model I, or 3, the Model III. */
  model: 1 | 3;
  /** Names for addresses (for M1, @fugloy/asm's symbols); they win over the hint file's and the disassembler's. */
  names?: ReadonlyMap<number, string>;
  /** A hint file's text: its names, notes and other decisions apply. */
  hints?: string;
  /** Where the module imports the runtime's helpers from: `@fugloy/runtime/ops` in a bundle. */
  runtimeImport: string;
  /** What the program is, for the module's first comment (a file name, not a path). */
  source?: string;
}

export interface PortReport {
  /** The entry routine's name. */
  entry: string;
  /** In address order. `labelled`: its blocks are the labelled cases of a `switch` rather than structured code. */
  routines: { name: string; addr: number; blocks: number; labelled: boolean }[];
  /** `DATA`'s entries. */
  data: { addr: number; length: number }[];
  /** The places that throw a sentence if they run (a transfer to no block, a HALT), one sentence each. */
  refused: string[];
}

export type PortResult = { ok: true; js: string; report: PortReport } | { ok: false; errors: string[] };

const addr = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

/** Port the .CMD program `cmd`, or say in sentences why it cannot be. */
export function port(cmd: Uint8Array, opts: PortOptions): PortResult {
  if (opts.model !== 1 && opts.model !== 3) return { ok: false, errors: [`model must be 1 (the Model I) or 3 (the Model III), not ${String(opts.model)}.`] };
  if (detectFormat(cmd) !== 'cmd') return { ok: false, errors: ['the program is not a .CMD load module.'] };
  const mod = loadCmd(cmd);

  let annotations: Annotations = emptyAnnotations();
  if (opts.hints !== undefined) {
    const parsed = parseHints(opts.hints);
    if (parsed.errors.length > 0) return { ok: false, errors: parsed.errors.map((e) => `the hint file, line ${e.line}: ${e.message}`) };
    const applied = applyHints(parsed.file, mod.image, programHash(cmd));
    if (applied.errors.length > 0) return { ok: false, errors: applied.errors.map((e) => `the hint file: ${e}`) };
    annotations = applied.annotations;
  }
  // The caller's names name the listing's operands too, so each instruction's comment reads with them.
  if (opts.names !== undefined) annotations = { ...annotations, names: new Map([...annotations.names, ...opts.names]) };

  const analysis = analyze(mod, { annotations });
  const ir = buildIr(mod, analysis.pass1, opts.source, analysis);
  if (ir.relocations.length > 0) return { ok: false, errors: ['the hint file relocates part of the program, which M1 does not port.'] };
  const entry = ir.entry;
  if (entry === null) return { ok: false, errors: ['the program has no entry address.'] };
  if (!ir.blocks.some((b) => b.start === entry)) return { ok: false, errors: [`the entry, ${addr(entry)}, is not code the disassembly found.`] };

  const routines = routinesOf(ir, entry);
  const data = ir.regions.filter((r) => r.kind !== 'code').map((r) => [r.start, mod.image.bytes.slice(r.start, r.end + 1)] as const);
  const out = emit({
    model: opts.model,
    runtimeImport: opts.runtimeImport,
    ...(opts.source === undefined ? {} : { source: opts.source }),
    entry,
    routines,
    ir,
    instructions: analysis.pass1.instructions,
    symbols: analysis.symbols,
    comments: analysis.annotations.comments,
    names: opts.names ?? new Map(),
    data,
  });
  if (out.errors.length > 0) return { ok: false, errors: out.errors };
  return {
    ok: true,
    js: out.js,
    report: {
      entry: out.routineNames.get(entry)!,
      routines: routines.routines.map((r) => ({ name: out.routineNames.get(r.start)!, addr: r.start, blocks: r.blocks.length, labelled: true })),
      data: data.map(([at, bytes]) => ({ addr: at, length: bytes.length })),
      refused: out.refused,
    },
  };
}
