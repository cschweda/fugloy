/**
 * The encoder: `@fugloy/z80`'s generated tables inverted at module load, so an
 * instruction's bytes and length come from the same entries the decoder reads
 * and the two cannot disagree. Nothing here names an opcode.
 */
import { TABLES } from '@fugloy/z80';
import type { Tables, Template, TemplateOperand } from '@fugloy/z80';
import { fits, fixedNumber, isImmediate, slotText } from './shape.js';
import type { Operand, Shape } from './shape.js';

type TableName = keyof typeof TABLES;

/** One real encoding: the template, and the bytes that select it. */
export interface Entry {
  tpl: Template;
  table: TableName;
  opcode: number;
  /** The form as text, `A,(BC)`; `b` and `p` stand for a bit number and an RST vector. */
  form: string;
}

/**
 * Base first: where two tables hold the same instruction (`LD (nn),HL` at 22
 * and ED 63, `LD HL,(nn)` at 2A and ED 6B), the first one kept is the base
 * opcode, which is what zmac assembles.
 */
const TABLE_ORDER: readonly TableName[] = ['base', 'cb', 'ed', 'dd', 'fd', 'ddcb', 'fdcb'];

/** The one allowed duplicate: these slots repeat a base instruction, which zmac assembles instead (disasm's BYTE_EXACT_EXCEPTIONS). */
const BASE_DUPLICATES: ReadonlySet<string> = new Set(['ed:63', 'ed:6b']);

const slotName = (table: TableName, opcode: number): string => `${table}:${opcode.toString(16).padStart(2, '0')}`;

/** The shapes the parser gives an entry's own form: the number class for any number, `(nn)` for any memory operand. */
function ownShapes(tpl: Template): Shape[] {
  return tpl.operands.map((o): Shape => {
    if (fixedNumber(o) !== undefined || o.t === 'n' || o.t === 'nn' || o.t === 'e' || o.t === 'd') return 'nn';
    if (o.t === '(n)' || o.t === '(nn)') return '(nn)';
    if (o.t === '(ix+d)') return o.reg === 'IX' ? '(IX+d)' : '(IY+d)';
    return slotText(o) as Shape;
  });
}

/** The fixed number at each slot (bit, vector, mode), which tells apart entries that fit the same shapes. */
const fixedKey = (tpl: Template): string => tpl.operands.map((o) => fixedNumber(o) ?? '').join(',');

/**
 * Every real encoding by mnemonic: no prefix slots, no DB fallbacks for
 * undocumented bytes. Throws if two entries fit the same shapes (and the same
 * fixed numbers), since the encoder would then pick one silently; the base
 * duplicates of ED 63 and ED 6B are the one exception.
 */
export function buildIndex(tables: Tables): Map<string, Entry[]> {
  const index = new Map<string, Entry[]>();
  for (const table of TABLE_ORDER) {
    tables[table].forEach((tpl, opcode) => {
      if (tpl.prefix !== undefined || tpl.mnemonic === 'DB') return;
      const list = index.get(tpl.mnemonic) ?? [];
      list.push({ tpl, table, opcode, form: tpl.operands.map(slotText).join(',') });
      index.set(tpl.mnemonic, list);
    });
  }
  for (const [mnemonic, entries] of index) {
    const kept = entries.filter((e) => {
      const rivals = fitting(entries, ownShapes(e.tpl)).filter((r) => r !== e && fixedKey(r.tpl) === fixedKey(e.tpl));
      if (rivals.length === 0) return true;
      if (BASE_DUPLICATES.has(slotName(e.table, e.opcode))) return false;
      if (rivals.every((r) => BASE_DUPLICATES.has(slotName(r.table, r.opcode)))) return true;
      throw new Error(`The z80 tables give ${mnemonic} ${e.form} two encodings the encoder cannot tell apart: ${[e, ...rivals].map((r) => slotName(r.table, r.opcode)).join(' and ')}.`);
    });
    index.set(mnemonic, kept);
  }
  return index;
}

/** The entries that `shapes` fit: exact fits first, then reading `(IX)` as `(IX+0)`. */
function fitting(entries: readonly Entry[], shapes: readonly Shape[]): Entry[] {
  const match = (indexZero: boolean): Entry[] =>
    entries.filter((e) => e.tpl.operands.length === shapes.length && e.tpl.operands.every((o, i) => fits(shapes[i]!, o, indexZero)));
  const exact = match(false);
  return exact.length > 0 ? exact : match(true);
}

const INDEX: ReadonlyMap<string, readonly Entry[]> = buildIndex(TABLES);

/** The entries of `mnemonic` that `shapes` fit. */
const candidates = (mnemonic: string, shapes: readonly Shape[]): Entry[] => fitting(INDEX.get(mnemonic) ?? [], shapes);

