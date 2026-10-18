/**
 * Explaining one listing line: the row at an address, its plain-English lead
 * (from the per-mnemonic templates), where an unproven register's value comes
 * from, a preview of each address it uses, the details strip, and the label
 * row's callers and jumpers. A .BAS session gets the BASIC-later note.
 */
import type { Instruction } from '@fugloy/z80';
import { Kind } from '../analysis/map.js';
import { formatRow } from '../rows.js';
import type { Row } from '../rows.js';
import { rowAt, rowsOf } from './listing.js';
import type { ListRow, Rows } from './listing.js';
import { dataRegion } from './region.js';
import type { Analysis } from '../pipeline.js';
import type { Session } from '../session.js';
import { knownBefore, opcodeRewritten, patchedBytes, pointerUses, rewrittenOpcodeBytes, sourceRewritten, storesInto, walkBack, written } from './track.js';
import { dataReference } from '../analysis/symbols.js';
import { addrPiece, andList, loaded, say, screenText, tableName, word$ } from './machine.js';
import type { Ctx } from './machine.js';
import type { LineCtx } from './phrase.js';
import { words } from './words.js';
import { patternAt } from './patterns.js';
import { idiomWhy } from './why-idiom.js';
import { purposeWhy, routineWhy } from './why-purpose.js';
import { registerWhy } from './why-register.js';
import type { Explanation, Piece, Preview, Sentence } from './types.js';

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

/**
 * Callers and jumpers of `addr`, from the xrefs, leaving out (into
 * `rewritten`) the ones whose bytes the program may rewrite (`sourceRewritten`):
 * they only start out leading here. `pointers` are the instructions that hold
 * `addr` as a number, through which it may also be reached.
 */
function into(a: Analysis, addr: number): { callers: number[]; jumpers: number[]; pointers: number[]; rewritten: number[] } {
  const callers = new Set<number>();
  const jumpers = new Set<number>();
  const rewritten = new Set<number>();
  for (const x of a.pass1.xrefs) {
    if (x.to !== addr) continue;
    if (sourceRewritten(a, x.from)) rewritten.add(x.from);
    else (x.kind === 'jump' || x.kind === 'cjump' ? jumpers : callers).add(x.from);
  }
  const sorted = (s: Set<number>): number[] => [...s].sort((p, q) => p - q);
  return { callers: sorted(callers), jumpers: sorted(jumpers), pointers: pointerUses(a, addr), rewritten: sorted(rewritten) };
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
  // A call or jump the program may rewrite only starts out leading here.
  const callers = from.callers.filter((f) => !sourceRewritten(a, f));
  const jumpers = from.jumpers.filter((f) => !sourceRewritten(a, f));
  const rewritten = [...from.callers, ...from.jumpers].filter((f) => sourceRewritten(a, f)).sort((p, q) => p - q);
  if (callers.length > 0) out.push([{ text: callers.length === 1 ? 'by the call at ' : 'by the calls at ' }, ...addrList(c, callers)]);
  const jumps = jumpers.filter((j) => a.pass1.instructions.has(j));
  const table = jumpers.filter((j) => !a.pass1.instructions.has(j));
  if (jumps.length > 0) out.push([{ text: jumps.length === 1 ? 'by the jump at ' : 'by the jumps at ' }, ...addrList(c, jumps)]);
  if (table.length > 0) out.push([{ text: table.length === 1 ? 'through the jump table entry at ' : 'through the jump table entries at ' }, ...addrList(c, table)]);
  if (rewritten.length > 0) out.push([{ text: rewritten.length === 1 ? 'perhaps by the instruction at ' : 'perhaps by the instructions at ' }, ...addrList(c, rewritten), { text: rewritten.length === 1 ? ', which starts out leading here but which the program rewrites' : ', which start out leading here but which the program rewrites' }]);
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
    // An instruction the program may turn into another one may write any register.
    const writer = w.chain.find((link) => opcodeRewritten(c.a, link.at) || written(link.ins).some((n) => halves.includes(n)));
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
    // The xrefs are every direct way in; an address the program loads or uses as data may be jumped through as well.
    const used = pointerUses(c.a, w.at);
    const pointer: Piece[] = used.length === 0 ? [] : [{ text: '; its address is also used at ' }, ...addrList(c, used), { text: ', so it may also be reached through a pointer' }];
    out.push(say(`${subject} when `, named, ' was reached: ', joined, pointer, '.'));
  } else if (w.stop === 'root' && w.at === c.addr && isRoot) {
    const start = c.addr === c.a.entry ? 'This is where the program starts (its entry point), so ' : 'This is an entry point the analysis starts from, so ';
    out.push(say(start, `${subject} when ${c.addr === c.a.entry ? 'the program was started' : 'control arrived here'}.`));
  } else if (w.stop === 'root') {
    out.push(say(`${subject} when ${w.at === c.a.entry ? 'the program started' : 'control entered'} at `, named, '.'));
  } else if (w.stop === 'label') {
    const kind = c.a.symbols.get(w.at)?.kind;
    const why = kind === 'data' ? ', since the program refers to it as data' : kind === 'table' ? ', since a declared table lists it' : '';
    if (w.pred !== undefined) {
      const isCall = c.a.pass1.instructions.get(w.pred)?.flow.kind === 'call';
      const way = isCall ? 'by coming back from the call at ' : 'by falling through from ';
      out.push(say(`${subject} when `, named, ` was reached: ${way}`, addrPiece(c, w.pred), `, or perhaps through a pointer${why}.`));
    } else out.push(say(`${subject} when `, named, ` was reached; no jump or call to it was found, so it may be reached through a pointer${why}.`));
  } else if (w.stop === 'call' && w.pred !== undefined) {
    out.push(say(`The lines leading here do not prove what ${regList(rest)} ${rest.length === 1 ? 'holds' : 'hold'}; the call at `, addrPiece(c, w.pred), ' just before may have changed ', rest.length === 1 ? 'it.' : 'them.'));
  } else {
    out.push(say(`The lines leading here do not prove what ${regList(rest)} ${rest.length === 1 ? 'holds' : 'hold'}.`));
  }
  return { sentences: out, entry: w.stop === 'root' && w.at === c.addr && isRoot };
}

