/**
 * Why a line is written the way it is: the common Z80 idioms (XOR A to clear
 * A, OR A to test it, a counted DJNZ loop, PUSH AF and POP AF around a call,
 * RST as a one-byte call, LDIR for a block copy and the rest), each with the
 * cost comparison that makes it the usual choice. Every number comes from
 * @fugloy/z80: the alternative is written as bytes and decoded at run time,
 * never typed into the prose. The sentences give the usual reason for the
 * form, never a claim about what this programmer had in mind.
 */
import { decodeAt, formatOperand } from '@fugloy/z80';
import type { Instruction, Operand } from '@fugloy/z80';
import { addrPiece, say } from './machine.js';
import type { LineCtx } from './phrase.js';
import { djnzLoop, opcodeRewritten, straightFrom, walkBack, written } from './track.js';
import type { Sentence } from './types.js';

/** What a run of instructions costs: bytes, T-states (the taken path of a conditional), and T-states when it is not taken. */
interface Cost {
  bytes: number;
  cycles: number;
  notTaken: number;
  /** The flags any of the instructions changes, SZHPNC order. */
  flags: string;
  ins: Instruction[];
}

/** Decodes `bytes` as consecutive instructions with @fugloy/z80 and adds up what they cost. */
function costOf(bytes: readonly number[]): Cost {
  const ins: Instruction[] = [];
  for (let at = 0; at < bytes.length; ) {
    const i = decodeAt(bytes, at, 0);
    if (i.truncated) throw new RangeError(`costOf: truncated instruction at offset ${at}`);
    ins.push(i);
    at += i.length;
  }
  const flags = 'SZHPNC'
    .split('')
    .filter((f) => ins.some((i) => i.flags.includes(f)))
    .join('');
  return {
    bytes: ins.reduce((n, i) => n + i.length, 0),
    cycles: ins.reduce((n, i) => n + i.cycles, 0),
    notTaken: ins.reduce((n, i) => n + (i.cyclesNotTaken ?? i.cycles), 0),
    flags,
    ins,
  };
}

/** The line's own cost, from its decoded instruction. */
const own = (ins: Instruction): Cost => ({ bytes: ins.length, cycles: ins.cycles, notTaken: ins.cyclesNotTaken ?? ins.cycles, flags: ins.flags, ins: [ins] });

const bytesText = (n: number): string => `${n} ${n === 1 ? 'byte' : 'bytes'}`;
/** `1 byte and 4 T-states` */
const costText = (k: Cost): string => `${bytesText(k.bytes)} and ${k.cycles} T-states`;
/** `1 byte and 4 T-states against 2 bytes and 7`, or `the same 2 bytes and 7 T-states`. */
function against(mine: Cost, alt: Cost): string {
  if (mine.bytes === alt.bytes && mine.cycles === alt.cycles) return `the same ${costText(mine)}`;
  return `${costText(mine)} against ${bytesText(alt.bytes)} and ${alt.cycles}`;
}

/** An alternative's instructions as the reader would write them: `LD A,00H`, `JR NZ`, `LD (nn),A`. */
function nameOf(i: Instruction): string {
  const ops = i.operands.filter((o) => o.kind !== 'rel').map((o) => (o.kind === 'mem' ? '(nn)' : formatOperand(o)));
  return ops.length === 0 ? i.mnemonic : `${i.mnemonic} ${ops.join(',')}`;
}
/** `LD A,(HL), INC A and LD (HL),A` */
function names(k: Cost): string {
  const n = k.ins.map(nameOf);
  return n.length === 1 ? n[0]! : `${n.slice(0, -1).join(', ')} and ${n.at(-1)}`;
}

const FLAG_NAME: Readonly<Record<string, string>> = { S: 'S', Z: 'Z', H: 'H', P: 'P/V', N: 'N', C: 'C' };
/** `S, Z and P/V`: the flags in `of` that are not in `but`. */
function flagsOnly(of: string, but: string): string {
  const f = of
    .split('')
    .filter((x) => !but.includes(x))
    .map((x) => FLAG_NAME[x]!);
  if (f.length === 0) return '';
  return f.length === 1 ? f[0]! : `${f.slice(0, -1).join(', ')} and ${f.at(-1)}`;
}

const isReg = (o: Operand | undefined, r: string): boolean => o?.kind === 'reg' && o.reg === r;
const isPair = (o: Operand | undefined, r: string): boolean => o?.kind === 'reg16' && o.reg === r;

