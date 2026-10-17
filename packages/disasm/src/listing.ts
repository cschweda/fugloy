/**
 * Plain-text listings for the CLI and the tests. Addresses are `$XXXX` in
 * comments and `XXXXH` in assembly, per the project conventions.
 */
import { hex4, hexByte, hexWord } from '@fugloy/z80';
import { commentEntries, externalComment, previousInstruction, renderInstruction } from './emit/operands.js';
import { externalUses, inTableOrder } from './analysis/externals.js';
import { Kind } from './analysis/map.js';
import type { BasLine, BasProgram } from './bas.js';
import { codeLineLabel } from './basic/structure.js';
import { dbItems } from './emit/strings.js';
import { filePieces } from './analysis/relocate.js';
import { rowStarts } from './analysis/words.js';
import { basReferences } from './basic/addresses.js';
import type { CmdModule } from './cmd.js';
import type { MemoryImage } from './memory.js';
import type { RawModule } from './raw.js';
import type { Analysis } from './pipeline.js';
import { describeSelection } from './symbols/select.js';
import type { SymbolSet } from './symbols/select.js';
import type { TableEntry } from './symbols/types.js';
import { linearSweep } from './sweep.js';
import type { ListingLine, Section } from './sweep.js';

export interface RenderOptions {
  /** File name for the header line. */
  source?: string;
  /**
   * The tables whose names `renderBasListing` gives the constant addresses of a BASIC
   * line's PEEK, POKE, and DEFUSR; without them nothing is named. A pass 1 listing
   * names from the tables its analysis was run with, not from this.
   */
  tables?: SymbolSet;
}

const $ = (n: number): string => `$${hex4(n)}`;
const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const prefix = (opts: RenderOptions): string => (opts.source === undefined ? '' : `${opts.source}: `);

/** `6000  21 00 3C      LD HL,3C00H             ; entry` */
export function formatListingLine(line: ListingLine, comment?: string): string {
  const bytes = line.bytes.map(hex2).join(' ').padEnd(12);
  const body = `${hex4(line.addr)}  ${bytes}  ${line.text}`;
  return comment === undefined ? body : `${body.padEnd(44)}; ${comment}`;
}

function renderSections(sections: Section[], entry: number | null): string[] {
  const out: string[] = [];
  for (const section of sections) {
    out.push('', `        ORG ${hexWord(section.run.start)}`);
    for (const line of section.lines) out.push(formatListingLine(line, line.addr === entry ? 'entry' : undefined));
  }
  return out;
}

/** The instruction an entry address falls inside of, when it is not on an instruction boundary. */
function misalignedEntry(sections: Section[], entry: number | null): ListingLine | undefined {
  if (entry === null) return undefined;
  for (const s of sections) {
    for (const line of s.lines) {
      if (line.addr === entry) return undefined;
      if (entry > line.addr && entry < line.addr + line.bytes.length) return line;
    }
  }
  return undefined;
}

function blockLines(image: MemoryImage): string[] {
  return image.blocks.map((b) => {
    const patches = image.overlaps
      .filter((o) => o.block === b.index)
      .map((o) => ` patches block ${o.earlier} at ${$(o.start)}-${$(o.end)}`)
      .join(',');
    return `; block ${b.index}: ${$(b.start)}-${$(b.end)} (${plural(b.length, 'byte')})${b.wrapped ? ' wraps past $FFFF' : ''}${patches}`;
  });
}

/** First header line of a load module listing. */
function cmdHeadline(mod: CmdModule, opts: RenderOptions): string {
  const runs = mod.image.runs();
  const loaded = runs.reduce((n, r) => n + r.length, 0);
  const entry =
    mod.entry === null
      ? `no entry (${mod.endedBy === 'end' ? '03 record' : 'nothing loaded'})`
      : `entry ${$(mod.entry)} (${mod.entrySource === 'transfer' ? 'transfer address' : 'lowest loaded address'})`;
  return `; ${prefix(opts)}load module, ${plural(mod.image.blocks.length, 'block')}, ${plural(runs.length, 'run')}, ${plural(loaded, 'byte')}, ${entry}`;
}

