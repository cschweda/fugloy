/**
 * Plain-text listings for the CLI and the tests. Addresses are `$XXXX` in
 * comments and `XXXXH` in assembly, per the project conventions.
 */
import { hex4, hexByte, hexWord } from '@fugloy/z80';
import { renderInstruction } from './emit/operands.js';
import { Kind } from './analysis/map.js';
import type { BasProgram } from './bas.js';
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
export function renderPass1Listing(analysis: Analysis, opts: RenderOptions = {}): string {
  const { module: mod, pass1, roots, symbols, annotations, hints } = analysis;
  const { image } = mod;
  const { map, instructions } = pass1;
  const runs = image.runs();
  const loaded = runs.reduce((n, r) => n + r.length, 0);
  let reached = 0;
  for (const run of runs) for (let a = run.start; a <= run.end; a++) if (map.kind(a) !== Kind.Unknown) reached++;
  const pct = loaded === 0 ? 0 : Math.round((reached / loaded) * 100);
  const rootText = roots.length === 0 ? 'no roots; use --entry <hex> or --sweep' : `roots ${roots.map($).join(', ')}; ${reached} of ${loaded} bytes reached (${pct}%); ${plural(pass1.externals.length, 'external target')}; ${plural(pass1.diagnostics.length, 'note')}`;
  const out: string[] = [mod.format === 'cmd' ? cmdHeadline(mod, opts) : mod.format === 'raw' ? rawHeadline(mod, opts) : basHeadline(mod, opts)];
  out.push(`; pass 1: ${rootText}`);
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
  for (const w of hints?.warnings ?? []) out.push(`; warning: ${w}`);
  if (mod.format === 'cmd') out.push(...cmdDetails(mod));
  const rootSet = new Set(roots);
  const commentFor = (addr: number): string | undefined => {
    const parts: string[] = [];
    if (rootSet.has(addr)) parts.push('entry');
    const text = annotations.comments.get(addr);
    if (text !== undefined) parts.push(text);
    return parts.length === 0 ? undefined : parts.join('; ');
  };
  const startsRow = (addr: number): boolean => symbols.has(addr) || annotations.comments.has(addr) || instructions.has(addr);
  for (const run of runs) {
    out.push('', `        ORG ${hexWord(run.start)}`);
    let addr = run.start;
    while (addr <= run.end) {
      const symbol = symbols.get(addr);
      if (symbol !== undefined && map.kind(addr) !== Kind.Tail) out.push(`${symbol.name}:`);
      const ins = instructions.get(addr);
      if (ins !== undefined) {
        out.push(formatListingLine({ addr, bytes: ins.bytes, text: renderInstruction(ins, symbols), ins }, commentFor(addr)));
        addr += ins.length;
        continue;
      }
      const kind = map.kind(addr);
      let n = 1;
      while (addr + n <= run.end && n < 4 && !startsRow(addr + n) && map.kind(addr + n) === kind) n++;
      let text: string;
      if (kind === Kind.Word && n >= 2) {
        if (n % 2 === 1) n--;
        const words: string[] = [];
        for (let i = 0; i < n; i += 2) {
          const value = image.bytes[addr + i]! | (image.bytes[addr + i + 1]! << 8);
          words.push(symbols.get(value)?.name ?? hexWord(value));
        }
        text = `DW ${words.join(',')}`;
      } else {
        text = `DB ${Array.from(image.bytes.subarray(addr, addr + n), hexByte).join(',')}`;
      }
      out.push(formatListingLine({ addr, bytes: Array.from(image.bytes.subarray(addr, addr + n)), text } as ListingLine, commentFor(addr)));
      addr += n;
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
