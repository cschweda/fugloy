/**
 * One Z80 instruction to JavaScript statements over @fugloy/runtime's machine state `z` and its
 * helpers `o` (`@fugloy/runtime/ops`). A table from the mnemonic and its operands' kinds to a line
 * template, as @fugloy/asm inverts @fugloy/z80's tables: no opcode byte is named here.
 *
 * What each statement does is what @fugloy/emu's core does (packages/emu/src/cpu/z80cpu.js, the
 * oracle a port is refereed against, cited by line), MEMPTR (`z.wz`) included; the test runs every
 * instruction the tables decode both ways and requires them equal.
 */
import { TABLES, formatInstruction } from '@fugloy/z80';
import type { Cond, FlowKind, Instruction, Operand, Reg16, Reg8 } from '@fugloy/z80';

/** The addresses of an instruction's operand bytes the program rewrites (its trace's cells, port.ts). */
export interface Cells {
  /** An index displacement's byte: (IX+d) and (IY+d) read d from it, sign-extended. */
  disp?: number;
  /** An 8-bit immediate's byte. */
  imm?: number;
  /** A word operand's low byte (its high byte follows it), whether one or both of its bytes are rewritten. */
  word?: number;
  /**
   * When only one byte of the word is rewritten, which: the other is a byte of code, which the port does
   * not carry, so it stays the constant the program was loaded with. Absent when both are.
   */
  half?: 'lo' | 'hi';
}

/** What the translator knows of the instructions before this one in its block, and of this one's operands. */
export interface TranslateContext {
  /**
   * Q for SCF and CCF: 1 when the previous instruction in the same block wrote the flags (its
   * `writesFlags`), 0 when it did not, null at a block's start, where the statement reads `z.q`.
   */
  qPrev: 0 | 1 | null;
  /**
   * The operands the program rewrites, by where they are: each is read from memory (`z.mem`) when the
   * instruction runs, in place of the value its bytes held when the program was loaded. An instruction
   * that has one its lines cannot read so is refused with a sentence.
   */
  cells?: Cells;
  /** For a JP nn whose word is in `cells`: every target the trace saw it hold, each a block of the port. */
  targets?: readonly number[];
}

/** One instruction's JavaScript. README.md gives the contract each field keeps. */
export interface Translation {
  /** Statements over `z` and `o`, run in order. */
  lines: string[];
  /** True when the instruction writes the flags as emu counts it (its `flagsWritten`, for the next SCF or CCF's Q). */
  writesFlags: boolean;
  flow: FlowKind;
  /** For a conditional transfer: a JavaScript boolean expression, evaluated after `lines`; true when it is taken. */
  cond?: string;
  /** Statements a conditional transfer runs after `lines` only when `cond` is true (the push of a CALL cc, the pop of a RET cc). */
  taken?: string[];
  /** The address a transfer goes to, when the instruction names it. */
  target?: number;
  /** For a transfer whose address is computed: a JavaScript expression for it, evaluated after `lines` (and `taken`). */
  targetExpr?: string;
  /** For a JP nn whose target the program rewrites: `targetExpr` reads it, and these are the targets it may hold. */
  targets?: number[];
  /** T-states the tick after the instruction adds: a transfer's when taken, or the final iteration's for a repeating instruction. */
  cycles: number;
  /** T-states when `cond` is false; present exactly when `cond` is. */
  cyclesNotTaken?: number;
  /** R increments the tick after the instruction adds: one per opcode fetch, or 0 for LD R,A, whose write replaces them. */
  r: number;
  /** The lines are a loop that ticks each repeating iteration itself; `cycles` and `r` are the last iteration's. */
  repeats?: true;
  /** The lines read or replace `z.cycles` or `z.r`, so they need both current to the instruction's own start. */
  readsTime?: true;
}

const hex = (n: number, width: number): string => n.toString(16).toUpperCase().padStart(width, '0');
/** A byte as a JavaScript literal, `0x3C`. */
const byte = (n: number): string => `0x${hex(n & 0xff, 2)}`;
/** A word as a JavaScript literal, `0x3C00`. */
const word = (n: number): string => `0x${hex(n & 0xffff, 4)}`;

