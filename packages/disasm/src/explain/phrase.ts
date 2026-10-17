/**
 * Phrasing operands for the per-mnemonic templates: registers with their proven
 * values, memory operands as "the byte at …" with the address filled in when it
 * is proven, and the addresses each line refers to (for previews) and the
 * registers it needed but could not prove (for the "where from" sentence).
 */
import type { Instruction, Operand } from '@fugloy/z80';
import { pair } from '../analysis/regs.js';
import type { Reg8Name, RegState } from '../analysis/regs.js';
import { addrPhrase, byte$, decimal, portPhrase, word$ } from './machine.js';
import type { Ctx } from './machine.js';
import type { Piece, Sentence } from './types.js';
import type { TableEntry } from '../symbols/types.js';

/** One line being explained: the context, the instruction, and what is proven just before it. */
export interface LineCtx extends Ctx {
  addr: number;
  ins: Instruction;
  regs: RegState;
  /** Addresses the line refers to, in order, for the previews. */
  refs: { addr: number; use: 'code' | 'data' }[];
  /** Registers the line uses as an address, count or port whose value is not proven. */
  needs: string[];
}

/** The result of a template: the lead sentences. */
export type Words = Sentence[];

const REG8: ReadonlySet<string> = new Set(['A', 'B', 'C', 'D', 'E', 'H', 'L', 'IXH', 'IXL', 'IYH', 'IYL']);
const PAIRS: ReadonlySet<string> = new Set(['BC', 'DE', 'HL', 'IX', 'IY']);

/** A register's proven value, or null (unknown, or a register the tracker does not follow: SP, I, R, AF). */
export function valueOf(c: LineCtx, r: string): number | null {
  if (REG8.has(r)) return c.regs[r as Reg8Name];
  if (PAIRS.has(r)) return pair(c.regs, r as 'BC' | 'DE' | 'HL' | 'IX' | 'IY');
  return null;
}

/** How a register is spelled in a sentence; the uncommon ones say what they are. */
const SPELLED: Readonly<Record<string, string>> = {
  SP: 'the stack pointer (SP)',
  I: 'I (the interrupt page register)',
  R: 'R (the memory refresh counter)',
  IXH: 'the high byte of IX',
  IXL: 'the low byte of IX',
  IYH: 'the high byte of IY',
  IYL: 'the low byte of IY',
  AF: 'A and the flags (AF)',
};
export const spell = (r: string): string => SPELLED[r] ?? r;

/** `A ($30)` or `BC ($2000)` when proven, else just the register. */
export function regPhrase(c: LineCtx, r: string): Piece[] {
  const v = valueOf(c, r);
  if (v === null) return [{ text: spell(r) }];
  return [{ text: `${spell(r)} (${PAIRS.has(r) ? word$(v) : byte$(v)})` }];
}

/** Records that the line needed `r` and could not prove it. */
export function need(c: LineCtx, r: string): void {
  if (!c.needs.includes(r)) c.needs.push(r);
}

/** Records an address the line refers to, for a preview. */
export function ref(c: LineCtx, addr: number, use: 'code' | 'data'): void {
  const a = addr & 0xffff;
  if (!c.refs.some((r) => r.addr === a)) c.refs.push({ addr: a, use });
}

/** `$7004 (DATA_7004)`, recorded as a reference. */
export function at(c: LineCtx, addr: number, use: 'code' | 'data' = 'data', how?: string): Piece[] {
  ref(c, addr, use);
  return addrPhrase(c, addr, use, how);
}

/** `the address in HL`, or the proven address with `the address in HL` in its parentheses. */
export function pointer(c: LineCtx, r: string): Piece[] {
  const v = valueOf(c, r);
  if (v === null) {
    need(c, r);
    return [{ text: `the address in ${r}` }];
  }
  return at(c, v, 'data', `the address in ${r}`);
}

const disp = (d: number): string => (d < 0 ? `-${byte$(-d)}` : `+${byte$(d)}`);

/**
 * A memory operand as a noun: `the byte at $7004 (DATA_7004)`, `the byte at the
 * address in HL`, `the byte at IX+$05`. `unit` is `byte` or `word`.
 */
