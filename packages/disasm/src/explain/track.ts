/**
 * The Explain tab's value tracker. It proves what registers hold just before a
 * line runs, and never claims more: it walks backward along straight-line code
 * (the fall-through predecessor) and stops at a merge point (any xref target),
 * an entry point, after a CALL or RST, after 32 instructions, or at the start
 * of a run, then replays the shared register rule forward. Anything it cannot
 * prove on every path to the line stays unknown.
 */
import type { Instruction } from '@fugloy/z80';
import { stepRegs, unknownRegs } from '../analysis/regs.js';
import type { RegState } from '../analysis/regs.js';
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
  const built = { endingAt, into, roots };
  cache.set(a, built);
  return built;
}

/** True when control never falls through past this instruction. */
const endsPath = (ins: Instruction): boolean =>
  !ins.flow.conditional && (ins.flow.kind === 'jump' || ins.flow.kind === 'return' || ins.flow.kind === 'halt');

/** The single instruction that falls through into `addr`, or null (none, several, or one whose flow ends the path). */
function fallThrough(a: Analysis, ix: Index, addr: number): { at: number; ins: Instruction } | null {
  const starts = ix.endingAt.get(addr);
  if (starts === undefined || starts.length !== 1) return null;
  const at = starts[0]!;
  const ins = a.pass1.instructions.get(at)!;
  return endsPath(ins) ? null : { at, ins };
}

/** What is proven about registers just before the instruction at `addr` runs. */
export function knownBefore(a: Analysis, addr: number): Known {
  const ix = index(a);
  const chain: Instruction[] = [];
  let cur = addr;
  let from: Known['from'];
  for (;;) {
    const merge = ix.into.get(cur);
    if (merge !== undefined) {
      from = { addr: cur, callers: [...merge.callers], jumpers: [...merge.jumpers] };
      break;
    }
    if (ix.roots.has(cur) || chain.length >= CAP) break;
    const pred = fallThrough(a, ix, cur);
    // A CALL or RST, conditional or not, leaves everything unknown after it.
    if (pred === null || pred.ins.flow.kind === 'call') break;
    chain.push(pred.ins);
    cur = pred.at;
  }
  const regs = unknownRegs();
  for (let i = chain.length - 1; i >= 0; i--) stepRegs(chain[i]!, regs);
  return from === undefined ? { regs } : { regs, from };
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
 * outside head..end jumps into the body, and no body instruction writes B or is
 * a CALL, RST or EXX.
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
  for (const [at, body] of a.pass1.instructions) {
    if (at < head || at >= end) continue;
    const m = body.mnemonic;
    if (m === 'CALL' || m === 'RST' || m === 'EXX' || writesB(body)) return { ...loop, count: null };
  }

  const pred = fallThrough(a, ix, head);
  if (pred === null) return { ...loop, count: null };
  const regs = knownBefore(a, pred.at).regs;
  stepRegs(pred.ins, regs);
  return { ...loop, count: regs.B };
}
