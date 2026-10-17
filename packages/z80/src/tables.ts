/**
 * Z80 opcode tables generated from the x/y/z/p/q decomposition of each opcode
 * byte (x = bits 7-6, y = bits 5-3, z = bits 2-0, p = y >> 1, q = y & 1).
 * Nothing here is typed per opcode; fix the rules, not the output.
 */
import type { Cond, Flow, IndexReg, IndReg, Operand, Reg16, Reg8, Template, TemplateOperand } from './types.js';

const NEXT: Flow = { kind: 'next', conditional: false, indirect: false };
const flow = (kind: Flow['kind'], conditional = false, indirect = false): Flow => ({ kind, conditional, indirect });

const fixed = (op: Operand): TemplateOperand => ({ t: 'fixed', op });
const reg = (r: Reg8): TemplateOperand => fixed({ kind: 'reg', reg: r });
const reg16 = (r: Reg16): TemplateOperand => fixed({ kind: 'reg16', reg: r });
const ind = (r: IndReg): TemplateOperand => fixed({ kind: 'ind', reg: r });
const cond = (c: Cond): TemplateOperand => fixed({ kind: 'cc', cond: c });
const bit = (b: number): TemplateOperand => fixed({ kind: 'bit', bit: b });
const byte = (v: number): TemplateOperand => fixed({ kind: 'byte', value: v });
const N: TemplateOperand = { t: 'n' };
const NN: TemplateOperand = { t: 'nn' };
const MEM: TemplateOperand = { t: '(nn)' };
const PORT: TemplateOperand = { t: '(n)' };
const E: TemplateOperand = { t: 'e' };

const R: readonly TemplateOperand[] = [reg('B'), reg('C'), reg('D'), reg('E'), reg('H'), reg('L'), ind('HL'), reg('A')];
const RP: readonly Reg16[] = ['BC', 'DE', 'HL', 'SP'];
const RP2: readonly Reg16[] = ['BC', 'DE', 'HL', 'AF'];
const CC: readonly Cond[] = ['NZ', 'Z', 'NC', 'C', 'PO', 'PE', 'P', 'M'];
/** ALU operations: mnemonic and whether the accumulator is written as an explicit first operand. */
const ALU: readonly (readonly [string, boolean])[] = [
  ['ADD', true], ['ADC', true], ['SUB', false], ['SBC', true], ['AND', false], ['XOR', false], ['OR', false], ['CP', false],
];
const ROT: readonly string[] = ['RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SLL', 'SRL'];
const BLI: readonly (readonly string[])[] = [
  ['LDI', 'CPI', 'INI', 'OUTI'], ['LDD', 'CPD', 'IND', 'OUTD'], ['LDIR', 'CPIR', 'INIR', 'OTIR'], ['LDDR', 'CPDR', 'INDR', 'OTDR'],
];
const X0Z7: readonly string[] = ['RLCA', 'RRCA', 'RLA', 'RRA', 'DAA', 'CPL', 'SCF', 'CCF'];

const SLOT_BYTES: Record<TemplateOperand['t'], number> = { fixed: 0, n: 1, nn: 2, '(nn)': 2, '(n)': 1, e: 1, '(ix+d)': 1, d: 1 };

const isFixed = (o: TemplateOperand | undefined, kind: Operand['kind'], name?: string): boolean =>
  o?.t === 'fixed' && o.op.kind === kind && (name === undefined || ('reg' in o.op && o.op.reg === name));

/**
 * Flag effects, one rule per group of mnemonics, after Zilog's instruction tables.
 * Letters are in SZHPNC order; undocumented bits 3 and 5 are not listed. The first
 * rule that matches wins, so the operand-sensitive rules come before the plain ones.
 */
