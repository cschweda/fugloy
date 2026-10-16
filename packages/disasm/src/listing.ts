/**
 * Plain-text listings for the CLI and the tests. Addresses are `$XXXX` in
 * comments and `XXXXH` in assembly, per the project conventions.
 */
import { hex4, hexByte, hexWord } from '@fugloy/z80';
import { renderInstruction } from './emit/operands.js';
import { Kind } from './analysis/map.js';
import type { BasLine, BasProgram } from './bas.js';
import { codeLineLabel } from './basic/structure.js';
import { dbItems } from './emit/strings.js';
import { filePieces } from './analysis/relocate.js';
import type { CmdModule } from './cmd.js';
import type { MemoryImage } from './memory.js';
import type { RawModule } from './raw.js';
import type { Analysis } from './pipeline.js';
import { linearSweep } from './sweep.js';
import type { ListingLine, Section } from './sweep.js';

export interface RenderOptions {
  /** File name for the header line. */
  source?: string;
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

export function renderPass1Listing(analysis: Analysis, opts: RenderOptions = {}): string {
  const { module: mod, pass1, roots, symbols, annotations, hints, entries, space } = analysis;
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
  const rootText = roots.length === 0
    ? 'no roots; use --entry <hex> or --sweep'
    : `roots ${rootList}; ${code} of ${loaded} bytes decoded as code (${pct}%)${data > 0 ? `; ${data} typed as data` : ''}; ${plural(pass1.externals.length, 'external target')}; ${plural(pass1.diagnostics.length, 'note')}`;
  const out: string[] = [mod.format === 'cmd' ? cmdHeadline(mod, opts) : mod.format === 'raw' ? rawHeadline(mod, opts) : basHeadline(mod, opts)];
  const { rebasedFrom } = analysis;
  if (rebasedFrom !== undefined) out.push(`; rebased from ${$(rebasedFrom)} to ${$(runs[0]?.start ?? 0)}`);
  out.push(`; pass 1: ${rootText}`);
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
  const commentFor = (addr: number): string | undefined => {
    const parts: string[] = [];
    if (rootSet.has(addr)) parts.push('entry');
    const text = annotations.comments.get(addr);
    if (text !== undefined) parts.push(text);
    if (stale(addr)) parts.push(`stale: original base ${$(rebasedFrom!)}`);
    return parts.length === 0 ? undefined : parts.join('; ');
  };
  const regionStarts = new Set(annotations.overrides.map((o) => o.addr & 0xffff));
  const startsRow = (addr: number): boolean => symbols.has(addr) || annotations.comments.has(addr) || instructions.has(addr) || regionStarts.has(addr);
  /** Rows for runtime addresses [from, to]: label lines, instructions, and data rows of up to four bytes. */
  const rows = (from: number, to: number): void => {
    let addr = from;
    while (addr <= to) {
      const symbol = symbols.get(addr);
      if (symbol !== undefined && map.kind(addr) !== Kind.Tail) out.push(`${symbol.name}:`);
      const ins = instructions.get(addr);
      if (ins !== undefined && addr + ins.length - 1 <= to) {
        out.push(formatListingLine({ addr, bytes: ins.bytes, text: renderInstruction(ins, symbols), ins }, commentFor(addr)));
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
          words.push(symbols.get(value)?.name ?? hexWord(value));
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
    // A BASIC line reads as its text; a code line as rows at its true addresses. Symbols the rows do not show are named.
    out.push('');
    for (const line of mod.lines) {
      const shown = listsAsCode(line) ? { from: line.bodyAddr, to: lastBodyByte(line) } : null;
      if (shown === null) out.push(line.text === '' ? `${line.number}` : `${line.number} ${line.text}`);
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

export function renderBasListing(prog: BasProgram, opts: RenderOptions = {}): string {
  const unparsed = prog.lines.filter((l) => !l.parsed).length;
  const out = [
    `; ${prefix(opts)}tokenized BASIC, ${plural(prog.lines.length, 'line')}, saved from ${$(prog.base)} to ${$(prog.end)}, ${prog.header ? 'FF header' : 'no FF header'}, ${unparsed} unparsed`,
  ];
  for (const w of prog.warnings) out.push(`; warning: ${w}`);
  for (const line of prog.lines) {
    out.push(line.parsed ? `${line.number} ${line.text}` : `${line.number} [unparsed: ${plural(line.body.length, 'byte')} at ${$(line.bodyAddr)}: ${line.reason}]`);
  }
  return `${out.join('\n')}\n`;
}
