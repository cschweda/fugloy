/**
 * The listings as typed rows with typed spans, for the workbench to colour and
 * link; `formatRow` prints a row as the line the CLI prints. The pass 1 listing:
 * instruction rows where descent reached, data rows of up to four bytes
 * elsewhere (four keeps the bytes column aligned), label rows before rows that
 * have a symbol, symbol names in operands, hint comments, `entry` on every root,
 * and a header that says how much was reached and how the hint file applied.
 */
import { hex4, hexByte, hexWord } from '@fugloy/z80';
import { Kind } from './analysis/map.js';
import { filePieces } from './analysis/relocate.js';
import { rowStarts } from './analysis/words.js';
import type { BasProgram } from './bas.js';
import { codeLineLabel } from './basic/structure.js';
import { commaSeparated, externalNotes, instructionSpans, nameSpan, spanText } from './emit/operands.js';
import { dbItemList } from './emit/strings.js';
import { $, basHeadline, basNotes, hex2, lastBodyByte, listsAsCode, pass1Header, plural } from './listing-header.js';
import type { BasNames, RenderOptions } from './listing-header.js';
import type { Analysis } from './pipeline.js';
import type { ListingLine } from './sweep.js';
import type { TableEntry } from './symbols/types.js';

export type { RenderOptions } from './listing-header.js';

export type SpanKind = 'mnemonic' | 'register' | 'condition' | 'number' | 'label' | 'table' | 'string' | 'punct' | 'directive';

/** A piece of a row's text. `target` is the address, port, or service call a `label` or `table` span stands for; `entry` is a `table` span's table entry. */
export interface Span {
  text: string;
  kind: SpanKind;
  target?: number;
  entry?: TableEntry;
}

export type Row =
  /** A `; …` line before the first ORG or BASIC line. */
  | { kind: 'header'; text: string }
  | { kind: 'blank' }
  | { kind: 'org'; addr: number }
  | { kind: 'label'; addr: number; name: string; user: boolean }
  /** `spans` concatenate to the text column of the line. */
  | { kind: 'code' | 'data'; addr: number; bytes: number[]; spans: Span[]; comment?: string }
  /** Relocated-piece notes, code-line labels, in-line `; symbol` lines, BASIC note lines. */
  | { kind: 'note'; text: string; addr?: number }
  | { kind: 'basic'; line: number; addr: number; text: string };

/** `6000  21 00 3C      LD HL,3C00H             ; entry` */
export function formatListingLine(line: Pick<ListingLine, 'addr' | 'bytes' | 'text'>, comment?: string): string {
  const bytes = line.bytes.map(hex2).join(' ').padEnd(12);
  const body = `${hex4(line.addr)}  ${bytes}  ${line.text}`;
  return comment === undefined ? body : `${body.padEnd(44)}; ${comment}`;
}

/** The line the listing prints for `row`. */
export function formatRow(row: Row): string {
  switch (row.kind) {
    case 'header':
    case 'note':
      return row.text;
    case 'blank':
      return '';
    case 'org':
      return `        ORG ${hexWord(row.addr)}`;
    case 'label':
      return `${row.name}:`;
    case 'code':
    case 'data':
      return formatListingLine({ addr: row.addr, bytes: row.bytes, text: spanText(row.spans) }, row.comment);
    case 'basic':
      return row.text === '' ? `${row.line}` : `${row.line} ${row.text}`;
  }
}

/** Address to the index of its `code` or `data` row, or of the `label` row before it when it has one. Only a row's first address is a key. */
export function rowIndex(rows: readonly Row[]): Map<number, number> {
  const index = new Map<number, number>();
  rows.forEach((row, i) => {
    if ((row.kind === 'label' || row.kind === 'code' || row.kind === 'data') && !index.has(row.addr)) index.set(row.addr, i);
  });
  return index;
}

const punct = (text: string): Span => ({ text, kind: 'punct' });
const directive = (name: string, items: Span[][]): Span[] => [{ text: name, kind: 'directive' }, punct(' '), ...commaSeparated(items)];

