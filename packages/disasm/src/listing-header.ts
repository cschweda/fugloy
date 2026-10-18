/**
 * The `; …` lines of the listings: the header before the first ORG or BASIC
 * line, and the note lines under a BASIC line. Addresses are `$XXXX`, per the
 * project conventions.
 */
import { hex4 } from '@fugloy/z80';
import { externalUses, inTableOrder } from './analysis/externals.js';
import { Kind } from './analysis/map.js';
import type { ByteMap } from './analysis/map.js';
import { outsideComments } from './analysis/symbols.js';
import type { BasLine, BasProgram } from './bas.js';
import { basReferences } from './basic/addresses.js';
import type { CmdModule } from './cmd.js';
import { commentEntries, noteEntries } from './emit/operands.js';
import type { ExternalNote } from './emit/operands.js';
import type { MemoryImage } from './memory.js';
import type { Analysis } from './pipeline.js';
import type { RawModule } from './raw.js';
import { describeSelection } from './symbols/select.js';
import type { SymbolSet } from './symbols/select.js';
import type { TableEntry } from './symbols/types.js';

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

export const $ = (n: number): string => `$${hex4(n)}`;
export const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const prefix = (opts: RenderOptions): string => (opts.source === undefined ? '' : `${opts.source}: `);

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
export function cmdHeadline(mod: CmdModule, opts: RenderOptions): string {
  const runs = mod.image.runs();
  const loaded = runs.reduce((n, r) => n + r.length, 0);
  const entry =
    mod.entry === null
      ? `no entry (${mod.endedBy === 'end' ? '03 record' : 'nothing loaded'})`
      : `entry ${$(mod.entry)} (${mod.entrySource === 'transfer' ? 'transfer address' : 'lowest loaded address'})`;
  return `; ${prefix(opts)}load module, ${plural(mod.image.blocks.length, 'block')}, ${plural(runs.length, 'run')}, ${plural(loaded, 'byte')}, ${entry}`;
}

/** Name, copyright, blocks, and warnings of a load module. */
export function cmdDetails(mod: CmdModule): string[] {
  const out: string[] = [];
  if (mod.name !== undefined) out.push(`; name: ${mod.name}`);
  if (mod.copyright !== undefined) out.push(`; copyright: ${mod.copyright}`);
  out.push(...blockLines(mod.image));
  for (const w of mod.warnings) out.push(`; warning: ${w}`);
  return out;
}

export function rawHeadline(mod: RawModule, opts: RenderOptions): string {
  const last = mod.image.runs().at(-1);
  const extent = last === undefined ? '' : ` at ${$(mod.base)}-${$(last.end)}`;
  return `; ${prefix(opts)}raw binary, ${plural(mod.image.blocks[0]?.length ?? 0, 'byte')}${extent}`;
}

