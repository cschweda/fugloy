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
export function show(value: number): string {
  if (value <= 9) return String(value);
  const digits = value > 0xff ? Math.max(4, value.toString(16).length) : 2;
  return `${value} ($${value.toString(16).toUpperCase().padStart(digits, '0')})`;
}

/** `$3C00`: an address in prose. */
const address = (value: number): string => `$${(value & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;

/** A number as zmac source writes it: `8`, `10H`, `38H`. */
export const asSource = (value: number): string => (value <= 9 ? String(value) : `${value.toString(16).toUpperCase()}H`);

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
 * An operand as a message names it, in words rather than the Zilog manual's
 * letters: a number is `number` (a `label` after JP and CALL, and for a
 * relative jump), a port `(port)`, a memory operand `(address)`, a bit
 * number `bit`, an RST vector `address`, and the displacement of `(IX+d)`
 * `offset`; registers and the rest as written.
 */
const WORDS: Readonly<Record<string, string>> = {
  num: 'number',
  n: 'number',
  nn: 'number',
  e: 'label',
  '(n)': '(port)',
  '(nn)': '(address)',
  b: 'bit',
  p: 'address',
  '(IX+d)': '(IX+offset)',
  '(IY+d)': '(IY+offset)',
};
const TARGETS: ReadonlySet<string> = new Set(['JP', 'CALL']);
const word = (shape: string, mnemonic = ''): string => (shape === 'nn' && TARGETS.has(mnemonic) ? 'label' : (WORDS[shape] ?? shape));

/** The jumps and calls, whose operand is where to go. */
const GOES: ReadonlySet<string> = new Set(['JP', 'CALL', 'JR', 'DJNZ']);

/** The example a bare mnemonic's message shows, where the first short form would not be the natural one. */
const EXAMPLES: Readonly<Record<string, string>> = { LD: 'A,number', IN: 'A,(port)', OUT: '(port),A', EX: 'DE,HL', IM: '1', ADD: 'A,number', ADC: 'A,number', SBC: 'A,number', SUB: 'number', AND: 'number', OR: 'number', XOR: 'number', CP: 'number', BIT: '0,A', SET: '0,A', RES: '0,A' };
const RESTARTS = 'one of 0, 8, 10H, 18H, 20H, 28H, 30H, and 38H';

/** The sentence for a mnemonic written with no operands that needs some: what it needs, and one form to copy. */
function needsOperands(mnemonic: string, readable: readonly string[]): string {
  if (GOES.has(mnemonic)) return `${mnemonic} needs a target: write ${mnemonic} label.`;
  if (mnemonic === 'RST') return `RST needs a restart address, ${RESTARTS}: write RST 28H, for example.`;
  const count = (f: string): number => f.split(',').length;
  const fewest = Math.min(...readable.map(count));
  const short = readable.filter((f) => count(f) === fewest);
  const example = EXAMPLES[mnemonic] ?? short.find((f) => f.startsWith('A')) ?? short.find((f) => /^[A-Z]/.test(f)) ?? short[0]!;
  return `${mnemonic} needs ${fewest === 1 ? 'an operand' : 'operands'}: write ${mnemonic} ${example}, for example.`;
}

/**
 * IN F,(C), IN (C), and OUT (C),0 are ED 70 and ED 71, which the z80 tables
 * hold as DB fallbacks (undocumented), so the disassembler writes them as DB
 * and the encoder has no template for them. The sentence says how to write them.
 */
function undocumentedEd(mnemonic: string, operands: readonly Operand[]): Rewrite | undefined {
  const shapes = operands.map((o) => o.shape).join(',');
  const db = (form: string, low: string): Rewrite => ({ error: `${mnemonic} ${form} is undocumented, and Fugløy writes it as DB 0EDH,${low}H; use that instead.`, rewrite: `DB 0EDH,${low}H` });
  if (mnemonic === 'IN' && (shapes === 'F,(C)' || shapes === '(C)')) return db(shapes, '70');
  if (mnemonic === 'OUT' && operands.length === 2 && operands[0]!.shape === '(C)' && isImmediate(operands[1]!.shape) && operands[1]!.value === 0) return db('(C),0', '71');
  return undefined;
}

/** A byte as zmac source writes it in a DB: `05H`, `0CBH`. */
const dbByte = (v: number): string => {
  const h = `${v.toString(16).toUpperCase().padStart(2, '0')}H`;
  return /^[A-F]/.test(h) ? `0${h}` : h;
};

const EIGHTY_PAIRS: Readonly<Record<string, string>> = { A: 'AF', B: 'BC', D: 'DE', H: 'HL', "AF'": 'AF' };
const BYTE_REGISTERS: ReadonlySet<string> = new Set(['A', 'B', 'C', 'D', 'E', 'H', 'L']);
const BRANCHES: ReadonlySet<string> = new Set(['JP', 'CALL', 'JR', 'RET']);
const CONDITION_SHAPES: ReadonlySet<string> = new Set(['NZ', 'Z', 'NC', 'C', 'PO', 'PE', 'P', 'M']);
const ROTATES: ReadonlySet<string> = new Set(['RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SLL', 'SRL', 'RES', 'SET']);

/**
 * The exact rewrite for a spelling zmac reads but the tables do not give
 * (each is pinned with zmac's bytes in zmac-probes.test.ts): the port alone
 * after IN or OUT, JP HL without parentheses, the 8080's PUSH B and M, PUSH
 * AF', and the undocumented DD CB / FD CB copies to a register, which the
 * tables keep as DB. Also a jump or call with a condition and no address
 * (JP M), which zmac rejects too.
 */
function spelling(mnemonic: string, operands: readonly Operand[], written: readonly string[] | undefined): Rewrite | undefined {
  const shapes = operands.map((o) => o.shape);
  const text = (i: number): string => written?.[i] ?? (operands[i]!.value === undefined ? shapes[i]! : asSource(operands[i]!.value!));
  const bare = (i: number): string => text(i).replace(/^\((.*)\)$/, '$1');
  const one = operands.length === 1;
  const said = (message: string, rewrite: string): Rewrite => ({ error: `${message}: write ${rewrite}.`, rewrite });
  if (mnemonic === 'IN' && one && (isImmediate(shapes[0]!) || shapes[0] === '(nn)')) {
    return said('IN needs A and the port in parentheses', `IN A,(${bare(0)})`);
  }
  if (mnemonic === 'OUT' && one && (isImmediate(shapes[0]!) || shapes[0] === '(nn)')) {
    return said('OUT needs the port in parentheses and then A', `OUT (${bare(0)}),A`);
  }
  // The port without its parentheses, beside a register: OUT 0FFH,A and IN A,0FFH.
  if (mnemonic === 'OUT' && operands.length === 2 && isImmediate(shapes[0]!) && candidates(mnemonic, ['(nn)', shapes[1]!]).length > 0) {
    return said('OUT needs the port in parentheses', `OUT (${text(0)}),${text(1)}`);
  }
  if (mnemonic === 'IN' && operands.length === 2 && isImmediate(shapes[1]!) && candidates(mnemonic, [shapes[0]!, '(nn)']).length > 0) {
    return said('IN needs the port in parentheses', `IN ${text(0)},(${text(1)})`);
  }
  if (mnemonic === 'JP' && one && (shapes[0] === 'HL' || shapes[0] === 'IX' || shapes[0] === 'IY')) {
    return said(`JP ${shapes[0]} jumps to the address in ${shapes[0]}, which Z80 assembly writes in parentheses`, `JP (${shapes[0]})`);
  }
  if ((mnemonic === 'PUSH' || mnemonic === 'POP') && one && EIGHTY_PAIRS[shapes[0]!] !== undefined) {
    const pair = EIGHTY_PAIRS[shapes[0]!]!;
    const why = shapes[0] === "AF'" ? `${mnemonic} works on AF, not the shadow AF'` : `${mnemonic} works on register pairs, and ${shapes[0]} is the 8080's short name for ${pair}`;
    return said(why, `${mnemonic} ${pair}`);
  }
  // After JP, CALL, JR, and RET, M is the condition "sign minus", not the 8080's (HL). The label is the writer's to choose, so no rewrite.
  if (BRANCHES.has(mnemonic) && one && CONDITION_SHAPES.has(shapes[0]!) && candidates(mnemonic, [shapes[0]!, 'nn']).length > 0) {
    return { error: `${mnemonic} ${text(0)} names a condition but no address to go to: write ${mnemonic} ${text(0)},label.` };
  }
  if (shapes.includes('M') && !BRANCHES.has(mnemonic)) {
    const swapped = shapes.map((sh) => (sh === 'M' ? '(HL)' : sh));
    const withA = candidates(mnemonic, swapped).length === 0 && candidates(mnemonic, ['A', ...swapped]).length > 0;
    if (candidates(mnemonic, swapped).length > 0 || withA) {
      const form = shapes.map((sh, i) => (sh === 'M' ? '(HL)' : text(i)));
      return said("M is the 8080's name for the byte HL points at", `${mnemonic} ${withA ? 'A,' : ''}${form.join(',')}`);
    }
  }
  const last = shapes[shapes.length - 1]!;
  const index = shapes.findIndex((sh) => sh === '(IX+d)' || sh === '(IX)' || sh === '(IY+d)' || sh === '(IY)');
  if (ROTATES.has(mnemonic) && operands.length >= 2 && BYTE_REGISTERS.has(last) && index === operands.length - 2) {
    // The copy is the (IX+d) form with the register form's opcode in the last byte.
    const onIndex = encode(mnemonic, operands.slice(0, -1), 0);
    const onRegister = encode(mnemonic, [...operands.slice(0, -2), { shape: last }], 0);
    if ('bytes' in onIndex && 'bytes' in onRegister) {
      const bytes = [...onIndex.bytes.slice(0, -1), onRegister.bytes[onRegister.bytes.length - 1]!];
      const head = `${mnemonic} ${operands.map((_, i) => text(i)).join(',')}`;
      const db = `DB ${bytes.map(dbByte).join(',')}`;
      return { error: `${head} is undocumented: it works on the byte at ${bare(index)} and also copies the result into ${last}. Fugløy writes it as data, so write ${db}.`, rewrite: db };
    }
  }
  return undefined;
}

/** Up to six forms in full; past that, the first five and how many more. */
function capped(forms: readonly string[]): { text: string; all: boolean } {
  if (forms.length <= 6) return { text: list(forms, 'and'), all: true };
  return { text: list([...forms.slice(0, 5), `${forms.length - 5} more`], 'and'), all: false };
}

/**
 * The sentence for a form the mnemonic lacks, with the forms worth trying
 * instead. `written` is the operands as the source wrote them, for the head.
 */
function noForm(mnemonic: string, shapes: readonly Shape[], entries: readonly Entry[], written?: readonly string[]): string {
  const said = shapes.map((sh) => word(sh, mnemonic));
  const all = [...new Set(formsOf(entries).map((f) => (f === '' ? f : f.split(',').map((x) => word(x, mnemonic)).join(','))))];
  if (shapes.length === 0) return needsOperands(mnemonic, all.filter((f) => f !== ''));
  const head = `${mnemonic} has no form ${(written ?? said).join(',')}.`;
  if (mnemonic === 'RST') return `${head} RST takes a restart address, ${RESTARTS}.`;
  if (all.length === 1 && all[0] === '') return `${head} ${mnemonic} takes no operands.`;
  const first = said[0];
  const sharing = first === undefined ? [] : all.filter((f) => f.split(',')[0] === first);
  if (sharing.length === 1) return `${head} The form that starts with ${first} is ${sharing[0]}.`;
  if (sharing.length > 1) return `${head} The forms that start with ${first} are ${capped(sharing).text}.`;
  const shown = capped(all.map((f) => (f === '' ? `${mnemonic} alone` : f)));
  return `${head} Its forms ${shown.all ? 'are' : 'include'} ${shown.text}.`;
}

/** The sentence for a fixed number (bit, vector, mode) that no entry has. */
function badFixed(mnemonic: string, slot: TemplateOperand, value: number, allowed: number[]): string {
  if (slot.t === 'fixed' && slot.op.kind === 'bit') {
    return `${mnemonic} takes a bit number from ${Math.min(...allowed)} to ${Math.max(...allowed)}; ${show(value)} is out of range.`;
  }
  return `${mnemonic} takes ${list(allowed.map(asSource), 'or')}; ${show(value)} is not one of them.`;
}

/** What a relative jump that cannot reach should become instead. */
const RELATIVE_FIX: Readonly<Record<string, string>> = { JR: 'Use JP.', DJNZ: 'Use DEC B and JP NZ.' };

/**
 * An error names, when it can, the index of the operand at fault; and, when
 * its sentence gives an exact rewrite, the whole instruction as rewritten.
 */
export type EncodeResult = { bytes: number[] } | { error: string; operand?: number; rewrite?: string };

/** A sentence with the exact rewrite it gives, if any. */
type Rewrite = { error: string; rewrite?: string };

/**
 * What the caller knows beyond the values: the name a relative jump's target
 * was written as, and the operands as written, for the messages.
 */
export interface EncodeOptions {
  target?: string;
  written?: readonly string[];
}

const at = (error: string, operand: number): EncodeResult => ({ error, operand });

/**
 * The bytes of one instruction. `pc` is its runtime address, from which a
 * relative jump's `e` (given as the target address) is measured; like zmac, a
 * relative jump never wraps around $FFFF. An error is a sentence naming the
 * problem and the limit; no bytes come with it.
 */
export function encode(mnemonic: string, operands: readonly Operand[], pc: number, options: EncodeOptions = {}): EncodeResult {
  const mn = mnemonic.toUpperCase();
  const entries = INDEX.get(mn);
  if (entries === undefined) return { error: `Unknown instruction ${mn}.` };
  const shapes = operands.map((o) => o.shape);
  let found = candidates(mn, shapes);
  if (found.length === 0) return undocumentedEd(mn, operands) ?? spelling(mn, operands, options.written) ?? { error: noForm(mn, shapes, entries, options.written) };

  // A fixed number (bit, RST vector, IM mode) picks the entry by its value.
  const fixedAt = found[0]!.tpl.operands.findIndex((o) => fixedNumber(o) !== undefined);
  if (fixedAt >= 0) {
    const slot = found[0]!.tpl.operands[fixedAt]!;
    const value = operands[fixedAt]!.value;
    if (value === undefined) return at(`${formName(mn, found[0]!)} needs a value for ${slotText(slot)}.`, fixedAt);
    const exact = found.filter((e) => fixedNumber(e.tpl.operands[fixedAt]!) === value);
    if (exact.length === 0) {
      const allowed = [...new Set(found.map((e) => fixedNumber(e.tpl.operands[fixedAt]!)!))].sort((a, b) => a - b);
      return at(badFixed(mn, slot, value, allowed), fixedAt);
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
    if (value === undefined) return at(`${name} needs a value for ${slotText(slot)}.`, i);
    if (!Number.isInteger(value)) return at(`${name} needs a whole number for ${slotText(slot)}; ${value} is not one.`, i);
    switch (slot.t) {
      case 'n':
      case 'd': {
        if (value < -128 || value > 255) return at(`${name} takes a byte, -128 to 255; ${show(value)} is out of range.`, i);
        tail.push(value & 0xff);
        break;
      }
      case '(n)': {
        // zmac refuses a negative port.
        if (value < 0 || value > 255) return at(`${name} takes a port, 0 to 255; ${show(value)} is out of range.`, i);
        tail.push(value);
        break;
      }
      case 'nn':
      case '(nn)': {
        if (value < -32768 || value > 0xffff) return at(`${name} takes ${slot.t === 'nn' ? 'a word' : 'an address'}, -32768 to 65535; ${show(value)} is out of range.`, i);
        tail.push(value & 0xff, (value >> 8) & 0xff);
        break;
      }
      case 'e': {
        if (value < -32768 || value > 0xffff) return at(`${name} takes an address, -32768 to 65535; ${show(value)} is out of range.`, i);
        const fix = RELATIVE_FIX[mn] ?? 'Use JP.';
        const target = value & 0xffff;
        const disp = target - (pc + tpl.length);
        if (disp < -128 || disp > 127) {
          const wrapped = (((disp % 0x10000) + 0x18000) % 0x10000) - 0x8000;
          if (wrapped >= -128 && wrapped <= 127) return at(`${mn} cannot wrap around the top of memory from ${address(pc)} to ${address(target)}. ${fix}`, i);
          const where = disp > 0 ? `${disp} bytes ahead` : `${-disp} bytes back`;
          return at(`${mn} reaches 128 bytes either way; ${options.target ?? `the target ${address(value)}`} is ${where}. ${fix}`, i);
        }
        tail.push(disp & 0xff);
        break;
      }
      case '(ix+d)': {
        if (value < -128 || value > 127) return at(`The displacement in (${slot.reg}+d) runs from -128 to 127; ${show(value)} is out of range.`, i);
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
