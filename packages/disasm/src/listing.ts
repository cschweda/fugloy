/**
 * Plain-text listings for the CLI and the tests. Addresses are `$XXXX` in
 * comments and `XXXXH` in assembly, per the project conventions.
 */
import { formatInstruction as formatInstructionText, hex4, hexByte, hexWord } from '@fugloy/z80';
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
 * The Pass 1 listing: instruction rows where descent reached, DB rows of up
 * to four bytes elsewhere (four keeps the bytes column aligned), `; entry` on
 * every root, and a header that says how much was reached.
 */
export function renderPass1Listing(analysis: Analysis, opts: RenderOptions = {}): string {
  const { module: mod, pass1, roots } = analysis;
  const { image } = mod;
  const runs = image.runs();
  const loaded = runs.reduce((n, r) => n + r.length, 0);
  let reached = 0;
  for (const run of runs) for (let a = run.start; a <= run.end; a++) if (pass1.map.kind(a) !== Kind.Unknown) reached++;
  const pct = loaded === 0 ? 0 : Math.round((reached / loaded) * 100);
  const rootText = roots.length === 0 ? 'no roots; use --entry <hex> or --sweep' : `roots ${roots.map($).join(', ')}; ${reached} of ${loaded} bytes reached (${pct}%); ${plural(pass1.externals.length, 'external target')}; ${plural(pass1.diagnostics.length, 'note')}`;
  const out: string[] = [mod.format === 'cmd' ? cmdHeadline(mod, opts) : mod.format === 'raw' ? rawHeadline(mod, opts) : basHeadline(mod, opts)];
  out.push(`; pass 1: ${rootText}`);
  for (const d of pass1.diagnostics) out.push(`; note: ${d.message}`);
  if (mod.format === 'cmd') out.push(...cmdDetails(mod));
  const rootSet = new Set(roots);
  for (const run of runs) {
    out.push('', `        ORG ${hexWord(run.start)}`);
    let addr = run.start;
    let pending: number[] = [];
    let pendingStart = addr;
    const flush = (): void => {
      if (pending.length > 0) out.push(formatListingLine({ addr: pendingStart, bytes: pending, text: `DB ${pending.map(hexByte).join(',')}` } as ListingLine));
      pending = [];
    };
    while (addr <= run.end) {
      const ins = pass1.instructions.get(addr);
      if (ins !== undefined) {
        flush();
        out.push(formatListingLine({ addr, bytes: ins.bytes, text: formatInstructionText(ins), ins }, rootSet.has(addr) ? 'entry' : undefined));
        addr += ins.length;
      } else {
        if (pending.length === 0) pendingStart = addr;
        pending.push(image.bytes[addr]!);
        if (pending.length === 4) flush();
        addr++;
      }
    }
    flush();
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
