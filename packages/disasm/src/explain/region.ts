/**
 * The data region a data row belongs to: the run of data bytes around it,
 * bounded by labels, code and the end of the loaded image; the instructions
 * and DW words that point into it; the variables its address is stored in;
 * and the loops that read it through HL, with the tests in them that split
 * the bytes into kinds. It reports only the instructions it saw and never
 * guesses what the kinds mean. An instruction the program may rewrite
 * (`patchedBytes`) contributes none of its numbers.
 */
import type { Cond, Instruction } from '@fugloy/z80';
import { dataReference } from '../analysis/symbols.js';
import type { Analysis } from '../pipeline.js';
import type { Session } from '../session.js';
import { rowsOf, rowText } from './listing.js';
import type { ListRow } from './listing.js';
import { addrPiece, andList, byte$, decimal, say, word$ } from './machine.js';
import type { Ctx } from './machine.js';
import { patchedBytes, written } from './track.js';
import type { DataRegion, Piece, Sentence } from './types.js';

/** The most items a list in a sentence names before "and N more". */
const LIST = 6;
/** The most straight-line instructions between a load of HL and the loop it falls into. */
const LEAD = 8;
/** The most bytes a loop may span. */
const SPAN = 512;
/** The most instructions a split's test looks back for the LD A,(HL) that feeds it. */
const BACK = 4;

interface Index {
  /** Direct jumps back to an address at or before themselves, not rewritten: from → to. */
  back: { from: number; to: number }[];
  /** Data rows' link spans: where each DW word points. */
  words: { addr: number; target: number; text: string }[];
  regions: Map<number, DataRegion>;
}

const cache = new WeakMap<Analysis, Index>();

function targetOf(ins: Instruction): number | null {
  for (const o of ins.operands) {
    if (o.kind === 'imm16') return o.value;
    if (o.kind === 'rel') return o.target;
  }
  return null;
}

function index(a: Analysis): Index {
  const hit = cache.get(a);
  if (hit !== undefined) return hit;
  const back: Index['back'] = [];
  for (const [at, ins] of a.pass1.instructions) {
    if (ins.flow.kind !== 'jump' || ins.flow.indirect || patchedBytes(a, at, ins).length > 0) continue;
    const t = targetOf(ins);
    if (t !== null && t <= at) back.push({ from: at, to: t });
  }
  const words: Index['words'] = [];
  for (const row of rowsOf(a).rows) {
    if (row.kind !== 'data') continue;
    const text = (row as ListRow).spans.map((s) => s.text).join('');
    for (const s of row.spans) if ((s.kind === 'label' || s.kind === 'table') && s.target !== undefined) words.push({ addr: row.addr, target: s.target, text });
  }
  const built: Index = { back, words, regions: new Map() };
  cache.set(a, built);
  return built;
}

/** Loaded and not part of a decoded instruction. */
const isData = (a: Analysis, addr: number): boolean => a.space.image.isLoaded(addr) && !a.pass1.map.isCode(addr);

/** `a, b, c and 3 more`, at most LIST items named. */
function capped(items: Piece[][]): Piece[] {
  if (items.length <= LIST) return andList(items, (p) => p);
  return andList([...items.slice(0, LIST - 1), [{ text: `${items.length - (LIST - 1)} more` }]], (p) => p);
}

const at$ = (c: Ctx, at: number): Piece[] => {
  const t = rowText(c.a, at);
  return t === undefined ? [addrPiece(c, at)] : [addrPiece(c, at), { text: ` (${t})` }];
};

const nameOrAddr = (a: Analysis, addr: number): string => a.symbols.get(addr)?.name ?? word$(addr);

const DATA_REGS = new Set(['BC', 'DE', 'HL', 'IX', 'IY']);

/** The 16-bit register an `LD rr,nn` loads, or null. */
function loadsPair(ins: Instruction): string | null {
  const [d, v] = ins.operands;
  return ins.mnemonic === 'LD' && d?.kind === 'reg16' && DATA_REGS.has(d.reg) && v?.kind === 'imm16' ? d.reg : null;
}

/** The instruction that ends at `addr` (starts at addr-1..addr-4), or null. */
function before(a: Analysis, addr: number): { at: number; ins: Instruction } | null {
  for (let n = 1; n <= 4; n++) {
    const at = (addr - n) & 0xffff;
    const ins = a.pass1.instructions.get(at);
    if (ins !== undefined && ins.length === n) return { at, ins };
  }
  return null;
}

