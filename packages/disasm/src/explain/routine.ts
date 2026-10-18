/**
 * The Explain tab's routine summary: what the routine around a line provably
 * touches. A routine is the code reached from its start by following jumps and
 * branches but not calls, stopping at returns and at jumps on to another
 * routine's start. Its start is the nearest address at or before the line that
 * is called (or RST'd) or is an entry point, and that reaches the line that
 * way. The facts are only what the analysis proves: a store's address comes
 * from its operand or from the tracker at that store, never from a guess, and
 * an instruction the program may rewrite contributes none of its numbers.
 */
import type { Instruction, Operand } from '@fugloy/z80';
import { isRst08 } from '../analysis/descent.js';
import { pair } from '../analysis/regs.js';
import type { RegState } from '../analysis/regs.js';
import type { Analysis } from '../pipeline.js';
import type { Session } from '../session.js';
import { addrPhrase, addrPiece, andList, decimal, loaded, nameOf, portPhrase, routineKind, say, screenCell, tableName, word$ } from './machine.js';
import type { Ctx } from './machine.js';
import { exitsPhrase, patternAt, screenRange } from './patterns.js';
import { djnzLoop, knownBefore, opcodeRewritten, patchedBytes, pointerUses, sourceRewritten } from './track.js';
import type { Piece, Sentence } from './types.js';

export interface RoutineSummary {
  start: number;
  name: string;
  instructions: number;
  bytes: number;
  sentences: Sentence[];
  truncated: boolean;
}

/** The most instructions a routine is followed for. */
const CAP = 2000;

/** The most items a list in a sentence names before "and N more". */
const LIST = 6;

/** The widest a note line may be. */
const WIDTH = 72;

const SCREEN_LO = 0x3c00;
const SCREEN_HI = 0x3fff;
const KEYS_LO = 0x3800;
const KEYS_HI = 0x3bff;

interface Exits {
  returns: boolean;
  halts: boolean;
  /** Jumps on to another routine's start, or outside the program: target → the jumps. */
  onward: Map<number, number[]>;
  /** Falling through into another routine's start: that start → the instructions that fall into it. */
  runsInto: Map<number, number[]>;
  /** JP (HL), JP (IX), JP (IY): the register. */
  indirect: string[];
  /** Jumps whose target bytes the program may rewrite: where they are. */
  rewritten: number[];
  /** Instructions whose opcode bytes (`opcodeOffsets`) the program stores into: at run time they may be anything, so where they lead is not proven. */
  rewrittenOps: number[];
  /** Jumps into loaded bytes not decoded as code: target → the jumps. */
  undecoded: Map<number, number[]>;
  /** Falling through past the end of the loaded image: the first unloaded address → the instructions that fall there. */
  runsOff: Map<number, number[]>;
  /** Falling through into loaded bytes not decoded as code: that address → the instructions that fall there. */
  fallsIntoData: Map<number, number[]>;
}

interface Body extends Exits {
  start: number;
  /** The routine's instructions, in address order. */
  ins: { at: number; ins: Instruction }[];
  has: Set<number>;
  truncated: boolean;
}

interface Index {
  /** Routine starts: loaded call and RST targets, roots and the entry, ascending. */
  starts: number[];
  startSet: Set<number>;
  /** For each address, the start of the routine that owns the instruction there (the nearest start at or before it that reaches it), or -1. */
  owner: Int32Array;
  /** The walk's visited marks: the number of the walk that last visited each address. */
  stamp: Int32Array;
  walks: number;
  bodies: Map<number, Body>;
  summaries: Map<number, RoutineSummary>;
}

const cache = new WeakMap<Analysis, Index>();

/** The starts, and the owner of every instruction: one walk per start, in ascending order, so the nearest start wins. */
function index(a: Analysis): Index {
  const hit = cache.get(a);
  if (hit !== undefined) return hit;
  const set = new Set<number>();
  for (const x of a.pass1.xrefs) if ((x.kind === 'call' || x.kind === 'ccall' || x.kind === 'rst') && a.pass1.instructions.has(x.to)) set.add(x.to);
  for (const r of [...a.roots, ...a.pass1.roots, ...(a.entry === null ? [] : [a.entry])]) if (a.pass1.instructions.has(r & 0xffff)) set.add(r & 0xffff);
  const ix: Index = {
    starts: [...set].sort((p, q) => p - q),
    startSet: set,
    owner: new Int32Array(0x10000).fill(-1),
    stamp: new Int32Array(0x10000),
    walks: 0,
    bodies: new Map(),
    summaries: new Map(),
  };
  for (const start of ix.starts) {
    walk(a, ix, start, (at) => {
      if (at >= start) ix.owner[at] = start;
    });
  }
  cache.set(a, ix);
  return ix;
}

