/**
 * port(): a TRS-80 .CMD program to its port, one JavaScript module that runs on @fugloy/runtime.
 * @fugloy/disasm loads and analyses it (a hint file's decisions applied, the caller's names given to
 * its addresses); its IR's blocks are grouped into routines (routines.ts) and written out (emit.ts).
 * The module carries the program's non-code bytes as `DATA` and none of its code.
 *
 * A program its hint file relocates (the file loads it at one address and a loader moves it to where
 * it runs) is analysed at its run addresses: the port starts at the hint file's entry inside the
 * relocated range, `DATA` holds the non-code bytes at the addresses the program runs at, and the
 * loader (the file's transfer routine) is not translated; the report says where it is.
 */
import { analyze, applyHints, buildIr, detectFormat, emptyAnnotations, loadCmd, parseHints, programHash } from '@fugloy/disasm';
import type { Analysis, Annotations, Ir } from '@fugloy/disasm';
import { emit } from './emit.js';
import { routinesOf } from './routines.js';
import type { Routines } from './routines.js';

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
  /** The entry routine's address: the file's transfer address, or with a relocating hint file the hinted entry inside the relocated range. */
  entryAddr: number;
  /** With a relocating hint file, the file's transfer routine that moves the program: not translated. */
  loader?: { addr: number; length: number; note: string };
  /** In address order. `labelled`: its blocks are the labelled cases of a `switch` rather than structured code. */
  routines: { name: string; addr: number; blocks: number; labelled: boolean }[];
  /**
   * `DATA`'s entries, at the addresses the program runs at. `data`: a region the hint file types as data;
   * `unknown`: a region the analysis did not reach (the string heuristic's guesses included).
   */
  data: { addr: number; length: number; kind: 'data' | 'unknown' }[];
  /** The places that throw a sentence if they run (a transfer to no block, a HALT), one sentence each. */
  refused: string[];
}

export type PortResult = { ok: true; js: string; report: PortReport } | { ok: false; errors: string[] };

/**
 * What a port is made from, before it is written: the analysis and its IR (regions at run addresses),
 * the entry, the loader when there is one, the routines and `DATA`. port() writes it out; the referee
 * (test code) takes the program's code from it. Not exported from the package.
 */
export interface Prepared {
  analysis: Analysis;
  ir: Ir;
  entry: number;
  loader?: { addr: number; length: number; note: string };
  /** The loader's blocks, by start: left out of the routines. */
  loaderBlocks: ReadonlySet<number>;
  routines: Routines;
  /** The program's code the port translates, at run addresses: the IR's code regions but the loader's bytes. */
  code: { start: number; end: number }[];
  data: { addr: number; bytes: Uint8Array; kind: 'data' | 'unknown' }[];
}

const addr = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

