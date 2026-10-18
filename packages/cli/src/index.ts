/**
 * The fugloy command: `fugloy <file> [--base <hex>] [--entry <hex>]... [--hints <path>] [--labels <path>] [--format listing|zmac|ir] [--sweep] [-o <path>]`.
 * Reads one file, detects its format from content, runs Pass 1 with the ROM,
 * hardware, and DOS tables that `--machine` and `--dos` choose, and prints a
 * listing, zmac source, or the JSON IR. Only this package touches the file
 * system; `run()` takes an Io so tests can capture output.
 */
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import {
  defaultDos,
  OpenError,
  openProgram,
  parseHints,
  parseLabelFile,
  rebaseBas,
  renderBasListing,
  renderCmdListing,
  renderRawListing,
  renderSession,
  SelectionError,
  selectSymbols,
  skeletonHints,
  withHintFile,
  withLabelFile,
  writeHints,
} from '@fugloy/disasm';
import type { Dos, Hint, Machine, Session, SymbolSelection } from '@fugloy/disasm';
import { colorListing } from './color.js';

export const VERSION = '1.2.0';

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, text: string): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  /** Whether stdout is a terminal; `--color` colors only there. */
  stdoutIsTerminal?: boolean;
  /** The environment; a non-empty NO_COLOR turns color off. */
  env?: Record<string, string | undefined>;
}

export const USAGE = `Usage: fugloy <file> [--base <hex> | --rebase <hex>] [--entry <hex>]... [--hints <path> | --write-hints <path>] [--labels <path>] [--machine 1|3|4] [--dos trsdos|ldos|none] [--format listing|zmac|ir] [--sweep] [--color] [-o <path>]

Prints a listing of a TRS-80 .CMD load module, raw binary, or tokenized Level
II .BAS program. The format is detected from the file's content, never its
extension. Load modules and raw binaries get a pass 1 listing: recursive
descent from the entry point, with everything it did not reach shown as DB.
A .BAS program lists as BASIC; one with machine code hidden in its lines, or
an entry its text plants (DEFUSR, the USR vector, a poked JP), gets the pass 1
listing instead, with each code line disassembled at its true address.

  --base <hex>     load the file as a raw binary at this address (e.g. 5200,
                   0x5200) and list it from there; skips format detection
  --rebase <hex>   treat a .BAS program as saved from this address instead:
                   line pointers rewritten, references into the old address
                   range marked stale; hints written before still apply
  --entry <hex>    add an entry point for pass 1; may repeat
  --hints <path>   apply a hint file: entries, code/data overrides, tables,
                   names, comments (see docs/Fugloy-Project-Plan.md, "Hint file")
  --labels <path>  apply a label and coverage file the emulator wrote for this
                   program (docs/label-format.md): executed instructions and
                   code labels become entry points; bytes only read (never
                   run or written) stop descent as data, a heuristic that
                   never overrides another entry point; code that changed at
                   runtime (a program that moved or rewrote itself) is
                   skipped with a warning unless a relocate hint says where
                   it runs; names and evidence are kept; the hint file wins
                   where both speak; refused when written for another program
  --write-hints <path>
                   write a hint-file skeleton for this program (identities and
                   any --entry addresses) and exit; refuses to overwrite
  --machine <n>    name ROM, hardware, and DOS addresses for Model 1, 3
                   (the default), or 4 (LS-DOS 6 service calls only)
  --dos <name>     the DOS whose names to use: trsdos (Model III default),
                   ldos (Model I default), or none
  --format <kind>  listing (default), zmac (assembler source that reassembles
                   to the same image), or ir (JSON)
  --sweep          the phase-1 linear sweep listing instead of pass 1
  --color          color the listing on a terminal; it stays plain when piped,
                   written with -o, or when NO_COLOR is set
  -o <path>        write the output to a file instead of stdout
  --help           show this help
  --version        show the version
`;

const FORMATS = ['listing', 'zmac', 'ir'] as const;
type Format = (typeof FORMATS)[number];

/** Parses `5200`, `0x5200`, `$5200`, or `5200H` into 0..FFFF, or returns null. */
export function parseBase(text: string): number | null {
  const m = /^(?:0x|\$)?([0-9a-f]{1,4})h?$/i.exec(text.trim());
  return m === null ? null : parseInt(m[1]!, 16);
}

const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');

const MACHINES: readonly Machine[] = [1, 3, 4];
const DOSES: readonly Dos[] = ['trsdos', 'ldos', 'none'];

/**
 * The tables `--machine` and `--dos` choose: Model III, and the DOS that machine
 * has by default, unless told otherwise. A value, or a machine and DOS together,
 * that no tables exist for is the usage error to print, never a listing named
 * from the wrong tables. Which pairs have tables is `selectSymbols`' to say.
 */