const reg8 = (r: Reg8): string => `z.${r.toLowerCase()}`;
const reg16 = (r: Reg16): string => (r === "AF'" ? 'z.af_' : `z.${r.toLowerCase()}`);

/** A condition over F (S $80, Z $40, P/V $04, C $01). */
const COND: Record<Cond, string> = {
  NZ: '(z.f & 0x40) === 0', Z: '(z.f & 0x40) !== 0',
  NC: '(z.f & 0x01) === 0', C: '(z.f & 0x01) !== 0',
  PO: '(z.f & 0x04) === 0', PE: '(z.f & 0x04) !== 0',
  P: '(z.f & 0x80) === 0', M: '(z.f & 0x80) !== 0',
};

/** What a rule returns; `translate` adds the time and the flow. */
interface Lines {
  lines: string[];
  writesFlags?: boolean;
  cond?: string;
  taken?: string[];
  target?: number;
  targetExpr?: string;
  targets?: number[];
  r?: number;
  repeats?: true;
  readsTime?: true;
}

/**
 * An instruction's operand values as expressions: the number its bytes held when the program was loaded,
 * or, for an operand the program rewrites (`cells`), a read of its byte in memory. `used` records which
 * cells a rule read, so an instruction whose rewritten operand its lines do not read is refused.
 */
class Operands {
  readonly used = new Set<keyof Cells>();
  constructor(readonly cells: Cells) {}

  /** (IX+d)'s or (IY+d)'s address, 16 bits; a rewritten d sign-extended as the decoder does it. */
  indexed(reg: Reg16, disp: number): string {
    const ix = reg16(reg);
    if (this.cells.disp !== undefined) {
      this.used.add('disp');
      return `(${ix} + ((z.mem[${word(this.cells.disp)}] ^ 0x80) - 0x80)) & 0xffff`;
    }
    return disp === 0 ? ix : `(${ix} ${disp < 0 ? '-' : '+'} ${Math.abs(disp)}) & 0xffff`;
  }

  /** An 8-bit immediate. */
  imm8(value: number): string {
    if (this.cells.imm === undefined) return byte(value);
    this.used.add('imm');
    return `z.mem[${word(this.cells.imm)}]`;
  }

  /** A word operand (an immediate, or an address in memory), low byte first; a byte not rewritten, a constant. */
  word(value: number): string {
    const lo = this.cells.word;
    if (lo === undefined) return word(value);
    this.used.add('word');
    if (this.cells.half === 'lo') return `z.mem[${word(lo)}] | ${word(value & 0xff00)}`;
    if (this.cells.half === 'hi') return `z.mem[${word(lo + 1)}] << 8 | ${byte(value)}`;
    return `z.mem[${word(lo)}] | z.mem[${word(lo + 1)}] << 8`;
  }

  /** A word operand plus one, 16 bits (MEMPTR after LD A,(nn) and the 16-bit loads). */
  wordPlus1(value: number): string {
    return this.cells.word === undefined ? word(value + 1) : `((${this.word(value)}) + 1) & 0xffff`;
  }

  /** A word operand's low byte plus one, 8 bits (MEMPTR's low byte after LD (nn),A). */
  lowPlus1(value: number): string {
    if (this.cells.word === undefined || this.cells.half === 'hi') return byte(value + 1);
    this.used.add('word');
    return `(z.mem[${word(this.cells.word)}] + 1) & 0xff`;
  }
}

type Rule = (ops: readonly Operand[], ins: Instruction, at: number, ctx: TranslateContext, k: Operands) => Lines | undefined;

/**
 * The address of a memory operand, after any statement that sets it up: (IX+d) and (IY+d) set MEMPTR
 * to the address first, as emu's indexedAddr does for every indexed form (:2651-2655) and DD/FD CB
 * does (:2778), and the instruction then reads `z.wz`. Null for an operand in no memory.
 */
function addressOf(op: Operand, pre: string[], k: Operands): string | null {
  switch (op.kind) {
    case 'ind':
      return op.reg === 'C' ? null : reg16(op.reg);
    case 'idx':
      pre.push(`z.wz = ${k.indexed(op.reg, op.disp)};`);
      return 'z.wz';
    case 'mem':
      return k.word(op.addr);
    default:
      return null;
  }
}

