/**
 * What a line does for the program: the proven journey of the value it
 * handles. For a register the line writes, its next use in straight-line code
 * (a store to the screen, a port, a DJNZ count, a ROM routine that takes it);
 * for a register a store, OUT or test reads, the instruction that produced it.
 * Destinations get their TRS-80 meaning: a screen cell and the character it
 * shows, the keyboard matrix, port $FF, a named variable. The scans follow
 * only straight-line code (`straightFrom`) and stop at a branch, a join, a
 * call, unknown code and any write to the register; where the next use is
 * past one of those, the sentence says so instead of naming a destination.
 * No value is stated that the tracker does not prove, and a byte read from
 * memory is never given the value the image holds there.
 */
import type { Instruction, Operand } from '@fugloy/z80';
import { renderInstruction } from '../emit/operands.js';
import { dataReference } from '../analysis/symbols.js';
import { pair } from '../analysis/regs.js';
import type { Reg8Name, RegState } from '../analysis/regs.js';
import { trsGlyph } from './charset.js';
import { addrPhrase, addrPiece, andList, byte$, decimal, loaded, nameOf, portPhrase, routineKind, say, screenCell, tableName, word$ } from './machine.js';
import type { Ctx } from './machine.js';
import { exitsPhrase } from './patterns.js';
import type { LineCtx } from './phrase.js';
import { summarizeRoutine } from './routine.js';
import { djnzLoop, knownBefore, opcodeRewritten, patchedBytes, sourceRewritten, storesInto, straightFrom, walkBack, written } from './track.js';
import type { Piece, Sentence } from './types.js';
import { inputRegisters } from './why-register.js';

const REG8 = new Set(['A', 'B', 'C', 'D', 'E', 'H', 'L', 'IXH', 'IXL', 'IYH', 'IYL']);
const PAIRS = new Set(['BC', 'DE', 'HL', 'IX', 'IY']);
const tracked = (r: string): boolean => REG8.has(r) || PAIRS.has(r);

/** The one-byte halves a register name stands for. */
function halves(r: string): Reg8Name[] {
  if (r === 'IX') return ['IXH', 'IXL'];
  if (r === 'IY') return ['IYH', 'IYL'];
  if (r === 'AF') return ['A'];
  if (PAIRS.has(r)) return [r[0] as Reg8Name, r[1] as Reg8Name];
  return REG8.has(r) ? [r as Reg8Name] : [];
}

const meets = (p: readonly string[], q: readonly string[]): boolean => p.some((x) => q.includes(x));

/** A register's value in `regs`, or null. */
function valueIn(regs: RegState, r: string): number | null {
  if (REG8.has(r)) return regs[r as Reg8Name];
  if (PAIRS.has(r)) return pair(regs, r as 'BC' | 'DE' | 'HL' | 'IX' | 'IY');
  return null;
}

const show = (r: string, v: number): string => (PAIRS.has(r) ? word$(v) : byte$(v));

/** A line as the listing spells it, names and all. */
const spelled = (c: Ctx, ins: Instruction): string => renderInstruction(ins, c.a.symbols, c.a.externals);

const ALU = new Set(['ADD', 'ADC', 'SUB', 'SBC', 'AND', 'OR', 'XOR', 'CP']);
const SHIFTS = new Set(['RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SLL', 'SRL']);
const BLOCK = new Set(['LDI', 'LDD', 'LDIR', 'LDDR', 'CPI', 'CPD', 'CPIR', 'CPDR', 'INI', 'IND', 'INIR', 'INDR', 'OUTI', 'OUTD', 'OTIR', 'OTDR']);

/** The registers an operand reads: a register itself, or the register an address is held in. */
function operandReads(o: Operand | undefined): Reg8Name[] {
  if (o === undefined) return [];
  if (o.kind === 'reg' || o.kind === 'reg16') return halves(o.reg);
  if (o.kind === 'ind') return o.reg === 'C' ? ['C'] : halves(o.reg);
  if (o.kind === 'idx') return halves(o.reg);
  return [];
}

/** The registers only as the address of a memory operand (a destination still reads its pointer). */
const pointerReads = (o: Operand | undefined): Reg8Name[] => (o?.kind === 'ind' || o?.kind === 'idx' ? operandReads(o) : []);

