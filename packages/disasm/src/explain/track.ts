/**
 * The Explain tab's value tracker. It proves what registers hold just before a
 * line runs, and never claims more: it walks backward along straight-line code
 * (the fall-through predecessor) and stops at a merge point (any label, which
 * covers every xref target, data reference, table and user name, since a
 * labelled address may be reached by an indirect jump or a RET), an entry
 * point, after a CALL or RST, after 32 instructions, or at the start of a run,
 * then replays the shared register rule forward. Anything it cannot
 * prove on every path to the line stays unknown.
 */
import type { Instruction } from '@fugloy/z80';
import { endsPath, isRst08 } from '../analysis/descent.js';
import { dataReference } from '../analysis/symbols.js';
import { stepRegs, unknownRegs } from '../analysis/regs.js';
import type { Reg8Name, RegState } from '../analysis/regs.js';
import type { Analysis } from '../pipeline.js';

export interface Known {
  regs: RegState;
  /** Where control can come from when the walk stopped at a merge point: callers and jumpers of that address. */
  from?: { addr: number; callers: number[]; jumpers: number[] };
}

/** The most instructions the walk goes back. */
const CAP = 32;

interface Index {
  /** End address (start + length) → starts of the instructions that end there. */
  endingAt: Map<number, number[]>;
  /** Xref target → where control comes from. */
  into: Map<number, { callers: number[]; jumpers: number[] }>;
  /** Entry points: the analysis roots and entry. */
  roots: Set<number>;
  /** Addresses an instruction references as data, or a hint declares a table at: reachable by an indirect transfer. */
  dataRefs: Set<number>;
  /** Address → the instructions that hold it as a number (`dataReference` with no (nn) operand): a pointer that may be jumped or called through. */
  pointerUses: Map<number, number[]>;
  /** Addresses an instruction provably stores into: the (nn) of LD (nn),r, and nn and nn+1 of LD (nn),rr. */
  stores: Set<number>;
}

const cache = new WeakMap<Analysis, Index>();

function index(a: Analysis): Index {
  const hit = cache.get(a);
  if (hit !== undefined) return hit;
  const endingAt = new Map<number, number[]>();
  for (const [at, ins] of a.pass1.instructions) {
    const end = (at + ins.length) & 0xffff;
    const list = endingAt.get(end);
    if (list === undefined) endingAt.set(end, [at]);
    else list.push(at);
  }
  const into = new Map<number, { callers: number[]; jumpers: number[] }>();
  for (const x of a.pass1.xrefs) {
    let e = into.get(x.to);
    if (e === undefined) into.set(x.to, (e = { callers: [], jumpers: [] }));
    const list = x.kind === 'jump' || x.kind === 'cjump' ? e.jumpers : e.callers;
    if (!list.includes(x.from)) list.push(x.from);
  }
  for (const e of into.values()) {
    e.callers.sort((p, q) => p - q);
    e.jumpers.sort((p, q) => p - q);
  }
  const roots = new Set<number>([...a.roots, ...a.pass1.roots]);
  if (a.entry !== null) roots.add(a.entry);
  const dataRefs = new Set<number>(a.annotations.tables.map((t) => t.addr & 0xffff));
  const pointerUses = new Map<number, number[]>();
  const stores = new Set<number>();
  for (const [at, ins] of a.pass1.instructions) {
    const ref = dataReference(ins);
    if (ref !== null) dataRefs.add(ref & 0xffff);
    // Only an address the program holds as a number (LD rr,nn and the like) can be jumped or called through; a store or load at (nn) uses the byte there.
    if (ref !== null && !ins.operands.some((o) => o.kind === 'mem')) {
      const list = pointerUses.get(ref & 0xffff);
      if (list === undefined) pointerUses.set(ref & 0xffff, [at]);
      else list.push(at);
    }
    const [d, v] = ins.operands;
    if (ins.mnemonic === 'LD' && d?.kind === 'mem') {
      stores.add(d.addr & 0xffff);
      if (v?.kind === 'reg16') stores.add((d.addr + 1) & 0xffff);
    }
  }
  for (const list of pointerUses.values()) list.sort((p, q) => p - q);
  const built = { endingAt, into, roots, dataRefs, pointerUses, stores };
  cache.set(a, built);
  return built;
}

/** The single instruction that falls through into `addr`, or null (none, several, or one whose flow ends the path). */
function fallThrough(a: Analysis, ix: Index, addr: number): { at: number; ins: Instruction } | null {
  const starts = ix.endingAt.get(addr);
  if (starts === undefined || starts.length !== 1) return null;
  const at = starts[0]!;
  const ins = a.pass1.instructions.get(at)!;
  return endsPath(ins) ? null : { at, ins };
}

