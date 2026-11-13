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
 * to each target the trace saw it hold. A rewritten opcode makes its instruction a choice (a variant
 * site): one instruction per value the trace saw there and the value as loaded, each decoded here from
 * the bytes as loaded with the cell's byte replaced and translated ahead of time; the site is a block of
 * its own whose successors are every variant's, and any the analysis did not reach is given to it as a
 * root. The module's `CODE` lets the runtime refuse a write into any other code byte. A POP the trace says
 * dropped a return address (its `drops`) ends its block (several in a row, the last of them), which
 * throws `o.unwind`, and the instruction after it starts a routine (a continuation), which the port goes
 * on with a routine up.
 *
 * The trace's ROM reads (the ROM bytes the program reads as data) are the module's `ROM`, which the
 * runtime's `load` puts in memory, so a port needs no ROM of anyone's.
 *
 * With or without a trace, when the entry's first block loads SP with a constant before any CALL, RET, PUSH
 * or POP (an `LD SP,nn` whose operand is not one of the trace's cells), a transfer back to the entry
 * discards the program's whole stack: the port throws `o.reset`, which leaves every routine running and
 * runs the entry from the top-level trampoline.
 */
import { analyze, applyHints, buildIr, detectFormat, emptyAnnotations, endsPath, loadCmd, parseHints, programHash, renderInstruction, targetOf } from '@fugloy/disasm';
import type { Analysis, Annotations, BasicBlock, Ir, Successor } from '@fugloy/disasm';
import { decode } from '@fugloy/z80';
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
   * bytes it rewrites and the return addresses it drops. Without one, the port assumes the program
   * rewrites none and drops none: a standalone port throws at a write into its code, and at the RET after
   * a POP that dropped one.
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
  /**
   * For an opcode: the instruction for each value the port chooses between (each the trace saw, and the
   * value as loaded), by value, as assembly.
   */
  variants?: string[];
}

/** An instruction whose opcode the program rewrites: its cell, and one instruction per value it may hold. */
export interface VariantSite {
  /** The opcode byte the program rewrites (the instruction's first byte, or the one after a prefix). */
  cell: number;
  /** By value: each the trace saw there, and the value as loaded; each decoded from the bytes as loaded with the cell's byte replaced. */
  variants: { value: number; ins: Instruction }[];
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
  /**
   * The trace's drops, by address: each POP that drops a return address, and the routine the port goes on
   * with after it (after the last of several in a row), a routine up for each.
   */
  drops: { at: number; continuation: string }[];
  /**
   * The transfers back to the entry that discard the program's stack (the entry's first block loads SP with
   * a constant before it touches the stack), by address, each with a sentence: the port leaves every
   * routine running and runs the entry from the top.
   */
  resets: { at: number; note: string }[];
  /** The ROM bytes the program reads as data (the trace's ROM reads), by address: the module's `ROM`, which `load` puts in memory. */
  rom: { addr: number; value: number }[];
}

/** A POP that drops a return address, or the last of several in a row: its block ends with it. */
export interface Drop {
  /** How many return addresses: the POPs in a row that end the block. */
  levels: number;
  /** Their addresses, in order. */
  pops: number[];
  /** The address after the last: a routine's start. */
  continuation: number;
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
  /** By instruction address, the instructions whose opcode the program rewrites: each a block of its own. */
  variants: ReadonlyMap<number, VariantSite>;
  /** By the address of the last POP of each, the trace's drops: each ends its block. */
  drops: ReadonlyMap<number, Drop>;
  /** When the entry's first block loads SP with a constant before it touches the stack: that LD SP's address. */
  reset?: number;
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
 * The trace's cells, each matched to the instruction byte it is (from the decoded instruction that covers
 * it), and by instruction the operands to read from memory; a rewritten JP nn's targets, each of which
 * must be a block of the port. Sentences for a cell two decoded instructions cover, a cell in no decoded
 * instruction, a prefix byte, and a target where no block starts. Exported for the tests, which give it a
 * pass 1 holding two decodes over one byte.
 */