/**
 * The registers an instruction reads for its result, or null when this does
 * not know (a call, which may read anything, and anything not listed). XOR A,
 * SUB A, SBC A,A and CP A read nothing: their result does not depend on A.
 */
function readsOf(ins: Instruction): Reg8Name[] | null {
  const m = ins.mnemonic;
  const ops = ins.operands;
  const [o0, o1] = ops;
  if (m === 'LD') return [...((o0?.kind === 'reg' || o0?.kind === 'reg16') ? [] : pointerReads(o0)), ...operandReads(o1)];
  if (ALU.has(m)) {
    const src = ops.length === 2 ? o1 : o0;
    if (o0?.kind === 'reg16') return [...operandReads(o0), ...operandReads(o1)];
    if (src?.kind === 'reg' && src.reg === 'A' && (m === 'XOR' || m === 'SUB' || m === 'SBC' || m === 'CP')) return [];
    return ['A', ...operandReads(src)];
  }
  if (m === 'INC' || m === 'DEC') return operandReads(o0);
  if (SHIFTS.has(m)) return operandReads(ops.find((o) => o.kind === 'ind' || o.kind === 'idx') ?? o0);
  if (m === 'BIT' || m === 'SET' || m === 'RES') return operandReads(ops.find((o) => o.kind === 'ind' || o.kind === 'idx') ?? o1);
  if (['RLCA', 'RRCA', 'RLA', 'RRA', 'CPL', 'NEG', 'DAA'].includes(m)) return ['A'];
  if (m === 'RLD' || m === 'RRD') return ['A', 'H', 'L'];
  if (m === 'DJNZ') return ['B'];
  if (m === 'PUSH' || m === 'EX') return [...operandReads(o0), ...operandReads(o1)];
  if (m === 'EXX') return ['B', 'C', 'D', 'E', 'H', 'L'];
  if (m === 'OUT') return [...operandReads(o0), ...operandReads(o1)];
  if (m === 'IN') return o1?.kind === 'ind' ? ['C'] : [];
  if (m === 'POP') return [];
  if (BLOCK.has(m)) return m.startsWith('CP') ? ['A', 'B', 'C', 'H', 'L'] : m.startsWith('LD') ? ['B', 'C', 'D', 'E', 'H', 'L'] : ['B', 'C', 'H', 'L'];
  if (m === 'JP' && ins.flow.indirect) return operandReads(o0);
  if (ins.flow.kind === 'jump' || ins.flow.kind === 'return' || ['NOP', 'HALT', 'DI', 'EI', 'IM', 'SCF', 'CCF'].includes(m)) return [];
  return null;
}

/** The phrases in a table `purpose` that name a register the routine hands back. */
const REG = '(A|B|C|D|E|H|L|BC|DE|HL|IX|IY)';
const OUTPUT: readonly RegExp[] = [new RegExp(`\\b${REG} returns\\b`, 'g'), new RegExp(`\\breturns? (?:[\\w'-]+ ){0,6}?in ${REG}\\b`, 'g'), new RegExp(`\\binto ${REG}\\b`, 'g')];

/** The registers a table entry's `purpose` says the routine returns ("A returns …", "return it in A", "into A"); nothing for a phrasing it does not know. */
export function outputRegisters(purpose: string): string[] {
  const found: { at: number; reg: string }[] = [];
  for (const re of OUTPUT) {
    re.lastIndex = 0;
    for (let m = re.exec(purpose); m !== null; m = re.exec(purpose)) found.push({ at: m.index, reg: m[1]! });
  }
  const regs: string[] = [];
  for (const f of found.sort((p, q) => p.at - q.at)) if (!regs.includes(f.reg)) regs.push(f.reg);
  return regs;
}

/** An unconditional call (CALL nn or RST) to a table routine outside the program, whose bytes the program does not rewrite. */
function tableCall(c: Ctx, at: number, ins: Instruction): { target: number; entry: NonNullable<ReturnType<typeof tableName>> } | undefined {
  if (ins.flow.kind !== 'call' || ins.flow.conditional || sourceRewritten(c.a, at)) return undefined;
  const op = ins.operands[0];
  const target = ins.mnemonic === 'RST' && op?.kind === 'rst' ? op.addr : ins.mnemonic === 'CALL' && op?.kind === 'imm16' ? op.value : undefined;
  if (target === undefined || c.a.symbols.has(target)) return undefined;
  const entry = tableName(c, target, 'code');
  return entry === undefined ? undefined : { target, entry };
}

