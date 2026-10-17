/**
 * Explaining one listing line: the row at an address, its plain-English lead
 * (from the per-mnemonic templates), where an unproven register's value comes
 * from, a preview of each address it uses, the details strip, and the label
 * row's callers and jumpers. A .BAS session gets the BASIC-later note.
 */
import type { Instruction } from '@fugloy/z80';
import { Kind } from '../analysis/map.js';
import { formatRow, listingRows, rowIndex } from '../rows.js';
import type { Row } from '../rows.js';
import type { Analysis } from '../pipeline.js';
import type { Session } from '../session.js';
import { knownBefore, walkBack, written } from './track.js';
import { addrPiece, andList, loaded, say, screenText, symbolSet, tableName, word$ } from './machine.js';
import type { Ctx } from './machine.js';
import type { LineCtx } from './phrase.js';
import { words } from './words.js';
import type { Explanation, Piece, Preview, Sentence } from './types.js';

type ListRow = Extract<Row, { kind: 'code' | 'data' }>;

interface Rows {
  rows: Row[];
  index: Map<number, number>;
}

const rowCache = new WeakMap<Analysis, Rows>();

/** The listing's rows, built once per analysis. */
function rowsOf(a: Analysis): Rows {
  let hit = rowCache.get(a);
  if (hit === undefined) {
    const rows = listingRows(a);
    hit = { rows, index: rowIndex(rows) };
    rowCache.set(a, hit);
  }
  return hit;
}

/** The index of the code or data row that covers `addr`, or undefined. */
function rowAt(r: Rows, addr: number): number | undefined {
  for (let back = 0; back < 4; back++) {
    const start = (addr - back) & 0xffff;
    let i = r.index.get(start);
    if (i === undefined) continue;
    while (i < r.rows.length && r.rows[i]!.kind !== 'code' && r.rows[i]!.kind !== 'data') i++;
    const row = r.rows[i] as ListRow | undefined;
    if (row === undefined || row.addr !== start) continue;
    if (addr - start < row.bytes.length) return i;
  }
  return undefined;
}

/** Up to `n` code and data rows from row `i` on, as the listing prints them. */
function linesFrom(r: Rows, i: number, n: number): string[] {
  const out: string[] = [];
  for (let j = i; j < r.rows.length && out.length < n; j++) {
    const row = r.rows[j]!;
    if (row.kind === 'code' || row.kind === 'data') out.push(formatRow(row));
    else if (row.kind === 'org' && out.length > 0) break;
  }
  return out;
}

/** Callers and jumpers of `addr`, from the xrefs. */
function into(a: Analysis, addr: number): { callers: number[]; jumpers: number[] } {
  const callers = new Set<number>();
  const jumpers = new Set<number>();
  for (const x of a.pass1.xrefs) {
    if (x.to !== addr) continue;
    (x.kind === 'jump' || x.kind === 'cjump' ? jumpers : callers).add(x.from);
  }
  const sorted = (s: Set<number>): number[] => [...s].sort((p, q) => p - q);
  return { callers: sorted(callers), jumpers: sorted(jumpers) };
}

function roots(a: Analysis): Set<number> {
  const set = new Set<number>([...a.roots, ...a.pass1.roots]);
  if (a.entry !== null) set.add(a.entry);
  return set;
}

/** `$A`, `$A and $B`, `$A, $B, $C and 4 more`, each a link. */
function addrList(c: Ctx, addrs: readonly number[]): Piece[] {
  const items: Piece[][] = addrs.length <= 4 ? addrs.map((x) => [addrPiece(c, x)]) : [...addrs.slice(0, 3).map((x) => [addrPiece(c, x)]), [{ text: `${addrs.length - 3} more` }]];
  return andList(items, (p) => p);
}

const regList = (regs: readonly string[]): string => (regs.length === 1 ? regs[0]! : `${regs.slice(0, -1).join(', ')} and ${regs.at(-1)}`);

