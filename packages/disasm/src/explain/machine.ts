/**
 * What the Explain tab knows about the TRS-80 and about the program's names:
 * screen memory as row and column, ROM routines, variables and ports from the
 * selected symbol tables, and the program's own labels. Everything comes back
 * as sentence pieces, so names link to the listing or the Symbol tab.
 */
import { hexWord } from '@fugloy/z80';
import type { Analysis } from '../pipeline.js';
import type { Session } from '../session.js';
import { selectSymbols } from '../symbols/select.js';
import type { SymbolSet } from '../symbols/select.js';
import type { TableEntry } from '../symbols/types.js';
import type { Piece, Sentence } from './types.js';

const sets = new WeakMap<Session, SymbolSet | null>();

/** The selection's symbol set, built once per session; undefined without a selection. */
export function symbolSet(s: Session): SymbolSet | undefined {
  let hit = sets.get(s);
  if (hit === undefined) {
    hit = s.selection === undefined ? null : selectSymbols(s.selection);
    sets.set(s, hit);
  }
  return hit ?? undefined;
}

/** What a sentence needs from the session: the analysis, and the symbol tables when a machine is selected. */
export interface Ctx {
  s: Session;
  a: Analysis;
  set: SymbolSet | undefined;
}

export const hex2 = (n: number): string => (n & 0xff).toString(16).toUpperCase().padStart(2, '0');
export const hex4 = (n: number): string => (n & 0xffff).toString(16).toUpperCase().padStart(4, '0');
/** `$3C` */
export const byte$ = (n: number): string => `$${hex2(n)}`;
/** `$3C00` */
export const word$ = (n: number): string => `$${hex4(n)}`;

/** `13,953`, the same in every locale. */
export function decimal(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** `a`, `a and b`, `a, b and c`. */
export function andList<T>(items: readonly T[], join: (t: T) => Piece[]): Piece[] {
  const out: Piece[] = [];
  items.forEach((item, i) => {
    if (i > 0) out.push({ text: i === items.length - 1 ? ' and ' : ', ' });
    out.push(...join(item));
  });
  return out;
}

/** Builds a sentence from text and pieces, joining neighbouring plain text. */
export function say(...parts: (string | Piece | readonly Piece[] | false | undefined)[]): Sentence {
  const out: Sentence = [];
  const push = (p: Piece): void => {
    if (p.text === '') return;
    const last = out.at(-1);
    if (last !== undefined && last.addr === undefined && last.entry === undefined && p.addr === undefined && p.entry === undefined) last.text += p.text;
    else out.push({ ...p });
  };
  for (const part of parts) {
    if (part === false || part === undefined) continue;
    if (typeof part === 'string') push({ text: part });
    else if (Array.isArray(part)) for (const p of part as readonly Piece[]) push(p);
    else push(part as Piece);
  }
  return out;
}

/** Row and column of a screen address, 0-based, row 0 at the top; null outside $3C00-$3FFF. 64 × 16 on both Model I and Model III. */
export function screenCell(addr: number): { row: number; column: number } | null {
  if (addr < 0x3c00 || addr > 0x3fff) return null;
  return { row: (addr - 0x3c00) >> 6, column: (addr - 0x3c00) & 63 };
}

/** `the screen, row 14, column 0`, or undefined off the screen. */
export function screenText(addr: number): string | undefined {
  const cell = screenCell(addr);
  return cell === null ? undefined : `the screen, row ${cell.row}, column ${cell.column}`;
}

/** True when the program occupies `addr` at run time. */
export const loaded = (c: Ctx, addr: number): boolean => c.a.space.image.isLoaded(addr & 0xffff);

/** A `$3C00` piece, linking the listing when the program loads that address. */
export const addrPiece = (c: Ctx, addr: number): Piece => (loaded(c, addr) ? { text: word$(addr), addr: addr & 0xffff } : { text: word$(addr) });

/** The table entry for an address outside the program: a routine or vector for code, a variable, vector or region for data. */
export function tableName(c: Ctx, addr: number, use: 'code' | 'data'): { entry: TableEntry; text: string } | undefined {
  if (c.set === undefined || loaded(c, addr)) return undefined;
  if (use === 'code') {
    const entry = c.set.code(addr);
    return entry === undefined ? undefined : { entry, text: entry.name };
  }
  const found = c.set.data(addr);
  if (found === undefined) return undefined;
  return { entry: found.entry, text: found.offset === 0 ? found.entry.name : `${found.entry.name}+${hexWord(found.offset)}` };
}

/** The name an address goes by: the program's own label, else a table name. */
export function nameOf(c: Ctx, addr: number, use: 'code' | 'data'): Piece | undefined {
  const own = c.a.symbols.get(addr);
  if (own !== undefined) return { text: own.name, addr: addr & 0xffff };
  const table = tableName(c, addr, use);
  return table === undefined ? undefined : { text: table.text, entry: table.entry };
}

/**
 * `$3F80 (VIDEO+0380H, the screen, row 14, column 0)`: an address with what it
 * is. `how` says where the address came from (`the address in HL`) and goes
 * last in the parentheses, after a semicolon.
 */
export function addrPhrase(c: Ctx, addr: number, use: 'code' | 'data' = 'data', how?: string): Piece[] {
  const extra: Piece[] = [];
  const name = nameOf(c, addr, use);
  if (name !== undefined) extra.push(name);
  const screen = use === 'data' ? screenText(addr) : undefined;
  if (screen !== undefined) extra.push({ text: screen });
  const out: Piece[] = [addrPiece(c, addr)];
  if (extra.length === 0 && how === undefined) return out;
  out.push({ text: ' (' }, ...andJoin(extra, ', '));
  if (how !== undefined) out.push({ text: extra.length === 0 ? how : `; ${how}` });
  out.push({ text: ')' });
  return out;
}

const andJoin = (pieces: Piece[], sep: string): Piece[] => pieces.flatMap((p, i) => (i === 0 ? [p] : [{ text: sep }, p]));

/** `port $EC (MODEPORT)` and its table entry, when the tables name it. */
export function portPhrase(c: Ctx, n: number): { pieces: Piece[]; entry?: TableEntry } {
  const entry = c.set?.port(n);
  const pieces: Piece[] = [{ text: `port ${byte$(n)}` }];
  if (entry === undefined) return { pieces };
  return { pieces: [...pieces, { text: ' (' }, { text: entry.name, entry }, { text: ')' }], entry };
}

/** `the ROM routine`, `the DOS routine` or `the routine`, from the table an entry comes from. */
export function routineKind(entry: TableEntry | undefined): string {
  if (entry === undefined) return 'the routine';
  if (entry.table.startsWith('rom-')) return 'the ROM routine';
  if (entry.table.startsWith('dos-')) return 'the DOS routine';
  return 'the routine';
}