/** `the ROM routine $KBWAIT ($0049)` */
function routinePieces(c: Ctx, call: NonNullable<ReturnType<typeof tableCall>>): Piece[] {
  return say(`${routineKind(call.entry.entry)} `, { text: call.entry.text, entry: call.entry.entry }, ' (', addrPiece(c, call.target), ')');
}

/** The register a line writes as its result, when the tracker follows it; for a call, the register its table entry says it returns. */
function destOf(c: LineCtx): string | undefined {
  const { ins } = c;
  const m = ins.mnemonic;
  const [o0] = ins.operands;
  const reg = (o: Operand | undefined): string | undefined => ((o?.kind === 'reg' || o?.kind === 'reg16') && tracked(o.reg) ? o.reg : undefined);
  if (m === 'LD' || m === 'IN' || m === 'POP' || m === 'INC' || m === 'DEC') return reg(o0);
  // OR A and AND A leave A as it was (they set the flags), so like CP they write no new value.
  const self = ins.operands.length === 1 ? o0 : ins.operands[1];
  if ((m === 'OR' || m === 'AND') && self?.kind === 'reg' && self.reg === 'A') return undefined;
  if (ALU.has(m)) return m === 'CP' ? undefined : o0?.kind === 'reg16' ? reg(o0) : 'A';
  if (SHIFTS.has(m)) return ins.operands.length === 1 ? reg(o0) : undefined;
  if (['RLCA', 'RRCA', 'RLA', 'RRA', 'CPL', 'NEG', 'DAA'].includes(m)) return 'A';
  if (ins.flow.kind === 'call') {
    const call = tableCall(c, c.addr, ins);
    return call === undefined ? undefined : outputRegisters(call.entry.entry.purpose).find(tracked);
  }
  return undefined;
}

const KEYS_LO = 0x3800;
const KEYS_HI = 0x3bff;

/** `the program also writes it at $7004`: the stores into a byte read, so it is not a constant. */
function writtenNote(c: Ctx, addrs: readonly number[], self: number): Piece[] {
  const w = [...new Set(addrs.flatMap((x) => storesInto(c.a, x)))].filter((x) => x !== self).sort((p, q) => p - q);
  if (w.length === 0) return [];
  const items = w.length <= 4 ? w.map((x) => [addrPiece(c, x)]) : [...w.slice(0, 3).map((x) => [addrPiece(c, x)]), [{ text: `${w.length - 3} more` }]];
  return [{ text: 'the program also writes it at ' }, ...andList(items, (p) => p)];
}

/**
 * What an address read means: `$3801 (KEYBOARD+0001H), the keyboard matrix, …`,
 * with the stores that make it a variable inside the parentheses, so a clause
 * that follows (`, set at $7000`) cannot be read as one of them:
 * `$65FB (DATA_65FB; the program also writes it at $4984)`.
 */
function readFrom(c: Ctx, addr: number, width: 1 | 2, self: number): Piece[] {
  const out: Piece[] = [...addrPhrase(c, addr)];
  const keys = addr >= KEYS_LO && addr <= KEYS_HI;
  if (keys) out.push({ text: ', the keyboard matrix, where a set bit is a key held down' });
  const note = writtenNote(c, width === 2 ? [addr, addr + 1] : [addr], self);
  if (note.length === 0) return out;
  const last = out[out.length - 1]!;
  if (!keys && out.length > 1 && last.text === ')' && last.addr === undefined && last.entry === undefined) out.splice(out.length - 1, 0, { text: '; ' }, ...note);
  else out.push({ text: ' (' }, ...note, { text: ')' });
  return out;
}

/**
 * Where the value an instruction writes into `r` comes from, as a noun:
 * `$58`, `the byte read from $5A20`, `the value copied from B ($08)`. `regs`
 * is what is proven just before it. Never a value read from memory, and no
 * number from bytes the program rewrites. Null when the value is just the
 * instruction's result (an add, a shift, an INC).
 */
