/**
 * The per-mnemonic sentence templates, with branches for the operand shapes:
 * loads, arithmetic and logic, rotates and bits here; jumps, calls, block
 * instructions, I/O and the rest in words-flow.ts. Every template fills in the
 * values the tracker proved and the names the program and tables give, and says
 * less when a value is not proven.
 */
import type { Operand } from '@fugloy/z80';
import { renderInstruction } from '../emit/operands.js';
import { dataReference } from '../analysis/symbols.js';
import { byte$, decimal, nameOf, say, screenText, word$ } from './machine.js';
import { bitsText, isMemory, operand8, operandAt, place, regPhrase, spell, valueOf } from './phrase.js';
import type { LineCtx, Words } from './phrase.js';
import { flowWords } from './words-flow.js';
import type { Piece } from './types.js';

/** The lead sentences for the instruction in `c`. Never empty. */
export function words(c: LineCtx): Words {
  const out = loadWords(c) ?? arithWords(c) ?? bitWords(c) ?? flowWords(c);
  if (out !== undefined && out.length > 0) return out;
  return [say(`Run ${renderInstruction(c.ins, c.a.symbols)}.`)];
}

/** The target of a rotate, shift or bit instruction: a register or a memory place. */
const target = (c: LineCtx, op: Operand | undefined): Piece[] => (op !== undefined && isMemory(op) ? place(c, op) : op?.kind === 'reg' ? [{ text: spell(op.reg) }] : operand8(c, op));

/** `Put $3F80 (VIDEO+0380H, …) into IX`: the value an `LD rr,nn` loads, named when the program or tables name it. */
function wordValue(c: LineCtx, reg: string, v: number): Piece[] {
  const isAddress = dataReference(c.ins) === v;
  const named = isAddress && (nameOf(c, v, 'data') !== undefined || screenText(v) !== undefined);
  if (named) return operandAt(c, v);
  const counts = reg === 'BC';
  return [{ text: counts ? `${word$(v)} (${decimal(v)})` : word$(v) }];
}

const GLOSS: Readonly<Record<string, string>> = { IX: 'IX (an index register)', IY: 'IY (an index register)' };

function loadWords(c: LineCtx): Words | undefined {
  const { ins } = c;
  if (ins.mnemonic !== 'LD') return undefined;
  const [d, s] = ins.operands;
  if (d === undefined || s === undefined) return undefined;
  // 16-bit loads.
  if (d.kind === 'reg16') {
    if (d.reg === 'SP') {
      if (s.kind === 'imm16') return [say(`Set the stack pointer (SP) to ${word$(s.value)}: the stack grows down from there.`)];
      if (s.kind === 'mem') return [say('Set the stack pointer (SP) to ', place(c, s, 'word'), '.')];
      return [say('Set the stack pointer (SP) to ', s.kind === 'reg16' ? regPhrase(c, s.reg) : operand8(c, s), '.')];
    }
    if (s.kind === 'imm16') return [say('Put ', wordValue(c, d.reg, s.value), ` into ${GLOSS[d.reg] ?? d.reg}.`)];
    if (s.kind === 'mem') return [say('Get ', place(c, s, 'word'), ` and put it in ${d.reg}: the low byte from ${word$(s.addr)}, the high byte from ${word$(s.addr + 1)}.`)];
  }
  if (d.kind === 'mem' && s.kind === 'reg16') {
    const who = s.reg === 'SP' ? [{ text: 'the stack pointer (SP)' }] : regPhrase(c, s.reg);
    return [say('Store ', who, ' in the two bytes at ', operandAt(c, d.addr), ', low byte first.')];
  }
  // 8-bit loads.
  if (d.kind === 'reg') {
    if (s.kind === 'imm8') return [say(`Put ${byte$(s.value)} into ${d.reg === 'A' ? 'A (the accumulator)' : spell(d.reg)}.`)];
    if (isMemory(s)) return [say('Get ', place(c, s), ` and put it in ${spell(d.reg)}.`)];
    if (s.kind === 'reg') {
      const note = s.reg === 'R' ? ', a value that changes all the time and is often used as a cheap random number' : '';
      return [say('Copy ', regPhrase(c, s.reg), ` into ${spell(d.reg)}${note}.`)];
    }
  }
  if (isMemory(d)) {
    if (s.kind === 'imm8') return [say(`Store ${byte$(s.value)} in `, place(c, d), '.')];
    return [say('Store ', operand8(c, s), ' in ', place(c, d), '.')];
  }
  return undefined;
}