const readsHL = (ins: Instruction): boolean => {
  if (ins.mnemonic === 'LD') return ins.operands[1]?.kind === 'ind' && (ins.operands[1] as { reg: string }).reg === 'HL';
  if (ins.mnemonic === 'PUSH' || ins.mnemonic === 'POP' || ins.mnemonic === 'JP' || ins.mnemonic === 'EX') return false;
  return ins.operands.some((o) => o.kind === 'ind' && o.reg === 'HL');
};

const isLdAHL = (ins: Instruction): boolean => {
  const [d, s] = ins.operands;
  return ins.mnemonic === 'LD' && d?.kind === 'reg' && d.reg === 'A' && s?.kind === 'ind' && s.reg === 'HL';
};

const imm8 = (ins: Instruction): number | null => {
  const o = ins.operands.find((x) => x.kind === 'imm8');
  return o?.kind === 'imm8' ? o.value & 0xff : null;
};

const WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];

/**
 * The test at `at` (AND n or CP n) as a split of the bytes the loop reads,
 * when A is proven to come from LD A,(HL) along straight-line code (through
 * at most one AND n before a CP n), and a conditional jump follows at once.
 */
function split(c: Ctx, at: number, ins: Instruction): { at: number; text: string } | null {
  const a = c.a;
  const m = ins.mnemonic;
  if ((m !== 'AND' && m !== 'CP') || patchedBytes(a, at, ins).length > 0) return null;
  const n = imm8(ins);
  if (n === null) return null;
  const jAt = (at + ins.length) & 0xffff;
  const j = a.pass1.instructions.get(jAt);
  if (j === undefined || a.symbols.has(jAt) || j.flow.kind !== 'jump' || !j.flow.conditional || j.flow.indirect) return null;
  const cc = j.operands.find((o) => o.kind === 'cc');
  if (cc?.kind !== 'cc') return null;
  const cond: Cond = cc.cond;
  // Back to LD A,(HL): no label on the way (another path could set A), nothing else writes A, at most one AND before a CP.
  let mask: number | null = null;
  let cur = at;
  let found = false;
  for (let k = 0; k < BACK; k++) {
    if (a.symbols.has(cur)) return null;
    const p = before(a, cur);
    if (p === null || p.ins.flow.kind !== 'next') return null;
    if (isLdAHL(p.ins)) {
      found = true;
      break;
    }
    if (m === 'CP' && mask === null && p.ins.mnemonic === 'AND' && imm8(p.ins) !== null && patchedBytes(a, p.at, p.ins).length === 0) mask = imm8(p.ins);
    else if (written(p.ins).includes('A')) return null;
    cur = p.at;
  }
  if (!found) return null;
  const how = ` (${rowText(a, at) ?? m} at ${word$(at)})`;
  if (m === 'AND') {
    if (n === 0 || (cond !== 'Z' && cond !== 'NZ')) return null;
    const rest = ~n & 0xff;
    const high = ((rest + 1) & rest) === 0; // n is $FF << k: the bytes it zeroes form $00..rest
    if (high) return { at, text: rest === 0 ? `bytes equal to $00 are treated differently${how}` : `bytes $00–${byte$(rest)} are treated differently${how}` };
    return { at, text: `bytes with none of the bits in ${byte$(n)} set are treated differently${how}` };
  }
  // CP n, perhaps after AND mask.
  const low = mask !== null && mask !== 0xff && ((mask + 1) & mask) === 0 ? Math.log2(mask + 1) : 0;
  const subject = mask === null || mask === 0xff ? 'bytes' : low > 0 ? `bytes whose low ${low === 1 ? 'bit is' : `${WORDS[low]} bits are`}` : `bytes whose value AND ${byte$(mask)} is`;
  const plain = subject === 'bytes';
  const top = mask === null ? 0xff : mask;
  if (cond === 'Z' || cond === 'NZ') {
    if (mask !== null && (n & ~mask & 0xff) !== 0) return null;
    return { at, text: `${plain ? 'bytes equal to' : subject} ${byte$(n)} are treated differently${how}` };
  }
  if (n === 0) return null;
  // After CP n the sign flag is A-n's bit 7; with A and n both below $80, P is exactly A >= n.
  const ordered = cond === 'C' || cond === 'NC' || ((cond === 'P' || cond === 'M') && top <= 0x7f && n <= 0x7f);
  if (ordered) return { at, text: `${plain ? 'bytes below' : `${subject} below`} ${byte$(n)} are treated differently from the rest${how}` };
  if (cond === 'P' || cond === 'M') return { at, text: `bytes are split by the sign of their value minus ${byte$(n)}${how}` };
  return null;
}