function sourceOf(c: LineCtx, at: number, ins: Instruction, regs: RegState, r: string): Piece[] | null {
  const m = ins.mnemonic;
  const [, s] = ins.operands;
  const patched = patchedBytes(c.a, at, ins).length > 0;
  if (m === 'LD' && s !== undefined) {
    if (s.kind === 'imm8' || s.kind === 'imm16') {
      if (patched) return [{ text: 'the number in this instruction, which the program rewrites as it runs,' }];
      if (s.kind === 'imm16' && dataReference(ins) === s.value && nameOf(c, s.value, 'data') !== undefined) return addrPhrase(c, s.value);
      return [{ text: show(r, s.value) }];
    }
    const width = PAIRS.has(r) ? 2 : 1;
    const noun = width === 2 ? 'the two bytes read from ' : 'the byte read from ';
    if (s.kind === 'mem') return patched ? [{ text: `${width === 2 ? 'two bytes' : 'a byte'} read from memory (the program rewrites this instruction's address)` }] : [{ text: noun }, ...readFrom(c, s.addr, width, at)];
    if (s.kind === 'ind' && s.reg !== 'C' && s.reg !== 'SP') {
      const v = valueIn(regs, s.reg);
      return v === null ? [{ text: `the byte at the address in ${s.reg}` }] : [{ text: noun }, ...readFrom(c, v, 1, at)];
    }
    if (s.kind === 'idx') {
      // A displacement the program rewrites is only where it starts: no number for it.
      if (patched) return [{ text: `the byte at an offset from ${s.reg} that the program rewrites as it runs` }];
      const base = valueIn(regs, s.reg);
      return base === null ? [{ text: `the byte at ${s.reg}${s.disp < 0 ? '-' : '+'}${byte$(Math.abs(s.disp))}` }] : [{ text: noun }, ...readFrom(c, (base + s.disp) & 0xffff, 1, at)];
    }
    if (s.kind === 'reg' || s.kind === 'reg16') {
      const v = valueIn(regs, s.reg);
      return [{ text: v === null ? `the value copied from ${s.reg}` : `the value copied from ${s.reg} (${show(s.reg, v)})` }];
    }
  }
  if (m === 'IN') {
    const port = ins.operands[1];
    const n = port?.kind === 'port' ? (patched ? null : port.value & 0xff) : regs.C;
    return n === null ? [{ text: 'the byte read from a port' }] : [{ text: 'the byte read from ' }, ...portPhrase(c, n).pieces];
  }
  if (m === 'POP') return [{ text: 'the value taken off the stack' }];
  if (ins.flow.kind === 'call') {
    const call = tableCall(c, at, ins);
    const called: Piece[] = at === c.addr ? [] : [{ text: ', called at ' }, addrPiece(c, at), { text: ',' }];
    if (call !== undefined) return [{ text: 'what ' }, ...routinePieces(c, call), ...called, { text: ` returns in ${r}` }];
  }
  return null;
}

/**
 * `, where it shows as "X"`: what a byte put in screen memory draws as. Only
 * the Model III and 4 show $60-$7F as lowercase. A stock Model I has no bit 6
 * in video RAM (the hardware makes it from bits 5 and 7, so $61 shows as
 * "!"), and making capitals is the ROM driver's job, not the screen's; there,
 * as with no machine selected, $60-$7F are not named.
 */
function shows(c: Ctx, v: number | null): string {
  if (v === null) return '';
  const machine = c.s.selection?.machine;
  if (v >= 0x60 && v <= 0x7f && machine !== 3 && machine !== 4) return '';
  const g = trsGlyph(v);
  if (g.kind === 'text') return `, where it shows as "${g.char}"`;
  if (g.kind === 'block') return ', where it shows as a block graphic';
  return '';
}

/** The keys the Model I and III keyboard drivers return as control codes. */
const KEY_NAMES: Readonly<Record<number, string>> = { 0x01: 'BREAK', 0x08: 'left-arrow', 0x09: 'right-arrow', 0x0a: 'down-arrow', 0x0d: 'ENTER', 0x1f: 'CLEAR', 0x20: 'space bar', 0x5b: 'up-arrow' };

