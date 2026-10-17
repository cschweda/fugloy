/**
 * The Explain tab's patterns: what a group of lines accomplishes. A block copy
 * (LDIR/LDDR with HL, DE and BC proven), a fill (LD (HL),n with DE = HL+1 and
 * LDIR), a counted loop (DJNZ) and a delay loop (DEC, a test and a backward
 * jump, nothing else). Each names the lines it spans, and every line in the
 * span shows it. Like the lead sentences, a pattern states only values the
 * tracker proves; an instruction the program rewrites proves nothing.
 */
import type { Instruction } from '@fugloy/z80';
import { pair } from '../analysis/regs.js';
import type { Reg8Name, RegState } from '../analysis/regs.js';
import { djnzLoop, knownBefore, loopEntry, patchedBytes, walkBack, written } from './track.js';
import { addrPhrase, addrPiece, byte$, decimal, say, screenCell, word$ } from './machine.js';
import type { Ctx } from './machine.js';
import type { Explanation, Piece, Sentence } from './types.js';

export type Pattern = NonNullable<Explanation['pattern']>;

/** How many instructions forward from a line the anchor of a pattern spanning it is looked for. */
const SCAN = 48;

/** The most instructions a delay loop's body holds, with its jump. */
const WAIT_MAX = 6;

/** The pattern whose span covers the line at `addr`, nearest anchor first. */
export function patternAt(c: Ctx, addr: number): Pattern | undefined {
  let at = addr;
  for (let n = 0; n < SCAN; n++) {
    const ins = c.a.pass1.instructions.get(at);
    if (ins === undefined) return undefined;
    const p = anchored(c, at, ins, addr);
    if (p !== undefined && p.from <= addr && addr <= p.to) return p;
    const next = at + ins.length;
    if (next > 0xffff) return undefined;
    at = next;
  }
  return undefined;
}

/** The pattern that ends at the instruction at `at` (an LDIR, LDDR, DJNZ or backward JR/JP NZ), seen from the line at `viewer`. */
function anchored(c: Ctx, at: number, ins: Instruction, viewer: number): Pattern | undefined {
  // A loop's span starts at its jump's target: one past the line cannot cover it.
  const t = ins.operands.find((o) => o.kind === 'rel' || o.kind === 'imm16');
  if ((ins.mnemonic === 'DJNZ' || ins.mnemonic === 'JR' || ins.mnemonic === 'JP') && t !== undefined && (t.kind === 'rel' ? t.target : t.kind === 'imm16' ? t.value : 0) > viewer) return undefined;
  switch (ins.mnemonic) {
    case 'LDIR':
      return fill(c, at) ?? copy(c, at, ins);
    case 'LDDR':
      return copy(c, at, ins);
    case 'DJNZ':
      return wait(c, at, ins) ?? counted(c, at, ins, viewer);
    case 'JR':
    case 'JP':
      return wait(c, at, ins);
    default:
      return undefined;
  }
}

/** `13,953 bytes ($3681)`; above 65,535 only the decimal. */
function bytesText(n: number): string {
  const unit = n === 1 ? 'byte' : 'bytes';
  return n > 0xffff ? `${decimal(n)} ${unit}` : `${decimal(n)} ${unit} (${word$(n)})`;
}

/** The earliest instruction in the straight-line chain before `at` that last wrote one of `regs`, or `at`. */
function setupStart(c: Ctx, at: number, regs: readonly Reg8Name[]): number {
  let from = at;
  const { chain } = walkBack(c.a, at);
  for (const r of regs) {
    const writer = chain.find((link) => written(link.ins).includes(r));
    if (writer !== undefined && writer.at < from) from = writer.at;
  }
  return from;
}