export function basHeadline(prog: BasProgram, opts: RenderOptions): string {
  const unparsed = prog.lines.filter((l) => !l.parsed).length;
  return `; ${prefix(opts)}tokenized BASIC, ${plural(prog.lines.length, 'line')}, saved from ${$(prog.base)} to ${$(prog.end)}, ${prog.header ? 'FF header' : 'no FF header'}, ${unparsed} unparsed`;
}

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
export interface BasNames {
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
export function basNotes(line: BasLine, names: BasNames): string[] {
  return basFinds(line, names).map(({ addr, entry, offset }) => {
    const tag = names.tag(entry);
    return `;   ${addr} = ${$(addr)} ${entry.purpose} (${offset === 0 ? entry.name : `${entry.name}+${offset}`})${tag === undefined ? '' : ` ${tag}`}`;
  });
}

/** The table entries the notes under a BASIC line name, in the order `basNotes` gives them (an entry may repeat). */
export function basNoteEntries(line: BasLine, names: BasNames): TableEntry[] {
  return basFinds(line, names).map((f) => f.entry);
}

/** What the tables name for each constant address of a BASIC line: a PEEK or POKE prefers a data name, a DEFUSR a code name. */
function basFinds(line: BasLine, names: BasNames): { addr: number; entry: TableEntry; offset: number }[] {
  const found: { addr: number; entry: TableEntry; offset: number }[] = [];
  for (const { addr, use } of basReferences(line)) {
    const asData = names.data(addr);
    const routine = names.code(addr);
    const asCode = routine === undefined ? undefined : { entry: routine, offset: 0 };
    const hit = use === 'data' ? (asData ?? asCode) : (asCode ?? asData);
    if (hit !== undefined) found.push({ addr, ...hit });
  }
  return found;
}

/** The last byte of a BASIC line's body, before its terminating `00`. */
export const lastBodyByte = (line: BasLine): number =>
  line.bodyAddr + (line.body.length > 0 && line.body[line.body.length - 1] === 0 ? line.body.length - 1 : line.body.length) - 1;

/** A .BAS line lists as code when it does not parse, or when a hint had any of its body decoded anyway. */
export function listsAsCode(line: BasLine, map: ByteMap): boolean {
  if (!line.parsed) return true;
  for (let a = line.bodyAddr; a <= lastBodyByte(line); a++) if (map.isCode(a)) return true;
  return false;
}

/**
 * The header of the pass 1 listing: how much was reached, the table legend,
 * names and comments outside the program, how the hint file applied, notes,
 * proposals, warnings, and a load module's blocks. `notes` is `externalNotes`
 * of the analysis, which the rows' comment column reads too.
 */
export function pass1Header(analysis: Analysis, opts: RenderOptions, notes: ReadonlyMap<number, ExternalNote>): string[] {
  const { module: mod, pass1, roots, symbols, annotations, hints, labels, entries, space, externals } = analysis;
  const { image } = mod;
  const { map } = pass1;
  const runs = image.runs();
  const loaded = runs.reduce((n, r) => n + r.length, 0);
  let code = 0;
  let data = 0;
  for (const run of space.image.runs()) {
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
    for (const e of inTableOrder([...analysis.tablesUsed, ...noteEntries(notes)])) out.push(legendLine(e));
    // A table name the program's own name took, if the program refers to the address: said so, since the address then stays a number.
    if (externals.dropped.length > 0) {
      const free = externals.ignoringCollisions();
      const wouldHaveNamed = new Set([...externalUses(pass1.instructions.values(), free, symbols), ...commentEntries(pass1.instructions, free, symbols)]);
      for (const e of externals.dropped) {
        if (!wouldHaveNamed.has(e)) continue;
        const own = symbols.list().find((s) => s.name.toUpperCase() === e.name.toUpperCase())?.name ?? e.name;
        out.push(`; table name ${e.name} not used: the program has its own ${own}`);
      }
    }
  }
  // A user name outside the program (an `at` hint): the one place the listing says what it is.
  const outside = [
    ...symbols.list().filter((s) => s.source === 'user' && !space.image.isLoaded(s.addr)).map((s) => ({ addr: s.addr, line: `; name ${s.name} = ${$(s.addr)}${s.comment === undefined ? '' : `: ${s.comment}`}` })),
    ...outsideComments(annotations, symbols, space.image).map((c) => ({ addr: c.addr, line: `; comment ${$(c.addr)}: ${c.text}` })),
  ].sort((a, b) => a.addr - b.addr);
  for (const o of outside) out.push(o.line);
  if (mod.format === 'bas') {
    const found = entries.filter((e) => e.addr !== null);
    out.push(`; code lines: ${mod.lines.filter((l) => listsAsCode(l, map)).length}; entries mined: ${found.length}`);
    for (const e of found) out.push(`; entry ${$(e.addr!)} (${e.evidence})`);
    for (const e of entries) if (e.addr === null) out.push(`; note: ${e.evidence}`);
  }
  if (hints !== undefined) {
    out.push(`; hints: ${hints.source === undefined ? '' : `${hints.source}: `}${plural(hints.matched, 'block')} matched, ${hints.unmatched} unmatched, ${plural(hints.applied, 'hint')} applied`);
  }
  if (labels !== undefined) {
    out.push(`; labels: ${labels.source === undefined ? '' : `${labels.source}: `}${plural(labels.names, 'name')}, ${plural(labels.roots, 'root')}, ${plural(labels.dataRuns, 'data run')} applied`);
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
  for (const w of labels?.warnings ?? []) out.push(`; warning: ${w}`);
  for (const e of analysis.relocationErrors) out.push(`; warning: ${e}`);
  if (mod.format === 'cmd') out.push(...cmdDetails(mod));
  return out;
}
