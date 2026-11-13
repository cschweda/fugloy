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

/** What the translator knows of the instructions before this one in its block. */
export interface TranslateContext {
  /**
   * Q for SCF and CCF: 1 when the previous instruction in the same block wrote the flags (its
   * `writesFlags`), 0 when it did not, null at a block's start, where the statement reads `z.q`.
   */
  qPrev: 0 | 1 | null;
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
  r?: number;
  repeats?: true;
  readsTime?: true;
}

type Rule = (ops: readonly Operand[], ins: Instruction, at: number, ctx: TranslateContext) => Lines | undefined;

/**
 * The address of a memory operand, after any statement that sets it up: (IX+d) and (IY+d) set MEMPTR
 * to the address first, as emu's indexedAddr does for every indexed form (:2651-2655) and DD/FD CB
 * does (:2778), and the instruction then reads `z.wz`. Null for an operand in no memory.
 */
function addressOf(op: Operand, pre: string[]): string | null {
  switch (op.kind) {
    case 'ind':
      return op.reg === 'C' ? null : reg16(op.reg);
    case 'idx': {
      const ix = reg16(op.reg);
      pre.push(`z.wz = ${op.disp === 0 ? ix : `(${ix} ${op.disp < 0 ? '-' : '+'} ${Math.abs(op.disp)}) & 0xffff`};`);
      return 'z.wz';
    }
    case 'mem':
      return word(op.addr);
    default:
      return null;
  }
}

/** The expression that reads an 8-bit operand. */
function read8(op: Operand, pre: string[]): string | undefined {
  if (op.kind === 'reg') return reg8(op.reg);
  if (op.kind === 'imm8') return byte(op.value);
  const addr = addressOf(op, pre);
  return addr === null ? undefined : `z.read(${addr})`;
}