/** The ways control reaches a merge point: falling through, calls, jumps, and jump-table entries. */
function ways(c: Ctx, w: ReturnType<typeof walkBack>): Piece[][] {
  const out: Piece[][] = [];
  const a = c.a;
  if (w.pred !== undefined) {
    const isCall = a.pass1.instructions.get(w.pred)?.flow.kind === 'call';
    out.push(isCall ? [{ text: 'by coming back from the call at ' }, addrPiece(c, w.pred)] : [{ text: 'by falling through from ' }, addrPiece(c, w.pred)]);
  }
  const from = w.from!;
  if (from.callers.length > 0) out.push([{ text: from.callers.length === 1 ? 'by the call at ' : 'by the calls at ' }, ...addrList(c, from.callers)]);
  const jumps = from.jumpers.filter((j) => a.pass1.instructions.has(j));
  const table = from.jumpers.filter((j) => !a.pass1.instructions.has(j));
  if (jumps.length > 0) out.push([{ text: jumps.length === 1 ? 'by the jump at ' : 'by the jumps at ' }, ...addrList(c, jumps)]);
  if (table.length > 0) out.push([{ text: table.length === 1 ? 'through the jump table entry at ' : 'through the jump table entries at ' }, ...addrList(c, table)]);
  return out;
}

/**
 * For the registers the line needed but could not prove: where their values
 * come from. Never a value; only the instruction that last changed one, or the
 * merge point, entry point or call where the walk had to stop.
 */
function fromSentences(c: LineCtx, isRoot: boolean): { sentences: Sentence[]; entry: boolean } {
  if (c.needs.length === 0) return { sentences: [], entry: false };
  const w = walkBack(c.a, c.addr);
  const out: Sentence[] = [];
  const changed = new Map<number, string[]>();
  const rest: string[] = [];
  for (const r of c.needs) {
    const halves = r.length === 2 && r !== 'IX' && r !== 'IY' ? [r[0]!, r[1]!] : r === 'IX' ? ['IXH', 'IXL'] : r === 'IY' ? ['IYH', 'IYL'] : [r];
    const writer = w.chain.find((link) => written(link.ins).some((n) => halves.includes(n)));
    if (writer === undefined) rest.push(r);
    else changed.set(writer.at, [...(changed.get(writer.at) ?? []), r]);
  }
  for (const [at, regs] of changed) {
    out.push(say(`The lines leading here do not prove what ${regList(regs)} ${regs.length === 1 ? 'holds' : 'hold'}; ${regs.length === 1 ? 'it was' : 'they were'} last changed at `, addrPiece(c, at), '.'));
  }
  if (rest.length === 0) return { sentences: out, entry: false };
  const subject = `${regList(rest)} ${rest.length === 1 ? 'holds' : 'hold'} whatever ${rest.length === 1 ? 'it' : 'they'} held`;
  const name = c.a.symbols.get(w.at)?.name ?? word$(w.at);
  const named: Piece = { text: name, addr: w.at };
  if (w.stop === 'merge') {
    const list = ways(c, w);
    const joined = list.flatMap((p, i) => (i === 0 ? p : [{ text: ', or ' }, ...p]));
    out.push(say(`${subject} when `, named, ' was reached: ', joined, '.'));
  } else if (w.stop === 'root' && w.at === c.addr && isRoot) {
    const start = c.addr === c.a.entry ? 'This is where the program starts (its entry point), so ' : 'This is an entry point the analysis starts from, so ';
    out.push(say(start, `${subject} when ${c.addr === c.a.entry ? 'the program was started' : 'control arrived here'}.`));
  } else if (w.stop === 'root') {
    out.push(say(`${subject} when ${w.at === c.a.entry ? 'the program started' : 'control entered'} at `, named, '.'));
  } else if (w.stop === 'label') {
    out.push(say(`${subject} when `, named, ' was reached; no jump or call to it was found, so it may be reached through a pointer.'));
  } else if (w.stop === 'call' && w.pred !== undefined) {
    out.push(say(`The lines leading here do not prove what ${regList(rest)} ${rest.length === 1 ? 'holds' : 'hold'}; the call at `, addrPiece(c, w.pred), ' just before may have changed ', rest.length === 1 ? 'it.' : 'them.'));
  } else {
    out.push(say(`The lines leading here do not prove what ${regList(rest)} ${rest.length === 1 ? 'holds' : 'hold'}.`));
  }
  return { sentences: out, entry: w.stop === 'root' && w.at === c.addr && isRoot };
}