/** Why the backward walk stopped at `at`, the first instruction of its chain (or the line itself when the chain is empty). */
export type WalkStop =
  /** `at` is an xref target: control also arrives by the jumps and calls in `from`. */
  | 'merge'
  /** `at` has a label nothing jumps to or calls (a data reference, a table, a user name): it may be reached another way. */
  | 'label'
  /** `at` is an entry point. */
  | 'root'
  /** The 32-instruction cap. */
  | 'cap'
  /** The instruction before `at` is a CALL or RST (`pred`). */
  | 'call'
  /** No single instruction falls through into `at` (data before it, several, or a jump or return). */
  | 'none';

export interface Walk {
  /** The straight-line instructions before the line, nearest first. */
  chain: { at: number; ins: Instruction }[];
  /** Where the walk stopped. */
  at: number;
  stop: WalkStop;
  from?: Known['from'];
  /** The instruction that falls through into `at`, when there is exactly one and it does not end the path (a CALL, for stop 'call' and sometimes 'merge'). */
  pred?: number;
}

/** The backward walk knownBefore replays: straight-line code to the previous merge point, label, entry point, call, or cap. */
export function walkBack(a: Analysis, addr: number): Walk {
  const ix = index(a);
  const chain: { at: number; ins: Instruction }[] = [];
  let cur = addr;
  const done = (stop: WalkStop, extra: Partial<Walk> = {}): Walk => {
    const pred = fallThrough(a, ix, cur);
    return { chain, at: cur, stop, ...(pred === null ? {} : { pred: pred.at }), ...extra };
  };
  for (;;) {
    const merge = ix.into.get(cur);
    if (merge !== undefined) return done('merge', { from: { addr: cur, callers: [...merge.callers], jumpers: [...merge.jumpers] } });
    // Any other label (a data reference, a table, a user name) may be entered by JP (HL) or a pushed RET.
    if (ix.roots.has(cur)) return done('root');
    if (a.symbols.has(cur)) return done('label');
    if (chain.length >= CAP) return done('cap');
    const pred = fallThrough(a, ix, cur);
    if (pred === null) return done('none');
    // A CALL or RST, conditional or not, leaves everything unknown after it.
    if (pred.ins.flow.kind === 'call') return done('call');
    chain.push(pred);
    cur = pred.at;
  }
}

/** What is proven about registers just before the instruction at `addr` runs. */
export function knownBefore(a: Analysis, addr: number): Known {
  const { chain, from } = walkBack(a, addr);
  const regs = unknownRegs();
  for (let i = chain.length - 1; i >= 0; i--) step(a, chain[i]!.at, chain[i]!.ins, regs);
  return from === undefined ? { regs } : { regs, from };
}

/**
 * The registers an instruction may write. Probed from two full states in which
 * every register holds a value no other register holds, and each register's
 * value differs between the two, so a copy (LD A,B), a swap (EX DE,HL) and a
 * constant load (which can match at most one of the two) are all caught.
 */
export function written(ins: Instruction): Reg8Name[] {
  const out = new Set<Reg8Name>();
  const names = Object.keys(unknownRegs()) as Reg8Name[];
  for (const base of [0x10, 0xa0]) {
    const r = unknownRegs();
    names.forEach((n, i) => (r[n] = base + i));
    stepRegs(ins, r);
    names.forEach((n, i) => {
      if (r[n] !== base + i) out.add(n);
    });
  }
  return [...out];
}

/** The instructions that hold `addr` as a number (LD HL,nn and the like, not a load or store at (nn)), so it may be jumped or called through; ascending. */
export function pointerUses(a: Analysis, addr: number): number[] {
  return [...(index(a).pointerUses.get(addr & 0xffff) ?? [])];
}

/**
 * True when some instruction provably stores into the first byte of the
 * instruction at `at` (LD (nn),r with nn = at, or LD (nn),rr covering it):
 * at run time it may be a different instruction altogether. A mere data
 * reference to an instruction start (a pointer the program loads) is not enough.
 */
export function opcodeRewritten(a: Analysis, at: number): boolean {
  return index(a).stores.has(at & 0xffff) && a.pass1.instructions.has(at & 0xffff);
}

/**
 * The bytes of an instruction the program may rewrite as it runs: its first
 * byte when an instruction stores into it (`opcodeRewritten`), and the
 * labelled addresses among its other bytes (at+1..at+len-1), which the program
 * refers to. Either way the decoded numbers are only where they start.
 */
export function patchedBytes(a: Analysis, at: number, ins: Instruction): number[] {
  const out: number[] = opcodeRewritten(a, at) ? [at & 0xffff] : [];
  for (let i = 1; i < ins.length; i++) if (a.symbols.has((at + i) & 0xffff)) out.push((at + i) & 0xffff);
  return out;
}

/**
 * One forward step of the replay. When the program may rewrite the
 * instruction's first byte, it may be any instruction at run time, so every
 * register becomes unknown. When a label lies inside its other bytes, the
 * program may rewrite its operand, so whatever it writes is unproven and
 * becomes unknown instead of the decoded value.
 */
function step(a: Analysis, at: number, ins: Instruction, regs: RegState): void {
  if (opcodeRewritten(a, at)) {
    for (const n of Object.keys(regs) as Reg8Name[]) regs[n] = null;
    return;
  }
  if (patchedBytes(a, at, ins).length === 0) return stepRegs(ins, regs);
  stepRegs(ins, regs);
  for (const n of written(ins)) regs[n] = null;
}