const FLAG_RULES: readonly (readonly [(m: string, ops: readonly TemplateOperand[]) => boolean, string])[] = [
  // Operand-sensitive cases first.
  [(m, o) => (m === 'INC' || m === 'DEC') && isFixed(o[0], 'reg16'), ''], // 16-bit INC/DEC
  [(m, o) => m === 'ADD' && isFixed(o[0], 'reg16'), 'HNC'], // ADD HL/IX/IY,rr
  [(m, o) => (m === 'ADC' || m === 'SBC') && isFixed(o[0], 'reg16'), 'SZHPNC'], // ADC/SBC HL,rr
  [(m, o) => m === 'POP' && isFixed(o[0], 'reg16', 'AF'), 'SZHPNC'], // POP AF loads F
  [(m, o) => m === 'EX' && isFixed(o[1], 'reg16', "AF'"), 'SZHPNC'], // EX AF,AF'
  [(m, o) => m === 'LD' && isFixed(o[0], 'reg', 'A') && (isFixed(o[1], 'reg', 'I') || isFixed(o[1], 'reg', 'R')), 'SZHPN'], // LD A,I / LD A,R
  [(m, o) => m === 'IN' && o[1]?.t === 'fixed' && o[1].op.kind === 'ind', 'SZHPN'], // IN r,(C); IN A,(n) has none
  // Plain mnemonic groups.
  [(m) => ['ADD', 'ADC', 'SUB', 'SBC', 'CP', 'AND', 'OR', 'XOR', 'NEG'].includes(m), 'SZHPNC'], // 8-bit ALU
  [(m) => m === 'INC' || m === 'DEC', 'SZHPN'], // 8-bit INC/DEC leave carry alone
  [(m) => ['RLCA', 'RRCA', 'RLA', 'RRA', 'SCF', 'CCF'].includes(m), 'HNC'], // accumulator rotates, carry flag
  [(m) => m === 'DAA', 'SZHPC'],
  [(m) => m === 'CPL', 'HN'],
  [(m) => ROT.includes(m), 'SZHPNC'], // CB rotates and shifts
  [(m) => m === 'BIT', 'SZHPN'],
  [(m) => m === 'RLD' || m === 'RRD', 'SZHPN'],
  [(m) => ['LDI', 'LDD', 'LDIR', 'LDDR'].includes(m), 'HPN'],
  [(m) => ['CPI', 'CPD', 'CPIR', 'CPDR'].includes(m), 'SZHPN'],
  [(m) => ['INI', 'IND', 'INIR', 'INDR', 'OUTI', 'OUTD', 'OTIR', 'OTDR'].includes(m), 'ZN'], // S, H, P are undefined
];

/** Affected flags for a mnemonic with these operands; '' when none (including DB, RES, SET, loads, jumps). */
function flagsOf(mnemonic: string, operands: readonly TemplateOperand[]): string {
  for (const [matches, flags] of FLAG_RULES) if (matches(mnemonic, operands)) return flags;
  return '';
}

interface Opts { notTaken?: number; flow?: Flow; documented?: boolean }

function entry(prefixLen: number, mnemonic: string, operands: TemplateOperand[], cycles: number, opts: Opts = {}): Template {
  const length = prefixLen + 1 + operands.reduce((n, o) => n + SLOT_BYTES[o.t], 0);
  const t: Template = { mnemonic, operands, length, cycles, flow: opts.flow ?? NEXT, documented: opts.documented ?? true, flags: flagsOf(mnemonic, operands) };
  if (opts.notTaken !== undefined) t.cyclesNotTaken = opts.notTaken;
  return t;
}

/** An undocumented encoding rendered as DB with the bytes the CPU would consume. 'd' is the displacement slot. */
function db(bytes: readonly (number | 'd')[], cycles: number): Template {
  const operands = bytes.map((b) => (b === 'd' ? ({ t: 'd' } as TemplateOperand) : byte(b)));
  return { mnemonic: 'DB', operands, length: bytes.length, cycles, flow: NEXT, documented: false, flags: '' };
}