export function listingRows(analysis: Analysis, opts: RenderOptions = {}): Row[] {
  const { module: mod, pass1, roots, symbols, annotations, space, externals, rebasedFrom } = analysis;
  const { map, instructions } = pass1;
  /** Bytes at runtime addresses; the file image itself when nothing is relocated. */
  const view = space.image;
  const runs = mod.image.runs();
  const loaded = runs.reduce((n, r) => n + r.length, 0);
  // Worked out once: the legend and the comment column both read them.
  const notes = externalNotes(instructions, externals, symbols);
  const out: Row[] = pass1Header(analysis, opts, notes).map((text) => ({ kind: 'header', text }));
  const rootSet = new Set(roots);
  /** After a rebase, an absolute operand into the program's old range still points where the program no longer is. */
  const inOldRange = (v: number): boolean => rebasedFrom !== undefined && v >= rebasedFrom && v < rebasedFrom + loaded;
  const stale = (addr: number): boolean =>
    instructions.get(addr)?.operands.some((o) => (o.kind === 'imm16' && inOldRange(o.value)) || (o.kind === 'mem' && inOldRange(o.addr))) ?? false;
  /** The comment column of the row at `addr`: the entry mark, the hint comment, what the tables say of an instruction row, and the stale-operand warning. */
  const commentFor = (addr: number, isCode: boolean): { comment?: string } => {
    const parts: string[] = [];
    if (rootSet.has(addr)) parts.push('entry');
    const text = annotations.comments.get(addr);
    if (text !== undefined) parts.push(text);
    const note = notes.get(addr);
    if (note !== undefined && isCode) parts.push(note.text);
    if (stale(addr)) parts.push(`stale: original base ${$(rebasedFrom!)}`);
    return parts.length === 0 ? {} : { comment: parts.join('; ') };
  };
  const startsRow = rowStarts(symbols, annotations, instructions);
  /** Rows for runtime addresses [from, to]: label rows, instructions, and data rows of up to four bytes. */
  const body = (from: number, to: number): void => {
    let addr = from;
    while (addr <= to) {
      const symbol = symbols.get(addr);
      const lines = annotations.notes.get(addr);
      if (lines !== undefined) out.push({ kind: 'blank' }, ...lines.map((line): Row => ({ kind: 'note', text: line === '' ? ';' : `; ${line}`, addr })));
      if (symbol !== undefined && map.kind(addr) !== Kind.Tail) out.push({ kind: 'label', addr, name: symbol.name, user: symbol.source === 'user' });
      const ins = instructions.get(addr);
      if (ins !== undefined && addr + ins.length - 1 <= to) {
        out.push({ kind: 'code', addr, bytes: ins.bytes, spans: instructionSpans(ins, symbols, externals), ...commentFor(addr, true) });
        addr += ins.length;
        continue;
      }
      const kind = map.kind(addr);
      let n = 1;
      while (addr + n <= to && n < 4 && !startsRow(addr + n) && map.kind(addr + n) === kind) n++;
      let spans: Span[];
      if (kind === Kind.Word && n >= 2) {
        if (n % 2 === 1) n--;
        const words: Span[][] = [];
        for (let i = 0; i < n; i += 2) {
          const value = view.bytes[addr + i]! | (view.bytes[addr + i + 1]! << 8);
          const own = symbols.get(value);
          const table = own === undefined ? externals.word(addr + i, value) : undefined;
          if (own !== undefined) words.push([nameSpan({ text: own.name, target: value })]);
          else if (table !== undefined) words.push([nameSpan({ text: table.text, target: value, entry: table.entry })]);
          else words.push([{ text: hexWord(value), kind: 'number' }]);
        }
        spans = directive('DW', words);
      } else if (kind === Kind.String) {
        spans = directive('DB', dbItemList(view.bytes.subarray(addr, addr + n)).map((item) => [{ text: item, kind: item.startsWith("'") ? 'string' : 'number' }]));
      } else {
        spans = directive('DB', Array.from(view.bytes.subarray(addr, addr + n), (b) => [{ text: hexByte(b), kind: 'number' }]));
      }
      out.push({ kind: 'data', addr, bytes: Array.from(view.bytes.subarray(addr, addr + n)), spans, ...commentFor(addr, false) });
      addr += n;
    }
  };
  if (mod.format === 'bas') {
    // A BASIC line reads as its text, with the notes a plain listing gives it; a code line as rows at its true addresses. Symbols the rows do not show are named.
    // A note is no operand, so a table name the program took for a symbol of its own (`dropped`) still counts.
    const free = externals.ignoringCollisions();
    const names: BasNames = {
      data: (addr) => {
        const found = free.data(addr);
        return found === undefined ? undefined : { entry: found.entry, offset: addr - found.entry.key };
      },
      code: (addr) => free.code(addr)?.entry,
      tag: (entry) => free.machineTag(entry),
    };
    out.push({ kind: 'blank' });
    for (const line of mod.lines) {
      const shown = listsAsCode(line, map) ? { from: line.bodyAddr, to: lastBodyByte(line) } : null;
      if (shown === null) {
        out.push({ kind: 'basic', line: line.number, addr: line.addr, text: line.text });
        for (const text of basNotes(line, names)) out.push({ kind: 'note', text });
      } else {
        out.push({ kind: 'note', text: `; ${codeLineLabel(line)}`, addr: line.bodyAddr });
        body(shown.from, shown.to);
      }
      for (const s of symbols.list()) {
        if (s.addr < line.addr || s.addr >= line.addr + line.length) continue;
        if (shown !== null && s.addr >= shown.from && s.addr <= shown.to) continue;
        out.push({ kind: 'note', text: `; symbol ${s.name} = ${$(s.addr)} (in line ${line.number})`, addr: s.addr });
      }
    }
  } else {
    for (const run of runs) {
      out.push({ kind: 'blank' }, { kind: 'org', addr: run.start });
      for (const piece of filePieces(run, space.relocations)) {
        if (piece.runAddr === null) {
          body(piece.start, piece.end);
          continue;
        }
        const last = piece.runAddr + piece.end - piece.start;
        out.push({ kind: 'note', text: `; relocated: file ${$(piece.start)}-${$(piece.end)} executes at ${$(piece.runAddr)}-${$(last)}`, addr: piece.runAddr });
        body(piece.runAddr, last);
      }
    }
  }
  return out;
}