function copy(c: Ctx, at: number, ins: Instruction): Pattern | undefined {
  const a = c.a;
  const regs = knownBefore(a, at).regs;
  const [hl, de, bc] = [pair(regs, 'HL'), pair(regs, 'DE'), pair(regs, 'BC')];
  const proposed = ins.mnemonic === 'LDIR' && a.proposals.some((p) => p.kind === 'move' && p.ldir === at);
  if (hl === null || de === null || bc === null) {
    if (!proposed) return undefined;
    // Movers follows one path forward through jumps; the tracker proves nothing here, so no numbers.
    return {
      name: 'copy',
      from: at,
      to: at,
      sentences: [
        say(
          "Fugløy's loader analysis proposes this copies the program to where it runs (the listing header has its proposal); the lines leading here do not prove what HL, DE and BC hold, so no numbers are given.",
        ),
      ],
    };
  }
  const n = bc === 0 ? 0x10000 : bc;
  const sentences: Sentence[] = [];
  if (ins.mnemonic === 'LDIR') {
    sentences.push(say('Copies ', bytesText(n), ' from ', addrPhrase(c, hl), ' to ', addrPhrase(c, de), '.'));
    const relocated = a.space.relocations.some((r) => r.fileAddr === hl && r.runAddr === de && r.length >= n);
    if (proposed || relocated) sentences.push(say('This moves the program to where it runs.'));
  } else {
    sentences.push(say('Copies ', bytesText(n), ', last byte first, from the block ending at ', addrPhrase(c, hl), ' to the block ending at ', addrPhrase(c, de), '.'));
  }
  return { name: 'copy', from: setupStart(c, at, ['H', 'L', 'D', 'E', 'B', 'C']), to: at, sentences };
}

const isReg = (o: Instruction['operands'][number] | undefined, r: string): boolean => (o?.kind === 'reg' || o?.kind === 'reg16') && o.reg === r;
const isImm = (o: Instruction['operands'][number] | undefined): boolean => o?.kind === 'imm8' || o?.kind === 'imm16';

/** The instructions a fill may have between its LD (HL),n and its LDIR: setting DE from HL, and loading DE or BC. */
function fillStep(ins: Instruction): 'DH' | 'EL' | 'INCDE' | 'DE' | 'BC' | null {
  const [d, s] = ins.operands;
  if (ins.mnemonic === 'INC' && isReg(d, 'DE')) return 'INCDE';
  if (ins.mnemonic !== 'LD') return null;
  if (isReg(d, 'D') && isReg(s, 'H')) return 'DH';
  if (isReg(d, 'E') && isReg(s, 'L')) return 'EL';
  if (isReg(d, 'DE') && isImm(s)) return 'DE';
  if ((isReg(d, 'BC') || isReg(d, 'B') || isReg(d, 'C')) && isImm(s)) return 'BC';
  return null;
}

/** `row 3` or `rows 1–2`; `from row 1, column 5 to row 2, column 9` when the range is not whole rows. */
function screenRange(start: number, end: number): { rows: string; whole: boolean; aligned: boolean } {
  const s = screenCell(start)!;
  const e = screenCell(end)!;
  const aligned = s.column === 0 && e.column === 63;
  const rows = aligned ? (s.row === e.row ? `row ${s.row}` : `rows ${s.row}–${e.row}`) : `from row ${s.row}, column ${s.column} to row ${e.row}, column ${e.column}`;
  return { rows, whole: start === 0x3c00 && end === 0x3fff, aligned };
}