/** The loop a load of HL at `at` falls into, as straight-line code, and how it reads (HL). */
function loopFrom(c: Ctx, ix: Index, at: number, ins: Instruction): { head: number; end: number; body: { at: number; ins: Instruction }[] } | null {
  const a = c.a;
  let p = (at + ins.length) & 0xffff;
  for (let k = 0; k < LEAD; k++) {
    const cur = a.pass1.instructions.get(p);
    if (cur === undefined) return null;
    const head = p;
    if (ix.back.some((b) => b.to === head && b.from - head < SPAN)) {
      let end = head;
      for (const b of ix.back) if (b.to === head && b.from > end && b.from - head < SPAN) end = b.from;
      for (let grew = true; grew; ) {
        grew = false;
        for (const b of ix.back) {
          if (b.to >= head && b.to <= end && b.from > end && b.from - head < SPAN) {
            end = b.from;
            grew = true;
          }
        }
      }
      const body: { at: number; ins: Instruction }[] = [];
      for (let q = head; q <= end; ) {
        const i = a.pass1.instructions.get(q);
        if (i === undefined) {
          q++;
          continue;
        }
        body.push({ at: q, ins: i });
        q += i.length;
      }
      return { head, end, body };
    }
    if (cur.flow.kind !== 'next') return null;
    const w = written(cur);
    if (w.includes('H') || w.includes('L')) return null;
    p = (p + cur.length) & 0xffff;
  }
  return null;
}