/**
 * A tokenized BASIC program, one row per detokenized program line. With
 * `opts.tables`, a note row follows a line whose PEEK, POKE, or DEFUSR uses a
 * constant address the tables name (`basNotes`). The tables apply only outside
 * the program's own image, as everywhere else in the listings.
 */
export function basRows(prog: BasProgram, opts: RenderOptions = {}): Row[] {
  const out: Row[] = [{ kind: 'header', text: basHeadline(prog, opts) }];
  for (const w of prog.warnings) out.push({ kind: 'header', text: `; warning: ${w}` });
  const { tables } = opts;
  const names: BasNames | undefined =
    tables === undefined
      ? undefined
      : {
          data: (addr) => (prog.image.isLoaded(addr) ? undefined : tables.data(addr)),
          code: (addr) => (prog.image.isLoaded(addr) ? undefined : tables.code(addr)),
          tag: (entry) => tables.machineTag(entry),
        };
  for (const line of prog.lines) {
    const text = line.parsed ? line.text : `[unparsed: ${plural(line.body.length, 'byte')} at ${$(line.bodyAddr)}: ${line.reason}]`;
    out.push({ kind: 'basic', line: line.number, addr: line.addr, text });
    if (names !== undefined) for (const note of basNotes(line, names)) out.push({ kind: 'note', text: note });
  }
  return out;
}