/** `$0D, the code of the ENTER key`, or `$41, the code of "A"`. */
function keyText(n: number): string {
  const name = KEY_NAMES[n];
  if (name !== undefined) return `${byte$(n)}, the code of the ${name} key`;
  return n > 0x20 && n < 0x7f ? `${byte$(n)}, the code of "${String.fromCharCode(n)}"` : byte$(n);
}

/** A routine whose table entry says it returns a key. */
const returnsKey = (purpose: string): boolean => /\bkey\b/.test(purpose);

/** For `CP n` after a key: `$0D, the code of the ENTER key`; '' for any other line. */
function keyTest(c: Ctx, ins: Instruction, at: number): string {
  const op = ins.operands[0];
  if (ins.mnemonic !== 'CP' || op?.kind !== 'imm8' || patchedBytes(c.a, at, ins).length > 0) return '';
  return keyText(op.value);
}

/** The sound note for port $FF: the cassette output is how TRS-80 programs make sound. */
const sound = (n: number): Sentence[] => (n === 0xff ? [say('Programs on the TRS-80 also make sound by switching the cassette output.')] : []);

/** The longest straight-line run a scan follows. */
const SCAN = 32;

/** `once`, `twice`, `8 times`, or `at most 8 times, leaving early at $7003`. */
function times(c: Ctx, loop: { count: number | null; exits: number[] }): Piece[] {
  const n = loop.count === 0 ? 256 : loop.count!;
  const count = n === 1 ? 'once' : n === 2 ? 'twice' : `${decimal(n)} times`;
  return loop.exits.length === 0 ? [{ text: count }] : [{ text: `at most ${count}, leaving early at ` }, ...exitsPhrase(c, loop.exits)];
}

/** A DJNZ loop whose head is `head` and whose count is proven, reached from straight-line code. */
function loopAt(c: Ctx, head: number): { djnz: number; loop: NonNullable<ReturnType<typeof djnzLoop>> } | undefined {
  for (const x of c.a.pass1.xrefs) {
    if (x.to !== head || c.a.pass1.instructions.get(x.from)?.mnemonic !== 'DJNZ') continue;
    const loop = djnzLoop(c.a, x.from);
    if (loop !== null && loop.head === head && loop.count !== null) return { djnz: x.from, loop };
  }
  return undefined;
}

/** The address a store at `at` writes into, when proven: (nn), or a pointer the tracker proves there. */
function storeAddr(c: Ctx, at: number, ins: Instruction, regs: RegState): number | null {
  const d = ins.operands[0];
  if (patchedBytes(c.a, at, ins).length > 0) return null;
  if (d?.kind === 'mem') return d.addr & 0xffff;
  if (d?.kind === 'ind' && (d.reg === 'HL' || d.reg === 'DE' || d.reg === 'BC')) return valueIn(regs, d.reg);
  if (d?.kind === 'idx') {
    const base = valueIn(regs, d.reg);
    return base === null ? null : (base + d.disp) & 0xffff;
  }
  return null;
}

/** The proven port of an OUT at `at`. */
function outPort(c: Ctx, at: number, ins: Instruction, regs: RegState): number | null {
  const p = ins.operands[0];
  if (p?.kind === 'port') return patchedBytes(c.a, at, ins).length > 0 ? null : p.value & 0xff;
  return regs.C;
}

/** `$3C45 (VIDEO+0045H, the screen, row 1, column 5)` and where it shows, or a named variable. */
function destPieces(c: Ctx, addr: number, v: number | null): { pieces: Piece[]; tail: string } {
  return { pieces: addrPhrase(c, addr), tail: screenCell(addr) === null ? '' : shows(c, v) };
}

/** What the next use does with the value: `its next use is the INC A at $7003`, with the address it points at when that is how it is used. */
function useClause(c: Ctx, r: string, at: number, ins: Instruction, regs: RegState): Piece[] {
  const d = ins.operands[0];
  const asPointer = (d?.kind === 'ind' || d?.kind === 'idx') && meets(pointerReads(d), halves(r)) && PAIRS.has(r);
  const v = valueIn(regs, r);
  const via = asPointer && v !== null && d?.kind === 'ind' ? [{ text: ', which uses it as the address ' }, ...addrPhrase(c, v)] : [];
  return [{ text: `its next use is the ${spelled(c, ins)} at ` }, addrPiece(c, at), ...via];
}

