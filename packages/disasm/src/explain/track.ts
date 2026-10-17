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
import { endsPath } from '../analysis/descent.js';
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
  for (const ins of a.pass1.instructions.values()) {
    const ref = dataReference(ins);
    if (ref !== null) dataRefs.add(ref & 0xffff);
  }
  const built = { endingAt, into, roots, dataRefs };
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

/** The registers an instruction may write: probed from two different full states, so a constant load is caught too. */
export function written(ins: Instruction): Reg8Name[] {
  const out = new Set<Reg8Name>();
  for (const v of [0x5a, 0xa5]) {
    const r = unknownRegs();
    for (const n of Object.keys(r) as Reg8Name[]) r[n] = v;
    stepRegs(ins, r);
    for (const n of Object.keys(r) as Reg8Name[]) if (r[n] !== v) out.add(n);
  }
  return [...out];
}

/**
 * One forward step of the replay. When a label lies inside the instruction's
 * bytes (at+1..at+len-1), the program may rewrite its operand, so whatever it
 * writes is unproven and becomes unknown instead of the decoded value.
 */
function step(a: Analysis, at: number, ins: Instruction, regs: RegState): void {
  let patched = false;
  for (let i = 1; i < ins.length && !patched; i++) patched = a.symbols.has((at + i) & 0xffff);
  if (!patched) return stepRegs(ins, regs);
  stepRegs(ins, regs);
  for (const n of written(ins)) regs[n] = null;
}

/** True when the instruction may change B: probed with two different B values so a constant load is caught too. */
function writesB(ins: Instruction): boolean {
  for (const b of [0x5a, 0xa5]) {
    const r = unknownRegs();
    r.B = b;
    stepRegs(ins, r);
    if (r.B !== b) return true;
  }
  return false;
}

/**
 * For a DJNZ at `addr`: its loop (head = target, end = addr) and B's value on
 * entry when proven, else count null. A count of 0 means 256 passes. The count
 * holds only when every xref into the head comes from this DJNZ, nothing from
 * outside head..end jumps into the body, no label at an instruction start in
 * head..end exists other than ones made only by jumps from inside head..end (a
 * data reference, table, user name or root there may mean an indirect
 * re-entry), and no body instruction writes B or is a CALL, RST or EXX.
 */
export function djnzLoop(a: Analysis, addr: number): { head: number; end: number; count: number | null } | null {
  const ins = a.pass1.instructions.get(addr);
  if (ins === undefined || ins.mnemonic !== 'DJNZ') return null;
  const rel = ins.operands.find((o) => o.kind === 'rel');
  if (rel?.kind !== 'rel') return null;
  const head = rel.target;
  const end = addr;
  // A forward DJNZ is not a loop.
  if (head > end) return null;
  const loop = { head, end };
  const inside = (p: number): boolean => p >= head && p <= end;

  const ix = index(a);
  for (const x of a.pass1.xrefs) {
    if (x.to === head && x.from !== addr) return { ...loop, count: null };
    if (x.to !== head && inside(x.to) && !inside(x.from)) return { ...loop, count: null };
  }
  for (const r of ix.roots) if (inside(r)) return { ...loop, count: null };
  for (const sym of a.symbols.list()) {
    // A label inside an instruction's bytes is an operand the program rewrites (Sea Dragon's DATA_49C1, the
    // displacement of LD A,(IY+d)), not a place control enters; only labels at instruction starts can re-enter.
    if (!inside(sym.addr) || !a.pass1.instructions.has(sym.addr)) continue;
    // Xrefs from outside were already ruled out above; what is left is a label not made by jumps alone.
    if (sym.source === 'user' || ix.dataRefs.has(sym.addr) || !ix.into.has(sym.addr)) return { ...loop, count: null };
  }
  for (const [at, body] of a.pass1.instructions) {
    if (at < head || at >= end) continue;
    const m = body.mnemonic;
    if (m === 'CALL' || m === 'RST' || m === 'EXX' || writesB(body)) return { ...loop, count: null };
  }

  const pred = fallThrough(a, ix, head);
  if (pred === null) return { ...loop, count: null };
  const regs = knownBefore(a, pred.at).regs;
  step(a, pred.at, pred.ins, regs);
  return { ...loop, count: regs.B };
}
