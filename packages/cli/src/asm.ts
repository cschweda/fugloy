/**
 * `fugloy asm <source> [-o <out.cmd>] [--model 1|3|4] [--dos trsdos|ldos|none] [--listing]`:
 * assembles Z80 source with @fugloy/asm. Every diagnostic goes to stderr as
 * `file:line:col: severity: message`, the form editors and terminals link to.
 * With no error the .CMD is written (to -o, or beside the source with its
 * extension changed to .cmd) and a one-line summary printed; `--listing`
 * prints the listing to stdout as well. Exit 0 when it assembled, 1 on an
 * error in the source or a file that cannot be read or written, 2 on a usage
 * error.
 */
import { realpathSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { assemble, selectionProblem, toCmd } from '@fugloy/asm';
import type { AsmOptions, AsmResult, ListingLine, Model } from '@fugloy/asm';
import type { Dos } from '@fugloy/disasm';
import type { Io } from './index.js';

export const ASM_USAGE = `Usage: fugloy asm <source> [-o <out.cmd>] [--model 1|3|4] [--dos trsdos|ldos|none] [--listing]

Assembles Z80 source (zmac syntax) into a TRS-80 .CMD program. Errors and
warnings are printed as file:line:col: severity: message, each a sentence
that says what to change. ROM routines can be called by name without
defining them ($VDCLS, $KBWAIT, ...), from the tables of the chosen model.

  -o <path>        write the .CMD here (default: the source's name with .cmd)
  --model <n>      the machine whose ROM names are predefined: 1, 3 (the
                   default), or 4 (LS-DOS 6 service calls and the Model III ROM);
                   naming it also turns the Model I/III warning into a note
  --dos <name>     also predefine that DOS's names: trsdos (Model III), ldos,
                   or none (the default)
  --listing        print the listing (address, bytes, source) to stdout
  --help           show this help
`;

const MODELS: readonly Model[] = [1, 3, 4];
const DOSES: readonly Dos[] = ['trsdos', 'ldos', 'none'];

const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');
const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');

/** Bytes shown on one listing row, and rows shown before the rest are summed up. */
const PER_ROW = 4;
const MAX_ROWS = 4;

/**
 * The listing: run address (with `@load` under .PHASE), up to four bytes a
 * row, and the source line; an EQU's value where the address would be.
 */
export function formatListing(listing: readonly ListingLine[]): string {
  const out: string[] = [];
  const pad = (s: string, n: number): string => s.padEnd(n);
  for (const l of listing) {
    const where = l.address === null ? (l.value === undefined ? '' : `=${hex4(l.value)}`) : `${hex4(l.address)}${l.load !== null && l.load !== l.address ? `@${hex4(l.load)}` : ''}`;
    const rows: string[] = [];
    for (let i = 0; i < l.bytes.length && rows.length < MAX_ROWS; i += PER_ROW) rows.push(l.bytes.slice(i, i + PER_ROW).map(hex2).join(' '));
    const shown = rows.length * PER_ROW;
    if (l.bytes.length > shown) rows[rows.length - 1] += ` +${l.bytes.length - shown}`;
    const first = rows[0] ?? '';
    out.push(`${String(l.line).padStart(5)}  ${pad(where, 10)}${pad(first, 16)}${l.text}`.trimEnd());
    for (const more of rows.slice(1)) out.push(`${''.padStart(5)}  ${pad('', 10)}${more}`);
  }
  return `${out.join('\n')}\n`;
}

/** `clear-screen.cmd: 1 block, 20 bytes, $7000-$7013, entry $7000`. */
function summary(path: string, result: AsmResult): string {
  const runs = result.image!.runs();
  const bytes = runs.reduce((n, r) => n + r.length, 0);
  const spans = runs.map((r) => (r.start === r.end ? `$${hex4(r.start)}` : `$${hex4(r.start)}-$${hex4(r.end)}`)).join(', ');
  const entry = result.entry !== null ? `entry $${hex4(result.entry)}` : `no END entry, so it runs from its first byte, $${hex4(result.listing.find((l) => l.bytes.length > 0)!.load!)}`;
  return `${path}: ${runs.length} block${runs.length === 1 ? '' : 's'}, ${bytes} byte${bytes === 1 ? '' : 's'}, ${spans}, ${entry}\n`;
}

/** A path as the file system resolves it (symbolic links followed where the file exists). */
function realPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/**
 * Whether two paths name the same file: `x.z` and `./x.z` do, and so do a
 * symbolic or hard link and its file. Where both exist, the device and inode
 * decide, which also catches `X.Z` for `x.z` on a case-insensitive file
 * system (realpath keeps the case it is given).
 */
export function samePath(a: string, b: string): boolean {
  if (realPath(a) === realPath(b)) return true;
  try {
    const sa = statSync(a);
    const sb = statSync(b);
    return sa.ino !== 0 && sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false;
  }
}

/** The default output path: the source's, with its extension (if any) changed to .cmd. */
export function defaultOutput(source: string): string {
  const ext = extname(source);
  const stem = basename(source, ext);
  return join(dirname(source), `${stem}.cmd`);
}

export async function runAsm(argv: string[], io: Io): Promise<number> {
  const options = {
    output: { type: 'string', short: 'o' },
    model: { type: 'string' },
    dos: { type: 'string' },
    listing: { type: 'boolean' },
    help: { type: 'boolean' },
  } as const;
  let parsed: ReturnType<typeof parseArgs<{ options: typeof options; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true });
  } catch (e) {
    io.stderr(`fugloy asm: ${(e as Error).message}\n${ASM_USAGE}`);
    return 2;
  }
  const { values } = parsed;
  if (values.help === true) {
    io.stdout(ASM_USAGE);
    return 0;
  }
  const [path, ...extra] = parsed.positionals;
  if (path === undefined || extra.length > 0) {
    io.stderr(`fugloy asm: expected exactly one source file\n${ASM_USAGE}`);
    return 2;
  }
  const model = values.model === undefined ? undefined : MODELS.find((m) => String(m) === values.model);
  if (values.model !== undefined && model === undefined) {
    io.stderr('fugloy asm: --model must be 1, 3, or 4\n');
    return 2;
  }
  const dos = values.dos === undefined ? undefined : DOSES.find((d) => d === values.dos);
  if (values.dos !== undefined && dos === undefined) {
    io.stderr('fugloy asm: --dos must be trsdos, ldos, or none\n');
    return 2;
  }
  // The model goes to the assembler only when --model names it, so the Model I/III warning stays a warning without it.
  const asmOptions: AsmOptions = { ...(model === undefined ? {} : { model }), ...(dos === undefined ? {} : { dos }) };
  const problem = selectionProblem(model ?? 3, dos);
  if (problem !== undefined) {
    io.stderr(`fugloy asm: ${problem}\n`);
    return 2;
  }
  const out = values.output ?? defaultOutput(path);
  if (samePath(out, path)) {
    io.stderr(`fugloy asm: the output would overwrite the source ${path}; choose another name with -o\n`);
    return 2;
  }
  if (io.writeBytes === undefined) throw new Error('fugloy asm needs an Io that can write bytes (writeBytes)');

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(await io.readFile(path));
  } catch (e) {
    const why = e instanceof TypeError ? 'it is not UTF-8 text' : (e as Error).message;
    io.stderr(`fugloy asm: cannot read ${path}: ${why}\n`);
    return 1;
  }
  const result = assemble(text, asmOptions);
  for (const d of result.diagnostics) io.stderr(`${path}:${d.line}:${d.column}: ${d.severity}: ${d.message}\n`);
  if (values.listing === true) io.stdout(formatListing(result.listing));
  if (!result.ok) {
    const n = result.diagnostics.filter((d) => d.severity === 'error').length;
    io.stderr(`fugloy asm: ${n} error${n === 1 ? '' : 's'}; no .CMD written\n`);
    return 1;
  }
  let cmd: Uint8Array;
  try {
    cmd = toCmd(result);
  } catch (e) {
    // A source with no bytes (only EQUs, or a DS with no fill) has nothing to write.
    io.stderr(`fugloy asm: ${(e as Error).message}\n`);
    return 1;
  }
  try {
    await io.writeBytes(out, cmd);
  } catch (e) {
    io.stderr(`fugloy asm: cannot write ${out}: ${(e as Error).message}\n`);
    return 1;
  }
  (values.listing === true ? io.stderr : io.stdout)(summary(out, result));
  return 0;
}