/**
 * The sentences for a register the line writes: where its value goes next in
 * straight-line code, or why its next use is not certain.
 */
function forward(c: LineCtx, r: string): Sentence[] {
  const a = c.a;
  const mine = halves(r);
  const src = sourceOf(c, c.addr, c.ins, c.regs, r);
  // Just a result: its value, when the tracker proves it after the line.
  const after = (): string => {
    const next = (c.addr + c.ins.length) & 0xffff;
    const v = straightFrom(a, next) === c.addr && !opcodeRewritten(a, next) ? valueIn(knownBefore(a, next).regs, r) : null;
    return v === null ? '' : ` (${show(r, v)})`;
  };
  const value = src === null ? after() : '';
  const noun: Piece[] = src ?? [{ text: `the result${value}` }];
  const subject = (verb: string): Piece[] => [{ text: `${r} ${verb} ` }, ...noun];
  // A bare "the result" with no proven value and no proven next use says nothing.
  const unsure = (...why: Piece[]): Sentence[] => (src === null && value === '' ? [] : [say(subject('holds'), '; its next use is not certain: ', why, '.')]);
  let cur = c.addr;
  let ins = c.ins;
  for (let k = 0; k < SCAN; k++) {
    const at = (cur + ins.length) & 0xffff;
    const next = a.pass1.instructions.get(at);
    if (next === undefined) return unsure({ text: 'the bytes at ' }, addrPiece(c, at), { text: ' are not decoded as code' });
    if (opcodeRewritten(a, at)) return unsure({ text: 'the program rewrites the instruction at ' }, addrPiece(c, at));
    const fromCall = k === 0 && c.ins.flow.kind === 'call';
    if (straightFrom(a, at) !== cur) {
      // After the line's own call: only the call leads to the next line (no join, label or entry point).
      const w = fromCall ? walkBack(a, at) : undefined;
      if (w === undefined || w.stop !== 'call' || w.pred !== cur || w.at !== at) {
        const head = mine.includes('B') ? loopAt(c, at) : undefined;
        if (head !== undefined) {
          return [say(`B holds ${byte$(head.loop.count!)} as the count for the DJNZ at `, addrPiece(c, head.djnz), ': the loop from ', addrPiece(c, at), ' runs ', times(c, head.loop), '.')];
        }
        return unsure({ text: 'other code also arrives at ' }, addrPiece(c, at));
      }
    }
    const regs = (): RegState => knownBefore(a, at).regs;
    if (next.flow.kind === 'call') {
      const call = tableCall(c, at, next);
      if (call !== undefined && inputRegisters(call.entry.entry.purpose).some((x) => meets(halves(x), mine))) {
        // why-register says why the register is loaded and what the routine does; this says what goes in.
        return [say(subject('holds'), '; it goes into the call at ', addrPiece(c, at), ' to ', routinePieces(c, call), '.')];
      }
      return unsure({ text: 'the call at ' }, addrPiece(c, at), { text: ' may use or change it' });
    }
    const reads = readsOf(next);
    if (reads === null) return [];
    if (meets(reads, mine)) {
      const [d, s] = next.operands;
      const value = (): number | null => valueIn(regs(), r);
      if (next.mnemonic === 'LD' && (s?.kind === 'reg' || s?.kind === 'reg16') && s.reg === r && d !== undefined && d.kind !== 'reg' && d.kind !== 'reg16') {
        const addr = storeAddr(c, at, next, regs());
        if (addr !== null) {
          const dest = destPieces(c, addr, PAIRS.has(r) ? null : value());
          return [say(subject('carries'), ' to ', dest.pieces, ': the ', spelled(c, next), ' at ', addrPiece(c, at), ` stores it there${dest.tail}.`)];
        }
      }
      if (next.mnemonic === 'OUT' && r === (next.operands[1]?.kind === 'reg' ? next.operands[1].reg : '')) {
        const n = outPort(c, at, next, regs());
        if (n !== null) return [say(subject('carries'), ' to ', portPhrase(c, n).pieces, ': the ', spelled(c, next), ' at ', addrPiece(c, at), ' sends it there.'), ...sound(n)];
      }
      if (next.mnemonic === 'DJNZ') {
        const loop = djnzLoop(a, at);
        if (loop !== null && loop.count !== null) return [say(`B holds ${byte$(loop.count)} as the count for the DJNZ at `, addrPiece(c, at), ': the loop from ', addrPiece(c, loop.head), ' runs ', times(c, loop), '.')];
      }
      const key = c.ins.flow.kind === 'call' && returnsKey(tableCall(c, c.addr, c.ins)!.entry.entry.purpose) && r === 'A' ? keyTest(c, next, at) : '';
      if (key !== '') return [say(subject('holds'), `; the ${spelled(c, next)} at `, addrPiece(c, at), ` tests it for ${key}.`)];
      return [say(subject('holds'), '; ', useClause(c, r, at, next, regs()), '.')];
    }
    const w = written(next);
    if (meets(w, mine)) return [];
    const f = next.flow;
    if (f.kind !== 'next') {
      if (f.conditional) return unsure({ text: 'the code branches at ' }, addrPiece(c, at));
      if (f.kind === 'return') return unsure({ text: 'the code returns at ' }, addrPiece(c, at));
      if (f.kind === 'jump') return unsure({ text: 'the code jumps away at ' }, addrPiece(c, at));
      return [];
    }
    cur = at;
    ins = next;
  }
  return [];
}