function build(c: Ctx, ix: Index, start: number, end: number): DataRegion {
  const a = c.a;
  const inside = (v: number): boolean => v >= start && v <= end;
  const name = a.symbols.get(start)?.name;
  const size = end - start + 1;
  const out: Sentence[] = [];
  const self: Piece = { text: name ?? word$(start), addr: start };
  const span = size === 1 ? `1 byte of data at ${word$(start)}` : `${decimal(size)} bytes of data from ${word$(start)} to ${word$(end)}`;
  out.push(name === undefined ? say(`This row is part of ${span}.`) : say('This row is part of ', self, `, ${span}.`));

  // Who refers to it.
  const users: DataRegion['users'] = [];
  const rewritten: number[] = [];
  const loads: { at: number; ins: Instruction }[] = [];
  for (const [at, ins] of a.pass1.instructions) {
    const ref = dataReference(ins);
    if (ref === null || !inside(ref & 0xffff)) continue;
    if (patchedBytes(a, at, ins).length > 0) rewritten.push(at);
    else {
      users.push({ addr: at, text: rowText(a, at) ?? ins.mnemonic });
      if (loadsPair(ins) !== null) loads.push({ at, ins });
    }
  }
  for (const w of ix.words) if (inside(w.target) && !users.some((u) => u.addr === w.addr)) users.push({ addr: w.addr, text: w.text });
  users.sort((p, q) => p.addr - q.addr);
  rewritten.sort((p, q) => p - q);
  loads.sort((p, q) => p.at - q.at);
  if (users.length > 0) out.push(say('The program refers to it at ', capped(users.map((u) => [addrPiece(c, u.addr), { text: ` (${u.text})` }])), '.'));
  if (rewritten.length > 0) {
    out.push(
      say(
        rewritten.length === 1 ? 'The instruction at ' : 'The instructions at ',
        capped(rewritten.map((x) => at$(c, x))),
        rewritten.length === 1 ? ' starts out pointing into it, but the program rewrites that instruction as it runs, so that is only where it starts.' : ' start out pointing into it, but the program rewrites them as it runs, so that is only where they start.',
      ),
    );
  }
  if (users.length === 0 && rewritten.length === 0) {
    out.push(say('No instruction refers to it by address, and no DW word points into it; the program may still reach it through an address it works out as it runs.'));
  }

  // Kept as a pointer: the next instruction stores the register just loaded.
  const pointers: DataRegion['pointers'] = [];
  for (const { at, ins } of loads) {
    const reg = loadsPair(ins)!;
    const nAt = (at + ins.length) & 0xffff;
    const n = a.pass1.instructions.get(nAt);
    const [d, s] = n?.operands ?? [];
    if (n === undefined || n.mnemonic !== 'LD' || d?.kind !== 'mem' || s?.kind !== 'reg16' || s.reg !== reg || patchedBytes(a, nAt, n).length > 0) continue;
    const variable = d.addr & 0xffff;
    const readers: number[] = [];
    const others: number[] = [];
    for (const [q, i] of a.pass1.instructions) {
      if (i.mnemonic !== 'LD' || patchedBytes(a, q, i).length > 0) continue;
      const [x, y] = i.operands;
      if (y?.kind === 'mem' && y.addr === variable) readers.push(q);
      else if (x?.kind === 'mem' && x.addr === variable && q !== nAt) others.push(q);
    }
    readers.sort((p, q) => p - q);
    others.sort((p, q) => p - q);
    const vname = nameOrAddr(a, variable);
    const v: Piece = { text: vname, addr: variable };
    pointers.push({ variable, name: vname, storedAt: nAt, readers });
    const back = readers.length > 0 ? [{ text: ', which is read back at ' }, ...capped(readers.map((x) => at$(c, x)))] : [{ text: '; nothing reads ' }, v, { text: ' back by address' }];
    out.push(say('The address loaded at ', addrPiece(c, at), ' is stored at ', addrPiece(c, nAt), ', so it is kept in ', v, back, '.'));
    if (others.length > 0) out.push(say(v, ' is also written at ', capped(others.map((x) => [addrPiece(c, x)])), '.'));
  }

  // How it is read: a load of HL that falls into a loop reading (HL).
  const readers: DataRegion['readers'] = [];
  for (const { at, ins } of loads) {
    if (loadsPair(ins) !== 'HL') continue;
    const loop = loopFrom(c, ix, at, ins);
    if (loop === null || readers.some((r) => r.loop === loop.head) || !loop.body.some((b) => readsHL(b.ins))) continue;
    const incs = loop.body.filter((b) => b.ins.mnemonic === 'INC' && b.ins.operands[0]?.kind === 'reg16' && b.ins.operands[0].reg === 'HL').map((b) => b.at);
    const decs = loop.body.filter((b) => b.ins.mnemonic === 'DEC' && b.ins.operands[0]?.kind === 'reg16' && b.ins.operands[0].reg === 'HL').map((b) => b.at);
    const moves = loop.body.filter((b) => !incs.includes(b.at) && !decs.includes(b.at) && written(b.ins).some((r) => r === 'H' || r === 'L')).map((b) => b.at);
    const head: Piece = { text: nameOrAddr(a, loop.head), addr: loop.head };
    const intro: Piece[] = [{ text: 'The load at ' }, addrPiece(c, at), { text: ' falls into the loop at ' }, head, { text: ` (to ${word$(loop.end)}), which reads the bytes through HL` }];
    const step: 1 | -1 | null = incs.length > 0 && decs.length === 0 ? 1 : decs.length > 0 && incs.length === 0 ? -1 : null;
    if (step === null) out.push(say(intro, '.'));
    else {
      const steps = step === 1 ? incs : decs;
      out.push(say(intro, `, stepping ${step === 1 ? 'forward' : 'back'} (${step === 1 ? 'INC' : 'DEC'} HL at `, capped(steps.map((x) => [addrPiece(c, x)])), ').'));
    }
    if (moves.length > 0) out.push(say('HL also changes in it at ', capped(moves.map((x) => at$(c, x))), '.'));
    const splits = loop.body.flatMap((b) => split(c, b.at, b.ins) ?? []);
    if (splits.length > 0) {
      const items = splits.map((sp): Piece[] => {
        const cut = sp.text.lastIndexOf(` at ${word$(sp.at)})`);
        return [{ text: sp.text.slice(0, cut + 4) }, addrPiece(c, sp.at), { text: ')' }];
      });
      out.push(say('In the loop, ', items.flatMap((p, i) => (i === 0 ? p : [{ text: '; ' }, ...p])), '.'));
    }
    if (step !== null) readers.push({ loop: loop.head, step, splits });
  }

  return { start, end, name: name ?? word$(start), users, pointers, readers, sentences: out };
}

/** The data region the row at `addr` belongs to, or null when `addr` is code, not loaded, or the session is BASIC. */
export function dataRegion(s: Session, addr: number): DataRegion | null {
  const a = s.analysis;
  addr &= 0xffff;
  if (s.plainBasic || s.module.format === 'bas' || !isData(a, addr)) return null;
  let start = addr;
  while (!a.symbols.has(start) && start > 0 && isData(a, start - 1)) start--;
  let end = addr;
  while (end < 0xffff && isData(a, end + 1) && !a.symbols.has(end + 1)) end++;
  const ix = index(a);
  let r = ix.regions.get(start);
  if (r === undefined) {
    r = build({ s, a }, ix, start, end);
    ix.regions.set(start, r);
  }
  return r;
}
