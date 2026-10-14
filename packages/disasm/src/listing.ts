/**
 * Plain-text listings for the CLI and the tests. Addresses are `$XXXX` in
 * comments and `XXXXH` in assembly, per the project conventions.
 */
import { hex4, hexWord } from '@fugloy/z80';
import type { BasProgram } from './bas.js';
import type { CmdModule } from './cmd.js';
import type { MemoryImage } from './memory.js';
import type { RawModule } from './raw.js';
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

export function renderCmdListing(mod: CmdModule, opts: RenderOptions = {}): string {
  const { image } = mod;
  const sections = linearSweep(image);
  const runs = image.runs();
  const loaded = runs.reduce((n, r) => n + r.length, 0);
  const entry =
    mod.entry === null
      ? `no entry (${mod.endedBy === 'end' ? '03 record' : 'nothing loaded'})`
      : `entry ${$(mod.entry)} (${mod.entrySource === 'transfer' ? 'transfer address' : 'lowest loaded address'})`;
  const out = [
    `; ${prefix(opts)}load module, ${plural(image.blocks.length, 'block')}, ${plural(runs.length, 'run')}, ${plural(loaded, 'byte')}, ${entry}`,
  ];
  if (mod.name !== undefined) out.push(`; name: ${mod.name}`);
  if (mod.copyright !== undefined) out.push(`; copyright: ${mod.copyright}`);
  out.push(...blockLines(image));
  const inside = misalignedEntry(sections, mod.entry);
  if (inside !== undefined && mod.entry !== null) out.push(`; note: entry ${$(mod.entry)} falls inside the instruction at ${$(inside.addr)} (linear sweep)`);
  for (const w of mod.warnings) out.push(`; warning: ${w}`);
  out.push(...renderSections(sections, mod.entry));
  return `${out.join('\n')}\n`;
}

export function renderRawListing(mod: RawModule, opts: RenderOptions = {}): string {
  const run = mod.image.runs();
  const last = run.at(-1);
  const extent = last === undefined ? '' : ` at ${$(mod.base)}-${$(last.end)}`;
  const out = [`; ${prefix(opts)}raw binary, ${plural(mod.image.blocks[0]?.length ?? 0, 'byte')}${extent}`];
  out.push(...renderSections(linearSweep(mod.image), mod.entry));
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
