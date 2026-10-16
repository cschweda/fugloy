/**
 * The fugloy command: `fugloy <file> [--base <hex>] [--entry <hex>]... [--format listing|zmac|ir] [--sweep] [-o <path>]`.
 * Reads one file, detects its format from content, runs Pass 1, and prints a
 * listing, zmac source, or the JSON IR. Only this package touches the file
 * system; `run()` takes an Io so tests can capture output.
 */
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import {
  analyze, applyHints, blockIdentities, buildIr, detectFormat, emitZmac, emptyAnnotations, loadBas, loadCmd, loadRaw, parseHints,
  programHash, renderBasListing, renderCmdListing, renderPass1Listing, renderRawListing, writeHints,
} from '@fugloy/disasm';
import type { Hint, HintFile, HintsSummary, Module } from '@fugloy/disasm';

export const VERSION = '0.1.0';

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, text: string): Promise<void>;
  fileExists(path: string): Promise<boolean>;
}

export const USAGE = `Usage: fugloy <file> [--base <hex>] [--entry <hex>]... [--hints <path> | --write-hints <path>] [--format listing|zmac|ir] [--sweep] [-o <path>]

Prints a listing of a TRS-80 .CMD load module, raw binary, or tokenized Level
II .BAS program. The format is detected from the file's content, never its
extension. Load modules and raw binaries get a pass 1 listing: recursive
descent from the entry point, with everything it did not reach shown as DB.
A .BAS program lists as BASIC; one with machine code hidden in its lines, or
an entry its text plants (DEFUSR, the USR vector, a poked JP), gets the pass 1
listing instead, with each code line disassembled at its true address.

  --base <hex>     load the file as a raw binary at this address (e.g. 5200,
                   0x5200) and list it from there; skips format detection
  --entry <hex>    add an entry point for pass 1; may repeat
  --hints <path>   apply a hint file: entries, code/data overrides, tables,
                   names, comments (see docs/Fugloy-Project-Plan.md, "Hint file")
  --write-hints <path>
                   write a hint-file skeleton for this program (identities and
                   any --entry addresses) and exit; refuses to overwrite
  --format <kind>  listing (default), zmac (assembler source that reassembles
                   to the same image), or ir (JSON)
  --sweep          the phase-1 linear sweep listing instead of pass 1
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

export async function run(argv: string[], io: Io): Promise<number> {
  const options = {
    base: { type: 'string' },
    entry: { type: 'string', multiple: true },
    format: { type: 'string' },
    sweep: { type: 'boolean' },
    hints: { type: 'string' },
    'write-hints': { type: 'string' },
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
  if (values.sweep === true && entries.length > 0) {
    io.stderr('fugloy: --entry has no effect with --sweep; drop one of them\n');
    return 2;
  }
  if (values.sweep === true && values.hints !== undefined) {
    io.stderr('fugloy: --hints has no effect with --sweep; drop one of them\n');
    return 2;
  }
  if (values.hints !== undefined && values['write-hints'] !== undefined) {
    io.stderr('fugloy: use either --hints or --write-hints, not both\n');
    return 2;
  }

  let bytes: Uint8Array;
  try {
    bytes = await io.readFile(path);
  } catch (e) {
    io.stderr(`fugloy: cannot read ${path}: ${(e as Error).message}\n`);
    return 1;
  }
  const source = basename(path);

  let mod: Module;
  if (base !== undefined) {
    mod = loadRaw(bytes, base);
  } else {
    const kind = detectFormat(bytes);
    if (kind === 'bas') mod = loadBas(bytes);
    else if (kind === 'cmd') mod = loadCmd(bytes);
    else {
      io.stderr(`fugloy: ${path} is not a .CMD load module or a tokenized BASIC program; use --base <hex> to list it as a raw binary\n`);
      return 2;
    }
  }
  for (const e of entries) {
    if (!mod.image.isLoaded(e)) {
      io.stderr(`fugloy: --entry $${hex4(e)} is not in loaded memory\n`);
      return 2;
    }
  }

  const writeTo = values['write-hints'];
  if (writeTo !== undefined) {
    if (await io.fileExists(writeTo)) {
      io.stderr(`fugloy: ${writeTo} exists; choose another name\n`);
      return 2;
    }
    const runs = mod.image.runs();
    const hintsOut: Hint[] = entries.map((e) => {
      const i = runs.findIndex((r) => e >= r.start && e <= r.end);
      return { block: i, offset: e - runs[i]!.start, directive: 'entry', line: 0 };
    });
    const file: HintFile = {
      version: 1,
      program: programHash(bytes),
      blocks: blockIdentities(mod.image).map((b) => ({ index: b.index, length: b.length, hash: b.hash, start: b.start })),
      hints: hintsOut,
    };
    try {
      await io.writeFile(writeTo, writeHints(file));
    } catch (e) {
      io.stderr(`fugloy: cannot write ${writeTo}: ${(e as Error).message}\n`);
      return 1;
    }
    return 0;
  }

  let annotations = emptyAnnotations();
  let hints: HintsSummary | undefined;
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
    const applied = applyHints(parsed.file, mod.image, programHash(bytes));
    annotations = applied.annotations;
    const skipped = applied.unmatched.reduce((n, u) => n + u.hints, 0);
    hints = { source: basename(values.hints), matched: applied.matched.length, unmatched: applied.unmatched.length, applied: parsed.file.hints.length - skipped, warnings: applied.warnings };
    if (format !== 'listing') for (const w of applied.warnings) io.stderr(`fugloy: warning: ${w}\n`);
  }

  let text: string;
  if (values.sweep === true && format === 'listing') {
    text = mod.format === 'cmd' ? renderCmdListing(mod, { source }) : mod.format === 'raw' ? renderRawListing(mod, { source }) : renderBasListing(mod, { source });
  } else {
    const analysis = analyze(mod, hints === undefined ? { entries, annotations } : { entries, annotations, hints });
    // A .BAS with neither hidden code nor a planted entry lists as plain BASIC unless pass 1 was asked for.
    const plainBasic = mod.format === 'bas' && entries.length === 0 && hints === undefined && analysis.entries.length === 0 && mod.lines.every((l) => l.parsed);
    if (format === 'listing' && plainBasic && mod.format === 'bas') text = renderBasListing(mod, { source });
    else if (format === 'zmac') text = emitZmac(mod.image, analysis.pass1, analysis.transfer, { source, symbols: analysis.symbols, annotations: analysis.annotations });
    else if (format === 'ir') text = `${JSON.stringify(buildIr(mod, analysis.pass1, source, analysis), null, 2)}\n`;
    else text = renderPass1Listing(analysis, { source });
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
  io.stdout(text);
  return 0;
}
