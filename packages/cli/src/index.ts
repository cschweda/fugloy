/**
 * The fugloy command: `fugloy <file> [--base <hex>]`. Reads one file, detects
 * its format from content, and prints a listing. Only this package touches
 * the file system; `run()` takes an Io so tests can capture output.
 */
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { detectFormat, loadBas, loadCmd, loadRaw, renderBasListing, renderCmdListing, renderRawListing } from '@fugloy/disasm';

export const VERSION = '0.1.0';

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  readFile(path: string): Promise<Uint8Array>;
}

export const USAGE = `Usage: fugloy <file> [--base <hex>]

Prints a linear-sweep listing of a TRS-80 .CMD load module or raw binary, or a
detokenized listing of a tokenized Level II .BAS program. The format is
detected from the file's content, never its extension.

  --base <hex>   load the file as a raw binary at this address (e.g. 5200,
                 0x5200) and list it from there; skips format detection
  --help         show this help
  --version      show the version
`;

/** Parses `5200`, `0x5200`, `$5200`, or `5200H` into 0..FFFF, or returns null. */
export function parseBase(text: string): number | null {
  const m = /^(?:0x|\$)?([0-9a-f]{1,4})h?$/i.exec(text.trim());
  return m === null ? null : parseInt(m[1]!, 16);
}

export async function run(argv: string[], io: Io): Promise<number> {
  let parsed: ReturnType<typeof parseArgs<{ options: { base: { type: 'string' }; help: { type: 'boolean' }; version: { type: 'boolean' } }; allowPositionals: true }>>;
  try {
    parsed = parseArgs({
      args: argv,
      options: { base: { type: 'string' }, help: { type: 'boolean' }, version: { type: 'boolean' } },
      allowPositionals: true,
    });
  } catch (e) {
    io.stderr(`fugloy: ${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  if (parsed.values.help === true) {
    io.stdout(USAGE);
    return 0;
  }
  if (parsed.values.version === true) {
    io.stdout(`fugloy ${VERSION}\n`);
    return 0;
  }
  const [path, ...extra] = parsed.positionals;
  if (path === undefined || extra.length > 0) {
    io.stderr(`fugloy: expected exactly one file\n${USAGE}`);
    return 2;
  }
  let base: number | undefined;
  if (parsed.values.base !== undefined) {
    const b = parseBase(parsed.values.base);
    if (b === null) {
      io.stderr(`fugloy: --base needs a hex address in 0..FFFF, not "${parsed.values.base}"\n`);
      return 2;
    }
    base = b;
  }
  let bytes: Uint8Array;
  try {
    bytes = await io.readFile(path);
  } catch (e) {
    io.stderr(`fugloy: cannot read ${path}: ${(e as Error).message}\n`);
    return 1;
  }
  const source = basename(path);
  if (base !== undefined) {
    io.stdout(renderRawListing(loadRaw(bytes, base), { source }));
    return 0;
  }
  switch (detectFormat(bytes)) {
    case 'bas':
      io.stdout(renderBasListing(loadBas(bytes), { source }));
      return 0;
    case 'cmd':
      io.stdout(renderCmdListing(loadCmd(bytes), { source }));
      return 0;
    default:
      io.stderr(`fugloy: ${path} is not a .CMD load module or a tokenized BASIC program; use --base <hex> to list it as a raw binary\n`);
      return 2;
  }
}