const prefixEntry = (prefix: 'CB' | 'DD' | 'ED' | 'FD'): Template => ({
  mnemonic: 'PREFIX', operands: [], length: 1, cycles: 0, flow: NEXT, documented: true, flags: '', prefix,
});

const isIndHL = (o: TemplateOperand): boolean => o.t === 'fixed' && o.op.kind === 'ind' && o.op.reg === 'HL';

function alu(y: number, operand: TemplateOperand, cycles: number): Template {
  const [mnemonic, withA] = ALU[y]!;
  return entry(0, mnemonic, withA ? [reg('A'), operand] : [operand], cycles);
}

function baseEntry(op: number): Template {
  const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
  const r = (i: number): TemplateOperand => R[i]!;
  const hl = (i: number): boolean => i === 6;
  if (x === 0) {
    switch (z) {
      case 0:
        if (y === 0) return entry(0, 'NOP', [], 4);
        if (y === 1) return entry(0, 'EX', [reg16('AF'), reg16("AF'")], 4);
        if (y === 2) return entry(0, 'DJNZ', [E], 13, { notTaken: 8, flow: flow('jump', true) });
        if (y === 3) return entry(0, 'JR', [E], 12, { flow: flow('jump') });
        return entry(0, 'JR', [cond(CC[y - 4]!), E], 12, { notTaken: 7, flow: flow('jump', true) });
      case 1:
        return q === 0 ? entry(0, 'LD', [reg16(RP[p]!), NN], 10) : entry(0, 'ADD', [reg16('HL'), reg16(RP[p]!)], 11);
      case 2:
        if (q === 0) {
          if (p === 0) return entry(0, 'LD', [ind('BC'), reg('A')], 7);
          if (p === 1) return entry(0, 'LD', [ind('DE'), reg('A')], 7);
          if (p === 2) return entry(0, 'LD', [MEM, reg16('HL')], 16);
          return entry(0, 'LD', [MEM, reg('A')], 13);
        }
        if (p === 0) return entry(0, 'LD', [reg('A'), ind('BC')], 7);
        if (p === 1) return entry(0, 'LD', [reg('A'), ind('DE')], 7);
        if (p === 2) return entry(0, 'LD', [reg16('HL'), MEM], 16);
        return entry(0, 'LD', [reg('A'), MEM], 13);
      case 3:
        return entry(0, q === 0 ? 'INC' : 'DEC', [reg16(RP[p]!)], 6);
      case 4:
        return entry(0, 'INC', [r(y)], hl(y) ? 11 : 4);
      case 5:
        return entry(0, 'DEC', [r(y)], hl(y) ? 11 : 4);
      case 6:
        return entry(0, 'LD', [r(y), N], hl(y) ? 10 : 7);
      default:
        return entry(0, X0Z7[y]!, [], 4);
    }
  }
  if (x === 1) {
    if (z === 6 && y === 6) return entry(0, 'HALT', [], 4, { flow: flow('halt') });
    return entry(0, 'LD', [r(y), r(z)], hl(y) || hl(z) ? 7 : 4);
  }
  if (x === 2) return alu(y, r(z), hl(z) ? 7 : 4);
  switch (z) {
    case 0:
      return entry(0, 'RET', [cond(CC[y]!)], 11, { notTaken: 5, flow: flow('return', true) });
    case 1:
      if (q === 0) return entry(0, 'POP', [reg16(RP2[p]!)], 10);
      if (p === 0) return entry(0, 'RET', [], 10, { flow: flow('return') });
      if (p === 1) return entry(0, 'EXX', [], 4);
      if (p === 2) return entry(0, 'JP', [ind('HL')], 4, { flow: flow('jump', false, true) });
      return entry(0, 'LD', [reg16('SP'), reg16('HL')], 6);
    case 2:
      return entry(0, 'JP', [cond(CC[y]!), NN], 10, { flow: flow('jump', true) });
    case 3:
      switch (y) {
        case 0: return entry(0, 'JP', [NN], 10, { flow: flow('jump') });
        case 1: return prefixEntry('CB');
        case 2: return entry(0, 'OUT', [PORT, reg('A')], 11);
        case 3: return entry(0, 'IN', [reg('A'), PORT], 11);
        case 4: return entry(0, 'EX', [ind('SP'), reg16('HL')], 19);
        case 5: return entry(0, 'EX', [reg16('DE'), reg16('HL')], 4);
        case 6: return entry(0, 'DI', [], 4);
        default: return entry(0, 'EI', [], 4);
      }
    case 4:
      return entry(0, 'CALL', [cond(CC[y]!), NN], 17, { notTaken: 10, flow: flow('call', true) });
    case 5:
      if (q === 0) return entry(0, 'PUSH', [reg16(RP2[p]!)], 11);
      if (p === 0) return entry(0, 'CALL', [NN], 17, { flow: flow('call') });
      if (p === 1) return prefixEntry('DD');
      if (p === 2) return prefixEntry('ED');
      return prefixEntry('FD');
    case 6:
      return alu(y, N, 7);
    default:
      return entry(0, 'RST', [fixed({ kind: 'rst', addr: y * 8 })], 11, { flow: flow('call') });
  }
}