/** The expression that reads an 8-bit operand. */
function read8(op: Operand, pre: string[], k: Operands): string | undefined {
  if (op.kind === 'reg') return reg8(op.reg);
  if (op.kind === 'imm8') return k.imm8(op.value);
  const addr = addressOf(op, pre, k);
  return addr === null ? undefined : `z.read(${addr})`;
}

/** The statements that replace an 8-bit operand by `f` of its value (INC (HL), RLC B, SET 3,(IX+d)). */
function modify(op: Operand, f: (v: string) => string, k: Operands): string[] | undefined {
  if (op.kind === 'reg') return [`${reg8(op.reg)} = ${f(reg8(op.reg))};`];
  const pre: string[] = [];
  const addr = addressOf(op, pre, k);
  return addr === null ? undefined : [...pre, `z.write(${addr}, ${f(`z.read(${addr})`)});`];
}

/** The number of opcode fetches, R's increments: two with a prefix byte, read from z80's table. */
const fetches = (ins: Instruction): number => (TABLES.base[ins.bytes[0]!]!.prefix === undefined ? 1 : 2);

// ---- the line templates

const ALU8: Record<string, string> = { ADD: 'add8', ADC: 'adc8', SUB: 'sub8', SBC: 'sbc8', AND: 'and8', XOR: 'xor8', OR: 'or8' };
const ALU16: Record<string, string> = { ADD: 'add16', ADC: 'adc16', SBC: 'sbc16' };
const ACCUMULATOR: Record<string, string> = { DAA: 'daa', CPL: 'cpl', RLCA: 'rlca', RRCA: 'rrca', RLA: 'rla', RRA: 'rra' };
const ROTATE: Record<string, string> = { RLC: 'rlc', RRC: 'rrc', RL: 'rl', RR: 'rr', SLA: 'sla', SRA: 'sra', SLL: 'sll', SRL: 'srl' };
/** The block instructions, one iteration each, and whether they touch a port. */
const BLOCK: Record<string, [string, boolean]> = {
  LDI: ['ldi', false], LDD: ['ldd', false], CPI: ['cpi', false], CPD: ['cpd', false],
  INI: ['ini', true], IND: ['ind', true], OUTI: ['outi', true], OUTD: ['outd', true],
};
/**
 * The repeating ones: the iteration they repeat, and when they stop (LDIR :2855, CPIR :2932, INIR
 * :3235, OTIR :3291 and their decrementing twins).
 */
const REPEAT: Record<string, [string, string]> = {
  LDIR: ['LDI', 'z.bc === 0'], LDDR: ['LDD', 'z.bc === 0'],
  CPIR: ['CPI', 'z.bc === 0 || (z.f & 0x40) !== 0'], CPDR: ['CPD', 'z.bc === 0 || (z.f & 0x40) !== 0'],
  INIR: ['INI', 'z.b === 0'], INDR: ['IND', 'z.b === 0'], OTIR: ['OUTI', 'z.b === 0'], OTDR: ['OUTD', 'z.b === 0'],
};

/** The address a relative jump reaches, from where the instruction sits. */
const relTarget = (op: Operand, ins: Instruction, at: number): number | undefined =>
  op.kind === 'rel' ? (at + ins.length + op.disp) & 0xffff : undefined;

const alu: Rule = ([a, b], ins, _, __, k) => {
  if (a?.kind === 'reg16' && b?.kind === 'reg16') {
    const fn = ALU16[ins.mnemonic];
    return fn === undefined ? undefined : { lines: [`${reg16(a.reg)} = o.${fn}(z, ${reg16(a.reg)}, ${reg16(b.reg)});`], writesFlags: true };
  }
  const src = b ?? a;
  const pre: string[] = [];
  const v = src && read8(src, pre, k);
  if (v === undefined) return undefined;
  if (ins.mnemonic === 'CP') return { lines: [...pre, `o.cp8(z, z.a, ${v});`], writesFlags: true };
  return { lines: [...pre, `z.a = o.${ALU8[ins.mnemonic]!}(z, z.a, ${v});`], writesFlags: true };
};

