/**
 * Templates for control flow, the stack, block instructions, I/O and the
 * one-off instructions: jumps and calls name their targets (ROM routines by
 * their cited purpose), ports read through the symbol tables, RST 08H mentions
 * its inline byte, and calls say what is proven going in.
 */
import { externalNote, previousInstruction } from '../emit/operands.js';
import { addrPiece, andList, byte$, decimal, portPhrase, routineKind, say, tableName, word$ } from './machine.js';
import { at, condition, count, need, operand8, operandAt, pointer, portIn, ref, regPhrase, spell, valueOf } from './phrase.js';
import type { LineCtx, Words } from './phrase.js';
import type { Piece, Sentence } from './types.js';

export function flowWords(c: LineCtx): Words | undefined {
  return jumpWords(c) ?? callWords(c) ?? stackWords(c) ?? blockWords(c) ?? ioWords(c) ?? miscWords(c);
}

/** The jump or call target operand, or undefined. */
function targetOf(c: LineCtx): number | undefined {
  for (const op of c.ins.operands) {
    if (op.kind === 'rel') return op.target;
    if (op.kind === 'imm16') return op.value;
  }
  return undefined;
}

/** `: purpose` for a target the tables name, outside the program. */
function purposeOf(c: LineCtx, addr: number): string {
  if (c.a.symbols.has(addr)) return '';
  const entry = tableName(c, addr, 'code')?.entry;
  return entry === undefined ? '' : `: ${entry.purpose}`;
}

function jumpWords(c: LineCtx): Words | undefined {
  const { ins, addr } = c;
  const m = ins.mnemonic;
  if (m === 'JP' && ins.flow.indirect) {
    const reg = ins.operands[0]?.kind === 'ind' ? ins.operands[0].reg : 'HL';
    const v = valueOf(c, reg);
    if (v === null) {
      need(c, reg);
      return [say(`Jump to the address in ${reg} (a computed jump: the target is worked out as the program runs).`)];
    }
    return [say('Jump to ', at(c, v, 'code'), `, the address in ${reg}${purposeOf(c, v)}.`)];
  }
  if (m === 'DJNZ') {
    const t = targetOf(c)!;
    const dir = t <= addr ? 'back' : 'ahead';
    return [say(`Subtract 1 from B and, unless B is now 0, jump ${dir} to `, operandAt(c, t, 'code'), '; when B reaches 0, carry on with the next line (DJNZ, decrement and jump if not zero).')];
  }
  if (m !== 'JP' && m !== 'JR') return undefined;
  const t = targetOf(c);
  if (t === undefined) return undefined;
  const cond = condition(ins);
  const where = operandAt(c, t, 'code');
  const purpose = purposeOf(c, t);
  if (t === addr) {
    return cond === undefined
      ? [say('Jump to this same line again, forever: an endless loop that only an interrupt can leave.')]
      : [say(`While ${cond}, jump to this same line again; otherwise carry on with the next line.`)];
  }
  if (cond === undefined) return [say('Jump to ', where, `${purpose}.`)];
  if (purpose !== '') return [say(`If ${cond}, jump to `, where, `${purpose}.`), say('Otherwise carry on with the next line.')];
  return [say(`If ${cond}, jump to `, where, '; otherwise carry on with the next line.')];
}

/** `Going in, BC holds $2000 (8,192).`: the registers proven before a call, pairs where both halves are known. */
function goingIn(c: LineCtx): Sentence | undefined {
  const items: string[] = [];
  const add = (r: string, v: number, wide: boolean, counts: boolean): void => {
    items.push(`${r} holds ${wide ? word$(v) : byte$(v)}${counts ? ` (${decimal(v)})` : ''}`);
  };
  const a = valueOf(c, 'A');
  if (a !== null) add('A', a, false, false);
  for (const [p, hi, lo] of [['BC', 'B', 'C'], ['DE', 'D', 'E'], ['HL', 'H', 'L'], ['IX', 'IXH', 'IXL'], ['IY', 'IYH', 'IYL']] as const) {
    const v = valueOf(c, p);
    if (v !== null) {
      add(p, v, true, p === 'BC');
      continue;
    }
    for (const half of [hi, lo]) {
      const h = valueOf(c, half);
      if (h !== null) add(half, h, false, half === 'B');
    }
  }
  if (items.length === 0) return undefined;
  return say('Going in, ', andList(items, (t) => [{ text: t }]), '.');
}