/** The bytes that select an entry, before its operand bytes; `d` goes between CB and the opcode in DDCB and FDCB. */
function lead(entry: Entry, d: number): number[] {
  switch (entry.table) {
    case 'base':
      return [entry.opcode];
    case 'cb':
      return [0xcb, entry.opcode];
    case 'ed':
      return [0xed, entry.opcode];
    case 'dd':
      return [0xdd, entry.opcode];
    case 'fd':
      return [0xfd, entry.opcode];
    case 'ddcb':
      return [0xdd, 0xcb, d & 0xff, entry.opcode];
    case 'fdcb':
      return [0xfd, 0xcb, d & 0xff, entry.opcode];
  }
}

/** `9`, `128 ($80)`, `4660 ($1234)`: a value as written, with its hex beside it once that helps. */
function show(value: number): string {
  if (value <= 9) return String(value);
  const digits = value > 0xff ? Math.max(4, value.toString(16).length) : 2;
  return `${value} ($${value.toString(16).toUpperCase().padStart(digits, '0')})`;
}

/** `$3C00`: an address in prose. */
const address = (value: number): string => `$${(value & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;

/** A number as zmac source writes it: `8`, `10H`, `38H`. */
const asSource = (value: number): string => (value <= 9 ? String(value) : `${value.toString(16).toUpperCase()}H`);

/** `a`, `a or b`, `a, b, or c`; with `and` for a list of facts. */
function list(items: readonly string[], word: 'or' | 'and'): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} ${word} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, ${word} ${items[items.length - 1]}`;
}

const formName = (mnemonic: string, entry: Entry): string => (entry.form === '' ? mnemonic : `${mnemonic} ${entry.form}`);

/** The sorted, distinct forms of a mnemonic's entries. */
const formsOf = (entries: readonly Entry[]): string[] => [...new Set(entries.map((e) => e.form))].sort();

/**
 * An operand as a message names it: a number is `n` or `nn`, a relative
 * target `displacement`, a port `(port)`; registers and the rest as written.
 */
const WORDS: Readonly<Record<string, string>> = { num: 'n', e: 'displacement', '(n)': '(port)' };
const word = (shape: string): string => WORDS[shape] ?? shape;

/**
 * IN F,(C), IN (C), and OUT (C),0 are ED 70 and ED 71, which the z80 tables
 * hold as DB fallbacks (undocumented), so the disassembler writes them as DB
 * and the encoder has no template for them. The sentence says how to write them.
 */
function undocumentedEd(mnemonic: string, operands: readonly Operand[]): string | undefined {
  const shapes = operands.map((o) => o.shape).join(',');
  const db = (form: string, low: string): string => `${mnemonic} ${form} is undocumented, and Fugløy writes it as DB 0EDH,${low}H; use that instead.`;
  if (mnemonic === 'IN' && (shapes === 'F,(C)' || shapes === '(C)')) return db(shapes, '70');
  if (mnemonic === 'OUT' && operands.length === 2 && operands[0]!.shape === '(C)' && isImmediate(operands[1]!.shape) && operands[1]!.value === 0) return db('(C),0', '71');
  return undefined;
}

/** The sentence for a form the mnemonic lacks, with the forms worth trying instead. */
function noForm(mnemonic: string, shapes: readonly Shape[], entries: readonly Entry[]): string {
  const said = shapes.map(word);
  const head = `${mnemonic} has no form ${said.join(',')}.`;
  const all = formsOf(entries).map((f) => (f === '' ? f : f.split(',').map(word).join(',')));
  if (all.length === 1 && all[0] === '') return `${head} ${mnemonic} takes no operands.`;
  const first = said[0];
  const sharing = first === undefined ? [] : all.filter((f) => f.split(',')[0] === first);
  if (sharing.length === 1) return `${head} The form that starts with ${first} is ${sharing[0]}.`;
  if (sharing.length > 1) return `${head} The forms that start with ${first} are ${list(sharing, 'and')}.`;
  const shown = all.map((f) => (f === '' ? `${mnemonic} alone` : f));
  if (shown.length <= 12) return `${head} Its forms are ${list(shown, 'and')}.`;
  return `${head} It has ${shown.length} forms, among them ${list([...shown.slice(0, 8), 'more'], 'and')}.`;
}

/** The sentence for a fixed number (bit, vector, mode) that no entry has. */
function badFixed(mnemonic: string, slot: TemplateOperand, value: number, allowed: number[]): string {
  if (slot.t === 'fixed' && slot.op.kind === 'bit') {
    return `${mnemonic} takes a bit number from ${Math.min(...allowed)} to ${Math.max(...allowed)}; ${show(value)} is out of range.`;
  }
  return `${mnemonic} takes ${list(allowed.map(asSource), 'or')}; ${show(value)} is not one of them.`;
}

const signed16 = (v: number): number => (v & 0x8000 ? (v & 0xffff) - 0x10000 : v & 0xffff);