/** The target in a jump's or call's own bytes, or null (indirect, or none). */
function targetOf(ins: Instruction): number | null {
  for (const o of ins.operands) {
    if (o.kind === 'imm16') return o.value;
    if (o.kind === 'rel') return o.target;
    if (o.kind === 'rst') return o.addr;
  }
  return null;
}

const emptyExits = (): Exits => ({ returns: false, halts: false, onward: new Map(), runsInto: new Map(), indirect: [], rewritten: [], rewrittenOps: [], undecoded: new Map(), runsOff: new Map(), fallsIntoData: new Map() });

const add = (m: Map<number, number[]>, k: number, v: number): void => {
  const list = m.get(k);
  if (list === undefined) m.set(k, [v]);
  else if (!list.includes(v)) list.push(v);
};

/**
 * Follows the routine from `start`: jumps and branches, not calls, up to the
 * cap. It stops at returns, at jumps it cannot follow (indirect, rewritten,
 * into undecoded bytes or outside the program), at another routine's start,
 * whether jumped to or fallen into, and where it falls off the loaded image or
 * into bytes not decoded as code. Returns whether the cap cut it short.
 */
function walk(a: Analysis, ix: Index, start: number, visit: (at: number, ins: Instruction) => void, x: Exits = emptyExits()): boolean {
  const id = ++ix.walks;
  const work = [start];
  let count = 0;
  const go = (to: number, from: number, jumped: boolean): void => {
    to &= 0xffff;
    if (to !== start && ix.startSet.has(to)) add(jumped ? x.onward : x.runsInto, to, from);
    else if (!a.space.image.isLoaded(to)) {
      add(jumped ? x.onward : x.runsOff, to, from);
    } else if (!a.pass1.instructions.has(to)) {
      add(jumped ? x.undecoded : x.fallsIntoData, to, from);
    } else work.push(to);
  };
  while (work.length > 0) {
    const at = work.pop()!;
    if (ix.stamp[at] === id) continue;
    if (count >= CAP) return true;
    ix.stamp[at] = id;
    count++;
    const ins = a.pass1.instructions.get(at)!;
    visit(at, ins);
    // Its decoded flow is still followed (it is what the instruction starts as), but where it really leads is not proven.
    if (opcodeRewritten(a, at)) x.rewrittenOps.push(at);
    const next = (at + ins.length + (isRst08(ins) ? 1 : 0)) & 0xffff;
    const f = ins.flow;
    if (f.kind === 'halt') {
      x.halts = true;
      continue;
    }
    if (f.kind === 'return') {
      x.returns = true;
      if (f.conditional) go(next, at, false);
      continue;
    }
    if (f.kind === 'jump') {
      if (f.indirect) {
        const r = ins.operands.find((o) => o.kind === 'ind');
        const reg = r?.kind === 'ind' ? r.reg : 'HL';
        if (!x.indirect.includes(reg)) x.indirect.push(reg);
      } else if (patchedBytes(a, at, ins).some((p) => p !== at)) {
        // The program may rewrite the target: where it goes is not proven.
        x.rewritten.push(at);
      } else {
        const t = targetOf(ins);
        if (t !== null) go(t, at, true);
      }
      if (f.conditional) go(next, at, false);
      continue;
    }
    go(next, at, false);
  }
  return false;
}

/** The routine from `start` with its instructions, built when a summary needs it. */
function body(a: Analysis, ix: Index, start: number): Body {
  const hit = ix.bodies.get(start);
  if (hit !== undefined) return hit;
  const ins: { at: number; ins: Instruction }[] = [];
  const x = emptyExits();
  const truncated = walk(a, ix, start, (at, i) => ins.push({ at, ins: i }), x);
  ins.sort((p, q) => p.at - q.at);
  const b: Body = { ...x, start, ins, has: new Set(ins.map((i) => i.at)), truncated };
  ix.bodies.set(start, b);
  return b;
}