const incDec: Rule = ([op], ins, _, __, k) => {
  if (op?.kind === 'reg16') return { lines: [`${reg16(op.reg)} = (${reg16(op.reg)} ${ins.mnemonic === 'INC' ? '+' : '-'} 1) & 0xffff;`] };
  const fn = ins.mnemonic === 'INC' ? 'inc8' : 'dec8';
  const lines = op && modify(op, (v) => `o.${fn}(z, ${v})`, k);
  return lines && { lines, writesFlags: true };
};

const ld: Rule = ([dst, src], _, __, ___, k) => {
  if (!dst || !src) return undefined;
  // 16-bit (LD rr,nn :636-669, LD HL,(nn) :684, LD (nn),HL :672, the ED forms :2986-3097, LD SP,HL :1690)
  if (dst.kind === 'reg16' && src.kind === 'imm16') return { lines: [`${reg16(dst.reg)} = ${k.word(src.value)};`] };
  if (dst.kind === 'reg16' && src.kind === 'mem') return { lines: [`${reg16(dst.reg)} = z.read16(${k.word(src.addr)});`, `z.wz = ${k.wordPlus1(src.addr)};`] };
  if (dst.kind === 'mem' && src.kind === 'reg16') return { lines: [`z.write16(${k.word(dst.addr)}, ${reg16(src.reg)});`, `z.wz = ${k.wordPlus1(dst.addr)};`] };
  if (dst.kind === 'reg16' && src.kind === 'reg16') return { lines: [`${reg16(dst.reg)} = ${reg16(src.reg)};`] };
  // I and R (:1882-1905). LD A,R reads R after this instruction's two fetches have counted; LD R,A
  // replaces R after them, so the tick after it adds none.
  if (dst.kind === 'reg' && dst.reg === 'R') return { lines: ['z.r = z.a;'], r: 0, readsTime: true };
  if (src.kind === 'reg' && src.reg === 'R') return { lines: ['z.a = o.ldair(z, (z.r & 0x80) | ((z.r + 2) & 0x7f));'], writesFlags: true, readsTime: true };
  if (src.kind === 'reg' && src.reg === 'I' && dst.kind === 'reg') return { lines: ['z.a = o.ldair(z, z.i);'], writesFlags: true };
  // 8-bit
  const pre: string[] = [];
  const v = read8(src, pre, k);
  if (v === undefined) return undefined;
  const lines = [...pre];
  if (dst.kind === 'reg') lines.push(`${reg8(dst.reg)} = ${v};`);
  else {
    const addr = addressOf(dst, lines, k);
    if (addr === null) return undefined;
    lines.push(`z.write(${addr}, ${v});`);
  }
  // MEMPTR: LD A,(BC) and (DE) :718-729, LD (BC),A and (DE),A :732-743, LD A,(nn) :707, LD (nn),A :696
  if (src.kind === 'ind' && (src.reg === 'BC' || src.reg === 'DE')) lines.push(`z.wz = (${reg16(src.reg)} + 1) & 0xffff;`);
  if (dst.kind === 'ind' && (dst.reg === 'BC' || dst.reg === 'DE')) lines.push(`z.wz = ((${reg16(dst.reg)} + 1) & 0xff) | (z.a << 8);`);
  if (src.kind === 'mem') lines.push(`z.wz = ${k.wordPlus1(src.addr)};`);
  if (dst.kind === 'mem') lines.push(`z.wz = (z.a << 8) | ${k.lowPlus1(dst.addr)};`);
  return { lines };
};

// Transfers. MEMPTR is the target for JP, CALL and RST whether taken or not (:478-546, :1268-1414),
// for JR and DJNZ only when taken (:1088-1161), and the popped address for RET (:521-528, :1164-1265).
// A JP nn whose target the program rewrites reads it into MEMPTR and goes to whichever of the trace's
// targets it is (emit.ts writes the choice).
const jp: Rule = ([a, b], ins, at, ctx, k) => {
  if (a?.kind === 'imm16' && k.cells.word !== undefined) {
    if (ctx.targets === undefined) throw new Error(`$${hex(at, 4)}: ${formatInstruction(ins)} has its target rewritten, but no targets were given for it.`);
    return { lines: [`z.wz = ${k.word(a.value)};`], targetExpr: 'z.wz', targets: [...ctx.targets] };
  }
  if (a?.kind === 'imm16') return { lines: [`z.wz = ${word(a.value)};`], target: a.value };
  if (a?.kind === 'cc' && b?.kind === 'imm16') return { lines: [`z.wz = ${word(b.value)};`], cond: COND[a.cond], target: b.value };
  if (a?.kind === 'ind') return { lines: [], targetExpr: reg16(a.reg as Reg16) }; // JP (HL), (IX), (IY): MEMPTR untouched
  return undefined;
};