/** The bytes of an operand slot the 8-bit instructions share (B C D E H L (HL) A as 0..7), with its prefix and displacement when it is (IX+d) or (IY+d). */
interface Slot {
  code: number;
  prefix: number[];
  disp: number[];
}
const CODES = ['B', 'C', 'D', 'E', 'H', 'L', '(HL)', 'A'];
function slotOf(o: Operand | undefined): Slot | undefined {
  if (o?.kind === 'reg') {
    const code = CODES.indexOf(o.reg);
    return code < 0 ? undefined : { code, prefix: [], disp: [] };
  }
  if (o?.kind === 'ind' && o.reg === 'HL') return { code: 6, prefix: [], disp: [] };
  if (o?.kind === 'idx') return { code: 6, prefix: [o.reg === 'IX' ? 0xdd : 0xfd], disp: [o.disp & 0xff] };
  return undefined;
}
/** `LD A,s` and `LD s,A` as bytes (none when s is A itself). */
const loadA = (s: Slot): number[] => (s.code === 7 ? [] : [...s.prefix, 0x78 | s.code, ...s.disp]);
const storeA = (s: Slot): number[] => (s.code === 7 ? [] : [...s.prefix, 0x47 | (s.code << 3), ...s.disp]);

/** The instruction one straight-line step after `cur` (`straightFrom`), unless the program may rewrite its opcode. With `overCall`, a CALL or RST is stepped over to the line it returns to. */
function stepFrom(c: LineCtx, cur: number, ins: Instruction, overCall = false): { at: number; ins: Instruction } | null {
  const a = c.a;
  const at = (cur + ins.length) & 0xffff;
  const next = a.pass1.instructions.get(at);
  if (next === undefined || opcodeRewritten(a, at)) return null;
  if (straightFrom(a, at) === cur) return { at, ins: next };
  if (overCall && ins.flow.kind === 'call') {
    // Nothing but the call leads here: no join, label or entry point (walkBack checks those before the call).
    const w = walkBack(a, at);
    if (w.stop === 'call' && w.pred === cur && w.at === at) return { at, ins: next };
  }
  return null;
}

/** The longest straight-line run a scan follows. */
const SCAN = 32;

const zeroA = (c: LineCtx, m: string): Sentence[] => {
  const mine = own(c.ins);
  const alt = costOf([0x3e, 0x00]);
  return [
    say(
      `Programmers write ${m} A rather than ${names(alt)} to set A to zero because it is ${against(mine, alt)}; it also sets the Z flag and clears the carry, where ${names(alt)} leaves the flags as they were.`,
    ),
  ];
};

function testA(c: LineCtx): Sentence[] {
  const m = c.ins.mnemonic;
  const mine = own(c.ins);
  const alt = costOf([0xfe, 0x00]);
  const out = [
    say(
      `${m} A leaves A as it is but sets the flags from it: Z when A is zero, S from its top bit, and the carry always cleared. It is the usual way to test A for zero, or to clear the carry, in ${against(mine, alt)} for ${names(alt)}, which tests for zero the same way.`,
    ),
  ];
  const next = stepFrom(c, c.addr, c.ins);
  if (next !== null && next.ins.mnemonic === 'SBC' && isPair(next.ins.operands[0], 'HL')) {
    out.push(
      say(
        `The next line, at `,
        addrPiece(c, next.at),
        `, is ${nameOf(next.ins)}: the Z80 has no 16-bit subtract that leaves the carry out, so clearing the carry first is the usual way to make SBC a plain subtract.`,
      ),
    );
  }
  return out;
}

/** CP is SUB that keeps A: the same instruction with SUB's opcode. */
function compare(c: LineCtx): Sentence[] {
  // A rewritten operand (CP n whose n the program stores over) would put a number in the sentence that is only where it starts.
  if (c.patched.length > 0) return [];
  const b = [...c.ins.bytes];
  const i = b[0] === 0xdd || b[0] === 0xfd ? 1 : 0;
  const op = b[i]!;
  if (op === 0xfe) b[i] = 0xd6;
  else if (op >= 0xb8 && op <= 0xbf) b[i] = op - 0x28;
  else return [];
  const alt = costOf(b);
  if (alt.ins.length !== 1 || alt.ins[0]!.mnemonic !== 'SUB') return [];
  return [say(`${nameOf(c.ins)} subtracts to set the flags, exactly as ${nameOf(alt.ins[0]!)} would, but throws the result away and leaves A unchanged, so A can be tested again; it costs ${against(own(c.ins), alt)}.`)];
}

