/**
 * `fugloy port <program.cmd> --model 1|3 [--hints <file>] [-o <dir>]`: ports a .CMD program to
 * JavaScript with @fugloy/recomp (Part 2, milestone M1). It writes `<name>.port.js`, the port, a module
 * that imports @fugloy/runtime/ops and runs on @fugloy/runtime, and `<name>.port.txt`, its report (the
 * entry, each routine, the data regions, and the places that refuse if they run), into the program's
 * directory or -o's. Exit 0 when it ported, 1 when the program cannot be ported (port()'s sentences on
 * stderr, nothing written) or a file cannot be read or written, 2 on a usage error.
 */
import { basename, dirname, extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { VERSION as RECOMP_VERSION, port } from '@fugloy/recomp';
import type { PortReport } from '@fugloy/recomp';
import type { Io } from './index.js';

export const PORT_USAGE = `Usage: fugloy port <program.cmd> --model 1|3 [--hints <file>] [-o <dir>]

Ports a TRS-80 .CMD program to JavaScript: one function per routine of the
program, one statement per instruction, running on @fugloy/runtime with every
block's T-states exact. Writes <name>.port.js (the port, which imports
@fugloy/runtime/ops) and <name>.port.txt (its report: the routines, the data,
and what the port refuses if it runs). A program the port cannot follow (a
JP (HL), an instruction that is not one) is refused with a sentence naming it.

  --model <n>      the machine the port runs on: 1 (the Model I) or 3 (the
                   Model III); needed
  --hints <file>   apply a hint file: its names name the routines, its notes
                   become their comments
  -o <dir>         write the two files into this directory (default: the
                   program's own)
  --help           show this help
`;

/** The port's runtime helpers, as a bundle or a page with an import map resolves them. */
const RUNTIME_IMPORT = '@fugloy/runtime/ops';

const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const modelName = (model: 1 | 3): string => `the Model ${model === 3 ? 'III' : 'I'}`;

/** Where the port and its report go: `dir` (or the program's directory), named after the program. */
export function outputsOf(program: string, dir: string | undefined): { module: string; report: string } {
  const stem = basename(program, extname(program));
  const into = dir ?? dirname(program);
  return { module: join(into, `${stem}.port.js`), report: join(into, `${stem}.port.txt`) };
}

/** The report as text: what was ported and for which machine, the entry, the routines, the data, the refusals. */
export function formatReport(report: PortReport, about: { source: string; model: 1 | 3; module: string }): string {
  const out: string[] = [
    `${about.source}, ported for ${modelName(about.model)} by @fugloy/recomp ${RECOMP_VERSION}`,
    `Module: ${about.module} (imports ${RUNTIME_IMPORT})`,
    `Entry: ${report.entry}`,
    'This port was not compared with the emulator. Self-modifying code is not detected here: a program that changes its own code will run wrong.',
    '',
  ];
  const labelled = report.routines.filter((r) => r.labelled).length;
  out.push(`Routines: ${report.routines.length} (${labelled} labelled)`);
  const nameWidth = Math.max(0, ...report.routines.map((r) => r.name.length));
  const blocksWidth = Math.max(0, ...report.routines.map((r) => plural(r.blocks, 'block').length));
  for (const r of report.routines) {
    out.push(`  $${hex4(r.addr)}  ${r.name.padEnd(nameWidth)}  ${plural(r.blocks, 'block').padEnd(blocksWidth)}  ${r.labelled ? 'labelled' : 'structured'}`);
  }
  out.push('');
  const bytes = report.data.reduce((n, d) => n + d.length, 0);
  out.push(report.data.length === 0 ? 'Data: none' : `Data: ${plural(report.data.length, 'region')}, ${plural(bytes, 'byte')}`);
  for (const d of report.data) out.push(`  $${hex4(d.addr)}  ${plural(d.length, 'byte')}`);
  out.push('');
  out.push(`Refused if they run: ${report.refused.length === 0 ? 'none' : report.refused.length}`);
  for (const r of report.refused) out.push(`  ${r}`);
  return `${out.join('\n')}\n`;
}

export async function runPort(argv: string[], io: Io): Promise<number> {
  const options = {
    model: { type: 'string' },
    hints: { type: 'string' },
    output: { type: 'string', short: 'o' },
    help: { type: 'boolean' },
  } as const;
  let parsed: ReturnType<typeof parseArgs<{ options: typeof options; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true });
  } catch (e) {
    io.stderr(`fugloy port: ${(e as Error).message}\n${PORT_USAGE}`);
    return 2;
  }
  const { values } = parsed;
  if (values.help === true) {
    io.stdout(PORT_USAGE);
    return 0;
  }
  const [path, ...extra] = parsed.positionals;
  if (path === undefined || extra.length > 0) {
    io.stderr(`fugloy port: expected exactly one program\n${PORT_USAGE}`);
    return 2;
  }
  if (values.model === undefined) {
    io.stderr('fugloy port: --model is needed: 1 (the Model I) or 3 (the Model III), the machine the port runs on\n');
    return 2;
  }
  const model = values.model === '1' ? 1 : values.model === '3' ? 3 : undefined;
  if (model === undefined) {
    io.stderr('fugloy port: --model must be 1 or 3\n');
    return 2;
  }
  const outputs = outputsOf(path, values.output);

  let cmd: Uint8Array;
  try {
    cmd = await io.readFile(path);
  } catch (e) {
    io.stderr(`fugloy port: cannot read ${path}: ${(e as Error).message}\n`);
    return 1;
  }
  let hints: string | undefined;
  if (values.hints !== undefined) {
    try {
      hints = new TextDecoder().decode(await io.readFile(values.hints));
    } catch (e) {
      io.stderr(`fugloy port: cannot read ${values.hints}: ${(e as Error).message}\n`);
      return 1;
    }
  }

  const source = basename(path);
  const result = port(cmd, { model, runtimeImport: RUNTIME_IMPORT, source, ...(hints === undefined ? {} : { hints }) });
  if (!result.ok) {
    for (const error of result.errors) io.stderr(`fugloy port: ${path}: ${error}\n`);
    io.stderr(`fugloy port: ${plural(result.errors.length, 'error')}; nothing written\n`);
    return 1;
  }
  for (const [file, text] of [
    [outputs.module, result.js],
    [outputs.report, formatReport(result.report, { source, model, module: basename(outputs.module) })],
  ] as const) {
    try {
      await io.writeFile(file, text);
    } catch (e) {
      io.stderr(`fugloy port: cannot write ${file}: ${(e as Error).message}\n`);
      return 1;
    }
  }
  const labelled = result.report.routines.filter((r) => r.labelled).length;
  io.stdout(`${outputs.module}: ${plural(result.report.routines.length, 'routine')} (${labelled} labelled), entry ${result.report.entry}; the report is ${outputs.report}\n`);
  return 0;
}