function fill(c: Ctx, at: number): Pattern | undefined {
  const a = c.a;
  const { chain } = walkBack(a, at);
  const k = chain.findIndex((link) => link.ins.mnemonic === 'LD' && link.ins.operands[0]?.kind === 'ind' && link.ins.operands[0].reg === 'HL');
  if (k < 0) return undefined;
  const between = chain.slice(0, k).reverse();
  if (between.some((link) => fillStep(link.ins) === null)) return undefined;
  // DE = HL+1 by LD D,H / LD E,L / INC DE, whatever HL holds.
  let dh = false;
  let el = false;
  let next = false;
  for (const link of between) {
    const st = fillStep(link.ins);
    if (st === 'DH') [dh, next] = [true, false];
    else if (st === 'EL') [el, next] = [true, false];
    else if (st === 'INCDE') [next, dh, el] = [dh && el, false, false];
    else if (st === 'DE') [dh, el, next] = [false, false, false];
  }
  const regs = knownBefore(a, at).regs;
  const [hl, de, bc] = [pair(regs, 'HL'), pair(regs, 'DE'), pair(regs, 'BC')];
  if (!next && !(hl !== null && de !== null && de === ((hl + 1) & 0xffff))) return undefined;

  const store = chain[k]!;
  const src = store.ins.operands[1];
  let value: number | null = null;
  if (src?.kind === 'imm8') value = patchedBytes(a, store.at, store.ins).length === 0 ? src.value : null;
  else if (src?.kind === 'reg') value = knownBefore(a, store.at).regs[src.reg as Reg8Name] ?? null;
  const total = bc === null ? null : (bc === 0 ? 0x10000 : bc) + 1;

  const place: Piece[] = hl === null ? [{ text: 'the address in HL' }] : addrPhrase(c, hl);
  const what: Piece[] =
    value !== null ? [{ text: byte$(value) }] : [{ text: 'the byte stored by the line at ' }, addrPiece(c, store.at), { text: ', whose value the lines leading here do not prove' }];
  const sentences: Sentence[] = [
    say('Fills ', total === null ? 'BC + 1 bytes' : bytesText(total), ' from ', place, ' with ', what, ': the first byte is stored, then LDIR copies each byte to the next.'),
  ];
  if (hl !== null && total !== null && value !== null && hl >= 0x3c00 && hl + total - 1 <= 0x3fff) {
    const r = screenRange(hl, hl + total - 1);
    if (value === 0x20) sentences.push(say(r.whole ? 'This clears the screen.' : r.aligned ? `This clears ${r.rows} of the screen.` : `This clears part of the screen, ${r.rows}.`));
    else sentences.push(say(r.whole ? `This fills the screen with ${byte$(value)}.` : r.aligned ? `This fills ${r.rows} of the screen with ${byte$(value)}.` : `This fills part of the screen, ${r.rows}, with ${byte$(value)}.`));
  }
  const regsSet: Reg8Name[] = [...(hl === null ? [] : (['H', 'L'] as const)), ...(bc === null ? [] : (['B', 'C'] as const))];
  return { name: 'fill', from: Math.min(store.at, setupStart(c, at, regsSet)), to: at, sentences };
}

/** The label of a loop head as a link, or its address. */
const headPiece = (c: Ctx, head: number): Piece => ({ text: c.a.symbols.get(head)?.name ?? word$(head), addr: head });

function counted(c: Ctx, at: number, ins: Instruction, viewer: number): Pattern | undefined {
  const a = c.a;
  // A rewritten displacement leaves the loop's head unproven.
  if (patchedBytes(a, at, ins).length > 0) return undefined;
  const loop = djnzLoop(a, at);
  if (loop === null) return undefined;
  const head = headPiece(c, loop.head);
  const to: Piece[] = viewer === at ? [{ text: 'here' }] : [{ text: 'the DJNZ at ' }, addrPiece(c, at)];
  let sentence: Sentence;
  if (loop.count !== null) {
    const n = loop.count === 0 ? 256 : loop.count;
    sentence = say('Repeats the lines from ', head, ' to ', to, n === 1 ? ' once.' : n === 2 ? ' twice.' : ` ${decimal(n)} times.`);
  } else {
    const changesB = [...range(a, loop.head, at)].some((b) => b.ins.mnemonic === 'CALL' || b.ins.mnemonic === 'RST' || b.ins.mnemonic === 'EXX' || written(b.ins).includes('B'));
    if (!changesB && loopEntry(a, loop.head, at) !== null) {
      sentence = say('Repeats the lines from ', head, ' to ', to, ' B times, with B as it was on reaching ', head, '; the lines leading there do not prove its value.');
    } else {
      sentence = say('Repeats the lines from ', head, ' to ', to, ' until B counts down to zero; how many times is not proven.');
    }
  }
  return { name: 'counted-loop', from: loop.head, to: at, sentences: [sentence] };
}

/** The decoded instructions from `from` up to (not including) `end`, in address order; stops at a gap. */
function* range(a: Ctx['a'], from: number, end: number): Generator<{ at: number; ins: Instruction }> {
  for (let p = from; p < end; ) {
    const ins = a.pass1.instructions.get(p);
    if (ins === undefined) return;
    yield { at: p, ins };
    p += ins.length;
  }
}

const COUNTERS: Readonly<Record<string, [string, string]>> = { BC: ['B', 'C'], DE: ['D', 'E'], HL: ['H', 'L'] };

