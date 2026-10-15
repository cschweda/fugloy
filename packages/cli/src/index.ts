/**
 * The fugloy command: `fugloy <file> [--base <hex>] [--entry <hex>]... [--format listing|zmac|ir] [--sweep] [-o <path>]`.
 * Reads one file, detects its format from content, runs Pass 1, and prints a
 * listing, zmac source, or the JSON IR. Only this package touches the file
 * system; `run()` takes an Io so tests can capture output.
 */
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import {
  analyze, buildIr, detectFormat, emitZmac, loadBas, loadCmd, loadRaw,
  renderBasListing, renderCmdListing, renderPass1Listing, renderRawListing,
} from '@fugloy/disasm';
import type { Module } from '@fugloy/disasm';

export const VERSION = '0.1.0';

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, text: string): Promise<void>;
}

export const USAGE = `Usage: fugloy <file> [--base <hex>] [--entry <hex>]... [--format listing|zmac|ir] [--sweep] [-o <path>]

Prints a listing of a TRS-80 .CMD load module, raw binary, or tokenized Level
II .BAS program. The format is detected from the file's content, never its
extension. Load modules and raw binaries get a pass 1 listing: recursive
descent from the entry point, with everything it did not reach shown as DB.

  --base <hex>     load the file as a raw binary at this address (e.g. 5200,
                   0x5200) and list it from there; skips format detection
  --entry <hex>    add an entry point for pass 1; may repeat
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

  let text: string;
  if (values.sweep === true && format === 'listing') {
    text = mod.format === 'cmd' ? renderCmdListing(mod, { source }) : mod.format === 'raw' ? renderRawListing(mod, { source }) : renderBasListing(mod, { source });
  } else if (format === 'listing' && mod.format === 'bas' && entries.length === 0) {
    text = renderBasListing(mod, { source });
  } else {
    const analysis = analyze(mod, { entries });
    if (format === 'zmac') text = emitZmac(mod.image, analysis.pass1, analysis.transfer, { source });
    else if (format === 'ir') text = `${JSON.stringify(buildIr(mod, analysis.pass1, source), null, 2)}\n`;
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