/** Name, copyright, blocks, and warnings of a load module. */
function cmdDetails(mod: CmdModule): string[] {
  const out: string[] = [];
  if (mod.name !== undefined) out.push(`; name: ${mod.name}`);
  if (mod.copyright !== undefined) out.push(`; copyright: ${mod.copyright}`);
  out.push(...blockLines(mod.image));
  for (const w of mod.warnings) out.push(`; warning: ${w}`);
  return out;
}

function rawHeadline(mod: RawModule, opts: RenderOptions): string {
  const last = mod.image.runs().at(-1);
  const extent = last === undefined ? '' : ` at ${$(mod.base)}-${$(last.end)}`;
  return `; ${prefix(opts)}raw binary, ${plural(mod.image.blocks[0]?.length ?? 0, 'byte')}${extent}`;
}

function basHeadline(prog: BasProgram, opts: RenderOptions): string {
  const unparsed = prog.lines.filter((l) => !l.parsed).length;
  return `; ${prefix(opts)}tokenized BASIC, ${plural(prog.lines.length, 'line')}, saved from ${$(prog.base)} to ${$(prog.end)}, ${prog.header ? 'FF header' : 'no FF header'}, ${unparsed} unparsed`;
}

export function renderCmdListing(mod: CmdModule, opts: RenderOptions = {}): string {
  const sections = linearSweep(mod.image);
  const out = [cmdHeadline(mod, opts)];
  const details = cmdDetails(mod);
  const warningsStart = details.findIndex((l) => l.startsWith('; warning: '));
  const inside = misalignedEntry(sections, mod.entry);
  const note = inside !== undefined && mod.entry !== null ? [`; note: entry ${$(mod.entry)} falls inside the instruction at ${$(inside.addr)} (linear sweep)`] : [];
  if (warningsStart < 0) out.push(...details, ...note);
  else out.push(...details.slice(0, warningsStart), ...note, ...details.slice(warningsStart));
  out.push(...renderSections(sections, mod.entry));
  return `${out.join('\n')}\n`;
}

export function renderRawListing(mod: RawModule, opts: RenderOptions = {}): string {
  const out = [rawHeadline(mod, opts)];
  out.push(...renderSections(linearSweep(mod.image), mod.entry));
  return `${out.join('\n')}\n`;
}

/**
 * The Pass 1 listing: instruction rows where descent reached, data rows of up
 * to four bytes elsewhere (four keeps the bytes column aligned), label lines
 * before rows that have a symbol, symbol names in operands, hint comments,
 * `; entry` on every root, and a header that says how much was reached and
 * how the hint file applied.
 */
/** Roots named in the pass 1 header before the rest are counted. */
const MAX_ROOTS = 8;

/** Where a table name points, as the legend says it: `$0049`, `port $EC`, or `SVC 10`. */
function legendWhere(e: TableEntry): string {
  return e.kind === 'port' ? `port $${hex2(e.key)}` : e.kind === 'svc' ? `SVC ${e.key}` : $(e.key);
}

/** `; table name $KBWAIT = $0049: wait for a key (m3-basic 12/12)` */
function legendLine(e: TableEntry): string {
  return `; table name ${e.name} = ${legendWhere(e)}: ${e.purpose} (${e.cite.map((c) => `${c.source} ${c.page}`).join(', ')})`;
}

/**
 * What the notes under a BASIC line ask of the tables: the name covering an
 * address as data, with the offset into it, the name at an address as code, and
 * the machine tag of an entry.
 */
interface BasNames {
  data(addr: number): { entry: TableEntry; offset: number } | undefined;
  code(addr: number): TableEntry | undefined;
  tag(entry: TableEntry): string | undefined;
}

/**
 * The note lines under a BASIC line (design spec §5.4): one for each distinct
 * constant address its PEEKs, POKEs, and DEFUSRs use that the tables name, in
 * the order the line reads them, as `;   16526 = $408E USR vector (USRVEC)`: the
 * address in decimal and in hex, the purpose, and the name. A ROM name whose
 * address differs between the machines ends with its machine tag, as a comment
 * on an instruction does (§4.6): `(USRVEC) [Model I]`. A note line and not a
 * trailing comment, because `;` is BASIC's PRINT separator and would read as
 * program text. A PEEK or POKE takes a data name and else a code name, a DEFUSR
 * the reverse; inside a span the name carries the decimal offset, `USRVEC+1`.
 */