/** The instructions that provably store into `b` (`storesInto`: LD (nn), or through a register whose value knownBefore proves there), and the others that only refer to it. */
function usersOf(a: Analysis, b: number): { writers: number[]; refs: number[] } {
  const writers = storesInto(a, b);
  const refs: number[] = [];
  for (const [at, ins] of a.pass1.instructions) if (!writers.includes(at) && dataReference(ins) === b) refs.push(at);
  return { writers, refs: refs.sort((p, q) => p - q) };
}

/** Who stores into or refers to the bytes `bytes`: their writers, else the instructions that refer to them. */
function usersOfAll(a: Analysis, bytes: readonly number[]): { writers: number[]; refs: number[] } {
  const writers = new Set<number>();
  const refs = new Set<number>();
  for (const b of bytes) {
    const u = usersOf(a, b);
    u.writers.forEach((x) => writers.add(x));
    u.refs.forEach((x) => refs.add(x));
  }
  const sorted = (s: Set<number>): number[] => [...s].sort((p, q) => p - q);
  return { writers: sorted(writers), refs: sorted(refs) };
}

/**
 * The caveats for an instruction the program may rewrite: when it stores into
 * an opcode byte (the first, or the one after a CB, ED, DD or FD prefix), the
 * instruction itself may be a different one at run time; when a label lies in
 * its other bytes, or it stores into them, its numbers are only where they start.
 */