function cbEntry(op: number): Template {
  const x = op >> 6, y = (op >> 3) & 7, z = op & 7;
  const r = R[z]!;
  const mem = z === 6;
  if (x === 0) return entry(1, ROT[y]!, [r], mem ? 15 : 8, { documented: y !== 6 });
  if (x === 1) return entry(1, 'BIT', [bit(y), r], mem ? 12 : 8);
  return entry(1, x === 2 ? 'RES' : 'SET', [bit(y), r], mem ? 15 : 8);
}

function edEntry(op: number): Template {
  const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
  const undoc = (cycles = 8): Template => db([0xed, op], cycles);
  if (x === 1) {
    switch (z) {
      case 0: return y === 6 ? undoc(12) : entry(1, 'IN', [R[y]!, ind('C')], 12);
      case 1: return y === 6 ? undoc(12) : entry(1, 'OUT', [ind('C'), R[y]!], 12);
      case 2: return entry(1, q === 0 ? 'SBC' : 'ADC', [reg16('HL'), reg16(RP[p]!)], 15);
      case 3: return q === 0 ? entry(1, 'LD', [MEM, reg16(RP[p]!)], 20) : entry(1, 'LD', [reg16(RP[p]!), MEM], 20);
      case 4: return y === 0 ? entry(1, 'NEG', [], 8) : undoc();
      case 5:
        if (y === 0) return entry(1, 'RETN', [], 14, { flow: flow('return') });
        if (y === 1) return entry(1, 'RETI', [], 14, { flow: flow('return') });
        return undoc(14);
      case 6:
        if (y === 0) return entry(1, 'IM', [fixed({ kind: 'im', mode: 0 })], 8);
        if (y === 2) return entry(1, 'IM', [fixed({ kind: 'im', mode: 1 })], 8);
        if (y === 3) return entry(1, 'IM', [fixed({ kind: 'im', mode: 2 })], 8);
        return undoc();
      default:
        switch (y) {
          case 0: return entry(1, 'LD', [reg('I'), reg('A')], 9);
          case 1: return entry(1, 'LD', [reg('R'), reg('A')], 9);
          case 2: return entry(1, 'LD', [reg('A'), reg('I')], 9);
          case 3: return entry(1, 'LD', [reg('A'), reg('R')], 9);
          case 4: return entry(1, 'RRD', [], 18);
          case 5: return entry(1, 'RLD', [], 18);
          default: return undoc();
        }
    }
  }
  if (x === 2 && z <= 3 && y >= 4) {
    const repeat = y >= 6;
    return entry(1, BLI[y - 4]![z]!, [], repeat ? 21 : 16, repeat ? { notTaken: 16 } : {});
  }
  return undoc();
}