function callWords(c: LineCtx): Words | undefined {
  const { ins } = c;
  const m = ins.mnemonic;
  if (m === 'RST') return rstWords(c);
  if (m === 'CALL') {
    const t = targetOf(c)!;
    if (c.patched.length === 0) ref(c, t, 'code');
    const own = c.a.symbols.get(t);
    const table = own === undefined ? tableName(c, t, 'code') : undefined;
    const cond = condition(ins);
    const lead = cond === undefined ? 'Call ' : `If ${cond}, call `;
    const back = cond === undefined ? '; when it returns, carry on with the next line.' : ' and come back; either way, the next line follows.';
    const out: Sentence[] = [];
    if (table !== undefined) {
      out.push(say(lead, `${routineKind(table.entry)} `, { text: table.text, entry: table.entry }, ' (', addrPiece(c, t), `): ${table.entry.purpose}.`));
      if (cond !== undefined) out.push(say('Either way, the next line follows.'));
    } else if (own !== undefined) out.push(say(lead, { text: own.name, addr: t }, ' (', addrPiece(c, t), ')', back));
    else out.push(say(lead, 'the routine at ', addrPiece(c, t), back));
    const into = goingIn(c);
    if (into !== undefined) out.push(into);
    return out;
  }
  if (m === 'RET' || m === 'RETI' || m === 'RETN') {
    const cond = condition(ins);
    if (m === 'RETI') return [say('Return from an interrupt routine to the code it interrupted (RETI).')];
    if (m === 'RETN') return [say('Return from a non-maskable interrupt routine to the code it interrupted (RETN).')];
    // Usually a CALL put that address there, but a PUSH before a RET is a jump too: never claim which.
    if (cond !== undefined) return [say(`If ${cond}, return: carry on at the address on top of the stack (usually the one the CALL that came here put there); otherwise carry on with the next line.`)];
    return [say('Return: carry on at the address on top of the stack (usually the one the CALL that came here put there).')];
  }
  return undefined;
}

function rstWords(c: LineCtx): Words {
  const { ins, addr } = c;
  const op = ins.operands[0];
  const vector = op?.kind === 'rst' ? op.addr : 0;
  ref(c, vector, 'code');
  const note = c.a.externals.selection === undefined ? undefined : externalNote(ins, previousInstruction(c.a.pass1.instructions, c.a.symbols, addr), c.a.externals, c.a.symbols);
  const rst = `RST ${byte$(vector).slice(1)}H, a one-byte call`;
  const out: Sentence[] = [];
  if (note?.entry.kind === 'svc') {
    out.push(say('Call the service ', { text: note.entry.name, entry: note.entry }, ` (SVC ${note.entry.key}) through ${rst}: ${note.entry.purpose}.`));
  } else {
    const own = c.a.symbols.get(vector);
    const table = own === undefined ? tableName(c, vector, 'code') : undefined;
    if (table !== undefined) out.push(say(`Call ${routineKind(table.entry)} `, { text: table.text, entry: table.entry }, ' at ', addrPiece(c, vector), ` (${rst}): ${table.entry.purpose}.`));
    else out.push(say('Call the routine at ', addrPiece(c, vector), ` (${rst}); when it returns, carry on with the next line.`));
  }
  if (vector === 0x08) {
    const next = (addr + 1) & 0xffff;
    const b = c.a.space.image.read(next);
    if (b === undefined) out.push(say('The byte after it is a parameter the routine reads; it comes back past that byte.'));
    else out.push(say(`The byte after it, ${byte$(b)} at `, addrPiece(c, next), ', is a parameter the routine reads; it comes back to ', addrPiece(c, next + 1), ', past that byte.'));
  }
  const into = goingIn(c);
  if (into !== undefined) out.push(into);
  return out;
}

function stackWords(c: LineCtx): Words | undefined {
  const { ins } = c;
  const m = ins.mnemonic;
  const [a, b] = ins.operands;
  if (m === 'PUSH' && a?.kind === 'reg16') {
    if (a.reg === 'AF') return [say('Save A and the flags on the stack (PUSH AF), to get them back later with POP.')];
    return [say('Save ', regPhrase(c, a.reg), ' on the stack (PUSH), to get it back later with POP.')];
  }
  if (m === 'POP' && a?.kind === 'reg16') {
    if (a.reg === 'AF') return [say('Take the word on top of the stack into A and the flags (POP AF): usually what an earlier PUSH AF saved.')];
    return [say(`Take the word on top of the stack into ${a.reg} (POP): usually the value an earlier PUSH saved.`)];
  }
  if (m === 'EX') {
    if (a?.kind === 'ind' && b?.kind === 'reg16') return [say('Swap ', regPhrase(c, b.reg), ' with the word on top of the stack.')];
    if (a?.kind === 'reg16' && a.reg === 'AF') return [say("Swap A and the flags with their spare copies in AF' (the alternate register set).")];
    if (a?.kind === 'reg16' && b?.kind === 'reg16') return [say('Swap ', regPhrase(c, a.reg), ' and ', regPhrase(c, b.reg), '.')];
  }
  if (m === 'EXX') return [say("Swap BC, DE and HL with their spare copies BC', DE' and HL' (the alternate register set).")];
  return undefined;
}

const BLOCK_DIR: Readonly<Record<string, 'up' | 'down'>> = {
  LDI: 'up', LDIR: 'up', LDD: 'down', LDDR: 'down',
  CPI: 'up', CPIR: 'up', CPD: 'down', CPDR: 'down',
  INI: 'up', INIR: 'up', IND: 'down', INDR: 'down',
  OUTI: 'up', OTIR: 'up', OUTD: 'down', OTDR: 'down',
};