/** The start of the instruction that covers `addr`, or null. */
function instructionAt(a: Analysis, addr: number): number | null {
  for (let back = 0; back < 4; back++) {
    const at = (addr - back) & 0xffff;
    const ins = a.pass1.instructions.get(at);
    if (ins !== undefined) return addr - at < ins.length ? at : null;
  }
  return null;
}

/** A memory address an instruction uses: exact, only its high byte, or unproven (null). */
type Where = { exact: number } | { hi: number } | null;

/** Where a memory operand points, from the operand itself or from what the tracker proves at the instruction. */
function where(op: Operand, regs: () => RegState, patched: boolean): Where {
  if (op.kind === 'mem') return patched ? null : { exact: op.addr & 0xffff };
  if (op.kind === 'ind' && (op.reg === 'HL' || op.reg === 'DE' || op.reg === 'BC')) {
    const r = regs();
    const v = pair(r, op.reg);
    if (v !== null) return { exact: v };
    const hi = r[op.reg[0] as 'H' | 'D' | 'B'];
    return hi === null ? null : { hi };
  }
  if (op.kind === 'idx') {
    if (patched) return null;
    const v = pair(regs(), op.reg);
    return v === null ? null : { exact: (v + op.disp) & 0xffff };
  }
  return null;
}

const isMem = (o: Operand | undefined): o is Operand => o?.kind === 'mem' || o?.kind === 'idx' || (o?.kind === 'ind' && o.reg !== 'C' && o.reg !== 'SP');

const READ_ONLY = new Set(['CP', 'AND', 'OR', 'XOR', 'ADD', 'ADC', 'SUB', 'SBC', 'BIT']);
const READ_WRITE = new Set(['INC', 'DEC', 'SET', 'RES', 'RL', 'RR', 'RLC', 'RRC', 'SLA', 'SRA', 'SRL', 'SLL']);

/** The memory operands an instruction reads and writes (not the stack, not the block instructions). */
function accesses(ins: Instruction): { op: Operand; read: boolean; write: boolean }[] {
  const m = ins.mnemonic;
  const ops = ins.operands;
  if (m === 'LD') {
    const out: { op: Operand; read: boolean; write: boolean }[] = [];
    if (isMem(ops[0])) out.push({ op: ops[0], read: false, write: true });
    if (isMem(ops[1])) out.push({ op: ops[1], read: true, write: false });
    return out;
  }
  if (m === 'RLD' || m === 'RRD') return [{ op: { kind: 'ind', reg: 'HL' } as Operand, read: true, write: true }];
  const op = ops.find(isMem);
  if (op === undefined) return [];
  if (READ_ONLY.has(m)) return [{ op, read: true, write: false }];
  if (READ_WRITE.has(m)) return [{ op, read: true, write: true }];
  return [];
}

/** `a, b, c and 3 more`, at most LIST items named. */
function capped(items: Piece[][]): Piece[] {
  if (items.length <= LIST) return andList(items, (p) => p);
  return andList([...items.slice(0, LIST - 1), [{ text: `${items.length - (LIST - 1)} more` }]], (p) => p);
}

/** An address as its name (linked), else the address. */
function named(c: Ctx, addr: number, use: 'code' | 'data'): Piece {
  return nameOf(c, addr, use) ?? addrPiece(c, addr);
}

const plural = (n: number, one: string, many: string): string => `${decimal(n)} ${n === 1 ? one : many}`;

/**
 * A pattern's lead ("Copies 16 bytes…", "Fills 1,024 bytes… with $20: the first
 * byte is stored, then LDIR…") as a sentence about the routine: "It copies…",
 * "It fills… with $20.", without the how-it-works clause. Other leads are kept.
 */
function subjectIt(lead: Sentence): Sentence {
  const head = lead[0];
  if (head === undefined || !/^(Copies|Fills) /.test(head.text)) return lead;
  const out: Sentence = lead.map((p) => ({ ...p }));
  out[0]!.text = `It ${head.text[0]!.toLowerCase()}${head.text.slice(1)}`;
  const last = out.at(-1)!;
  const cut = last.text.indexOf(': the first byte is stored');
  if (cut >= 0) last.text = `${last.text.slice(0, cut)}.`;
  return out;
}