/** What is at an address the line uses: listing lines, or the table entry, or the screen cell. */
function preview(c: Ctx, r: Rows, addr: number, use: 'code' | 'data'): Preview {
  if (loaded(c, addr)) {
    const i = rowAt(r, addr);
    const comment = c.a.annotations.comments.get(addr);
    return {
      addr,
      title: c.a.symbols.get(addr)?.name ?? word$(addr),
      lines: i === undefined ? [] : linesFrom(r, i, 4),
      ...(comment === undefined ? {} : { comment }),
    };
  }
  const table = tableName(c, addr, use);
  const screen = use === 'data' ? screenText(addr) : undefined;
  const lines: string[] = [];
  if (table !== undefined) lines.push(table.entry.purpose);
  if (screen !== undefined) lines.push(screen);
  if (lines.length === 0) lines.push(`Outside the program; no table names ${word$(addr)}.`);
  return { addr, title: table?.text ?? word$(addr), lines, ...(table === undefined ? {} : { entry: table.entry }) };
}

/** `$20`–`$7E` throughout: the bytes read as text. */
const asText = (bytes: readonly number[]): string | undefined => (bytes.every((b) => b >= 0x20 && b <= 0x7e) ? String.fromCharCode(...bytes) : undefined);

function dataSentences(row: ListRow): Sentence[] {
  const n = row.bytes.length;
  const lead =
    n === 1
      ? 'This byte is data: the code is not known to run it. Press C to decode it as code (D turns code back into bytes).'
      : `These ${n} bytes are data: the code is not known to run them. Press C to decode them as code (D turns code back into bytes).`;
  const out = [say(lead)];
  const text = asText(row.bytes);
  if (text !== undefined) out.push(say(n === 1 ? `As text it reads "${text}".` : `As text they read "${text}".`));
  return out;
}

/** Explains the listing line at `addr` (or the row that covers it). */
export function explainLine(s: Session, addr: number): Explanation {
  const a = s.analysis;
  addr &= 0xffff;
  if (s.plainBasic || s.module.format === 'bas') {
    return { kind: 'basic', addr, line: '', sentences: [say('Explain covers machine code; BASIC comes later.')], previews: [] };
  }
  const c: Ctx = { s, a, set: symbolSet(s) };
  const r = rowsOf(a);
  const i = rowAt(r, addr);
  if (i === undefined) {
    return { kind: 'other', addr, line: '', sentences: [say('Nothing the program loads is at ', addrPiece(c, addr), '.')], previews: [] };
  }
  const row = r.rows[i] as ListRow;
  const line = formatRow(row);
  const rootSet = roots(a);
  const symbol = a.symbols.get(addr);
  // A label inside an instruction's bytes: the program refers to a byte of an instruction.
  if (row.addr !== addr) {
    if (symbol !== undefined && a.pass1.map.kind(addr) === Kind.Tail) {
      return {
        kind: 'label',
        addr,
        line,
        sentences: [
          say('The program refers to ', addrPiece(c, addr), ' (', { text: symbol.name, addr }, ') as data, but it lies inside the instruction at ', addrPiece(c, row.addr), ', so a write there would change that instruction as it runs.'),
        ],
        previews: [],
        label: { name: symbol.name, ...into(a, addr), entry: rootSet.has(addr) },
      };
    }
    addr = row.addr;
  }
  const at = addr;
  const labelSym = a.symbols.get(at);
  const label = labelSym === undefined ? undefined : { name: labelSym.name, ...into(a, at), entry: rootSet.has(at) };
  if (row.kind === 'data') {
    return { kind: 'data', addr: at, line, sentences: dataSentences(row), previews: [], ...(label === undefined ? {} : { label }) };
  }
  const ins = a.pass1.instructions.get(at) as Instruction;
  const lc: LineCtx = { ...c, addr: at, ins, regs: knownBefore(a, at).regs, refs: [], needs: [] };
  const sentences = words(lc);
  const isRoot = rootSet.has(at);
  const from = fromSentences(lc, isRoot);
  sentences.push(...from.sentences);
  if (isRoot && !from.entry) {
    sentences.push(say(at === a.entry ? 'This is where the program starts (its entry point).' : 'This is an entry point the analysis starts from.'));
  }
  return {
    kind: 'code',
    addr: at,
    line,
    sentences,
    previews: lc.refs.map((x) => preview(c, r, x.addr, x.use)),
    details: {
      bytes: ins.length,
      cycles: ins.cycles,
      ...(ins.cyclesNotTaken === undefined ? {} : { cyclesNotTaken: ins.cyclesNotTaken }),
      flags: ins.flags,
      documented: ins.documented,
    },
    ...(label === undefined ? {} : { label }),
  };
}
