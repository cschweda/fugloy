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
 *
 * With a trace (M2; trace.ts), each code byte the program rewrites (a cell) is matched to the byte of
 * its instruction it is: a rewritten displacement, immediate or word operand is read from memory when
 * the instruction runs, and the module carries the cell's initial value (`CELLS`); a rewritten JP nn goes
 * to each target the trace saw it hold. The module's `CODE` lets the runtime refuse a write into any
 * other code byte.
 */
import { analyze, applyHints, buildIr, detectFormat, emptyAnnotations, loadCmd, parseHints, programHash, renderInstruction } from '@fugloy/disasm';
import type { Analysis, Annotations, BasicBlock, Ir } from '@fugloy/disasm';
import type { Instruction } from '@fugloy/z80';
import { emit } from './emit.js';
import { routinesOf } from './routines.js';
import type { Routines } from './routines.js';
import type { PortTrace } from './trace.js';
import type { Cells } from './translate.js';

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
  /**
   * The ROM routines the runtime stands in for, address to name: @fugloy/runtime's `standins(model)`,
   * by name (recomp does not depend on the runtime). A CALL to one is written as `o.standin` and is not
   * refused; with none given, a CALL into the ROM is refused, as in M1.
   */
  standins?: ReadonlyMap<number, string>;
  /**
   * The program's trace (trace.ts, `parseTrace`), from the census of sessions it was played in: the code
   * bytes it rewrites. Without one, the port assumes the program rewrites none, and a standalone port
   * throws at a write into its code.
   */
  trace?: PortTrace;
}

/** A code byte the program rewrites (a cell of its trace) and what it is in its instruction. */
export interface PortCell {
  addr: number;
  /** The address of the instruction it is a byte of. */
  instruction: number;
  /** A displacement, an immediate, a byte of a word operand, or the opcode. */
  kind: 'disp' | 'imm' | 'word' | 'opcode';
  /** The values the trace saw written to it. */
  values: number[];
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
  /** The ROM routines the port calls the runtime's stand-ins for, by address, each with its CALLs' addresses in order. */
  standins: { addr: number; name: string; sites: number[] }[];
  /**
   * The trace's cells, by address: the code bytes the program rewrites, each read from memory when its
   * instruction runs. The module carries each one's byte as loaded (`CELLS`), and no other code byte.
   */
  cells: PortCell[];
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
  /** The trace's cells, matched to their instructions, by address; empty with no trace. */
  cells: PortCell[];
  /** By instruction address, the operands it reads from memory and, for a rewritten JP nn, the targets it may hold. */
  patched: ReadonlyMap<number, { cells: Cells; targets?: number[] }>;
}

const addr = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;
const byteHex = (n: number): string => `$${n.toString(16).toUpperCase().padStart(2, '0')}`;
/** `a, b and c`. */
const listed = (items: readonly string[]): string => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/** What a byte of an instruction is: a prefix, its opcode, or a byte of one of its operands. */
type Role = 'prefix' | 'opcode' | 'disp' | 'imm' | 'lo' | 'hi' | 'rel' | 'port';

/**
 * Each byte of the instruction `ins`, by offset, and what it is, from @fugloy/z80's decoding: a CB, ED, DD
 * or FD prefix and then the opcode; with DD CB or FD CB, the displacement before the opcode; then the
 * operands in their order. Null for a DB, which is no instruction.
 */
function roles(ins: Instruction): Role[] | null {
  if (ins.mnemonic === 'DB') return null;
  const [b0, b1] = ins.bytes;
  if ((b0 === 0xdd || b0 === 0xfd) && b1 === 0xcb) return ['prefix', 'prefix', 'disp', 'opcode'];
  const out: Role[] = (b0 === 0xcb || b0 === 0xed || b0 === 0xdd || b0 === 0xfd) && ins.length > 1 ? ['prefix', 'opcode'] : ['opcode'];
  for (const op of ins.operands) {
    if (op.kind === 'idx') out.push('disp');
    else if (op.kind === 'imm8') out.push('imm');
    else if (op.kind === 'imm16' || op.kind === 'mem') out.push('lo', 'hi');
    else if (op.kind === 'rel') out.push('rel');
    else if (op.kind === 'port') out.push('port');
  }
  return out.length === ins.length ? out : null;
}

/** A role as a cell's kind in the report: a JR's displacement is a displacement, a port number an immediate. */
const KIND: Record<Exclude<Role, 'prefix'>, PortCell['kind']> = { opcode: 'opcode', disp: 'disp', rel: 'disp', imm: 'imm', port: 'imm', lo: 'word', hi: 'word' };