const jr: Rule = ([a, b], ins, at) => {
  if (a?.kind === 'rel') {
    const target = relTarget(a, ins, at)!;
    return { lines: [`z.wz = ${word(target)};`], target };
  }
  const target = b && relTarget(b, ins, at);
  if (a?.kind !== 'cc' || target === undefined) return undefined;
  return { lines: [], cond: COND[a.cond], taken: [`z.wz = ${word(target)};`], target };
};

const djnz: Rule = ([a], ins, at) => {
  const target = a && relTarget(a, ins, at);
  if (target === undefined) return undefined;
  return { lines: ['z.b = (z.b - 1) & 0xff;'], cond: 'z.b !== 0', taken: [`z.wz = ${word(target)};`], target };
};

const call: Rule = ([a, b], ins, at) => {
  const back = word(at + ins.length);
  if (a?.kind === 'imm16') return { lines: [`z.wz = ${word(a.value)};`, `o.push(z, ${back});`], target: a.value };
  if (a?.kind === 'cc' && b?.kind === 'imm16') return { lines: [`z.wz = ${word(b.value)};`], cond: COND[a.cond], taken: [`o.push(z, ${back});`], target: b.value };
  return undefined;
};

const ret: Rule = ([a]) => {
  if (a === undefined) return { lines: ['z.wz = o.pop(z);'], targetExpr: 'z.wz' };
  if (a.kind === 'cc') return { lines: [], cond: COND[a.cond], taken: ['z.wz = o.pop(z);'], targetExpr: 'z.wz' };
  return undefined;
};

/** RETI and RETN: RET, and IFF1 from IFF2 (:3333-3357). */
const retIff: Rule = () => ({ lines: ['z.wz = o.pop(z);', 'z.iff1 = z.iff2;'], targetExpr: 'z.wz' });

const rst: Rule = ([a], ins, at) =>
  a?.kind === 'rst' ? { lines: [`o.push(z, ${word(at + ins.length)});`, `z.wz = ${word(a.addr)};`], target: a.addr } : undefined;

const ex: Rule = ([a, b]) => {
  if (a?.kind === 'reg16' && b?.kind === 'reg16') return { lines: [`[${reg16(a.reg)}, ${reg16(b.reg)}] = [${reg16(b.reg)}, ${reg16(a.reg)}];`] };
  if (a?.kind === 'ind' && a.reg === 'SP' && b?.kind === 'reg16') return { lines: [`${reg16(b.reg)} = o.exsp(z, ${reg16(b.reg)});`] };
  return undefined;
};

/** SCF and CCF: F's own bits 5 and 3 are kept when the instruction before left the flags alone (Q). */
const scfCcf: Rule = (_, ins, __, ctx) => {
  const keep = ctx.qPrev === null ? 'z.q ? 0 : 0x28' : ctx.qPrev === 1 ? '0' : '0x28';
  return { lines: [`o.${ins.mnemonic.toLowerCase()}(z, ${keep});`], writesFlags: true };
};

const rotate: Rule = ([op], ins, _, __, k) => {
  const lines = op && modify(op, (v) => `o.${ROTATE[ins.mnemonic]!}(z, ${v})`, k);
  return lines && { lines, writesFlags: true };
};

const bit: Rule = ([n, op], _, __, ___, k) => {
  if (n?.kind !== 'bit' || !op) return undefined;
  if (op.kind === 'reg') return { lines: [`o.bit(z, ${n.bit}, ${reg8(op.reg)}, ${reg8(op.reg)});`], writesFlags: true };
  const pre: string[] = [];
  const v = read8(op, pre, k);
  return v === undefined ? undefined : { lines: [...pre, `o.bit(z, ${n.bit}, ${v}, z.wz >> 8);`], writesFlags: true };
};