/** `LD B,n` that sets the count of a DJNZ loop starting in straight-line code after it. */
function countedLoop(c: LineCtx): Sentence[] {
  const [d, n] = c.ins.operands;
  if (c.ins.mnemonic !== 'LD' || !isReg(d, 'B') || n?.kind !== 'imm8' || c.patched.length > 0) return [];
  const a = c.a;
  let cur = c.addr;
  let ins = c.ins;
  for (let k = 0; k < SCAN; k++) {
    const head = (cur + ins.length) & 0xffff;
    for (const x of a.pass1.xrefs) {
      if (x.to !== head || a.pass1.instructions.get(x.from)?.mnemonic !== 'DJNZ') continue;
      const loop = djnzLoop(a, x.from);
      if (loop === null || loop.count !== n.value) continue;
      const djnz = a.pass1.instructions.get(x.from)!;
      const alt = costOf([0x05, 0x20, 0xfe]);
      return [
        say(
          `${nameOf(c.ins)} with the DJNZ at `,
          addrPiece(c, x.from),
          ` is the Z80's counted loop: B holds the count, and DJNZ takes 1 from it and jumps back in ${bytesText(djnz.length)} and ${djnz.cycles} T-states (${djnz.cyclesNotTaken} when it falls out), against ${bytesText(alt.bytes)} and ${alt.cycles} (${alt.notTaken}) for ${names(alt)}.`,
        ),
      ];
    }
    const next = stepFrom(c, cur, ins);
    if (next === null || next.ins.flow.kind !== 'next' || written(next.ins).includes('B')) return [];
    cur = next.at;
    ins = next.ins;
  }
  return [];
}

function djnz(c: LineCtx): Sentence[] {
  const rel = c.ins.operands[0];
  if (rel?.kind !== 'rel' || rel.target > c.addr) return [];
  const alt = costOf([0x05, 0x20, 0xfe]);
  const mine = own(c.ins);
  const flags = mine.flags === '' && alt.flags !== '' ? `, and it leaves the flags alone where DEC B changes ${flagsOnly(alt.flags, '')}` : '';
  return [
    say(
      `Programmers write DJNZ rather than ${names(alt)} to close a counted loop because it is ${bytesText(mine.bytes)} and ${mine.cycles} T-states when it jumps back (${mine.notTaken} when it falls out), against ${bytesText(alt.bytes)} and ${alt.cycles} (${alt.notTaken})${flags}.`,
    ),
  ];
}

function double(c: LineCtx): Sentence[] {
  const [d, s] = c.ins.operands;
  if (isReg(d, 'A') && isReg(s, 'A')) {
    const alt = costOf([0xcb, 0x27]);
    return [say(`ADD A,A adds A to itself, doubling it: the Z80 has no multiply, and this is the usual quick way to multiply by two, ${against(own(c.ins), alt)} for ${names(alt)}, which shifts A left the same way.`)];
  }
  if (isPair(d, 'HL') && isPair(s, 'HL')) {
    const alt = costOf([0xcb, 0x25, 0xcb, 0x14]);
    return [say(`ADD HL,HL adds HL to itself, doubling it: the Z80 has no multiply, and this is the usual way to multiply a 16-bit number by two, ${against(own(c.ins), alt)} for ${names(alt)}.`)];
  }
  return [];
}

/** SLA and SRL: doubling and halving by shifting, and what the same takes through A. */
function shift(c: LineCtx): Sentence[] {
  const m = c.ins.mnemonic;
  const op = c.ins.operands.at(-1);
  const s = slotOf(op);
  if (s === undefined || !c.ins.documented || c.patched.length > 0) return [];
  const mine = own(c.ins);
  if (m === 'SLA') {
    const lead = 'SLA shifts every bit left, which doubles an unsigned byte (the top bit goes into the carry): the Z80 has no multiply, so shifting is the usual way to multiply by two.';
    if (s.code === 7) {
      const alt = costOf([0x87]);
      return [say(`${lead} For A, ${names(alt)} does the same in ${against(alt, mine)}.`)];
    }
    const alt = costOf([...loadA(s), 0x87, ...storeA(s)]);
    return [say(`${lead} Doing it through A instead (${names(alt)}) would take ${bytesText(alt.bytes)} and ${alt.cycles} T-states against ${bytesText(mine.bytes)} and ${mine.cycles}, and would change A.`)];
  }
  const lead = 'SRL shifts every bit right, which halves an unsigned byte, the low bit (the remainder) going into the carry: the Z80 has no divide, so shifting is the usual way to divide by two.';
  const alt = costOf([...loadA(s), 0xb7, 0x1f, ...storeA(s)]);
  const via = s.code === 7 ? `For A, clearing the carry and rotating (${names(alt)}) gives the same value in ${against(alt, mine)}, but only SRL works on the other registers` : `Doing it through A instead (${names(alt)}) would take ${bytesText(alt.bytes)} and ${alt.cycles} T-states against ${bytesText(mine.bytes)} and ${mine.cycles}, and would change A`;
  return [say(`${lead} ${via}.`)];
}