/** Builds the summary for the routine starting at `start`. */
function summarize(c: Ctx, ix: Index, start: number): RoutineSummary {
  const a = c.a;
  const b = body(a, ix, start);
  const name = a.symbols.get(start)?.name ?? word$(start);
  const bytes = b.ins.reduce((t, x) => t + x.ins.length + (isRst08(x.ins) ? 1 : 0), 0);
  const out: Sentence[] = [];
  const self: Piece = { text: name, addr: start };

  const title: Piece[] = a.symbols.has(start) ? [{ text: 'The routine ' }, self, { text: ` (${word$(start)})` }] : [{ text: 'The routine at ' }, addrPiece(c, start)];
  out.push(say(title, ` is ${plural(b.ins.length, 'instruction', 'instructions')} (${plural(bytes, 'byte', 'bytes')}), counting the code it jumps to but not the routines it calls.`));

  // Who enters it.
  const isRoot = new Set<number>([...a.roots, ...a.pass1.roots].map((r) => r & 0xffff)).has(start) || a.entry === start;
  if (start === a.entry) out.push(say('This is where the program starts (its entry point).'));
  else if (isRoot) out.push(say('This is an entry point the analysis starts from.'));
  const callers = new Set<number>();
  const jumps = new Set<number>();
  const table = new Set<number>();
  for (const x of a.pass1.xrefs) {
    if (x.to !== start) continue;
    // A call or jump whose target bytes the program may rewrite does not prove it comes here.
    if (sourceRewritten(a, x.from)) continue;
    if (x.kind === 'call' || x.kind === 'ccall' || x.kind === 'rst') callers.add(x.from);
    else if (!b.has.has(x.from)) (a.pass1.instructions.has(x.from) ? jumps : table).add(x.from);
  }
  const list = (s: Set<number>): Piece[] => capped([...s].sort((p, q) => p - q).map((x) => [addrPiece(c, x)]));
  // The xrefs are every direct way in; an address the program loads or uses as data may be called or jumped through as well.
  const used = pointerUses(a, start);
  const usedList = capped(used.map((x) => [addrPiece(c, x)]));
  const pointer: Piece[] = used.length === 0 ? [] : [{ text: ', and its address is used at ' }, ...usedList, { text: ', so it may also be reached through a pointer' }];
  if (callers.size > 0) out.push(say(`It is called from ${callers.size === 1 ? 'one place' : `${decimal(callers.size)} places`}: `, list(callers), pointer, '.'));
  if (jumps.size > 0) out.push(say(`It is jumped to from `, list(jumps), callers.size > 0 ? [] : pointer, '.'));
  if (callers.size === 0 && jumps.size === 0 && used.length > 0) out.push(say('Its address is used at ', usedList, ', so it may be reached through a pointer.'));
  if (table.size > 0) out.push(say(table.size === 1 ? 'A jump table entry at ' : 'Jump table entries at ', list(table), table.size === 1 ? ' leads to it.' : ' lead to it.'));

  // How it ends.
  const ends: Piece[][] = [];
  if (b.returns) ends.push([{ text: 'returning' }]);
  if (b.onward.size > 0) {
    const targets = [...b.onward.keys()].sort((p, q) => p - q).map((t): Piece[] => {
      const ext = loaded(c, t) ? undefined : tableName(c, t, 'code');
      return ext === undefined ? [named(c, t, 'code')] : [{ text: `${routineKind(ext.entry)} ` }, { text: ext.text, entry: ext.entry }];
    });
    ends.push([{ text: 'jumping on to ' }, ...capped(targets)]);
  }
  if (b.runsInto.size > 0) ends.push([{ text: 'running on into ' }, ...capped([...b.runsInto.keys()].sort((p, q) => p - q).map((t) => [named(c, t, 'code')]))]);
  for (const r of b.indirect) ends.push([{ text: `jumping to the address in ${r}` }]);
  if (b.rewritten.length > 0) {
    const at = [...b.rewritten].sort((p, q) => p - q);
    ends.push([{ text: `jumping to an address the program rewrites (the ${at.length === 1 ? 'jump' : 'jumps'} at ` }, ...capped(at.map((x) => [addrPiece(c, x)])), { text: ')' }]);
  }
  if (b.rewrittenOps.length > 0) {
    const at = [...b.rewrittenOps].sort((p, q) => p - q);
    ends.push([
      { text: 'whatever the ' },
      { text: at.length === 1 ? 'instruction at ' : 'instructions at ' },
      ...capped(at.map((x) => [addrPiece(c, x)])),
      { text: at.length === 1 ? ' becomes (the program rewrites it)' : ' become (the program rewrites them)' },
    ]);
  }
  if (b.undecoded.size > 0) {
    ends.push([{ text: 'jumping to ' }, ...capped([...b.undecoded.keys()].sort((p, q) => p - q).map((t) => [addrPiece(c, t)])), { text: `, which ${b.undecoded.size === 1 ? 'is' : 'are'} not decoded as code` }]);
  }
  const fell = (m: Map<number, number[]>): Piece[] => capped([...m.keys()].sort((p, q) => p - q).map((t) => [addrPiece(c, t)]));
  if (b.runsOff.size > 0) ends.push([{ text: 'running off the end of the loaded code at ' }, ...fell(b.runsOff)]);
  // After a CALL the routine called may not come back there (it may take the bytes after the call as its parameters).
  const afterCall = new Map<number, number[]>();
  const plain = new Map<number, number[]>();
  for (const [t, froms] of b.fallsIntoData) {
    for (const f of froms) add(a.pass1.instructions.get(f)?.flow.kind === 'call' ? afterCall : plain, t, f);
  }
  if (plain.size > 0) ends.push([{ text: 'running into bytes not decoded as code at ' }, ...fell(plain)]);
  for (const [t, froms] of [...afterCall].sort((p, q) => p[0] - q[0])) {
    const calls = [...froms].sort((p, q) => p - q);
    ends.push([{ text: calls.length === 1 ? 'falling past the call at ' : 'falling past the calls at ' }, ...capped(calls.map((x) => [addrPiece(c, x)])), { text: ' into bytes not decoded as code at ' }, addrPiece(c, t)]);
  }
  if (b.halts) ends.push([{ text: 'halting' }]);
  if (ends.length > 0) out.push(say('It ends by ', ends.flatMap((p, i) => (i === 0 ? p : [{ text: ', or by ' }, ...p])), b.truncated ? ' (among the paths followed).' : '.'));
  else if (!b.truncated) {
    const calls = b.ins.some((x) => x.ins.flow.kind === 'call');
    out.push(say(calls ? 'None of its paths returns or jumps out of it: it loops forever, unless a routine it calls leaves it.' : 'None of its paths returns or jumps out of it: it loops forever.'));
  }

  // What it touches.
  const screen: { text: string; lo: number; hi: number; at: number }[] = [];
  const keys: { pieces: Piece[]; at: number }[] = [];
  const keyWrites: { pieces: Piece[]; at: number }[] = [];
  const reads = new Map<number, number>();
  const writes = new Map<number, number>();
  const portsOut = new Map<number, number>();
  const portsIn = new Map<number, number>();
  const blocks: Sentence[] = [];
  const romCalls = new Map<number, number>();
  const progCalls = new Map<number, number>();
  const loops: Piece[][] = [];
  const first = (m: Map<number, number>, k: number, at: number): void => {
    if (!m.has(k)) m.set(k, at);
  };

  for (const { at, ins } of b.ins) {
    const patched = patchedBytes(a, at, ins).length > 0;
    let regs: RegState | undefined;
    const known = (): RegState => (regs ??= knownBefore(a, at).regs);
    const m = ins.mnemonic;

    for (const acc of accesses(ins)) {
      const w = where(acc.op, known, patched);
      if (w === null) continue;
      if ('hi' in w) {
        if (acc.write && w.hi >= 0x3c && w.hi <= 0x3f) {
          const r0 = (((w.hi << 8) - SCREEN_LO) >> 6) as number;
          screen.push({ text: `somewhere in rows ${r0}–${r0 + 3}`, lo: w.hi << 8, hi: (w.hi << 8) | 0xff, at });
        } else if (w.hi >= 0x38 && w.hi <= 0x3b) (acc.write ? keyWrites : keys).push({ pieces: [{ text: `somewhere in ${word$(w.hi << 8)}–${word$((w.hi << 8) | 0xff)}` }], at });
        continue;
      }
      const v = w.exact;
      if (acc.write && v >= SCREEN_LO && v <= SCREEN_HI) {
        const cell = screenCell(v)!;
        screen.push({ text: `row ${cell.row}, column ${cell.column}`, lo: v, hi: v, at });
      } else if (v >= KEYS_LO && v <= KEYS_HI) {
        (acc.write ? keyWrites : keys).push({ pieces: addrPhrase(c, v), at });
      } else if (v < SCREEN_LO || v > SCREEN_HI) {
        if (nameOf(c, v, 'data') === undefined) continue;
        if (acc.read) first(reads, v, at);
        if (acc.write) first(writes, v, at);
      }
    }

    // Block copies and fills: the range LDIR or LDDR writes, when the pattern's registers are proven.
    if (m === 'LDIR' || m === 'LDDR') {
      const p = patternAt(c, at);
      if (p !== undefined && p.to === at && (p.name === 'copy' || p.name === 'fill')) {
        const r = known();
        const de = pair(r, 'DE');
        const bc = pair(r, 'BC');
        if (de !== null && bc !== null) {
          const n = bc === 0 ? 0x10000 : bc;
          let lo = m === 'LDIR' ? de : de - n + 1;
          let hi = m === 'LDIR' ? de + n - 1 : de;
          const hl = pair(r, 'HL');
          if (p.name === 'fill' && hl !== null && hl === de - 1) lo = hl;
          lo = Math.max(lo, SCREEN_LO);
          hi = Math.min(hi, SCREEN_HI);
          if (lo <= hi) screen.push({ text: screenRange(lo, hi).rows, lo, hi, at });
        }
        const lead = p.sentences[0];
        if (lead !== undefined) blocks.push(subjectIt(lead));
      }
    }

    // Ports.
    if (m === 'OUT' || m === 'IN' || m === 'OUTI' || m === 'OTIR' || m === 'OUTD' || m === 'OTDR' || m === 'INI' || m === 'INIR' || m === 'IND' || m === 'INDR') {
      const port = ins.operands.find((o) => o.kind === 'port');
      let n: number | null = null;
      if (port?.kind === 'port') n = patched ? null : port.value & 0xff;
      else n = known().C;
      if (n !== null) first(m.startsWith('O') ? portsOut : portsIn, n, at);
    }

    // Calls.
    if (ins.flow.kind === 'call' && !patched) {
      const t = targetOf(ins);
      if (t !== null) first(loaded(c, t) ? progCalls : romCalls, t & 0xffff, at);
    }

    // Loops: a jump back to an address inside the routine.
    if (ins.flow.kind === 'jump' && !ins.flow.indirect && !patched) {
      const t = targetOf(ins);
      if (t !== null && t <= at && b.has.has(t)) {
        const p = patternAt(c, at);
        if (p !== undefined && p.name === 'wait' && p.to === at) loops.push([{ text: 'a delay loop at ' }, addrPiece(c, at)]);
        else if (m === 'DJNZ') {
          const loop = djnzLoop(a, at);
          let times: Piece[];
          if (loop === null || loop.count === null) times = [{ text: ' (how many times is not proven)' }];
          else {
            const n = loop.count === 0 ? 256 : loop.count;
            const count = n === 1 ? 'once' : n === 2 ? 'twice' : `${decimal(n)} times`;
            // An exit out of the body makes the count only a bound.
            times = loop.exits.length === 0 ? [{ text: `, ${count}` }] : [{ text: `, at most ${count}, leaving early at ` }, ...exitsPhrase(c, loop.exits)];
          }
          loops.push([{ text: 'the lines from ' }, named(c, t, 'code'), { text: ' to the DJNZ at ' }, addrPiece(c, at), ...times]);
        } else loops.push([{ text: 'the lines from ' }, named(c, t, 'code'), { text: ' to the jump back at ' }, addrPiece(c, at)]);
      }
    }
  }

  // Screen: one place per text, cells inside a block range dropped.
  const ranges = screen.filter((s) => s.lo !== s.hi);
  const shown = new Set<string>();
  const places: Piece[][] = [];
  for (const s of screen) {
    if (s.lo === s.hi && ranges.some((r) => r.lo <= s.lo && s.lo <= r.hi)) continue;
    if (shown.has(s.text)) continue;
    shown.add(s.text);
    places.push([{ text: `${s.text} (at ` }, addrPiece(c, s.at), { text: ')' }]);
  }
  if (places.length > 0) out.push(say('It writes to the screen: ', capped(places), '.'));
  // One item per address, at its first use.
  const keyItems = (list: { pieces: Piece[]; at: number }[]): Piece[][] => {
    const seen = new Set<string>();
    return list.flatMap((k) => {
      const t = k.pieces.map((p) => p.text).join('');
      if (seen.has(t)) return [];
      seen.add(t);
      return [[...k.pieces, { text: ' (at ' }, addrPiece(c, k.at), { text: ')' }]];
    });
  };
  if (keys.length > 0) out.push(say('It reads the keyboard: ', capped(keyItems(keys)), '.'));
  if (keyWrites.length > 0) out.push(say('It writes to the keyboard area: ', capped(keyItems(keyWrites)), '.'));

  const portSentences = (ports: Map<number, number>, verb: string): void => {
    for (const n of [...ports.keys()].sort((p, q) => p - q)) {
      const p = portPhrase(c, n);
      out.push(say(`It ${verb} `, p.pieces, p.entry === undefined ? '' : `: ${p.entry.purpose}`, '.'));
    }
  };
  portSentences(portsOut, 'writes to');
  portSentences(portsIn, 'reads from');

  out.push(...blocks.slice(0, 3));

  const dataList = (m: Map<number, number>): Piece[] => capped([...m.keys()].sort((p, q) => p - q).map((x) => [named(c, x, 'data')]));
  if (reads.size > 0) out.push(say('It reads ', dataList(reads), '.'));
  if (writes.size > 0) out.push(say('It writes ', dataList(writes), '.'));

  for (const t of [...romCalls.keys()].sort((p, q) => p - q)) {
    const ext = tableName(c, t, 'code');
    if (ext === undefined) out.push(say('It calls ', word$(t), ', outside the program.'));
    else out.push(say(`It calls ${routineKind(ext.entry)} `, { text: ext.text, entry: ext.entry }, ` (${word$(t)}): ${ext.entry.purpose}.`));
  }
  if (progCalls.size > 0) out.push(say('It calls ', capped([...progCalls.keys()].sort((p, q) => p - q).map((t) => [named(c, t, 'code')])), '.'));

  if (loops.length > 0) {
    const named6 = loops.length <= LIST ? loops : [...loops.slice(0, LIST - 1), [{ text: `${loops.length - (LIST - 1)} more` }]];
    out.push(say(loops.length === 1 ? 'It loops: ' : `It has ${decimal(loops.length)} loops: `, named6.flatMap((p, i) => (i === 0 ? p : [{ text: '; ' }, ...p])), '.'));
  }

  if (b.truncated) out.push(say(`It is longer than ${decimal(CAP)} instructions; this summary stopped there.`));

  return { start, name, instructions: b.ins.length, bytes, sentences: out, truncated: b.truncated };
}

/** The summary of the routine around the line at `addr`, or null when no routine reaches it. */
export function summarizeRoutine(s: Session, addr: number): RoutineSummary | null {
  const a = s.analysis;
  const at = instructionAt(a, addr & 0xffff);
  if (at === null) return null;
  const ix = index(a);
  const start = ix.owner[at]!;
  if (start < 0) return null;
  let r = ix.summaries.get(start);
  if (r === undefined) {
    r = summarize({ s, a }, ix, start);
    ix.summaries.set(start, r);
  }
  return r;
}

/** The summary as note lines (each ≤ 72 characters, wrapped), for Use as comment. */
export function summaryNotes(r: RoutineSummary): string[] {
  const out: string[] = [];
  for (const s of r.sentences) {
    let line = '';
    for (let word of s.map((p) => p.text).join('').split(/\s+/).filter((w) => w !== '')) {
      while (word.length > WIDTH) {
        if (line !== '') out.push(line);
        out.push(word.slice(0, WIDTH));
        word = word.slice(WIDTH);
        line = '';
      }
      if (line === '') line = word;
      else if (line.length + 1 + word.length <= WIDTH) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
    }
    if (line !== '') out.push(line);
  }
  return out;
}
