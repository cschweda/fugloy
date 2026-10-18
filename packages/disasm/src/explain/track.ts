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
import { pair, stepRegs, unknownRegs } from '../analysis/regs.js';
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
  /** Addresses an instruction provably stores into by its own bytes: the (nn) of LD (nn),r, and nn and nn+1 of LD (nn),rr; address → the stores. */
  stores: Map<number, number[]>;
}

const cache = new WeakMap<Analysis, Index>();

function addStore(m: Map<number, number[]>, addr: number, at: number): void {
  const list = m.get(addr & 0xffff);
  if (list === undefined) m.set(addr & 0xffff, [at]);
  else if (list.at(-1) !== at) list.push(at);
}

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
  const stores = new Map<number, number[]>();
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
      addStore(stores, d.addr, at);
      if (v?.kind === 'reg16') addStore(stores, d.addr + 1, at);
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
    const stop = stopAt(a, ix, cur);
    if (stop !== null) return done(stop);
    const pred = fallThrough(a, ix, cur)!;
    chain.push(pred);
    cur = pred.at;
  }
}

/**
 * Whether the backward walk stops at `cur` (other than at the cap), and why;
 * null when exactly one instruction, not a CALL or RST, falls into it and
 * nothing else may reach it. The one rule walkBack and the forward sweep share.
 */
function stopAt(a: Analysis, ix: Index, cur: number): Exclude<WalkStop, 'cap'> | null {
  if (ix.into.has(cur)) return 'merge';
  // Any other label (a data reference, a table, a user name) may be entered by JP (HL) or a pushed RET.
  if (ix.roots.has(cur)) return 'root';
  if (a.symbols.has(cur)) return 'label';
  const pred = fallThrough(a, ix, cur);
  if (pred === null) return 'none';
  // A CALL or RST, conditional or not, leaves everything unknown after it.
  if (pred.ins.flow.kind === 'call') return 'call';
  return null;
}

/**
 * One forward pass over the instructions in address order, calling `visit`
 * with what is proven just before each: unknown where the backward walk would
 * stop (stopAt), else the state after the single instruction that falls into
 * it. This is knownBefore without its 32-instruction cap (the cap only bounds
 * one walk's cost; it is not a rule about what may reach a line), so it proves
 * at least what knownBefore proves, for every line at once.
 */