const ALU8 = new Set(['ADD', 'ADC', 'SUB', 'SBC', 'AND', 'OR', 'XOR', 'CP']);

function arithWords(c: LineCtx): Words | undefined {
  const { ins } = c;
  const m = ins.mnemonic;
  const ops = ins.operands;
  if ((m === 'ADD' || m === 'ADC' || m === 'SBC') && ops[0]?.kind === 'reg16') {
    const [d, s] = ops as [Extract<Operand, { kind: 'reg16' }>, Operand];
    const src = s.kind === 'reg16' ? s.reg : '?';
    if (m === 'ADD' && src === d.reg) return [say(`Double ${d.reg} (add it to itself).`)];
    if (m === 'ADD') return [say('Add ', regPhrase(c, src), ` to ${d.reg}.`)];
    if (m === 'ADC') return [say('Add ', regPhrase(c, src), ` and the carry flag to ${d.reg} (a 16-bit add with carry).`)];
    if (src === d.reg) return [say(`Subtract ${d.reg} and the carry flag from itself: ${d.reg} becomes 0, or $FFFF when the carry was set.`)];
    return [say('Subtract ', regPhrase(c, src), ` and the carry flag from ${d.reg} (a 16-bit subtract with carry).`)];
  }
  if (ALU8.has(m)) {
    // ADD A,s / ADC A,s / SBC A,s name A first; SUB s / AND s / OR s / XOR s / CP s do not.
    const s = ops.length === 2 ? ops[1] : ops[0];
    const sIsA = s?.kind === 'reg' && s.reg === 'A';
    const src = operand8(c, s);
    const imm = s?.kind === 'imm8' ? s.value : undefined;
    switch (m) {
      case 'ADD':
        return [sIsA ? say('Double A (add it to itself).') : say('Add ', src, ' to A.')];
      case 'ADC':
        return [say('Add ', src, ' and the carry flag to A.')];
      case 'SUB':
        return [sIsA ? say('Set A to 0 (subtract it from itself).') : say('Subtract ', src, ' from A.')];
      case 'SBC':
        return [sIsA ? say('Subtract A and the carry flag from itself: A becomes 0, or $FF when the carry was set.') : say('Subtract ', src, ' and the carry flag from A.')];
      case 'AND':
        if (sIsA) return [say('Test A without changing it: Z is set if A is 0 and S if bit 7 is set (AND A, which also clears the carry).')];
        if (imm === 0) return [say('Clear A to 0 (AND $00).')];
        if (imm === 0xff) return [say('Test A without changing it (AND $FF): Z is set if A is 0.')];
        if (imm !== undefined) return [say(`Keep only ${bitsText(imm)} of A, clearing the rest (AND ${byte$(imm)}).`)];
        return [say('Keep only the bits of A that are also set in ', src, ' (AND).')];
      case 'OR':
        if (sIsA) return [say('Test A without changing it: Z is set if A is 0 and S if bit 7 is set (OR A, which also clears the carry).')];
        if (imm === 0) return [say('Test A without changing it (OR $00): Z is set if A is 0.')];
        if (imm !== undefined) return [say(`Set ${bitsText(imm)} of A to 1 (OR ${byte$(imm)}).`)];
        return [say('Combine ', src, ' into A, setting each bit that is set in either (OR).')];
      case 'XOR':
        if (sIsA) return [say('Set A to 0 (XOR A, the short way to clear it).')];
        if (imm === 0) return [say('Test A without changing it (XOR $00): Z is set if A is 0.')];
        if (imm === 0xff) return [say('Flip every bit of A (XOR $FF).')];
        if (imm !== undefined) return [say(`Flip ${bitsText(imm)} of A (XOR ${byte$(imm)}).`)];
        return [say('Flip the bits of A that are set in ', src, ' (XOR).')];
      case 'CP':
        if (sIsA) return [say('Compare A with itself: Z is always set and the carry cleared (CP A).')];
        return [say('Compare A with ', src, ': Z is set if they are equal, C if A is smaller (CP subtracts without keeping the result).')];
    }
  }
  if (m === 'INC' || m === 'DEC') {
    const op = ops[0];
    const verb = m === 'INC' ? 'Add 1 to ' : 'Subtract 1 from ';
    if (op === undefined) return undefined;
    if (isMemory(op)) return [say(verb, place(c, op), '.')];
    const r = op.kind === 'reg' || op.kind === 'reg16' ? op.reg : '?';
    const v = valueOf(c, r);
    if (v === null) return [say(`${verb}${spell(r)}${op.kind === 'reg16' ? '; as a 16-bit step, it changes no flags' : ''}.`)];
    const wide = op.kind === 'reg16';
    const next = (v + (m === 'INC' ? 1 : -1)) & (wide ? 0xffff : 0xff);
    const show = wide ? word$ : byte$;
    return [say(`${verb}${spell(r)} (${show(v)}, making ${show(next)}).`)];
  }
  const A_ONLY: Readonly<Record<string, string>> = {
    CPL: 'Flip every bit of A (CPL, complement).',
    NEG: 'Make A negative: A becomes 0 minus A (NEG, negate).',
    DAA: 'Adjust A after an addition or subtraction so it holds a valid two-digit decimal number (DAA, decimal adjust for BCD).',
    SCF: 'Set the carry flag to 1 (SCF).',
    CCF: 'Flip the carry flag (CCF, complement carry).',
  };
  const fixed = A_ONLY[m];
  return fixed === undefined ? undefined : [say(fixed)];
}