export function place(c: LineCtx, op: Operand, unit: 'byte' | 'word' = 'byte'): Piece[] {
  const the: Piece = { text: `the ${unit} at ` };
  switch (op.kind) {
    case 'mem':
      return [the, ...at(c, op.addr)];
    case 'ind':
      if (op.reg === 'SP') return [{ text: `the ${unit} on top of the stack` }];
      if (op.reg === 'C') return portIn(c).pieces;
      return [the, ...pointer(c, op.reg)];
    case 'idx': {
      const base = valueOf(c, op.reg);
      if (base === null) {
        need(c, op.reg);
        return [the, { text: `${op.reg}${disp(op.disp)}` }];
      }
      return [the, ...at(c, (base + op.disp) & 0xffff, 'data', `${op.reg}${disp(op.disp)}`)];
    }
    default:
      return [{ text: 'memory' }];
  }
}

/** True for an operand that names memory: (nn), (rr), (IX+d). */
export const isMemory = (op: Operand | undefined): boolean => op?.kind === 'mem' || op?.kind === 'idx' || (op?.kind === 'ind' && op.reg !== 'C');

/** An 8-bit operand as a noun: a register (with its value), a number, or a memory place. */
export function operand8(c: LineCtx, op: Operand | undefined): Piece[] {
  if (op === undefined) return [{ text: 'A' }];
  switch (op.kind) {
    case 'reg':
      return regPhrase(c, op.reg);
    case 'reg16':
      return regPhrase(c, op.reg);
    case 'imm8':
    case 'byte':
      return [{ text: byte$(op.value) }];
    case 'imm16':
      return [{ text: word$(op.value) }];
    default:
      return place(c, op);
  }
}

/** The port in C: `port $FF (CASSETTE), the port in C` when C is proven, else `the port in C`. */
export function portIn(c: LineCtx): { pieces: Piece[]; entry?: TableEntry } {
  const v = valueOf(c, 'C');
  if (v === null) {
    need(c, 'C');
    return { pieces: [{ text: 'the port in C' }] };
  }
  const p = portPhrase(c, v);
  return { pieces: [...p.pieces, { text: ', the port in C' }], ...(p.entry === undefined ? {} : { entry: p.entry }) };
}

/** `$3681 (13,953) bytes`, or `BC bytes` when the count is not proven. BC = 0 means 65,536; B = 0 means 256. */
export function count(c: LineCtx, r: 'BC' | 'B'): Piece[] {
  const v = valueOf(c, r);
  if (v === null) {
    need(c, r);
    return [{ text: `${r} bytes` }];
  }
  const n = v === 0 ? (r === 'BC' ? 65536 : 256) : v;
  const shown = r === 'BC' ? word$(v) : byte$(v);
  return [{ text: `${shown} (${decimal(n)}) ${n === 1 ? 'byte' : 'bytes'}` }];
}

/** `bits 4–7`, `bit 3`, `bits 0, 3 and 5`. */
export function bitsText(n: number): string {
  const runs: [number, number][] = [];
  for (let b = 0; b < 8; b++) {
    if ((n & (1 << b)) === 0) continue;
    const last = runs.at(-1);
    if (last !== undefined && last[1] === b - 1) last[1] = b;
    else runs.push([b, b]);
  }
  const parts: string[] = [];
  for (const [lo, hi] of runs) {
    if (hi - lo >= 2) parts.push(`${lo}–${hi}`);
    else for (let b = lo; b <= hi; b++) parts.push(String(b));
  }
  const single = parts.length === 1 && !parts[0]!.includes('–');
  const list = parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `${single ? 'bit' : 'bits'} ${list}`;
}

/** What a condition tests, in plain words with the flag after. */
export const CONDITION: Readonly<Record<string, string>> = {
  NZ: 'the last result was not zero (Z flag clear)',
  Z: 'the last result was zero (Z flag set)',
  NC: 'there was no carry (C flag clear)',
  C: 'there was a carry (C flag set)',
  PO: 'the parity/overflow flag is clear (PO: odd parity, or no overflow)',
  PE: 'the parity/overflow flag is set (PE: even parity, or overflow)',
  P: 'the last result was positive (S flag clear)',
  M: 'the last result was negative (S flag set)',
};

/** The condition operand of a conditional instruction, or undefined. */
export function condition(ins: Instruction): string | undefined {
  const cc = ins.operands.find((o) => o.kind === 'cc');
  return cc?.kind === 'cc' ? CONDITION[cc.cond] : undefined;
}