/** Analyse the .CMD program `cmd` for its port, or say in sentences why it cannot be ported. */
export function prepare(cmd: Uint8Array, opts: PortOptions): { ok: true; prepared: Prepared } | { ok: false; errors: string[] } {
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
  const blocks = new Map(ir.blocks.map((b) => [b.start, b]));

  let entry: number;
  let loader: Prepared['loader'];
  const loaderBlocks = new Set<number>();
  if (ir.relocations.length === 0) {
    if (ir.entry === null) return { ok: false, errors: ['the program has no entry address.'] };
    entry = ir.entry;
  } else {
    // The program starts at the hinted entry inside the relocated range; the transfer routine is the loader.
    const moved = (a: number): boolean => ir.relocations.some((r) => a >= r.runAddr && a < r.runAddr + r.length);
    const ranges = ir.relocations.map((r) => `${addr(r.runAddr)}-${addr(r.runAddr + r.length - 1)}`).join(', ');
    const hinted = [...new Set(analysis.annotations.entries)].filter(moved).sort((x, y) => x - y);
    if (hinted.length === 0) return { ok: false, errors: [`the hint file relocates part of the program to ${ranges} but names no entry there, so the port has nowhere to start; add an entry line where the moved program starts.`] };
    if (hinted.length > 1) return { ok: false, errors: [`the hint file names ${hinted.length} entries inside the relocated range (${hinted.map(addr).join(', ')}), so the port cannot tell where the program starts; keep the one it starts at.`] };
    entry = hinted[0]!;
    const transfer = ir.entry;
    if (transfer === null || !blocks.has(transfer) || moved(transfer)) {
      return { ok: false, errors: [`the file's transfer address${transfer === null ? '' : `, ${addr(transfer)},`} is not code the disassembly found outside the relocated range, so it is not a loader the port can leave out.`] };
    }
    // The loader: the blocks its transfer routine reaches, by any transfer, without entering the moved program
    const todo = [transfer];
    loaderBlocks.add(transfer);
    while (todo.length > 0) {
      for (const s of blocks.get(todo.pop()!)!.succ) {
        if (s.kind === 'external' || !blocks.has(s.to) || moved(s.to) || loaderBlocks.has(s.to)) continue;
        loaderBlocks.add(s.to);
        todo.push(s.to);
      }
    }
    const length = [...loaderBlocks].reduce((n, b) => n + blocks.get(b)!.end - b + 1, 0);
    loader = {
      addr: transfer,
      length,
      note: `The file's transfer routine at ${addr(transfer)} (${length} bytes) moves the program to where it runs; the port does not translate it, and starts at ${addr(entry)} with its data already at its run addresses.`,
    };
  }
  if (!blocks.has(entry) || loaderBlocks.has(entry)) return { ok: false, errors: [`the entry, ${addr(entry)}, is not code the disassembly found.`] };

  const routines = routinesOf({ ...ir, blocks: ir.blocks.filter((b) => !loaderBlocks.has(b.start)) }, entry);
  // The regions are run addresses, so their bytes come from the analysis image, not the file's.
  const bytes = analysis.space.image.bytes;
  // What the analysis reached as data: the bytes the hint file types (bytes, words, string, a table). The
  // disassembler types no data from the code's references, and its string heuristic only guesses at bytes
  // nothing reached, so a region it alone typed is still `unknown`.
  const typed = new Uint8Array(0x10000);
  for (const o of analysis.annotations.overrides) if (o.kind === 'bytes' || o.kind === 'words' || o.kind === 'string') for (let k = 0; k < o.length; k++) typed[(o.addr + k) & 0xffff] = 1;
  for (const t of analysis.annotations.tables) for (let k = 0; k < t.count * t.width; k++) typed[(t.addr + k) & 0xffff] = 1;
  const data = ir.regions
    .filter((r) => r.kind !== 'code')
    .map((r) => ({
      addr: r.start,
      bytes: bytes.slice(r.start, r.end + 1),
      kind: r.kind === 'bytes' && typed.subarray(r.start, r.end + 1).every((v) => v === 1) ? ('data' as const) : ('unknown' as const),
    }));
  const inLoader = (a: number): boolean => [...loaderBlocks].some((b) => a >= b && a <= blocks.get(b)!.end);
  const code: { start: number; end: number }[] = [];
  for (const r of ir.regions) {
    if (r.kind !== 'code') continue;
    for (let a = r.start; a <= r.end; a++) {
      if (inLoader(a)) continue;
      const last = code[code.length - 1];
      if (last !== undefined && last.end === a - 1) last.end = a;
      else code.push({ start: a, end: a });
    }
  }
  return { ok: true, prepared: { analysis, ir, entry, ...(loader === undefined ? {} : { loader }), loaderBlocks, routines, code, data } };
}

/** Port the .CMD program `cmd`, or say in sentences why it cannot be. */
export function port(cmd: Uint8Array, opts: PortOptions): PortResult {
  const p = prepare(cmd, opts);
  if (!p.ok) return p;
  const { analysis, ir, entry, loader, routines, data } = p.prepared;
  const out = emit({
    model: opts.model,
    runtimeImport: opts.runtimeImport,
    ...(opts.source === undefined ? {} : { source: opts.source }),
    entry,
    ...(loader === undefined ? {} : { loader }),
    routines,
    ir,
    instructions: analysis.pass1.instructions,
    symbols: analysis.symbols,
    comments: analysis.annotations.comments,
    names: opts.names ?? new Map(),
    data: data.map((d) => [d.addr, d.bytes] as const),
  });
  if (out.errors.length > 0) return { ok: false, errors: out.errors };
  return {
    ok: true,
    js: out.js,
    report: {
      entry: out.routineNames.get(entry)!,
      entryAddr: entry,
      ...(loader === undefined ? {} : { loader }),
      routines: routines.routines.map((r) => ({ name: out.routineNames.get(r.start)!, addr: r.start, blocks: r.blocks.length, labelled: out.labelled.get(r.start)! })),
      data: data.map((d) => ({ addr: d.addr, length: d.bytes.length, kind: d.kind })),
      refused: out.refused,
    },
  };
}