const resSet: Rule = ([n, op], ins, _, __, k) => {
  if (n?.kind !== 'bit' || !op) return undefined;
  const mask = 1 << n.bit;
  const lines = modify(op, (v) => (ins.mnemonic === 'RES' ? `${v} & ${byte(~mask)}` : `${v} | ${byte(mask)}`), k);
  return lines && { lines };
};

// I/O (IN A,(n) :755, OUT (n),A :746, IN r,(C) :3166, OUT (C),r :3188). Their lines read the time
// (a port write is stamped with `z.cycles`), so a block brings it current before them.
const inp: Rule = ([dst, src]) => {
  if (dst?.kind === 'reg' && src?.kind === 'port') {
    return { lines: [`z.wz = (((z.a << 8) | ${byte(src.value)}) + 1) & 0xffff;`, `z.a = z.in(${byte(src.value)});`], readsTime: true };
  }
  if (dst?.kind === 'reg' && src?.kind === 'ind' && src.reg === 'C') {
    return { lines: ['z.wz = (z.bc + 1) & 0xffff;', `${reg8(dst.reg)} = o.inr(z, z.in(z.c));`], writesFlags: true, readsTime: true };
  }
  return undefined;
};

const out: Rule = ([dst, src]) => {
  if (dst?.kind === 'port' && src?.kind === 'reg') {
    return { lines: [`z.wz = (z.a << 8) | ${byte(dst.value + 1)};`, `z.out(${byte(dst.value)}, z.a);`], readsTime: true };
  }
  if (dst?.kind === 'ind' && dst.reg === 'C' && src?.kind === 'reg') {
    return { lines: ['z.wz = (z.bc + 1) & 0xffff;', `z.out(z.c, ${reg8(src.reg)});`], readsTime: true };
  }
  return undefined;
};

const block: Rule = (_, ins) => {
  const [fn, io] = BLOCK[ins.mnemonic]!;
  return io ? { lines: [`o.${fn}(z);`], writesFlags: true, readsTime: true } : { lines: [`o.${fn}(z);`], writesFlags: true };
};

/**
 * LDIR and the rest: a loop of the one-iteration helper. An iteration that repeats ticks its own 21
 * T-states and 2 R where it ends; the last one's 16 are the tick after the instruction. A repeating
 * LDIR, LDDR, CPIR or CPDR iteration sets MEMPTR to the instruction's address + 1 and takes F's bits
 * 5 and 3 from that address's high byte (emu's `_xyRepeat`, :193-196, with PC back on the ED); the I/O
 * ones change neither (:3235-3326).
 */
const repeat: Rule = (_, ins, at) => {
  const [single, done] = REPEAT[ins.mnemonic]!;
  const [fn, io] = BLOCK[single]!;
  const body = [`  o.${fn}(z);`, `  if (${done}) break;`];
  if (!io) body.push(`  z.wz = ${word(at + 1)};`, `  z.f = (z.f & 0xD7) | ${byte((at >> 8) & 0x28)};`);
  body.push(`  z.tick(${ins.cycles}, ${fetches(ins)});`);
  const lines = ['for (;;) {', ...body, '}'];
  return io ? { lines, writesFlags: true, repeats: true, readsTime: true } : { lines, writesFlags: true, repeats: true };
};

/** An instruction whose lines take nothing from its operands (a fresh array each time: a caller may change it). */
const fixed = (lines: readonly string[], writesFlags = false): Rule => () => ({ lines: [...lines], writesFlags });