function blockWords(c: LineCtx): Words | undefined {
  const m = c.ins.mnemonic;
  const dir = BLOCK_DIR[m];
  if (dir === undefined) return undefined;
  const step = dir === 'up' ? 'add 1 to' : 'subtract 1 from';
  const counting = dir === 'up' ? 'counting up' : 'counting down';
  switch (m) {
    case 'LDI':
    case 'LDD':
      return [say('Copy the byte at ', pointer(c, 'HL'), ' to ', pointer(c, 'DE'), `, then ${step} HL and DE and subtract 1 from BC (one step of a block copy).`)];
    case 'LDIR':
    case 'LDDR': {
      const n = count(c, 'BC');
      return [say('Copy ', n, ' from ', from(c, 'HL'), ' to ', from(c, 'DE'), `, one at a time, ${counting}: BC is the count, HL the source and DE the destination.`)];
    }
    case 'CPI':
    case 'CPD':
      return [say('Compare A with the byte at ', pointer(c, 'HL'), `, then ${step} HL and subtract 1 from BC: Z is set on a match (one step of a search).`)];
    case 'CPIR':
    case 'CPDR':
      return [say('Search up to ', count(c, 'BC'), ' from ', from(c, 'HL'), `, ${counting}, for a byte equal to A: it stops at a match (Z set) or when BC reaches 0.`)];
    case 'INI':
    case 'IND':
      return [say('Read a byte from ', portIn(c).pieces, ' into the byte at ', pointer(c, 'HL'), `, then ${step} HL and subtract 1 from B.`)];
    case 'INIR':
    case 'INDR':
      return [say('Read ', count(c, 'B'), ' from ', portIn(c).pieces, ' into memory from ', from(c, 'HL'), `, ${counting}: B is the count.`)];
    case 'OUTI':
    case 'OUTD':
      return [say('Send the byte at ', pointer(c, 'HL'), ' to ', portIn(c).pieces, `, then ${step} HL and subtract 1 from B.`)];
    default:
      return [say('Send ', count(c, 'B'), ' from ', from(c, 'HL'), ` to `, portIn(c).pieces, `, ${counting}: B is the count.`)];
  }
}

/** A block instruction's start address: proven, or `the address in HL`. */
function from(c: LineCtx, r: 'HL' | 'DE'): Piece[] {
  const v = valueOf(c, r);
  if (v === null) {
    need(c, r);
    return [{ text: `the address in ${r}` }];
  }
  return at(c, v);
}

function ioWords(c: LineCtx): Words | undefined {
  const { ins } = c;
  const [a, b] = ins.operands;
  if (ins.mnemonic === 'IN' && a?.kind === 'reg') {
    if (b?.kind === 'port') {
      const p = portPhrase(c, b.value);
      return [say('Read a byte from ', p.pieces, ` into ${spell(a.reg)}${p.entry === undefined ? '' : `: ${p.entry.purpose}`}.`)];
    }
    const p = portIn(c);
    return [say('Read a byte from ', p.pieces, ` into ${spell(a.reg)}${p.entry === undefined ? '' : `: ${p.entry.purpose}`}.`)];
  }
  if (ins.mnemonic === 'OUT' && b !== undefined) {
    const value = operand8(c, b);
    if (a?.kind === 'port') {
      const p = portPhrase(c, a.value);
      return [say('Send ', value, ' to ', p.pieces, `${p.entry === undefined ? '' : `: ${p.entry.purpose}`}.`)];
    }
    const p = portIn(c);
    return [say('Send ', value, ' to ', p.pieces, `${p.entry === undefined ? '' : `: ${p.entry.purpose}`}.`)];
  }
  return undefined;
}

const IM_TEXT = [
  'Choose interrupt mode 0: on an interrupt, run the instruction the interrupting device puts on the bus (IM 0).',
  'Choose interrupt mode 1: on an interrupt, call the routine at $0038 (IM 1, what the TRS-80 uses).',
  'Choose interrupt mode 2: on an interrupt, call through a table of addresses in the page that I selects (IM 2).',
];

function miscWords(c: LineCtx): Words | undefined {
  const { ins } = c;
  switch (ins.mnemonic) {
    case 'NOP':
      return [say('Do nothing for one step (no operation).')];
    case 'HALT':
      return [say('Stop and wait for an interrupt (HALT).')];
    case 'DI':
      return [say('Turn off interrupts, so nothing breaks in until they are turned back on (DI, disable interrupts).')];
    case 'EI':
      return [say('Turn interrupts back on, from after the next instruction (EI, enable interrupts).')];
    case 'IM': {
      const op = ins.operands[0];
      return [say(IM_TEXT[op?.kind === 'im' ? op.mode : 0]!)];
    }
    case 'DB': {
      const bytes = ins.bytes.map(byte$);
      if (bytes.length === 1) return [say(`The byte ${bytes[0]} is not an instruction on its own here, so the listing shows it as a DB byte.`)];
      return [say(`The bytes ${bytes.join(', ')} are not an instruction the Z80 documents, so the listing shows them as DB bytes.`)];
    }
  }
  return undefined;
}