/** A delay body's counter: `DEC r`, or `DEC rr / LD A,hi / OR lo` (either half first). Null for any other delay body. */
function counterOf(body: Instruction[]): string | null {
  const [d, ld, or] = body;
  if (d === undefined || d.mnemonic !== 'DEC') return null;
  const reg = d.operands[0];
  if (body.length === 1 && reg?.kind === 'reg') return reg.reg;
  if (body.length !== 3 || reg?.kind !== 'reg16') return null;
  const halves = COUNTERS[reg.reg];
  if (halves === undefined || ld === undefined || or === undefined) return null;
  const x = ld.operands[1];
  const y = or.operands[0];
  if (x?.kind !== 'reg' || y?.kind !== 'reg') return null;
  const ok = (x.reg === halves[0] && y.reg === halves[1]) || (x.reg === halves[1] && y.reg === halves[0]);
  return ok ? reg.reg : null;
}

/** True for the instructions a delay body is made of: DEC of a register, LD A,r and OR r. */
function delayStep(ins: Instruction): boolean {
  const [d, s] = ins.operands;
  if (ins.mnemonic === 'DEC') return (d?.kind === 'reg' && d.reg !== 'I' && d.reg !== 'R') || (d?.kind === 'reg16' && d.reg in COUNTERS);
  if (ins.mnemonic === 'LD') return isReg(d, 'A') && s?.kind === 'reg' && s.reg !== 'I' && s.reg !== 'R';
  if (ins.mnemonic === 'OR') return d?.kind === 'reg' && ins.operands.length === 1;
  return false;
}

function wait(c: Ctx, at: number, ins: Instruction): Pattern | undefined {
  const a = c.a;
  if (patchedBytes(a, at, ins).length > 0) return undefined;
  let head: number;
  if (ins.mnemonic === 'DJNZ') {
    const rel = ins.operands.find((o) => o.kind === 'rel');
    // Only DJNZ to itself: anything in between makes it a counted loop.
    if (rel?.kind !== 'rel' || rel.target !== at) return undefined;
    head = at;
  } else {
    const cc = ins.operands[0];
    const t = ins.operands[1];
    if (cc?.kind !== 'cc' || cc.cond !== 'NZ') return undefined;
    if (t?.kind === 'rel') head = t.target;
    else if (t?.kind === 'imm16') head = t.value;
    else return undefined;
    if (head >= at) return undefined;
  }
  const body: Instruction[] = [];
  let reached = false;
  for (const b of range(a, head, at + 1)) {
    if (b.at === at) {
      reached = true;
      break;
    }
    if (!delayStep(b.ins) || body.length >= WAIT_MAX - 1) return undefined;
    body.push(b.ins);
  }
  if (!reached) return undefined;
  if (ins.mnemonic !== 'DJNZ' && !body.some((b) => b.mnemonic === 'DEC')) return undefined;

  const counter = ins.mnemonic === 'DJNZ' ? 'B' : counterOf(body);
  const span = { name: 'wait', from: head, to: at };
  if (counter === null) {
    return { ...span, sentences: [say('A delay loop: it only counts down and tests, writing no memory and using no ports, so all it does is spend time.')] };
  }
  const wide = counter.length === 2;
  const entry: RegState | null = loopEntry(a, head, at);
  const v = entry === null ? null : wide ? pair(entry, counter as 'BC' | 'DE' | 'HL') : entry[counter as Reg8Name];
  if (v === null) {
    return { ...span, sentences: [say(`A delay loop: it does nothing but count ${counter} down to zero; how long it takes depends on ${counter} on entry, which the lines leading here do not prove.`)] };
  }
  const n = v === 0 ? (wide ? 0x10000 : 0x100) : v;
  const perPass = body.reduce((t, b) => t + b.cycles, ins.cycles);
  const total = n * perPass - (ins.cycles - (ins.cyclesNotTaken ?? ins.cycles));
  const shown = wide ? word$(v) : byte$(v);
  return { ...span, sentences: [say(`A delay loop: it does nothing but count ${counter} down from ${shown} (${decimal(n)}) to zero, which takes ${decimal(total)} T-states.`)] };
}