const RULES: Record<string, Rule> = {
  NOP: fixed([]),
  HALT: fixed([]),
  DI: fixed(['z.iff1 = z.iff2 = false;']),
  // Both flip-flops at once: emu's one-instruction delay (pendingEI, :1426-1431) is not modelled (README).
  EI: fixed(['z.iff1 = z.iff2 = true;']),
  IM: ([m]) => (m?.kind === 'im' ? { lines: [`z.im = ${m.mode};`] } : undefined),
  LD: ld,
  PUSH: ([a]) => (a?.kind === 'reg16' ? { lines: [`o.push(z, ${reg16(a.reg)});`] } : undefined),
  // POP AF loads F without writing it as flags (:1632-1639, setFlag's note :198-201)
  POP: ([a]) => (a?.kind === 'reg16' ? { lines: [`${reg16(a.reg)} = o.pop(z);`] } : undefined),
  EX: ex,
  EXX: fixed(['o.exx(z);']),
  ADD: alu, ADC: alu, SUB: alu, SBC: alu, AND: alu, XOR: alu, OR: alu, CP: alu,
  INC: incDec, DEC: incDec,
  NEG: fixed(['z.a = o.neg(z, z.a);'], true),
  SCF: scfCcf, CCF: scfCcf,
  ...Object.fromEntries(Object.entries(ACCUMULATOR).map(([m, fn]): [string, Rule] => [m, fixed([`o.${fn}(z);`], true)])),
  ...Object.fromEntries(Object.keys(ROTATE).map((m): [string, Rule] => [m, rotate])),
  BIT: bit, RES: resSet, SET: resSet,
  RLD: fixed(['o.rld(z);'], true), RRD: fixed(['o.rrd(z);'], true),
  JP: jp, JR: jr, DJNZ: djnz, CALL: call, RET: ret, RETI: retIff, RETN: retIff, RST: rst,
  IN: inp, OUT: out,
  ...Object.fromEntries(Object.keys(BLOCK).map((m): [string, Rule] => [m, block])),
  ...Object.fromEntries(Object.keys(REPEAT).map((m): [string, Rule] => [m, repeat])),
};

const bytesOf = (ins: Instruction): string => ins.bytes.map((b) => hex(b, 2)).join(' ');

/** What a rewritten operand is, for a sentence. */
const OPERAND_NAME: Record<'disp' | 'imm' | 'word', string> = { disp: 'displacement', imm: 'immediate', word: 'word operand' };

/**
 * Translate the instruction `ins`, decoded at `at`, into JavaScript statements. Every byte sequence
 * @fugloy/z80 decodes to an instruction is translated, documented or not; one it decodes only as a
 * DB fallback is refused with a sentence naming its bytes.
 */
export function translate(ins: Instruction, at: number, ctx: TranslateContext): Translation {
  if (ins.mnemonic === 'DB') {
    throw new Error(
      `$${hex(at, 4)}: ${bytesOf(ins)} is not an instruction @fugloy/z80 decodes (it reads ${ins.bytes.length === 1 ? 'that byte' : 'those bytes'} only as DB), so it cannot be translated.`,
    );
  }
  const k = new Operands(ctx.cells ?? {});
  const made = RULES[ins.mnemonic]?.(ins.operands, ins, at, ctx, k);
  if (made === undefined) throw new Error(`$${hex(at, 4)}: no line template for ${formatInstruction(ins)} (${bytesOf(ins)}).`);
  // A rewritten operand the lines do not read from memory would run as the constant it was loaded with
  for (const cell of ['disp', 'imm', 'word'] as const) {
    const where = k.cells[cell];
    if (where !== undefined && !k.used.has(cell)) {
      throw new Error(`$${hex(at, 4)}: the program rewrites the ${OPERAND_NAME[cell]} of ${formatInstruction(ins)} (${bytesOf(ins)}) at $${hex(where, 4)}, which a port does not read from memory in this instruction.`);
    }
  }

  const t: Translation = { lines: made.lines, writesFlags: made.writesFlags ?? false, flow: ins.flow.kind, cycles: ins.cycles, r: made.r ?? fetches(ins) };
  if (made.repeats) {
    t.repeats = true;
    t.cycles = ins.cyclesNotTaken ?? ins.cycles; // the last iteration's
  }
  if (made.cond !== undefined) {
    t.cond = made.cond;
    t.cyclesNotTaken = ins.cyclesNotTaken ?? ins.cycles;
  }
  if (made.taken) t.taken = made.taken;
  if (made.target !== undefined) t.target = made.target;
  if (made.targetExpr !== undefined) t.targetExpr = made.targetExpr;
  if (made.targets !== undefined) t.targets = made.targets;
  if (made.readsTime) t.readsTime = true;
  return t;
}
