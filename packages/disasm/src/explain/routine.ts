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
import { patternAt, screenRange } from './patterns.js';
import { djnzLoop, knownBefore, patchedBytes } from './track.js';
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

interface Body {
  start: number;
  /** The routine's instructions, in address order. */
  ins: { at: number; ins: Instruction }[];
  has: Set<number>;
  truncated: boolean;
  returns: boolean;
  halts: boolean;
  /** Jumps on to another routine's start, or outside the program: target → the jumps. */
  onward: Map<number, number[]>;
  /** JP (HL), JP (IX), JP (IY): the register. */
  indirect: string[];
}

interface Index {
  /** Routine starts: loaded call and RST targets, roots and the entry, ascending. */
  starts: number[];
  startSet: Set<number>;
  bodies: Map<number, Body>;
  summaries: Map<number, RoutineSummary>;
}

const cache = new WeakMap<Analysis, Index>();

function index(a: Analysis): Index {
  const hit = cache.get(a);
  if (hit !== undefined) return hit;
  const set = new Set<number>();
  for (const x of a.pass1.xrefs) if ((x.kind === 'call' || x.kind === 'ccall' || x.kind === 'rst') && a.pass1.instructions.has(x.to)) set.add(x.to);
  for (const r of [...a.roots, ...a.pass1.roots, ...(a.entry === null ? [] : [a.entry])]) if (a.pass1.instructions.has(r & 0xffff)) set.add(r & 0xffff);
  const built: Index = { starts: [...set].sort((p, q) => p - q), startSet: set, bodies: new Map(), summaries: new Map() };
  cache.set(a, built);
  return built;
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

/** Follows the routine from `start`: jumps and branches, not calls, up to the cap. */
function body(a: Analysis, ix: Index, start: number): Body {
  const hit = ix.bodies.get(start);
  if (hit !== undefined) return hit;
  const b: Body = { start, ins: [], has: new Set(), truncated: false, returns: false, halts: false, onward: new Map(), indirect: [] };
  const work = [start];
  const onward = (to: number, from: number): void => {
    const list = b.onward.get(to);
    if (list === undefined) b.onward.set(to, [from]);
    else list.push(from);
  };
  while (work.length > 0) {
    const at = work.pop()!;
    if (b.has.has(at)) continue;
    const ins = a.pass1.instructions.get(at);
    if (ins === undefined) continue;
    if (b.has.size >= CAP) {
      b.truncated = true;
      break;
    }
    b.has.add(at);
    b.ins.push({ at, ins });
    const next = (at + ins.length + (isRst08(ins) ? 1 : 0)) & 0xffff;
    const f = ins.flow;
    if (f.kind === 'halt') {
      b.halts = true;
      continue;
    }
    if (f.kind === 'return') {
      b.returns = true;
      if (f.conditional) work.push(next);
      continue;
    }
    if (f.kind === 'jump') {
      if (f.indirect) {
        const r = ins.operands.find((o) => o.kind === 'ind');
        const reg = r?.kind === 'ind' ? r.reg : 'HL';
        if (!b.indirect.includes(reg)) b.indirect.push(reg);
      } else {
        const t = targetOf(ins);
        if (t !== null) {
          if ((t !== start && ix.startSet.has(t)) || !a.space.image.isLoaded(t & 0xffff)) onward(t, at);
          else work.push(t);
        }
      }
      if (f.conditional) work.push(next);
      continue;
    }
    work.push(next);
  }
  b.ins.sort((p, q) => p.at - q.at);
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
    if (x.kind === 'call' || x.kind === 'ccall' || x.kind === 'rst') callers.add(x.from);
    else if (!b.has.has(x.from)) (a.pass1.instructions.has(x.from) ? jumps : table).add(x.from);
  }
  const list = (s: Set<number>): Piece[] => capped([...s].sort((p, q) => p - q).map((x) => [addrPiece(c, x)]));
  if (callers.size > 0) out.push(say(`It is called from ${callers.size === 1 ? 'one place' : `${decimal(callers.size)} places`}: `, list(callers), '.'));
  if (jumps.size > 0) out.push(say(`It is jumped to from `, list(jumps), '.'));
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
  for (const r of b.indirect) ends.push([{ text: `jumping to the address in ${r}` }]);
  if (b.halts) ends.push([{ text: 'halting' }]);
  if (ends.length > 0) out.push(say('It ends by ', ends.flatMap((p, i) => (i === 0 ? p : [{ text: ', or by ' }, ...p])), b.truncated ? ' (among the paths followed).' : '.'));
  else if (!b.truncated) {
    const calls = b.ins.some((x) => x.ins.flow.kind === 'call');
    out.push(say(calls ? 'None of its paths returns or jumps out of it: it loops forever, unless a routine it calls leaves it.' : 'None of its paths returns or jumps out of it: it loops forever.'));
  }

  // What it touches.
  const screen: { text: string; lo: number; hi: number; at: number }[] = [];
  const keys: { pieces: Piece[]; at: number }[] = [];
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
        } else if (w.hi >= 0x38 && w.hi <= 0x3b) keys.push({ pieces: [{ text: `somewhere in ${word$(w.hi << 8)}–${word$((w.hi << 8) | 0xff)}` }], at });
        continue;
      }
      const v = w.exact;
      if (acc.write && v >= SCREEN_LO && v <= SCREEN_HI) {
        const cell = screenCell(v)!;
        screen.push({ text: `row ${cell.row}, column ${cell.column}`, lo: v, hi: v, at });
      } else if (v >= KEYS_LO && v <= KEYS_HI) {
        keys.push({ pieces: addrPhrase(c, v), at });
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
        if (p.sentences[0] !== undefined) blocks.push(p.sentences[0]);
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
          const times = loop?.count === null || loop === null ? ' (how many times is not proven)' : loop.count === 1 ? ', once' : `, ${decimal(loop.count === 0 ? 256 : loop.count)} times`;
          loops.push([{ text: 'the lines from ' }, named(c, t, 'code'), { text: ' to the DJNZ at ' }, addrPiece(c, at), { text: times }]);
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
  if (keys.length > 0) out.push(say('It reads the keyboard: ', capped(keys.map((k) => [...k.pieces, { text: ' (at ' }, addrPiece(c, k.at), { text: ')' }])), '.'));

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
  for (let i = ix.starts.length - 1; i >= 0; i--) {
    const start = ix.starts[i]!;
    if (start > at) continue;
    if (!body(a, ix, start).has.has(at)) continue;
    let r = ix.summaries.get(start);
    if (r === undefined) {
      r = summarize({ s, a }, ix, start);
      ix.summaries.set(start, r);
    }
    return r;
  }
  return null;
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