function patchedSentences(c: LineCtx): Sentence[] {
  const out: Sentence[] = [];
  const name = (b: number): Piece[] => [{ text: c.a.symbols.get(b)?.name ?? word$(b), addr: b }];
  const ops = rewrittenOpcodeBytes(c.a, c.addr);
  if (ops.length > 0) {
    const u = usersOfAll(c.a, ops);
    const which = ops.length === 1 && ops[0] === c.addr ? 'the first byte' : ops.length === 1 ? 'an opcode byte' : 'the opcode bytes';
    // A store found only by the rewrite rules' wider sweep is not named: its address is not proven where it stands.
    const written: Piece[] = u.writers.length > 0 ? [{ text: ', written at ' }, ...addrList(c, u.writers)] : [];
    out.push(
      say(
        `The program ${u.writers.length > 0 ? 'stores' : 'may store'} into ${which} of this instruction as it runs (`,
        andList(ops, name),
        written,
        '), so at run time it may be a different instruction; this line shows only what it starts as.',
      ),
    );
  }
  const operand = c.patched.filter((b) => !ops.includes(b));
  if (operand.length === 0) return out;
  const names = andList(operand, name);
  const u = usersOfAll(c.a, operand);
  if (u.writers.length > 0) {
    out.push(say('The program rewrites part of this instruction as it runs (', names, ', written at ', addrList(c, u.writers), '), so the numbers shown are only where they start.'));
    return out;
  }
  if (u.refs.length === 0 && operand.every((b) => !c.a.symbols.has(b))) {
    out.push(say('The program may store into part of this instruction as it runs (', names, '), so the numbers shown are only where they start.'));
    return out;
  }
  const used = u.refs.length > 0 ? [{ text: ', used at ' }, ...addrList(c, u.refs)] : [];
  out.push(say('The program refers to a byte inside this instruction (', names, used, '), so it may rewrite the instruction as it runs; the numbers shown are only where they start.'));
  return out;
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
  const c: Ctx = { s, a };
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
    const region = dataRegion(s, at);
    return { kind: 'data', addr: at, line, sentences: dataSentences(row), previews: [], ...(label === undefined ? {} : { label }), ...(region === null ? {} : { region }) };
  }
  const ins = a.pass1.instructions.get(at) as Instruction;
  const lc: LineCtx = { ...c, addr: at, ins, regs: knownBefore(a, at).regs, refs: [], needs: [], patched: patchedBytes(a, at, ins) };
  const sentences = words(lc);
  sentences.push(...patchedSentences(lc));
  const isRoot = rootSet.has(at);
  const from = fromSentences(lc, isRoot);
  sentences.push(...from.sentences);
  if (isRoot && !from.entry) {
    sentences.push(say(at === a.entry ? 'This is where the program starts (its entry point).' : 'This is an entry point the analysis starts from.'));
  }
  const pattern = patternAt(c, at);
  const why = { register: registerWhy(lc), purpose: purposeWhy(lc), idiom: idiomWhy(lc), routine: routineWhy(lc) };
  return {
    kind: 'code',
    addr: at,
    line,
    sentences,
    ...(pattern === undefined ? {} : { pattern }),
    previews: lc.refs.map((x) => preview(c, r, x.addr, x.use)),
    details: {
      bytes: ins.length,
      cycles: ins.cycles,
      ...(ins.cyclesNotTaken === undefined ? {} : { cyclesNotTaken: ins.cyclesNotTaken }),
      flags: ins.flags,
      documented: ins.documented,
    },
    ...(label === undefined ? {} : { label }),
    why,
  };
}

/**
 * Explains any listing row: code, data, label and BASIC rows by their address
 * (`explainLine`); ORG, header, note and blank rows in one line each.
 */
export function explainRow(s: Session, row: Row): Explanation {
  if (s.plainBasic || s.module.format === 'bas') return { ...explainLine(s, 0), addr: 'addr' in row && row.addr !== undefined ? row.addr : null, line: formatRow(row) };
  const line = formatRow(row);
  const one = (addr: number | null, text: string): Explanation => ({ kind: 'other', addr, line, sentences: [say(text)], previews: [] });
  switch (row.kind) {
    case 'code':
    case 'data':
    case 'label':
    case 'basic':
      return explainLine(s, row.addr);
    case 'org':
      return one(row.addr, `ORG tells the assembler that the code below starts at ${word$(row.addr)}.`);
    case 'blank':
      return one(null, 'A blank line that separates parts of the listing.');
    case 'header':
      return one(null, 'A comment line Fugløy adds to the top of the listing to describe the file; the program does not contain it.');
    case 'note': {
      const mine = row.addr !== undefined && (s.analysis.annotations.notes.get(row.addr) ?? []).some((t) => (t === '' ? ';' : `; ${t}`) === row.text);
      if (mine) return one(row.addr!, `Your block comment for ${word$(row.addr!)}, kept in the hint file; the program does not contain it.`);
      return one(row.addr ?? null, 'A comment line Fugløy adds to the listing; the program does not contain it.');
    }
  }
}