/**
 * The instruction that produced the value of `r` the line reads, from the
 * straight-line code before it, with where it came from; or the table routine
 * called just before, when its entry says it returns `r`.
 */
function producer(c: LineCtx, r: string): { src: Piece[]; at: number; call?: NonNullable<ReturnType<typeof tableCall>>; own?: true } | undefined {
  const a = c.a;
  const mine = halves(r);
  const w = walkBack(a, c.addr);
  for (const link of w.chain) {
    if (opcodeRewritten(a, link.at)) return undefined;
    const wr = written(link.ins);
    if (!meets(wr, mine)) continue;
    // OR A and AND A leave A's value as it was: its producer is further back.
    if (r === 'A' && destOf({ ...c, addr: link.at, ins: link.ins }) === undefined && (link.ins.mnemonic === 'OR' || link.ins.mnemonic === 'AND')) continue;
    // A pair built from two loads, or a write the line does not name: no single producer.
    if (!mine.every((h) => wr.includes(h)) || destOf({ ...c, addr: link.at, ins: link.ins }) !== r) return undefined;
    const src = sourceOf(c, link.at, link.ins, knownBefore(a, link.at).regs, r);
    return src === null ? { src: [{ text: `the result of the ${spelled(c, link.ins)} at ` }, addrPiece(c, link.at)], at: link.at, own: true } : { src, at: link.at };
  }
  // The chain between the call and the line does not write `r` (checked above), so what the call returns reaches the line.
  if (w.stop !== 'call' || w.pred === undefined) return undefined;
  const callIns = a.pass1.instructions.get(w.pred)!;
  const call = tableCall(c, w.pred, callIns);
  if (call === undefined || !outputRegisters(call.entry.entry.purpose).includes(r)) return undefined;
  const src = sourceOf(c, w.pred, callIns, knownBefore(a, w.pred).regs, r);
  return src === null ? undefined : { src, at: w.pred, call };
}