const ROTATE: Readonly<Record<string, string>> = {
  RLC: 'Rotate {t} left one bit: bit 7 moves round to bit 0 and into the carry flag.',
  RRC: 'Rotate {t} right one bit: bit 0 moves round to bit 7 and into the carry flag.',
  RL: 'Rotate {t} left one bit through the carry flag: the carry goes into bit 0 and bit 7 into the carry.',
  RR: 'Rotate {t} right one bit through the carry flag: the carry goes into bit 7 and bit 0 into the carry.',
  SLA: 'Shift {t} left one bit, doubling it: bit 7 goes into the carry flag and bit 0 becomes 0.',
  SRA: 'Shift {t} right one bit, halving it and keeping its sign: bit 7 stays, bit 0 goes into the carry flag.',
  SRL: 'Shift {t} right one bit, halving it: bit 0 goes into the carry flag and bit 7 becomes 0.',
  SLL: 'Shift {t} left one bit and set bit 0 to 1: bit 7 goes into the carry flag (SLL, an undocumented instruction).',
};
const ROTATE_A: Readonly<Record<string, string>> = { RLCA: 'RLC', RRCA: 'RRC', RLA: 'RL', RRA: 'RR' };

/** `text` with `{t}` replaced by the target pieces. */
function fill(text: string, t: Piece[]): Piece[] {
  const [before, after] = text.split('{t}') as [string, string];
  return say(before, t, after);
}

function bitWords(c: LineCtx): Words | undefined {
  const { ins } = c;
  const m = ins.mnemonic;
  const [a, b] = ins.operands;
  if (ROTATE_A[m] !== undefined) return [fill(ROTATE[ROTATE_A[m]]!.replace('.', ` (${m}, the one-byte form for A).`), [{ text: 'A' }])];
  if (ROTATE[m] !== undefined) return [fill(ROTATE[m], target(c, a))];
  if (m === 'RLD' || m === 'RRD') {
    const dir = m === 'RLD' ? 'left' : 'right';
    return [say(`Rotate 4-bit digits ${dir} through the low half of A and `, place(c, { kind: 'ind', reg: 'HL' }), ` (${m}, used for decimal digits).`)];
  }
  if ((m === 'BIT' || m === 'SET' || m === 'RES') && a?.kind === 'bit') {
    const t = target(c, b);
    if (m === 'BIT') return [say(`Test bit ${a.bit} of `, t, ': Z is set if the bit is 0, clear if it is 1.')];
    if (m === 'SET') return [say(`Set bit ${a.bit} of `, t, ' to 1.')];
    return [say(`Clear bit ${a.bit} of `, t, ' to 0.')];
  }
  return undefined;
}