/**
 * The trace's cells, each matched to the instruction byte it is (from the IR's instruction at or before
 * it), and by instruction the operands to read from memory; a rewritten JP nn's targets, each of which
 * must be a block of the port. Sentences for a cell in no decoded instruction, a prefix byte, and a
 * target where no block starts.
 */
function matchCells(
  trace: PortTrace,
  analysis: Analysis,
  isBlock: (a: number) => boolean,
): { cells: PortCell[]; patched: Map<number, { cells: Cells; targets?: number[] }>; errors: string[] } {
  const { instructions } = analysis.pass1;
  const bytes = analysis.space.image.bytes;
  const text = (ins: Instruction): string => renderInstruction(ins, analysis.symbols);
  const cells: PortCell[] = [];
  const patched = new Map<number, { cells: Cells; targets?: number[] }>();
  const errors: string[] = [];
  /** By instruction: its word cells' values, low and high (undefined where that byte is not a cell). */
  const words = new Map<number, { lo?: number[]; hi?: number[] }>();
  for (const p of trace.patches) {
    let at: number | undefined;
    for (let back = 0; back < 4 && at === undefined; back++) {
      const ins = instructions.get((p.addr - back) & 0xffff);
      if (ins !== undefined && back < ins.length) at = (p.addr - back) & 0xffff;
    }
    const ins = at === undefined ? undefined : instructions.get(at)!;
    const role = ins === undefined ? undefined : roles(ins)?.[(p.addr - at!) & 0xffff];
    if (ins === undefined || role === undefined) {
      errors.push(`${addr(p.addr)}: the trace says the program rewrites this byte, which is in no instruction the disassembly decoded; an entry hint that decodes the code around it would let the port read it.`);
      continue;
    }
    if (role === 'prefix') {
      errors.push(`${addr(p.addr)}: the trace says the program rewrites this byte, a prefix of ${text(ins)} at ${addr(at!)}, which a port cannot follow.`);
      continue;
    }
    cells.push({ addr: p.addr, instruction: at!, kind: KIND[role], values: [...p.values] });
    if (role === 'opcode') continue;
    let entry = patched.get(at!);
    if (entry === undefined) patched.set(at!, (entry = { cells: {} }));
    if (role === 'disp' || role === 'rel') entry.cells.disp = p.addr;
    else if (role === 'imm' || role === 'port') entry.cells.imm = p.addr;
    else {
      entry.cells.word = role === 'lo' ? p.addr : (p.addr - 1) & 0xffff;
      const w = words.get(at!) ?? {};
      w[role] = p.values;
      words.set(at!, w);
    }
  }

  // A rewritten JP nn: the words the trace attests (its low byte's values with its high byte's, one of
  // them a single value, or the byte as loaded where it is not a cell), and the word as loaded where a
  // block starts there
  for (const [at, w] of words) {
    const ins = instructions.get(at)!;
    const lo = patched.get(at)!.cells.word!;
    if (w.lo === undefined || w.hi === undefined) patched.get(at)!.cells.half = w.lo === undefined ? 'hi' : 'lo';
    if (ins.mnemonic !== 'JP' || ins.operands.length !== 1 || ins.operands[0]!.kind !== 'imm16') continue;
    const los = w.lo ?? [bytes[lo]!];
    const his = w.hi ?? [bytes[(lo + 1) & 0xffff]!];
    if (los.length > 1 && his.length > 1) {
      errors.push(
        `${addr(at)}: ${text(ins)}'s target is rewritten in both its bytes (${addr(lo)}: ${listed(los.map(byteHex))}; ${addr(lo + 1)}: ${listed(his.map(byteHex))}), and the trace does not say which low byte goes with which high byte, so the port cannot name its targets.`,
      );
      continue;
    }
    const seen = los.flatMap((l) => his.map((h) => l | (h << 8)));
    const bad = seen.filter((t) => !isBlock(t));
    for (const t of bad) errors.push(`${addr(at)}: ${text(ins)}'s target is rewritten to ${addr(t)}, where no block of the disassembly starts; an entry hint there would decode it.`);
    if (bad.length > 0) continue;
    const loaded = bytes[lo]! | (bytes[(lo + 1) & 0xffff]! << 8);
    patched.get(at)!.targets = [...new Set([...seen, ...(isBlock(loaded) ? [loaded] : [])])].sort((x, y) => x - y);
  }
  return { cells, patched, errors };
}