/** The target in a jump's own bytes, or null (indirect, or none). */
function jumpTarget(ins: Instruction): number | null {
  for (const o of ins.operands) {
    if (o.kind === 'imm16') return o.value;
    if (o.kind === 'rel') return o.target;
  }
  return null;
}

/**
 * The instructions in head..end-1 that may take control out of the loop
 * without passing its DJNZ at `end`: a jump whose target lies outside
 * head..end (before the head too, which may re-enter and reset B), an
 * indirect jump or one whose target the program may rewrite, any return, HALT,
 * an instruction whose first byte the program rewrites, and one that falls
 * into bytes not decoded as code. Ascending.
 */
export function loopExits(a: Analysis, head: number, end: number): number[] {
  const out: number[] = [];
  for (const [at, ins] of a.pass1.instructions) {
    if (at < head || at >= end) continue;
    const f = ins.flow;
    let exit = opcodeRewritten(a, at) || f.kind === 'return' || f.kind === 'halt';
    if (!exit && f.kind === 'jump') {
      const t = jumpTarget(ins);
      exit = f.indirect || t === null || patchedBytes(a, at, ins).length > 0 || t < head || t > end;
    }
    if (!exit && !endsPath(ins)) {
      const next = at + ins.length + (isRst08(ins) ? 1 : 0);
      exit = next < end && !a.pass1.instructions.has(next);
    }
    if (exit) out.push(at);
  }
  return out.sort((p, q) => p - q);
}

/** True when the instruction may change B. */
const writesB = (ins: Instruction): boolean => written(ins).includes('B');

/**
 * The registers on entry to a loop from `head` to `end` (the instruction that
 * jumps back), when it is entered only by falling into its head: every xref
 * into the head comes from `end`, nothing from outside head..end jumps into
 * the body, no root lies in it, and no label at an instruction start in
 * head..end exists other than ones made only by jumps from inside head..end (a
 * data reference, table, user name or root there may mean an indirect
 * re-entry). Null otherwise, or when no single instruction falls into the head.
 * With `anyBackJump`, jumps into the head may come from anywhere in head..end,
 * not only from `end` (a loop with several jumps back to its head).
 */
export function loopEntry(a: Analysis, head: number, end: number, anyBackJump = false): RegState | null {
  const inside = (p: number): boolean => p >= head && p <= end;
  const ix = index(a);
  for (const x of a.pass1.xrefs) {
    if (x.to === head && (anyBackJump ? !inside(x.from) : x.from !== end)) return null;
    if (x.to !== head && inside(x.to) && !inside(x.from)) return null;
  }
  for (const r of ix.roots) if (inside(r)) return null;
  for (const sym of a.symbols.list()) {
    // A label inside an instruction's bytes is an operand the program rewrites (Sea Dragon's DATA_49C1, the
    // displacement of LD A,(IY+d)), not a place control enters; only labels at instruction starts can re-enter.
    if (!inside(sym.addr) || !a.pass1.instructions.has(sym.addr)) continue;
    // Xrefs from outside were already ruled out above; what is left is a label not made by jumps alone.
    if (sym.source === 'user' || ix.dataRefs.has(sym.addr) || !ix.into.has(sym.addr)) return null;
  }
  const pred = fallThrough(a, ix, head);
  if (pred === null) return null;
  const regs = knownBefore(a, pred.at).regs;
  step(a, pred.at, pred.ins, regs);
  return regs;
}

/**
 * For a DJNZ at `addr`: its loop (head = target, end = addr), B's value on
 * entry when proven, else count null, and the body's early exits
 * (`loopExits`). A count of 0 means 256 passes. The count holds only when the
 * loop is entered only by falling into its head (`loopEntry`), and no body
 * instruction writes B, is a CALL, RST or EXX, or may be rewritten; with exits it is only a
 * bound: the loop runs at most that many times.
 */
export function djnzLoop(a: Analysis, addr: number): { head: number; end: number; count: number | null; exits: number[] } | null {
  const ins = a.pass1.instructions.get(addr);
  if (ins === undefined || ins.mnemonic !== 'DJNZ') return null;
  const rel = ins.operands.find((o) => o.kind === 'rel');
  if (rel?.kind !== 'rel') return null;
  const head = rel.target;
  const end = addr;
  // A forward DJNZ is not a loop.
  if (head > end) return null;
  const loop = { head, end, exits: loopExits(a, head, end) };
  for (const [at, body] of a.pass1.instructions) {
    if (at < head || at >= end) continue;
    const m = body.mnemonic;
    if (m === 'CALL' || m === 'RST' || m === 'EXX' || writesB(body) || opcodeRewritten(a, at)) return { ...loop, count: null };
  }
  const regs = loopEntry(a, head, end);
  return { ...loop, count: regs === null ? null : regs.B };
}