export function sweep(a: Analysis, visit: (at: number, ins: Instruction, before: Readonly<RegState>) => void): void {
  const ix = index(a);
  const starts = [...a.pass1.instructions.keys()].sort((p, q) => p - q);
  let last = -1;
  let after = unknownRegs();
  for (const at of starts) {
    const ins = a.pass1.instructions.get(at)!;
    let before: RegState;
    if (stopAt(a, ix, at) !== null) before = unknownRegs();
    else {
      const pred = fallThrough(a, ix, at)!;
      // Overlapping decodes can put another instruction between the two; then ask the walk.
      before = pred.at === last ? after : knownBefore(a, at).regs;
    }
    visit(at, ins, before);
    after = { ...before };
    step(a, at, ins, after);
    last = at;
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

/** The memory writes that go through a register: the register-addressed operand of these, when it is (HL), (BC), (DE) or (IX/IY+d). */
const WRITES_OPERAND = new Set(['INC', 'DEC', 'RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SLL', 'SRL', 'SET', 'RES']);

/**
 * The address an instruction stores one byte into through a register, given
 * what the registers hold before it: LD (rr),x and LD (IX+d),x; INC, DEC, the
 * rotates, shifts, SET and RES on (HL) or (IX+d); RLD and RRD; LDI, LDD, INI
 * and IND. Null when it stores through a register whose value is not proven;
 * [] when it stores nothing that way. The repeating block moves (LDIR, LDDR,
 * INIR, INDR) are left out: a loader's LDIR copies the whole program to where
 * it runs (Sea Dragon's at $888B), which would mark every instruction.
 */
function storesThroughRegs(ins: Instruction, regs: RegState): number[] | null {
  const m = ins.mnemonic;
  const one = (x: number | null): number[] | null => (x === null ? null : [x & 0xffff]);
  switch (m) {
    case 'LDI':
    case 'LDD':
      return one(pair(regs, 'DE'));
    case 'INI':
    case 'IND':
    case 'RLD':
    case 'RRD':
      return one(pair(regs, 'HL'));
  }
  const o = m === 'LD' ? ins.operands[0] : WRITES_OPERAND.has(m) ? ins.operands.find((x) => x.kind === 'ind' || x.kind === 'idx') : undefined;
  if (o?.kind === 'ind' && (o.reg === 'HL' || o.reg === 'DE' || o.reg === 'BC')) return one(pair(regs, o.reg));
  if (o?.kind === 'idx') {
    const base = pair(regs, o.reg);
    return one(base === null ? null : base + o.disp);
  }
  return [];
}

/** The per-Analysis set of addresses stored into through a register (address → the stores), built on first need. */
const viaRegsCache = new WeakMap<Analysis, Map<number, number[]>>();
/** The analyses whose register-store set is being built: while it is, the rules below consult only the direct stores. */
const building = new WeakSet<Analysis>();

/**
 * The addresses some instruction provably stores into through a register
 * (`storesThroughRegs`, with the registers from one forward `sweep`, which
 * proves at least what knownBefore proves at each store, in one pass instead
 * of one walk per store). Built once per Analysis, lazily, and cached. While
 * it is built, the replay sees only the direct stores, so there is no
 * recursion; marking an instruction rewritten only ever removes knowledge, so
 * one pass suffices.
 * A store that may itself be rewritten (its opcode, or the displacement of
 * (IX+d)) proves no address and is skipped. Null while building.
 */
function viaRegs(a: Analysis): Map<number, number[]> | null {
  const hit = viaRegsCache.get(a);
  if (hit !== undefined) return hit;
  if (building.has(a)) return null;
  building.add(a);
  const out = new Map<number, number[]>();
  try {
    sweep(a, (at, ins, before) => {
      // Cheap first: does it write through a register at all?
      if (storesThroughRegs(ins, FULL)?.length === 0 || anyPatched(a, at, ins)) return;
      const addrs = storesThroughRegs(ins, before);
      if (addrs !== null) for (const x of addrs) addStore(out, x, at);
    });
  } finally {
    building.delete(a);
  }
  viaRegsCache.set(a, out);
  return out;
}

/** A register state with every register known: used only to ask whether an instruction stores through a register. */
const FULL: RegState = (() => {
  const r = unknownRegs();
  for (const n of Object.keys(r) as Reg8Name[]) r[n] = 1;
  return r;
})();

/** True when some instruction provably stores into `addr`, by its own operand or through a register. */
function storedInto(a: Analysis, addr: number): boolean {
  return index(a).stores.has(addr & 0xffff) || (viaRegs(a)?.has(addr & 0xffff) ?? false);
}

/**
 * The instructions that store into `addr` and whose address a line can show
 * as proven: LD (nn) by its operand, and a store through a register only when
 * `knownBefore` at that store, under the final rewrite rules, still gives
 * `addr`. The register-store set behind the rewrite rules is a superset (its
 * sweep ran before the register stores were known), which is right for
 * forgetting registers but not for naming a writer. Ascending.
 */
export function storesInto(a: Analysis, addr: number): number[] {
  const b = addr & 0xffff;
  const set = new Set(index(a).stores.get(b) ?? []);
  for (const w of viaRegs(a)?.get(b) ?? []) {
    if (set.has(w)) continue;
    const ins = a.pass1.instructions.get(w)!;
    if (!anyPatched(a, w, ins) && (storesThroughRegs(ins, knownBefore(a, w).regs) ?? []).includes(b)) set.add(w);
  }
  return [...set].sort((p, q) => p - q);
}

/**
 * The offsets of an instruction's opcode bytes: its first byte; for a CB, ED,
 * DD or FD prefix also the second (the real opcode, or the CB after DD/FD);
 * and for DD CB d op and FD CB d op also the fourth.
 */
export function opcodeOffsets(ins: Instruction): readonly number[] {
  const [b0, b1] = ins.bytes;
  if (b0 === 0xcb || b0 === 0xed) return OPS_01;
  if (b0 === 0xdd || b0 === 0xfd) return b1 === 0xcb && ins.length >= 4 ? OPS_013 : ins.length >= 2 ? OPS_01 : OPS_0;
  return OPS_0;
}
const OPS_0: readonly number[] = [0];
const OPS_01: readonly number[] = [0, 1];
const OPS_013: readonly number[] = [0, 1, 3];

/** The opcode bytes (`opcodeOffsets`) of the instruction at `at` that some instruction provably stores into; ascending addresses. */
export function rewrittenOpcodeBytes(a: Analysis, at: number): number[] {
  const ins = a.pass1.instructions.get(at & 0xffff);
  if (ins === undefined) return [];
  const out: number[] = [];
  for (const o of opcodeOffsets(ins)) if (storedInto(a, at + o)) out.push((at + o) & 0xffff);
  return out;
}

/**
 * True when some instruction provably stores into an opcode byte of the
 * instruction at `at` (`opcodeOffsets`): by LD (nn),r or LD (nn),rr, or
 * through a register whose value the forward `sweep` proves at that store. At run
 * time it may be a different instruction altogether. A mere data reference
 * to an instruction start (a pointer the program loads) is not enough.
 */
export function opcodeRewritten(a: Analysis, at: number): boolean {
  const ins = a.pass1.instructions.get(at & 0xffff);
  if (ins === undefined) return false;
  for (const o of opcodeOffsets(ins)) if (storedInto(a, at + o)) return true;
  return false;
}

/**
 * True when `patchedBytes` would find a byte: the same rule, without building
 * the list (the replay asks this at every step). The two must stay in step; a
 * test checks they agree on every Sea Dragon instruction.
 */
function anyPatched(a: Analysis, at: number, ins: Instruction): boolean {
  if (opcodeRewritten(a, at)) return true;
  const ops = opcodeOffsets(ins);
  for (let i = 1; i < ins.length; i++) {
    const p = (at + i) & 0xffff;
    if (a.symbols.has(p) || (!ops.includes(i) && storedInto(a, p))) return true;
  }
  return false;
}

/**
 * The bytes of an instruction the program may rewrite as it runs: its opcode
 * bytes that an instruction stores into (`opcodeRewritten`), and among its
 * other bytes the ones the program refers to (a label) or provably stores
 * into. Either way the decoded numbers are only where they start. Keep in
 * step with `anyPatched`.
 */
export function patchedBytes(a: Analysis, at: number, ins: Instruction): number[] {
  const out = rewrittenOpcodeBytes(a, at);
  const ops = opcodeOffsets(ins);
  for (let i = 1; i < ins.length; i++) {
    const p = (at + i) & 0xffff;
    if (out.includes(p)) continue;
    if (a.symbols.has(p) || (!ops.includes(i) && storedInto(a, p))) out.push(p);
  }
  return out.sort((p, q) => p - q);
}

/** True when the instruction at `from` (an xref's source) may be rewritten, so where it leads is not proven: `patchedBytes` finds a byte. A jump-table entry (not an instruction) is not. */
export function sourceRewritten(a: Analysis, from: number): boolean {
  const ins = a.pass1.instructions.get(from & 0xffff);
  return ins !== undefined && anyPatched(a, from, ins);
}

/**
 * One forward step of the replay. When the program stores into one of the
 * instruction's opcode bytes (`opcodeRewritten`), it may be any instruction
 * at run time, so every register becomes unknown. When another of its bytes
 * is labelled or stored into (`patchedBytes`), the program may rewrite its
 * operand, so whatever it writes is unproven and becomes unknown instead of
 * the decoded value.
 */
function step(a: Analysis, at: number, ins: Instruction, regs: RegState): void {
  if (opcodeRewritten(a, at)) {
    for (const n of Object.keys(regs) as Reg8Name[]) regs[n] = null;
    return;
  }
  if (!anyPatched(a, at, ins)) return stepRegs(ins, regs);
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