export function matchCells(
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
    // Every decoded instruction that covers the cell (an instruction is at most four bytes)
    const covering: number[] = [];
    for (let back = 3; back >= 0; back--) {
      const ins = instructions.get((p.addr - back) & 0xffff);
      if (ins !== undefined && back < ins.length) covering.push((p.addr - back) & 0xffff);
    }
    if (covering.length > 1) {
      const which = listed(covering.map((a) => `${text(instructions.get(a)!)} at ${addr(a)}`));
      errors.push(`${addr(p.addr)}: the trace says the program rewrites this byte, which ${covering.length === 2 ? 'two' : String(covering.length)} instructions the disassembly decoded cover (${which}); a port cannot tell which of them the byte belongs to.`);
      continue;
    }
    const at: number | undefined = covering[0];
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

/** The successors of a block that ends in `ins` at `at`, as @fugloy/disasm's basicBlocks gives them; a target not loaded is external. */
function successorsOf(ins: Instruction, at: number, loaded: (a: number) => boolean): Successor[] {
  const out: Successor[] = [];
  const target = targetOf(ins);
  if (target !== null) {
    const kind = ins.flow.kind === 'call' ? (ins.operands[0]?.kind === 'rst' ? 'rst' : ins.flow.conditional ? 'ccall' : 'call') : ins.flow.conditional ? 'cjump' : 'jump';
    out.push({ to: target, kind: loaded(target) ? kind : 'external' });
  }
  if (!endsPath(ins)) out.push({ to: (at + ins.length) & 0xffff, kind: 'next' });
  return out;
}

/**
 * The instructions an opcode cell makes of its instruction: one per value the trace saw there and the
 * value as loaded, by value, each decoded from the bytes as loaded with the cell's byte replaced. Sentences
 * for a value @fugloy/z80 decodes only as DB, one that makes the cell a prefix (the instruction would run
 * on into bytes the analysis reads as other instructions), and a variant with another byte that is not
 * code the disassembly decoded (no write guard would keep it) or is itself rewritten (`rewritten`).
 */
function variantSite(cell: PortCell, analysis: Analysis, rewritten: ReadonlySet<number>): { site: VariantSite } | { errors: string[] } {
  const at = cell.instruction;
  const bytes = analysis.space.image.bytes;
  const loaded = analysis.pass1.instructions.get(at)!;
  const text = (ins: Instruction): string => renderInstruction(ins, analysis.symbols);
  const said = `${addr(cell.addr)}: the program rewrites the opcode of ${text(loaded)} at ${addr(at)}`;
  const values = [...new Set([...cell.values, bytes[cell.addr]!])].sort((x, y) => x - y);
  const errors: string[] = [];
  const variants: VariantSite['variants'] = [];
  for (const value of values) {
    const ins = decode((i) => {
      const a = (at + i) & 0xffff;
      return a === cell.addr ? value : bytes[a];
    }, at);
    const role = roles(ins)?.[(cell.addr - at) & 0xffff];
    const spelled = ins.bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
    if (ins.mnemonic === 'DB' || role === undefined) {
      errors.push(`${said} to ${byteHex(value)}, and @fugloy/z80 reads ${spelled} there only as DB, so the port has no instruction to translate for it.`);
      continue;
    }
    if (role !== 'opcode') {
      errors.push(`${said} to ${byteHex(value)}, a prefix: ${spelled} decodes as ${text(ins)}, running on into bytes the disassembly reads as other instructions, which a port cannot follow.`);
      continue;
    }
    let fits = true;
    for (let k = 0; k < ins.length; k++) {
      const a = (at + k) & 0xffff;
      if (a === cell.addr) continue;
      if (rewritten.has(a)) errors.push(`${said} to ${byteHex(value)}, making ${text(ins)}, which takes in the byte at ${addr(a)}; the program rewrites that byte too, and a port does not translate a variant that takes in a rewritten byte other than its opcode.`);
      else if (!analysis.pass1.map.isCode(a)) errors.push(`${said} to ${byteHex(value)}, making ${text(ins)}, whose byte at ${addr(a)} is not code the disassembly decoded, so the port could not keep it from being written.`);
      else continue;
      fits = false;
      break;
    }
    if (fits) variants.push({ value, ins });
  }
  return errors.length > 0 ? { errors } : { site: { cell: cell.addr, variants } };
}

/** Where a variant's successor came from: the cell, its site, the value and the instruction it makes there. */
interface RootOrigin {
  cell: number;
  at: number;
  value: number;
  ins: Instruction;
}

/**
 * The roots a swapped opcode needs the analysis to have, so each site is a block of its own and every
 * variant's successors are blocks: each site, and every successor in the loaded program, in the trace's
 * order; and for each successor, the variant that goes there (the first, where several do). Empty with no
 * opcode cell. The sentences are left to the match on the final analysis.
 */
function variantRoots(trace: PortTrace, analysis: Analysis): { roots: number[]; origins: Map<number, RootOrigin> } {
  const { cells } = matchCells(trace, analysis, () => true);
  const rewritten = new Set(cells.map((c) => c.addr));
  const loaded = (a: number): boolean => analysis.space.image.isLoaded(a);
  const roots: number[] = [];
  const origins = new Map<number, RootOrigin>();
  for (const c of cells) {
    if (c.kind !== 'opcode') continue;
    const v = variantSite(c, analysis, rewritten);
    if (!('site' in v)) continue;
    roots.push(c.instruction);
    for (const x of v.site.variants) {
      for (const s of successorsOf(x.ins, c.instruction, loaded)) {
        if (s.kind === 'external') continue;
        roots.push(s.to);
        if (!origins.has(s.to)) origins.set(s.to, { cell: c.addr, at: c.instruction, value: x.value, ins: x.ins });
      }
    }
  }
  return { roots: [...new Set(roots)], origins };
}

/**
 * The instructions of the first analysis (`before`, with no variant's roots) that the second (`after`) no
 * longer has at the same address and length: a variant's successor was decoded first and took their bytes
 * (the analysis works its roots in order, the variants' before the hint file's entries). One sentence for
 * each, naming it and the variant whose successor's path decoded over it: a successor no first-pass
 * instruction starts at, from which the second analysis's new instructions (by falling through and their
 * targets) reach an instruction overlapping it.
 */
function displaced(before: Analysis, after: Analysis, origins: ReadonlyMap<number, RootOrigin>): string[] {
  const old = before.pass1.instructions;
  const now = after.pass1.instructions;
  const text = (ins: Instruction): string => renderInstruction(ins, before.symbols);
  const lost = [...old].filter(([a, ins]) => now.get(a)?.length !== ins.length).sort(([x], [y]) => x - y);
  if (lost.length === 0) return [];
  const fresh = (a: number): boolean => now.has(a) && old.get(a)?.length !== now.get(a)!.length;
  /** The new instructions a successor's path decoded: from it, by falling through and to their targets. */
  const pathOf = (from: number): Set<number> => {
    const seen = new Set<number>();
    const todo = [from];
    while (todo.length > 0) {
      const a = todo.pop()!;
      if (seen.has(a) || !fresh(a)) continue;
      seen.add(a);
      const ins = now.get(a)!;
      if (!endsPath(ins)) todo.push((a + ins.length) & 0xffff);
      const t = targetOf(ins);
      if (t !== null) todo.push(t);
    }
    return seen;
  };
  const paths = [...origins].filter(([to]) => !old.has(to)).map(([to, o]) => ({ to, o, path: pathOf(to) }));
  return lost.map(([a, ins]) => {
    const overlaps = (b: number): boolean => b < a + ins.length && a < b + now.get(b)!.length;
    const by = paths.find((p) => [...p.path].some(overlaps)) ?? paths[0];
    const lostText = `${text(ins)} at ${addr(a)}`;
    if (by === undefined) return `${addr(a)}: the analysis with the swapped opcodes' successors as roots no longer decodes ${lostText}, which the program's own code reaches; a port cannot follow it.`;
    return `${addr(by.o.cell)}: the program rewrites the opcode at ${addr(by.o.at)} to ${byteHex(by.o.value)}, making ${text(by.o.ins)}, which goes to ${addr(by.to)}, where no block of the disassembly starts; decoding code there would displace ${lostText}, which the program's own code reaches.`;
  });
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
  // A ROM read the module carries is stored straight into memory by `load`: it must be in the ROM's space
  const romTop = opts.model === 1 ? 0x3000 : 0x3800;
  const outside = (trace?.romReads ?? []).filter((r) => r.addr >= romTop);
  if (outside.length > 0) {
    return { ok: false, errors: outside.map((r) => `${addr(r.addr)}: the trace says the program read this byte of the ROM, but the Model ${opts.model === 1 ? 'I' : 'III'}'s ROM ends at ${addr(romTop - 1)}.`) };
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

  let analysis = analyze(mod, { annotations });
  // A swapped opcode's site, and its variants' successors, start blocks: given to the analysis as roots,
  // which also decodes a successor only a variant reaches
  if (trace !== undefined) {
    const { roots, origins } = variantRoots(trace, analysis);
    if (roots.length > 0) {
      const first = analysis;
      analysis = analyze(mod, { annotations, entries: roots });
      // Every instruction the program's own code reaches must survive the roots, at the same address and length
      const lost = displaced(first, analysis, origins);
      if (lost.length > 0) return { ok: false, errors: lost };
    }
  }
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
  const isBlock = (a: number): boolean => blocks.has(a) && !loaderBlocks.has(a);
  const matched = trace === undefined ? { cells: [], patched: new Map<number, { cells: Cells; targets?: number[] }>(), errors: [] } : matchCells(trace, analysis, isBlock);
  if (matched.errors.length > 0) return { ok: false, errors: matched.errors };

  // The swapped opcodes: each site a block of its own, whose successors are its variants' together
  const variants = new Map<number, VariantSite>();
  const variantSucc = new Map<number, Successor[]>();
  const variantErrors: string[] = [];
  const rewritten = new Set(matched.cells.map((c) => c.addr));
  const text = (ins: Instruction): string => renderInstruction(ins, analysis.symbols);
  for (const c of matched.cells) {
    if (c.kind !== 'opcode') continue;
    const v = variantSite(c, analysis, rewritten);
    if (!('site' in v)) {
      variantErrors.push(...v.errors);
      continue;
    }
    const at = c.instruction;
    const loadedIns = analysis.pass1.instructions.get(at)!;
    const block = blocks.get(at);
    if (block === undefined || !isBlock(at) || block.end !== ((at + loadedIns.length - 1) & 0xffff)) {
      variantErrors.push(`${addr(c.addr)}: the program rewrites the opcode of ${text(loadedIns)} at ${addr(at)}, which is not a block of its own in the disassembly, so the port cannot choose between its instructions there.`);
      continue;
    }
    const succ: Successor[] = [];
    for (const x of v.site.variants) {
      for (const s of successorsOf(x.ins, at, (a) => analysis.space.image.isLoaded(a))) {
        if (s.kind !== 'external' && !isBlock(s.to)) {
          variantErrors.push(`${addr(c.addr)}: the program rewrites the opcode at ${addr(at)} to ${byteHex(x.value)}, making ${text(x.ins)}, which goes to ${addr(s.to)}, where no block of the disassembly starts.`);
        } else if (!succ.some((t) => t.kind === s.kind && t.to === s.to)) succ.push(s);
      }
    }
    c.variants = v.site.variants.map((x) => text(x.ins));
    variants.set(at, v.site);
    variantSucc.set(at, succ);
  }
  if (variantErrors.length > 0) return { ok: false, errors: variantErrors };

  const joined = ir.blocks
    .filter((b) => !loaderBlocks.has(b.start))
    .map((b): BasicBlock => {
      const chosen = variantSucc.get(b.start);
      if (chosen !== undefined) return { ...b, succ: chosen };
      const last = [...matched.patched].find(([at, p]) => p.targets !== undefined && at >= b.start && at + analysis.pass1.instructions.get(at)!.length - 1 === b.end);
      return last === undefined ? b : { ...b, succ: [...b.succ, ...last[1].targets!.map((to) => ({ kind: 'jump' as const, to }))] };
    });
  const cut = cutDrops(joined, trace?.drops ?? [], analysis, variants);
  if (!cut.ok) return { ok: false, errors: cut.errors };
  const ported = cut.blocks;
  const routines = routinesOf({ ...ir, blocks: ported }, entry, [...cut.drops.values()].map((d) => d.continuation));
  const reset = variants.has(entry) ? undefined : reloadsSp(blocks.get(entry)!, analysis.pass1.instructions, rewritten);
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
  return { ok: true, prepared: { analysis, ir, entry, ...(loader === undefined ? {} : { loader }), loaderBlocks, routines, code, data, cells: matched.cells, patched: matched.patched, variants, drops: cut.drops, ...(reset === undefined ? {} : { reset }) } };
}

/**
 * The blocks with each POP the trace says dropped a return address ending its own, and the instruction
 * after it starting the next (a continuation, given no successor from the POP's block, which throws);
 * POPs in a row end one block, after the last. By the last POP's address, each such run. Sentences for a
 * drop at an address where the port translates no POP: no instruction, another instruction, a swapped
 * opcode's site, or the loader's code.
 */
function cutDrops(
  blocks: readonly BasicBlock[],
  traced: readonly { at: number }[],
  analysis: Analysis,
  variants: ReadonlyMap<number, VariantSite>,
): { ok: true; blocks: BasicBlock[]; drops: Map<number, Drop> } | { ok: false; errors: string[] } {
  const { instructions } = analysis.pass1;
  const dropped = new Set(traced.map((d) => d.at));
  const drops = new Map<number, Drop>();
  const found = new Set<number>();
  const out: BasicBlock[] = [];
  for (const b of blocks) {
    if (variants.has(b.start) || ![...dropped].some((a) => a >= b.start && a <= b.end)) {
      out.push(b);
      continue;
    }
    let start = b.start;
    let pops: number[] = [];
    for (let a = b.start; a <= b.end; ) {
      const ins = instructions.get(a)!;
      const next = a + ins.length;
      if (dropped.has(a) && ins.mnemonic === 'POP') {
        found.add(a);
        pops.push(a);
        // Another POP that drops follows in the block: the run goes on to it
        if (next <= b.end && dropped.has(next) && instructions.get(next)?.mnemonic === 'POP') {
          a = next;
          continue;
        }
        out.push({ start, end: next - 1, succ: [] });
        drops.set(a, { levels: pops.length, pops, continuation: next & 0xffff });
        pops = [];
        start = next;
      }
      a = next;
    }
    if (start <= b.end) out.push({ ...b, start });
  }
  const starts = new Set(out.map((b) => b.start));
  const errors: string[] = [];
  for (const at of [...dropped].sort((x, y) => x - y)) {
    if (found.has(at)) continue;
    const ins = instructions.get(at);
    const said = `${addr(at)}: the trace says a POP here dropped a return address, but`;
    if (variants.has(at)) errors.push(`${said} the program rewrites the opcode there, and a port does not follow a drop at a swapped opcode.`);
    else if (ins?.mnemonic === 'POP') errors.push(`${said} the POP there is not in code the port translates (a relocated program's loader).`);
    else errors.push(`${said} the disassembly decoded ${ins === undefined ? 'no instruction' : renderInstruction(ins, analysis.symbols)} here, not a POP the port translates.`);
  }
  for (const d of drops.values()) {
    if (!starts.has(d.continuation)) errors.push(`${addr(d.pops[d.pops.length - 1]!)}: the POP drops a return address, and the port would go on at ${addr(d.continuation)}, where no block of the disassembly starts.`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, blocks: out, drops };
}

/**
 * The address of the `LD SP,nn` in the block `b` (the entry's first) when it comes before any instruction
 * that touches the stack (a CALL, RST, RET, PUSH, POP or EX (SP),rr); undefined otherwise, and undefined
 * when a byte of its operand is one of the trace's cells (`rewritten`): the program then loads SP with
 * whatever it last wrote there (an SP it saved, say), not a constant, and need not discard its stack.
 */
function reloadsSp(b: BasicBlock, instructions: ReadonlyMap<number, Instruction>, rewritten: ReadonlySet<number>): number | undefined {
  for (let a = b.start; a <= b.end; ) {
    const ins = instructions.get(a);
    if (ins === undefined) return undefined;
    const [to, from] = ins.operands;
    if (ins.mnemonic === 'LD' && to?.kind === 'reg16' && to.reg === 'SP' && from?.kind === 'imm16') {
      for (let k = 1; k < ins.length; k++) if (rewritten.has((a + k) & 0xffff)) return undefined;
      return a;
    }
    if (ins.flow.kind === 'call' || ins.flow.kind === 'return' || ins.mnemonic === 'PUSH' || ins.mnemonic === 'POP' || ins.operands.some((o) => o.kind === 'ind' && o.reg === 'SP')) return undefined;
    a += ins.length;
  }
  return undefined;
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
  const { analysis, ir, entry, loader, routines, data, code, cells, patched, variants, drops, reset } = p.prepared;
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
    rom: (opts.trace?.romReads ?? []).map((r) => [r.addr, r.value] as const),
    patched,
    variants,
    drops,
    ...(reset === undefined ? {} : { reset }),
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
      drops: [...drops.values()]
        .flatMap((d) => d.pops.map((at) => ({ at, continuation: out.routineNames.get(d.continuation)! })))
        .sort((x, y) => x.at - y.at),
      resets: out.resets,
      rom: (opts.trace?.romReads ?? []).map((r) => ({ addr: r.addr, value: r.value })),
    },
  };
}