/** The sentences for a register the line reads: a store's, an OUT's or a test's value and where it came from. */
function backward(c: LineCtx): Sentence[] {
  const { ins } = c;
  const m = ins.mnemonic;
  const [d, s] = ins.operands;
  // `the byte read from $5A20, set at $7000,` in the middle of a sentence; without the last comma at its end.
  const from = (p: NonNullable<ReturnType<typeof producer>>, mid = true): Piece[] => (p.call !== undefined || p.own ? p.src : [...p.src, { text: ', set at ' }, addrPiece(c, p.at), ...(mid ? [{ text: ',' }] : [])]);
  if (m === 'LD' && (s?.kind === 'reg' || s?.kind === 'reg16') && tracked(s.reg) && d !== undefined && d.kind !== 'reg' && d.kind !== 'reg16') {
    const addr = storeAddr(c, c.addr, ins, c.regs);
    const p = addr === null ? undefined : producer(c, s.reg);
    if (addr === null || p === undefined) return [];
    const cell = screenCell(addr);
    if (cell !== null) {
      const tail = PAIRS.has(s.reg) ? '' : shows(c, valueIn(c.regs, s.reg));
      return [say(`${s.reg} carries `, from(p), ` to the screen here, at row ${cell.row}, column ${cell.column}${tail}.`)];
    }
    if (!loaded(c, addr) && nameOf(c, addr, 'data') === undefined) return [];
    return [say(`${s.reg} carries `, from(p), ' to ', addrPhrase(c, addr), ' here.')];
  }
  if (m === 'OUT' && s?.kind === 'reg' && tracked(s.reg)) {
    const n = outPort(c, c.addr, ins, c.regs);
    const p = n === null ? undefined : producer(c, s.reg);
    if (n === null || p === undefined) return [];
    return [say(`${s.reg} carries `, from(p), ' to ', portPhrase(c, n).pieces, ' here.'), ...sound(n)];
  }
  if (m === 'CP' && !(d?.kind === 'reg' && d.reg === 'A')) {
    const p = producer(c, 'A');
    // A value that is only some earlier instruction's result (an add, an INC) adds nothing to the lead.
    if (p === undefined || p.own) return [];
    const key = p.call !== undefined && returnsKey(p.call.entry.entry.purpose) ? keyTest(c, ins, c.addr) : '';
    return [say('A holds ', from(p, false), key === '' ? '.' : `, and this ${spelled(c, ins)} tests it for ${key}.`)];
  }
  if (m === 'DJNZ') return djnzCount(c);
  return [];
}

/** The DJNZ line: the count its loop runs, and where B was set. */
function djnzCount(c: LineCtx): Sentence[] {
  const loop = djnzLoop(c.a, c.addr);
  if (loop === null || loop.count === null) return [];
  const w = walkBack(c.a, loop.head);
  let set: number | undefined;
  if (w.pred !== undefined) {
    const pred = { at: w.pred, ins: c.a.pass1.instructions.get(w.pred)! };
    for (const link of [pred, ...walkBack(c.a, w.pred).chain]) {
      if (opcodeRewritten(c.a, link.at)) break;
      if (written(link.ins).includes('B')) {
        set = link.at;
        break;
      }
    }
  }
  const where = set === undefined ? [] : [{ text: ' (set at ' }, addrPiece(c, set), { text: ')' }];
  return [say(`B holds ${byte$(loop.count)} when the loop from `, addrPiece(c, loop.head), ' is entered', where, ', so it runs ', times(c, loop), '.')];
}

/** `It is part of the routine at $6140, which writes to the screen.`, when the summary finds the screen, keyboard or a port. */
export function routineWhy(c: LineCtx): Sentence[] {
  if (opcodeRewritten(c.a, c.addr)) return [];
  const r = summarizeRoutine(c.s, c.addr);
  if (r === null || r.start === c.addr) return [];
  const t = r.touches;
  const facts: string[] = [
    ...(t.screen ? ['writes to the screen'] : []),
    ...(t.keyboard ? ['reads the keyboard'] : []),
    ...t.portsOut.map((n) => `writes to port ${byte$(n)}`),
    ...t.portsIn.map((n) => `reads from port ${byte$(n)}`),
  ];
  if (facts.length === 0) return [];
  const name: Piece[] = c.a.symbols.has(r.start) ? [{ text: 'the routine ' }, { text: r.name, addr: r.start }, { text: ` (${word$(r.start)})` }] : [{ text: 'the routine at ' }, addrPiece(c, r.start)];
  return [say('It is part of ', name, ', which ', andList(facts, (f) => [{ text: f }]), '.')];
}

/** The "what it does here" sentences for a code line. */
export function purposeWhy(c: LineCtx): Sentence[] {
  // An instruction the program may turn into another one is not proven to be this form.
  if (opcodeRewritten(c.a, c.addr)) return [];
  const dest = destOf(c);
  return dest !== undefined && c.ins.mnemonic !== 'DJNZ' ? forward(c, dest) : backward(c);
}
