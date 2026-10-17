/**
 * Plain-text listings for the CLI and the tests. Addresses are `$XXXX` in
 * comments and `XXXXH` in assembly, per the project conventions. The pass 1 and
 * BASIC listings are their rows (rows.ts), each printed by `formatRow`.
 */
import { hexWord } from '@fugloy/z80';
import type { BasProgram } from './bas.js';
import type { CmdModule } from './cmd.js';
import { $, cmdDetails, cmdHeadline, rawHeadline } from './listing-header.js';
import type { RenderOptions } from './listing-header.js';
import type { Analysis } from './pipeline.js';
import type { RawModule } from './raw.js';
import { basRows, formatListingLine, formatRow, listingRows } from './rows.js';
import type { Row } from './rows.js';
import { linearSweep } from './sweep.js';
import type { ListingLine, Section } from './sweep.js';

export { formatListingLine } from './rows.js';
export type { RenderOptions } from './listing-header.js';

const text = (rows: readonly Row[]): string => `${rows.map(formatRow).join('\n')}\n`;

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

/** The pass 1 listing: `listingRows`, one line per row. */
export function renderPass1Listing(analysis: Analysis, opts: RenderOptions = {}): string {
  return text(listingRows(analysis, opts));
}

/** A tokenized BASIC program as text: `basRows`, one line per row. */
export function renderBasListing(prog: BasProgram, opts: RenderOptions = {}): string {
  return text(basRows(prog, opts));
}