/** RLCA, RRCA, RLA, RRA: the one-byte forms of RLC A, RRC A, RL A, RR A. */
const LONG: Readonly<Record<string, number>> = { RLCA: 0x07, RRCA: 0x0f, RLA: 0x17, RRA: 0x1f };
function rotateA(c: LineCtx): Sentence[] {
  const m = c.ins.mnemonic;
  const alt = costOf([0xcb, LONG[m]!]);
  const mine = own(c.ins);
  const kept = flagsOnly(alt.flags, mine.flags);
  const carry = m === 'RLA' || m === 'RRA' ? ` Rotating through the carry passes a bit from one byte into the next, the usual way to shift a number longer than one byte.` : '';
  return [say(`${m} is the short form of ${names(alt)}: ${against(mine, alt)}, and it leaves ${kept} alone, where ${names(alt)} sets them.${carry}`)];
}

/** INC (HL), DEC (HL) and the (IX+d) forms: a counter kept in memory. */
function inPlace(c: LineCtx): Sentence[] {
  const s = slotOf(c.ins.operands[0]);
  if (s === undefined || s.code !== 6 || c.patched.length > 0) return [];
  const inc = c.ins.mnemonic === 'INC';
  const alt = costOf([...loadA(s), inc ? 0x3c : 0x3d, ...storeA(s)]);
  return [
    say(
      `${nameOf(c.ins)} ${inc ? 'adds 1 to' : 'takes 1 from'} the byte in memory where it is, the usual way to keep a counter in memory: ${against(own(c.ins), alt)} for ${names(alt)}, which would also change A.`,
    ),
  ];
}

/** Changes the stack pointer or what is on the stack (CALL and RST excepted: they return to the next line with it as it was). */
function touchesStack(ins: Instruction): boolean {
  const m = ins.mnemonic;
  if (m === 'PUSH' || m === 'POP') return true;
  if (m === 'EX' && ins.operands[0]?.kind === 'ind' && ins.operands[0].reg === 'SP') return true;
  return (m === 'LD' || m === 'INC' || m === 'DEC') && isPair(ins.operands[0], 'SP');
}

/** PUSH AF, a call, then POP AF in straight-line code. */
function keepAF(c: LineCtx): Sentence[] {
  if (!isPair(c.ins.operands[0], 'AF')) return [];
  let cur = c.addr;
  let ins = c.ins;
  let call: number | undefined;
  for (let k = 0; k < SCAN; k++) {
    const next = stepFrom(c, cur, ins, true);
    if (next === null) return [];
    if (next.ins.mnemonic === 'POP') {
      if (!isPair(next.ins.operands[0], 'AF') || call === undefined) return [];
      const alt = costOf([0x32, 0x00, 0x00, 0x3a, 0x00, 0x00]);
      const pop = next.ins;
      return [
        say(
          'PUSH AF here, with the POP AF at ',
          addrPiece(c, next.at),
          ' after the call at ',
          addrPiece(c, call),
          `, is the usual way to keep A and the flags across a call: the stack holds them while the routine runs, ${bytesText(c.ins.length + pop.length)} and ${c.ins.cycles + pop.cycles} T-states in all. Keeping A at a fixed address instead (${names(alt)}) would take ${bytesText(alt.bytes)} and ${alt.cycles} T-states, and would not keep the flags.`,
        ),
      ];
    }
    const f = next.ins.flow.kind;
    if ((f !== 'next' && f !== 'call') || touchesStack(next.ins)) return [];
    if (f === 'call' && call === undefined) call = next.at;
    cur = next.at;
    ins = next.ins;
  }
  return [];
}

function exAF(c: LineCtx): Sentence[] {
  const alt = costOf([0xf5, 0xf1]);
  return [
    say(
      `EX AF,AF' swaps A and the flags with the spare pair, A' and F', in ${costText(own(c.ins))}: a quick way to set A and the flags aside without the stack, where ${names(alt)} would take ${bytesText(alt.bytes)} and ${alt.cycles} T-states.`,
    ),
  ];
}