/** The statements that replace an 8-bit operand by `f` of its value (INC (HL), RLC B, SET 3,(IX+d)). */
function modify(op: Operand, f: (v: string) => string): string[] | undefined {
  if (op.kind === 'reg') return [`${reg8(op.reg)} = ${f(reg8(op.reg))};`];
  const pre: string[] = [];
  const addr = addressOf(op, pre);
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

const alu: Rule = ([a, b], ins) => {
  if (a?.kind === 'reg16' && b?.kind === 'reg16') {
    const fn = ALU16[ins.mnemonic];
    return fn === undefined ? undefined : { lines: [`${reg16(a.reg)} = o.${fn}(z, ${reg16(a.reg)}, ${reg16(b.reg)});`], writesFlags: true };
  }
  const src = b ?? a;
  const pre: string[] = [];
  const v = src && read8(src, pre);
  if (v === undefined) return undefined;
  if (ins.mnemonic === 'CP') return { lines: [...pre, `o.cp8(z, z.a, ${v});`], writesFlags: true };
  return { lines: [...pre, `z.a = o.${ALU8[ins.mnemonic]!}(z, z.a, ${v});`], writesFlags: true };
};

const incDec: Rule = ([op], ins) => {
  if (op?.kind === 'reg16') return { lines: [`${reg16(op.reg)} = (${reg16(op.reg)} ${ins.mnemonic === 'INC' ? '+' : '-'} 1) & 0xffff;`] };
  const fn = ins.mnemonic === 'INC' ? 'inc8' : 'dec8';
  const lines = op && modify(op, (v) => `o.${fn}(z, ${v})`);
  return lines && { lines, writesFlags: true };
};

const ld: Rule = ([dst, src]) => {
  if (!dst || !src) return undefined;
  // 16-bit (LD rr,nn :636-669, LD HL,(nn) :684, LD (nn),HL :672, the ED forms :2986-3097, LD SP,HL :1690)
  if (dst.kind === 'reg16' && src.kind === 'imm16') return { lines: [`${reg16(dst.reg)} = ${word(src.value)};`] };
  if (dst.kind === 'reg16' && src.kind === 'mem') return { lines: [`${reg16(dst.reg)} = z.read16(${word(src.addr)});`, `z.wz = ${word(src.addr + 1)};`] };
  if (dst.kind === 'mem' && src.kind === 'reg16') return { lines: [`z.write16(${word(dst.addr)}, ${reg16(src.reg)});`, `z.wz = ${word(dst.addr + 1)};`] };
  if (dst.kind === 'reg16' && src.kind === 'reg16') return { lines: [`${reg16(dst.reg)} = ${reg16(src.reg)};`] };
  // I and R (:1882-1905). LD A,R reads R after this instruction's two fetches have counted; LD R,A
  // replaces R after them, so the tick after it adds none.
  if (dst.kind === 'reg' && dst.reg === 'R') return { lines: ['z.r = z.a;'], r: 0, readsTime: true };
  if (src.kind === 'reg' && src.reg === 'R') return { lines: ['z.a = o.ldair(z, (z.r & 0x80) | ((z.r + 2) & 0x7f));'], writesFlags: true, readsTime: true };
  if (src.kind === 'reg' && src.reg === 'I' && dst.kind === 'reg') return { lines: ['z.a = o.ldair(z, z.i);'], writesFlags: true };
  // 8-bit
  const pre: string[] = [];
  const v = read8(src, pre);
  if (v === undefined) return undefined;
  const lines = [...pre];
  if (dst.kind === 'reg') lines.push(`${reg8(dst.reg)} = ${v};`);
  else {
    const addr = addressOf(dst, lines);
    if (addr === null) return undefined;
    lines.push(`z.write(${addr}, ${v});`);
  }
  // MEMPTR: LD A,(BC) and (DE) :718-729, LD (BC),A and (DE),A :732-743, LD A,(nn) :707, LD (nn),A :696
  if (src.kind === 'ind' && (src.reg === 'BC' || src.reg === 'DE')) lines.push(`z.wz = (${reg16(src.reg)} + 1) & 0xffff;`);
  if (dst.kind === 'ind' && (dst.reg === 'BC' || dst.reg === 'DE')) lines.push(`z.wz = ((${reg16(dst.reg)} + 1) & 0xff) | (z.a << 8);`);
  if (src.kind === 'mem') lines.push(`z.wz = ${word(src.addr + 1)};`);
  if (dst.kind === 'mem') lines.push(`z.wz = (z.a << 8) | ${byte(dst.addr + 1)};`);
  return { lines };
};

// Transfers. MEMPTR is the target for JP, CALL and RST whether taken or not (:478-546, :1268-1414),
// for JR and DJNZ only when taken (:1088-1161), and the popped address for RET (:521-528, :1164-1265).
const jp: Rule = ([a, b]) => {
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

const rotate: Rule = ([op], ins) => {
  const lines = op && modify(op, (v) => `o.${ROTATE[ins.mnemonic]!}(z, ${v})`);
  return lines && { lines, writesFlags: true };
};

const bit: Rule = ([n, op]) => {
  if (n?.kind !== 'bit' || !op) return undefined;
  if (op.kind === 'reg') return { lines: [`o.bit(z, ${n.bit}, ${reg8(op.reg)}, ${reg8(op.reg)});`], writesFlags: true };
  const pre: string[] = [];
  const v = read8(op, pre);
  return v === undefined ? undefined : { lines: [...pre, `o.bit(z, ${n.bit}, ${v}, z.wz >> 8);`], writesFlags: true };
};

const resSet: Rule = ([n, op], ins) => {
  if (n?.kind !== 'bit' || !op) return undefined;
  const mask = 1 << n.bit;
  const lines = modify(op, (v) => (ins.mnemonic === 'RES' ? `${v} & ${byte(~mask)}` : `${v} | ${byte(mask)}`));
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
  const made = RULES[ins.mnemonic]?.(ins.operands, ins, at, ctx);
  if (made === undefined) throw new Error(`$${hex(at, 4)}: no line template for ${formatInstruction(ins)} (${bytesOf(ins)}).`);

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
  if (made.readsTime) t.readsTime = true;
  return t;
}