/** Applies the DD/FD prefix to an unprefixed entry: HL→IX, (HL)→(IX+d), H/L→IXH/IXL. */
function indexEntry(base: Template, ix: IndexReg): Template {
  if (base.prefix === 'CB') return prefixEntry('CB');
  const noop = db([ix === 'IX' ? 0xdd : 0xfd], 4);
  if (base.prefix) return noop;
  // EX DE,HL swaps DE with HL even under DD/FD; the prefix is ignored.
  if (base.mnemonic === 'EX' && base.operands[0]?.t === 'fixed' && base.operands[0].op.kind === 'reg16' && base.operands[0].op.reg === 'DE') return noop;
  const hasIndHL = base.operands.some(isIndHL);
  const bare = base.mnemonic === 'JP';
  let changed = false;
  const operands = base.operands.map((o): TemplateOperand => {
    if (o.t !== 'fixed') return o;
    const op = o.op;
    if (op.kind === 'reg16' && op.reg === 'HL') { changed = true; return reg16(ix); }
    if (op.kind === 'ind' && op.reg === 'HL') { changed = true; return bare ? ind(ix) : { t: '(ix+d)', reg: ix }; }
    if (!hasIndHL && op.kind === 'reg' && (op.reg === 'H' || op.reg === 'L')) {
      changed = true;
      return reg(`${ix}${op.reg}` as Reg8);
    }
    return o;
  });
  if (!changed) return noop;
  const indexed = operands.some((o) => o.t === '(ix+d)');
  const halfReg = operands.some((o) => o.t === 'fixed' && o.op.kind === 'reg' && o.op.reg.length === 3);
  let cycles = base.cycles + 4;
  if (indexed) cycles = base.mnemonic === 'LD' && operands.some((o) => o.t === 'n') ? 19 : base.cycles + 12;
  const t: Template = {
    mnemonic: base.mnemonic, operands, cycles, flow: base.flow, documented: !halfReg, flags: flagsOf(base.mnemonic, operands),
    length: base.length + 1 + (indexed ? 1 : 0),
  };
  if (base.cyclesNotTaken !== undefined) t.cyclesNotTaken = base.cyclesNotTaken;
  return t;
}

/** DD CB d op / FD CB d op. Only the (HL) column is documented; the rest are DB. */
function indexCbEntry(cb: Template, op: number, ix: IndexReg): Template {
  const x = op >> 6, z = op & 7;
  const cycles = x === 1 ? 20 : 23;
  if (z !== 6) return db([ix === 'IX' ? 0xdd : 0xfd, 0xcb, 'd', op], cycles);
  const operands = cb.operands.map((o): TemplateOperand => (isIndHL(o) ? { t: '(ix+d)', reg: ix } : o));
  return { mnemonic: cb.mnemonic, operands, length: 4, cycles, flow: cb.flow, documented: cb.documented, flags: flagsOf(cb.mnemonic, operands) };
}

function table(make: (op: number) => Template): Template[] {
  const out: Template[] = [];
  for (let op = 0; op < 256; op++) out.push(make(op));
  return out;
}

export interface Tables {
  base: Template[]; cb: Template[]; ed: Template[]; dd: Template[]; fd: Template[]; ddcb: Template[]; fdcb: Template[];
}

export function generateTables(): Tables {
  const base = table(baseEntry);
  const cb = table(cbEntry);
  const ed = table(edEntry);
  const dd = table((op) => indexEntry(base[op]!, 'IX'));
  const fd = table((op) => indexEntry(base[op]!, 'IY'));
  const ddcb = table((op) => indexCbEntry(cb[op]!, op, 'IX'));
  const fdcb = table((op) => indexCbEntry(cb[op]!, op, 'IY'));
  return { base, cb, ed, dd, fd, ddcb, fdcb };
}

export const TABLES: Tables = generateTables();