/** What a relative jump that cannot reach should become instead. */
const RELATIVE_FIX: Readonly<Record<string, string>> = { JR: 'Use JP.', DJNZ: 'Use DEC B and JP NZ.' };

export type EncodeResult = { bytes: number[] } | { error: string };

/**
 * The bytes of one instruction. `pc` is its runtime address, from which a
 * relative jump's `e` (given as the target address) is measured. An error is a
 * sentence naming the problem and the limit; no bytes come with it.
 */
export function encode(mnemonic: string, operands: readonly Operand[], pc: number): EncodeResult {
  const mn = mnemonic.toUpperCase();
  const entries = INDEX.get(mn);
  if (entries === undefined) return { error: `Unknown instruction ${mn}.` };
  const shapes = operands.map((o) => o.shape);
  let found = candidates(mn, shapes);
  if (found.length === 0) return { error: undocumentedEd(mn, operands) ?? noForm(mn, shapes, entries) };

  // A fixed number (bit, RST vector, IM mode) picks the entry by its value.
  const fixedAt = found[0]!.tpl.operands.findIndex((o) => fixedNumber(o) !== undefined);
  if (fixedAt >= 0) {
    const slot = found[0]!.tpl.operands[fixedAt]!;
    const value = operands[fixedAt]!.value;
    if (value === undefined) return { error: `${formName(mn, found[0]!)} needs a value for ${slotText(slot)}.` };
    const exact = found.filter((e) => fixedNumber(e.tpl.operands[fixedAt]!) === value);
    if (exact.length === 0) {
      const allowed = [...new Set(found.map((e) => fixedNumber(e.tpl.operands[fixedAt]!)!))].sort((a, b) => a - b);
      return { error: badFixed(mn, slot, value, allowed) };
    }
    found = exact;
  }

  const entry = found[0]!;
  const { tpl } = entry;
  const name = formName(mn, entry);
  const tail: number[] = [];
  let d = 0;
  for (let i = 0; i < tpl.operands.length; i++) {
    const slot = tpl.operands[i]!;
    if (slot.t === 'fixed') continue;
    const given = operands[i]!;
    // (IX) read as (IX+0) carries no value.
    const value = slot.t === '(ix+d)' && given.shape === `(${slot.reg})` ? 0 : given.value;
    if (value === undefined) return { error: `${name} needs a value for ${slotText(slot)}.` };
    if (!Number.isInteger(value)) return { error: `${name} needs a whole number for ${slotText(slot)}; ${value} is not one.` };
    switch (slot.t) {
      case 'n':
      case 'd':
      case '(n)': {
        if (value < -128 || value > 255) return { error: `${name} takes ${slot.t === '(n)' ? 'a port' : 'a byte'}, -128 to 255; ${show(value)} is out of range.` };
        tail.push(value & 0xff);
        break;
      }
      case 'nn':
      case '(nn)': {
        if (value < -32768 || value > 0xffff) return { error: `${name} takes ${slot.t === 'nn' ? 'a word' : 'an address'}, -32768 to 65535; ${show(value)} is out of range.` };
        tail.push(value & 0xff, (value >> 8) & 0xff);
        break;
      }
      case 'e': {
        if (value < -32768 || value > 0xffff) return { error: `${name} takes an address, -32768 to 65535; ${show(value)} is out of range.` };
        const disp = signed16(value - (pc + tpl.length));
        if (disp < -128 || disp > 127) {
          const where = disp > 0 ? `${disp} bytes ahead` : `${-disp} bytes back`;
          return { error: `${mn} reaches 128 bytes either way; the target ${address(value)} is ${where}. ${RELATIVE_FIX[mn] ?? 'Use JP.'}` };
        }
        tail.push(disp & 0xff);
        break;
      }
      case '(ix+d)': {
        if (value < -128 || value > 127) return { error: `The displacement in (${slot.reg}+d) runs from -128 to 127; ${show(value)} is out of range.` };
        d = value;
        // In DDCB and FDCB the displacement sits before the opcode, in the lead.
        if (entry.table !== 'ddcb' && entry.table !== 'fdcb') tail.push(value & 0xff);
        break;
      }
    }
  }
  return { bytes: [...lead(entry, d), ...tail] };
}

/** The length of the form `shapes` select, from the template alone (pass 1 needs no values); null if there is no such form. */
export function lengthOf(mnemonic: string, shapes: readonly Shape[]): number | null {
  return candidates(mnemonic.toUpperCase(), shapes)[0]?.tpl.length ?? null;
}

/** Every operand form of `mnemonic` as text, sorted (`''` for none); empty for an unknown mnemonic. */
export function forms(mnemonic: string): string[] {
  return formsOf(INDEX.get(mnemonic.toUpperCase()) ?? []);
}

/** Every mnemonic the tables know, sorted. */
export function mnemonics(): string[] {
  return [...INDEX.keys()].sort();
}