function rst(c: LineCtx): Sentence[] {
  const op = c.ins.operands[0];
  if (op?.kind !== 'rst') return [];
  const alt = costOf([0xcd, op.addr & 0xff, op.addr >> 8]);
  return [
    say(
      `${nameOf(c.ins)} calls `,
      addrPiece(c, op.addr),
      ` in ${against(own(c.ins), alt)} for ${nameOf(alt.ins[0]!)}. The Z80 has eight of these one-byte calls, to `,
      addrPiece(c, 0x00),
      ', ',
      addrPiece(c, 0x08),
      ' and so on up to ',
      addrPiece(c, 0x38),
      ', so they are usually kept for the routines called most often.',
    ),
  ];
}

/** `LD r,(HL)` then `INC HL` (or `DEC HL`): walking a table. */
function walkTable(c: LineCtx): Sentence[] {
  const [d, s] = c.ins.operands;
  if (d?.kind !== 'reg' || s?.kind !== 'ind' || s.reg !== 'HL') return [];
  const code = CODES.indexOf(d.reg);
  if (code < 0 || code === 4 || code === 5) return [];
  const next = stepFrom(c, c.addr, c.ins);
  if (next === null || (next.ins.mnemonic !== 'INC' && next.ins.mnemonic !== 'DEC') || !isPair(next.ins.operands[0], 'HL')) return [];
  const inc = next.ins.mnemonic === 'INC';
  const alt = costOf([0xdd, 0x46 | (code << 3), 0x00, 0xdd, inc ? 0x23 : 0x2b]);
  const mine = costOf([...c.ins.bytes, ...next.ins.bytes]);
  // For A, BC and DE serve as well: LD A,(DE) and INC DE cost what LD A,(HL) and INC HL do.
  const viaDE = code === 7 ? costOf([0x1a, inc ? 0x13 : 0x1b]) : undefined;
  const cheap =
    viaDE !== undefined && viaDE.bytes === mine.bytes && viaDE.cycles === mine.cycles
      ? `HL is as cheap as any pointer for it (${names(viaDE)} cost the same), ${against(mine, alt)} for ${names(alt)}`
      : `HL is the cheapest pointer for it, ${against(mine, alt)} for ${names(alt)}`;
  return [
    say(
      `${nameOf(c.ins)} with the ${nameOf(next.ins)} at `,
      addrPiece(c, next.at),
      ` is the usual way to walk through a table: read the byte HL points at, then move HL ${inc ? 'on' : 'back'} to the next. ${cheap}.`,
    ),
  ];
}

function blockCopy(c: LineCtx): Sentence[] {
  const up = c.ins.mnemonic === 'LDIR';
  // LD A,(HL); LD (DE),A; INC/DEC HL; INC/DEC DE; DEC BC; LD A,B; OR C; JR NZ back to the start.
  const alt = costOf([0x7e, 0x12, up ? 0x23 : 0x2b, up ? 0x13 : 0x1b, 0x0b, 0x78, 0xb1, 0x20, 0xf7]);
  const mine = own(c.ins);
  return [
    say(
      `${c.ins.mnemonic} copies a whole block with a single ${mine.bytes}-byte instruction, ${mine.cycles} T-states for each byte but the last (${mine.notTaken}). The same copy written as a loop (${names(alt)}) takes ${bytesText(alt.bytes)} and ${alt.cycles} T-states a byte, and uses A.`,
    ),
  ];
}

/** The "why write it this way" sentences for a code line. */
export function idiomWhy(c: LineCtx): Sentence[] {
  // An instruction the program may turn into another one is not proven to be this form.
  if (opcodeRewritten(c.a, c.addr)) return [];
  const ins = c.ins;
  const [o0] = ins.operands;
  switch (ins.mnemonic) {
    case 'XOR':
    case 'SUB':
      return isReg(o0, 'A') && ins.operands.length === 1 ? zeroA(c, ins.mnemonic) : [];
    case 'OR':
    case 'AND':
      return isReg(o0, 'A') && ins.operands.length === 1 ? testA(c) : [];
    case 'CP':
      return compare(c);
    case 'LD':
      return [...countedLoop(c), ...walkTable(c)];
    case 'DJNZ':
      return djnz(c);
    case 'ADD':
      return double(c);
    case 'SLA':
    case 'SRL':
      return shift(c);
    case 'RLCA':
    case 'RRCA':
    case 'RLA':
    case 'RRA':
      return rotateA(c);
    case 'INC':
    case 'DEC':
      return inPlace(c);
    case 'PUSH':
      return keepAF(c);
    case 'EX':
      return isPair(o0, 'AF') ? exAF(c) : [];
    case 'RST':
      return rst(c);
    case 'LDIR':
    case 'LDDR':
      return blockCopy(c);
    default:
      return [];
  }
}