function basNotes(line: BasLine, names: BasNames): string[] {
  const notes: string[] = [];
  for (const { addr, use } of basReferences(line)) {
    const asData = names.data(addr);
    const routine = names.code(addr);
    const asCode = routine === undefined ? undefined : { entry: routine, offset: 0 };
    const found = use === 'data' ? (asData ?? asCode) : (asCode ?? asData);
    if (found === undefined) continue;
    const { entry, offset } = found;
    const tag = names.tag(entry);
    notes.push(`;   ${addr} = ${$(addr)} ${entry.purpose} (${offset === 0 ? entry.name : `${entry.name}+${offset}`})${tag === undefined ? '' : ` ${tag}`}`);
  }
  return notes;
}

export function renderPass1Listing(analysis: Analysis, opts: RenderOptions = {}): string {
  const { module: mod, pass1, roots, symbols, annotations, hints, entries, space, externals } = analysis;
  const { image } = mod;
  const { map, instructions } = pass1;
  /** Bytes at runtime addresses; the file image itself when nothing is relocated. */
  const view = space.image;
  const runs = image.runs();
  const loaded = runs.reduce((n, r) => n + r.length, 0);
  let code = 0;
  let data = 0;
  for (const run of view.runs()) {
    for (let a = run.start; a <= run.end; a++) {
      const k = map.kind(a);
      if (k === Kind.Code || k === Kind.Tail) code++;
      else if (k !== Kind.Unknown) data++;
    }
  }
  const pct = loaded === 0 ? 0 : Math.round((code / loaded) * 100);
  const rootList = roots.length <= MAX_ROOTS ? roots.map($).join(', ') : `${roots.slice(0, MAX_ROOTS).map($).join(', ')} and ${roots.length - MAX_ROOTS} more`;
  /** `2 external targets`, and with tables `2 external targets (1 named)`: how many a ROM, hardware, or DOS name stands for. */
  const targets = `${plural(pass1.externals.length, 'external target')}${
    externals.selection !== undefined && pass1.externals.length > 0 ? ` (${pass1.externals.filter((a) => externals.code(a) !== undefined).length} named)` : ''
  }`;
  const rootText = roots.length === 0
    ? 'no roots; use --entry <hex> or --sweep'
    : `roots ${rootList}; ${code} of ${loaded} bytes decoded as code (${pct}%)${data > 0 ? `; ${data} typed as data` : ''}; ${targets}; ${plural(pass1.diagnostics.length, 'note')}`;
  const out: string[] = [mod.format === 'cmd' ? cmdHeadline(mod, opts) : mod.format === 'raw' ? rawHeadline(mod, opts) : basHeadline(mod, opts)];
  const { rebasedFrom } = analysis;
  if (rebasedFrom !== undefined) out.push(`; rebased from ${$(rebasedFrom)} to ${$(runs[0]?.start ?? 0)}`);
  out.push(`; pass 1: ${rootText}`);
  if (externals.selection !== undefined) {
    out.push(`; symbols: ${describeSelection(externals.selection)}`);
    // Every name the listing shows: those in operands and DW rows (which zmac defines) and those only a comment speaks of.
    for (const e of inTableOrder([...analysis.tablesUsed, ...commentEntries(pass1.instructions, externals, symbols)])) out.push(legendLine(e));
    // A table name the program's own name took, if the program refers to the address: said so, since the address then stays a number.
    const free = externals.ignoringCollisions();
    const wouldHaveNamed = new Set([...externalUses(pass1.instructions.values(), free, symbols), ...commentEntries(pass1.instructions, free, symbols)]);
    for (const e of externals.dropped) {
      if (!wouldHaveNamed.has(e)) continue;
      const own = symbols.list().find((s) => s.name.toUpperCase() === e.name.toUpperCase())?.name ?? e.name;
      out.push(`; table name ${e.name} not used: the program has its own ${own}`);
    }
  }
  // A user name outside the program (an `at` hint): the one place the listing says what it is.
  for (const s of symbols.list()) {
    if (s.source === 'user' && !space.image.isLoaded(s.addr)) out.push(`; name ${s.name} = ${$(s.addr)}${s.comment === undefined ? '' : `: ${s.comment}`}`);
  }
  /** A .BAS line lists as code when it does not parse, or when a hint had any of its body decoded anyway. */
  const lastBodyByte = (line: BasLine): number => line.bodyAddr + (line.body.length > 0 && line.body[line.body.length - 1] === 0 ? line.body.length - 1 : line.body.length) - 1;
  const listsAsCode = (line: BasLine): boolean => {
    if (!line.parsed) return true;
    for (let a = line.bodyAddr; a <= lastBodyByte(line); a++) if (map.isCode(a)) return true;
    return false;
  };
  if (mod.format === 'bas') {
    const found = entries.filter((e) => e.addr !== null);
    out.push(`; code lines: ${mod.lines.filter(listsAsCode).length}; entries mined: ${found.length}`);
    for (const e of found) out.push(`; entry ${$(e.addr!)} (${e.evidence})`);
    for (const e of entries) if (e.addr === null) out.push(`; note: ${e.evidence}`);
  }
  if (hints !== undefined) {
    out.push(`; hints: ${hints.source === undefined ? '' : `${hints.source}: `}${plural(hints.matched, 'block')} matched, ${hints.unmatched} unmatched, ${plural(hints.applied, 'hint')} applied`);
  }
  for (const s of symbols.list()) {
    if (map.kind(s.addr) !== Kind.Tail) continue;
    let owner = s.addr;
    while (!map.isStart(owner) && owner > s.addr - 4) owner--;
    out.push(`; symbol ${s.name} = ${$(s.addr)} (inside the instruction at ${$(owner)})`);
  }
  for (const d of pass1.diagnostics) out.push(`; note: ${d.message}`);
  for (const p of analysis.proposals) {
    if (p.kind === 'table') out.push(`; proposed table at ${$(p.addr)}, ${p.count} entries, all in code; declare with: ${p.hint}`);
    else {
      out.push(`; proposed move: LDIR at ${$(p.ldir)} copies ${$(p.src)}-${$(p.src + p.length - 1)} to ${$(p.dst)}-${$(p.dst + p.length - 1)}; declare with:`);
      for (const h of p.hints) out.push(`;   ${h}`);
    }
  }
  for (const w of hints?.warnings ?? []) out.push(`; warning: ${w}`);
  for (const e of analysis.relocationErrors) out.push(`; warning: ${e}`);
  if (mod.format === 'cmd') out.push(...cmdDetails(mod));
  const rootSet = new Set(roots);
  /** After a rebase, an absolute operand into the program's old range still points where the program no longer is. */
  const inOldRange = (v: number): boolean => rebasedFrom !== undefined && v >= rebasedFrom && v < rebasedFrom + loaded;
  const stale = (addr: number): boolean =>
    instructions.get(addr)?.operands.some((o) => (o.kind === 'imm16' && inOldRange(o.value)) || (o.kind === 'mem' && inOldRange(o.addr))) ?? false;
  /** The comment column of the row at `addr`: the entry mark, the hint comment, what the tables say (`note`), and the stale-operand warning. */
  const commentFor = (addr: number, note?: string): string | undefined => {
    const parts: string[] = [];
    if (rootSet.has(addr)) parts.push('entry');
    const text = annotations.comments.get(addr);
    if (text !== undefined) parts.push(text);
    if (note !== undefined) parts.push(note);
    if (stale(addr)) parts.push(`stale: original base ${$(rebasedFrom!)}`);
    return parts.length === 0 ? undefined : parts.join('; ');
  };
  const startsRow = rowStarts(symbols, annotations, instructions);
  /** Rows for runtime addresses [from, to]: label lines, instructions, and data rows of up to four bytes. */
  const rows = (from: number, to: number): void => {
    let addr = from;
    while (addr <= to) {
      const symbol = symbols.get(addr);
      if (symbol !== undefined && map.kind(addr) !== Kind.Tail) out.push(`${symbol.name}:`);
      const ins = instructions.get(addr);
      if (ins !== undefined && addr + ins.length - 1 <= to) {
        const note = externalComment(ins, previousInstruction(instructions, symbols, addr), externals, symbols);
        out.push(formatListingLine({ addr, bytes: ins.bytes, text: renderInstruction(ins, symbols, externals), ins }, commentFor(addr, note)));
        addr += ins.length;
        continue;
      }
      const kind = map.kind(addr);
      let n = 1;
      while (addr + n <= to && n < 4 && !startsRow(addr + n) && map.kind(addr + n) === kind) n++;
      let text: string;
      if (kind === Kind.Word && n >= 2) {
        if (n % 2 === 1) n--;
        const words: string[] = [];
        for (let i = 0; i < n; i += 2) {
          const value = view.bytes[addr + i]! | (view.bytes[addr + i + 1]! << 8);
          words.push(symbols.get(value)?.name ?? externals.word(addr + i, value)?.text ?? hexWord(value));
        }
        text = `DW ${words.join(',')}`;
      } else if (kind === Kind.String) {
        text = `DB ${dbItems(view.bytes.subarray(addr, addr + n))}`;
      } else {
        text = `DB ${Array.from(view.bytes.subarray(addr, addr + n), hexByte).join(',')}`;
      }
      out.push(formatListingLine({ addr, bytes: Array.from(view.bytes.subarray(addr, addr + n)), text } as ListingLine, commentFor(addr)));
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
    out.push('');
    for (const line of mod.lines) {
      const shown = listsAsCode(line) ? { from: line.bodyAddr, to: lastBodyByte(line) } : null;
      if (shown === null) out.push(line.text === '' ? `${line.number}` : `${line.number} ${line.text}`, ...basNotes(line, names));
      else {
        out.push(`; ${codeLineLabel(line)}`);
        rows(shown.from, shown.to);
      }
      for (const s of symbols.list()) {
        if (s.addr < line.addr || s.addr >= line.addr + line.length) continue;
        if (shown !== null && s.addr >= shown.from && s.addr <= shown.to) continue;
        out.push(`; symbol ${s.name} = ${$(s.addr)} (in line ${line.number})`);
      }
    }
  } else {
    for (const run of runs) {
      out.push('', `        ORG ${hexWord(run.start)}`);
      for (const piece of filePieces(run, space.relocations)) {
        if (piece.runAddr === null) {
          rows(piece.start, piece.end);
          continue;
        }
        const last = piece.runAddr + piece.end - piece.start;
        out.push(`; relocated: file ${$(piece.start)}-${$(piece.end)} executes at ${$(piece.runAddr)}-${$(last)}`);
        rows(piece.runAddr, last);
      }
    }
  }
  return `${out.join('\n')}\n`;
}

/**
 * A tokenized BASIC program as text, one detokenized line per program line. With
 * `opts.tables`, the line after one whose PEEK, POKE, or DEFUSR uses a constant
 * address the tables name is a note line (`basNotes`). The tables apply only
 * outside the program's own image, as everywhere else in the listings.
 */
export function renderBasListing(prog: BasProgram, opts: RenderOptions = {}): string {
  const unparsed = prog.lines.filter((l) => !l.parsed).length;
  const out = [
    `; ${prefix(opts)}tokenized BASIC, ${plural(prog.lines.length, 'line')}, saved from ${$(prog.base)} to ${$(prog.end)}, ${prog.header ? 'FF header' : 'no FF header'}, ${unparsed} unparsed`,
  ];
  for (const w of prog.warnings) out.push(`; warning: ${w}`);
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
    out.push(line.parsed ? `${line.number} ${line.text}` : `${line.number} [unparsed: ${plural(line.body.length, 'byte')} at ${$(line.bodyAddr)}: ${line.reason}]`);
    if (names !== undefined) out.push(...basNotes(line, names));
  }
  return `${out.join('\n')}\n`;
}