/** Analyse the .CMD program `cmd` for its port, or say in sentences why it cannot be ported. */
export function prepare(cmd: Uint8Array, opts: PortOptions): { ok: true; prepared: Prepared } | { ok: false; errors: string[] } {
  if (opts.model !== 1 && opts.model !== 3) return { ok: false, errors: [`model must be 1 (the Model I) or 3 (the Model III), not ${String(opts.model)}.`] };
  if (detectFormat(cmd) !== 'cmd') return { ok: false, errors: ['the program is not a .CMD load module.'] };
  const { trace } = opts;
  if (trace !== undefined && trace.program.sha256 !== programHash(cmd)) {
    return { ok: false, errors: [`the trace was taken of another program (${trace.program.name}, SHA-256 ${trace.program.sha256}), not this one; take a census of this program.`] };
  }
  if (trace !== undefined && trace.model !== opts.model) {
    return { ok: false, errors: [`the trace was taken on the Model ${trace.model === 1 ? 'I' : 'III'}, and the port is for the Model ${opts.model === 1 ? 'I' : 'III'}.`] };
  }
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
    const transfer = ir.entry;
    if (hinted.length === 0) return { ok: false, errors: [`the hint file relocates part of the program to ${ranges} but names no entry there, so the port has nowhere to start; add an entry line where the moved program starts.`] };
    // Of several, the program starts at the one its code reaches from the file's transfer address: an
    // entry nothing reaches is code it gets to some way the disassembly cannot see (a JP whose target it
    // rewrites, as Sea Dragon's at $509A), not where it starts.
    let starts = hinted;
    if (hinted.length > 1 && transfer !== null) {
      const reached = reachedFrom(transfer, blocks);
      const found = hinted.filter((a) => reached.has(a));
      if (found.length === 1) starts = found;
    }
    if (starts.length > 1) return { ok: false, errors: [`the hint file names ${hinted.length} entries inside the relocated range (${hinted.map(addr).join(', ')}), so the port cannot tell where the program starts; keep the one it starts at.`] };
    entry = starts[0]!;
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

  // The trace's cells; a rewritten JP nn's targets are its block's successors, so its routine holds them
  const matched = trace === undefined ? { cells: [], patched: new Map<number, { cells: Cells; targets?: number[] }>(), errors: [] } : matchCells(trace, analysis, (a) => blocks.has(a) && !loaderBlocks.has(a));
  if (matched.errors.length > 0) return { ok: false, errors: matched.errors };
  const ported = ir.blocks
    .filter((b) => !loaderBlocks.has(b.start))
    .map((b): BasicBlock => {
      const last = [...matched.patched].find(([at, p]) => p.targets !== undefined && at >= b.start && at + analysis.pass1.instructions.get(at)!.length - 1 === b.end);
      return last === undefined ? b : { ...b, succ: [...b.succ, ...last[1].targets!.map((to) => ({ kind: 'jump' as const, to }))] };
    });
  const routines = routinesOf({ ...ir, blocks: ported }, entry);
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
  return { ok: true, prepared: { analysis, ir, entry, ...(loader === undefined ? {} : { loader }), loaderBlocks, routines, code, data, cells: matched.cells, patched: matched.patched } };
}

/** The blocks reached from `from` by any transfer the IR knows (a CALL's included), `from` among them. */
function reachedFrom(from: number, blocks: ReadonlyMap<number, BasicBlock>): Set<number> {
  const seen = new Set<number>();
  const todo = [from];
  while (todo.length > 0) {
    const at = todo.pop()!;
    const b = blocks.get(at);
    if (b === undefined || seen.has(at)) continue;
    seen.add(at);
    for (const s of b.succ) if (s.kind !== 'external') todo.push(s.to);
  }
  return seen;
}

/** Port the .CMD program `cmd`, or say in sentences why it cannot be. */
export function port(cmd: Uint8Array, opts: PortOptions): PortResult {
  const p = prepare(cmd, opts);
  if (!p.ok) return p;
  const { analysis, ir, entry, loader, routines, data, code, cells, patched } = p.prepared;
  // A swapped opcode is not translated yet: each one is named
  const swapped = cells.filter((c) => c.kind === 'opcode');
  if (swapped.length > 0) {
    return {
      ok: false,
      errors: swapped.map((c) => {
        const ins = analysis.pass1.instructions.get(c.instruction)!;
        return `${addr(c.addr)}: the program rewrites the opcode of ${renderInstruction(ins, analysis.symbols)} at ${addr(c.instruction)} (the trace saw ${listed(c.values.map(byteHex))} there); a port does not translate a swapped opcode yet.`;
      }),
    };
  }
  const bytes = analysis.space.image.bytes;
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
    standins: opts.standins ?? new Map(),
    data: data.map((d) => [d.addr, d.bytes] as const),
    code: code.map((r) => [r.start, r.end] as const),
    cells: cells.map((c) => [c.addr, bytes[c.addr]!] as const),
    patched,
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
      standins: [...out.standinSites]
        .sort(([x], [y]) => x - y)
        .map(([at, sites]) => ({ addr: at, name: opts.standins!.get(at)!, sites: [...sites].sort((x, y) => x - y) })),
      cells,
    },
  };
}