function chooseTables(machineText: string | undefined, dosText: string | undefined): { selection: SymbolSelection } | { error: string } {
  const machine = machineText === undefined ? 3 : MACHINES.find((m) => String(m) === machineText);
  if (machine === undefined) return { error: '--machine must be 1, 3, or 4' };
  const dos = dosText === undefined ? defaultDos(machine) : DOSES.find((d) => d === dosText);
  if (dos === undefined) return { error: '--dos must be trsdos, ldos, or none' };
  try {
    selectSymbols({ machine, dos });
    return { selection: { machine, dos } };
  } catch (e) {
    if (!(e instanceof SelectionError)) throw e;
    // The error's own wording is for callers of the library; a command line is told what to type instead.
    if (machine === 4) return { error: '--machine 4 names LS-DOS 6 service calls only; leave out --dos' };
    if (dos === 'trsdos') return { error: '--dos trsdos is the Model III DOS; use --machine 3 or --dos ldos' };
    return { error: e.message };
  }
}

export async function run(argv: string[], io: Io): Promise<number> {
  const options = {
    base: { type: 'string' },
    rebase: { type: 'string' },
    entry: { type: 'string', multiple: true },
    format: { type: 'string' },
    machine: { type: 'string' },
    dos: { type: 'string' },
    sweep: { type: 'boolean' },
    color: { type: 'boolean' },
    hints: { type: 'string' },
    'write-hints': { type: 'string' },
    labels: { type: 'string' },
    output: { type: 'string', short: 'o' },
    help: { type: 'boolean' },
    version: { type: 'boolean' },
  } as const;
  let parsed: ReturnType<typeof parseArgs<{ options: typeof options; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true });
  } catch (e) {
    io.stderr(`fugloy: ${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  const { values } = parsed;
  if (values.help === true) {
    io.stdout(USAGE);
    return 0;
  }
  if (values.version === true) {
    io.stdout(`fugloy ${VERSION}\n`);
    return 0;
  }
  const [path, ...extra] = parsed.positionals;
  if (path === undefined || extra.length > 0) {
    io.stderr(`fugloy: expected exactly one file\n${USAGE}`);
    return 2;
  }
  const format = (values.format ?? 'listing') as Format;
  if (!FORMATS.includes(format)) {
    io.stderr(`fugloy: --format must be one of ${FORMATS.join(', ')}, not "${values.format}"\n`);
    return 2;
  }
  let base: number | undefined;
  if (values.base !== undefined) {
    const b = parseBase(values.base);
    if (b === null) {
      io.stderr(`fugloy: --base needs a hex address in 0..FFFF, not "${values.base}"\n`);
      return 2;
    }
    base = b;
  }
  let rebase: number | undefined;
  if (values.rebase !== undefined) {
    const r = parseBase(values.rebase);
    if (r === null) {
      io.stderr(`fugloy: --rebase needs a hex address in 0..FFFF, not "${values.rebase}"\n`);
      return 2;
    }
    rebase = r;
  }
  const entries: number[] = [];
  for (const text of values.entry ?? []) {
    const e = parseBase(text);
    if (e === null) {
      io.stderr(`fugloy: --entry needs a hex address in 0..FFFF, not "${text}"\n`);
      return 2;
    }
    entries.push(e);
  }
  if (values.sweep === true && format !== 'listing') {
    io.stderr(`fugloy: --sweep applies to the listing format only, not --format ${format}\n`);
    return 2;
  }
  if (values.color === true && format !== 'listing') {
    io.stderr(`fugloy: --color applies to the listing format only, not --format ${format}\n`);
    return 2;
  }
  if (values.sweep === true && entries.length > 0) {
    io.stderr('fugloy: --entry has no effect with --sweep; drop one of them\n');
    return 2;
  }
  if (values.sweep === true && values.hints !== undefined) {
    io.stderr('fugloy: --hints has no effect with --sweep; drop one of them\n');
    return 2;
  }
  if (values.sweep === true && values.labels !== undefined) {
    io.stderr('fugloy: --labels has no effect with --sweep; drop one of them\n');
    return 2;
  }
  if (values.labels !== undefined && values['write-hints'] !== undefined) {
    io.stderr('fugloy: --labels has no effect with --write-hints; drop one of them\n');
    return 2;
  }
  if (values.hints !== undefined && values['write-hints'] !== undefined) {
    io.stderr('fugloy: use either --hints or --write-hints, not both\n');
    return 2;
  }
  const chosen = chooseTables(values.machine, values.dos);
  if ('error' in chosen) {
    io.stderr(`fugloy: ${chosen.error}\n`);
    return 2;
  }
  const { selection } = chosen;

  let bytes: Uint8Array;
  try {
    bytes = await io.readFile(path);
  } catch (e) {
    io.stderr(`fugloy: cannot read ${path}: ${(e as Error).message}\n`);
    return 1;
  }
  const source = basename(path);

  const openOpts = { name: source, selection, entries, ...(base === undefined ? {} : { base }) };
  let session: Session;
  try {
    session = openProgram(bytes, openOpts);
  } catch (e) {
    if (!(e instanceof OpenError) || e.kind !== 'format') throw e;
    io.stderr(`fugloy: ${path} is not a .CMD load module or a tokenized BASIC program; use --base <hex> to list it as a raw binary\n`);
    return 2;
  }
  if (rebase !== undefined) {
    const mod = session.module;
    if (mod.format !== 'bas') {
      io.stderr(`fugloy: --rebase applies to a tokenized BASIC program, and ${path} is ${mod.format === 'cmd' ? 'a .CMD load module' : 'loaded raw'}\n`);
      return 2;
    }
    try {
      bytes = rebaseBas(bytes, rebase);
    } catch (e) {
      io.stderr(`fugloy: --rebase ${values.rebase}: ${(e as Error).message}\n`);
      return 2;
    }
    session = openProgram(bytes, { ...openOpts, rebasedFrom: mod.base });
  }
  const mod = session.module;
  const writeTo = values['write-hints'];
  if (writeTo !== undefined) {
    for (const e of entries) {
      if (!mod.image.isLoaded(e)) {
        io.stderr(`fugloy: --entry $${hex4(e)} is not in loaded memory\n`);
        return 2;
      }
    }
    if (await io.fileExists(writeTo)) {
      io.stderr(`fugloy: ${writeTo} exists; choose another name\n`);
      return 2;
    }
    const runs = mod.image.runs();
    const hintsOut: Hint[] = entries.map((e) => {
      const i = runs.findIndex((r) => e >= r.start && e <= r.end);
      return { block: i, offset: e - runs[i]!.start, directive: 'entry', line: 0 };
    });
    try {
      await io.writeFile(writeTo, writeHints({ ...skeletonHints(mod, bytes), hints: hintsOut }));
    } catch (e) {
      io.stderr(`fugloy: cannot write ${writeTo}: ${(e as Error).message}\n`);
      return 1;
    }
    return 0;
  }

  if (values.hints !== undefined) {
    let hintText: string;
    try {
      hintText = new TextDecoder().decode(await io.readFile(values.hints));
    } catch (e) {
      io.stderr(`fugloy: cannot read ${values.hints}: ${(e as Error).message}\n`);
      return 1;
    }
    const parsed = parseHints(hintText);
    if (parsed.errors.length > 0) {
      for (const err of parsed.errors) io.stderr(`fugloy: ${values.hints}:${err.line}: ${err.message}\n`);
      return 2;
    }
    try {
      session = withHintFile(session, parsed.file, basename(values.hints));
    } catch (e) {
      if (!(e instanceof OpenError) || e.kind !== 'hints') throw e;
      for (const err of e.details) io.stderr(`fugloy: ${values.hints}: ${err}\n`);
      return 2;
    }
    if (format !== 'listing') for (const w of session.applied.warnings) io.stderr(`fugloy: warning: ${w}\n`);
  }

  if (values.labels !== undefined) {
    let labelText: string;
    try {
      labelText = new TextDecoder().decode(await io.readFile(values.labels));
    } catch (e) {
      io.stderr(`fugloy: cannot read ${values.labels}: ${(e as Error).message}\n`);
      return 1;
    }
    const parsed = parseLabelFile(labelText);
    if (parsed.file === null) {
      for (const err of parsed.errors) io.stderr(`fugloy: ${values.labels}: ${err}\n`);
      return 2;
    }
    try {
      session = withLabelFile(session, parsed.file, basename(values.labels));
    } catch (e) {
      if (!(e instanceof OpenError) || e.kind !== 'labels') throw e;
      io.stderr(`fugloy: ${values.labels}: ${e.message}\n`);
      return 2;
    }
    if (format !== 'listing') for (const w of session.analysis.labels?.warnings ?? []) io.stderr(`fugloy: warning: ${w}\n`);
  }

  // An entry may name a runtime address that a relocate hint created, but not the file address it moved away from.
  const runtime = session.analysis.space;
  for (const e of entries) {
    if (!runtime.image.isLoaded(e)) {
      const moved = runtime.toRun(e);
      io.stderr(
        moved !== null && moved !== e
          ? `fugloy: --entry $${hex4(e)} is a file address a relocate hint moves; it runs at $${hex4(moved)}, so use --entry ${hex4(moved)}\n`
          : `fugloy: --entry $${hex4(e)} is not in loaded memory\n`,
      );
      return 2;
    }
  }

  let text: string;
  if (values.sweep === true && format === 'listing') {
    text = mod.format === 'cmd' ? renderCmdListing(mod, { source }) : mod.format === 'raw' ? renderRawListing(mod, { source }) : renderBasListing(mod, { source });
  } else {
    text = renderSession(session, format);
  }

  if (values.output !== undefined) {
    try {
      await io.writeFile(values.output, text);
    } catch (e) {
      io.stderr(`fugloy: cannot write ${values.output}: ${(e as Error).message}\n`);
      return 1;
    }
    return 0;
  }
  const noColor = (io.env?.['NO_COLOR'] ?? '') !== '';
  io.stdout(values.color === true && io.stdoutIsTerminal === true && !noColor ? colorListing(text) : text);
  return 0;
}
