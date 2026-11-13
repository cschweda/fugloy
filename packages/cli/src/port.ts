/**
 * `fugloy port <program.cmd> --model 1|3 [--hints <file>] [--trace <file>] [-o <dir>]`: ports a .CMD
 * program to JavaScript with @fugloy/recomp (Part 2, milestones M1 and M2). It writes `<name>.port.js`,
 * the port, a module that imports @fugloy/runtime/ops and runs on @fugloy/runtime, and `<name>.port.txt`,
 * its report (the entry, the loader left out, each routine, the data regions and their kinds, the code
 * the program rewrites, the return addresses it drops, the jumps back to its entry that discard the stack,
 * the ROM routines the runtime stands in for, the ROM bytes the module carries, and the places that refuse
 * if they run), into the program's directory or -o's. `--trace` reads a port trace (the census's,
 * docs/port-trace-format.md) and checks it was taken of this program. Exit 0 when it ported, 1 when the
 * program cannot be ported (port()'s sentences on stderr, nothing written), the trace is malformed or of
 * another program, or a file cannot be read or written, 2 on a usage error.
 */
/// <reference path="./fugloy-runtime.d.ts" />
import { basename, dirname, extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { programHash } from '@fugloy/disasm';
import { VERSION as RECOMP_VERSION, parseTrace, port } from '@fugloy/recomp';
import type { PortCell, PortReport, PortTrace } from '@fugloy/recomp';
import { standins } from '@fugloy/runtime';
import type { Io } from './index.js';

export const PORT_USAGE = `Usage: fugloy port <program.cmd> --model 1|3 [--hints <file>] [--trace <file>] [-o <dir>]

Ports a TRS-80 .CMD program to JavaScript: one function per routine of the
program, one statement per instruction, running on @fugloy/runtime with every
block's T-states exact. Writes <name>.port.js (the port, which imports
@fugloy/runtime/ops) and <name>.port.txt (its report: the routines, the data,
what the trace let it follow, and what the port refuses if it runs). A CALL to
a ROM routine the runtime stands in for (on the Model III, $DELAY at 0060H)
runs the runtime's own code; any other call into the ROM is refused if it
runs. A program the port cannot follow (a JP (HL), an instruction that is not
one) is refused with a sentence naming it.

  --model <n>      the machine the port runs on: 1 (the Model I) or 3 (the
                   Model III); needed
  --hints <file>   apply a hint file: its names name the routines, its notes
                   become their comments, and one that relocates the program
                   makes the port start at its entry
  --trace <file>   a port trace taken of this program (the census's): the code
                   it rewrites, the return addresses it drops and the ROM
                   bytes it reads, which the port follows
  -o <dir>         write the two files into this directory (default: the
                   program's own)
  --help           show this help
`;

/** The port's runtime helpers, as a bundle or a page with an import map resolves them. */
const RUNTIME_IMPORT = '@fugloy/runtime/ops';

const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const modelName = (model: 1 | 3): string => `the Model ${model === 3 ? 'III' : 'I'}`;
const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');

/** What a cell is in its instruction, for the report. */
const CELL_KIND: Record<PortCell['kind'], string> = { disp: 'displacement', imm: 'immediate', word: 'word operand', opcode: 'opcode' };

/** Where the port and its report go: `dir` (or the program's directory), named after the program. */
export function outputsOf(program: string, dir: string | undefined): { module: string; report: string } {
  const stem = basename(program, extname(program));
  const into = dir ?? dirname(program);
  return { module: join(into, `${stem}.port.js`), report: join(into, `${stem}.port.txt`) };
}

/**
 * The report as text, one line an item: what was ported and for which machine, the entry, the loader left
 * out and the trace (when there are), whether it was compared with the emulator, the routines, the data
 * and their kinds; then, when there are any, the code the program rewrites, the return addresses it drops,
 * the jumps back to the entry that discard the stack, the stand-ins and the ROM bytes carried; the refusals.
 */
export function formatReport(report: PortReport, about: { source: string; model: 1 | 3; module: string; trace?: string }): string {
  const $4 = (n: number): string => `$${hex4(n)}`;
  const out: string[] = [
    `${about.source}, ported for ${modelName(about.model)} by @fugloy/recomp ${RECOMP_VERSION}`,
    `Module: ${about.module} (imports ${RUNTIME_IMPORT})`,
    `Entry: ${report.entry}`,
    ...(report.loader === undefined ? [] : [`Loader: ${report.loader.note}`]),
    ...(about.trace === undefined ? [] : [`Trace: ${about.trace}`]),
    about.trace === undefined
      ? 'This port was not compared with the emulator. It was made with no trace, so a write into the program\'s code stops it with a sentence.'
      : 'This port was not compared with the emulator. A write into the program\'s code that the trace does not name stops it with a sentence.',
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
  out.push(report.data.length === 0 ? 'Data: none' : `Data: ${plural(report.data.length, 'region')}, ${plural(bytes, 'byte')} (data: the hint file types it; unknown: the analysis did not reach it)`);
  const lengthWidth = Math.max(0, ...report.data.map((d) => plural(d.length, 'byte').length));
  for (const d of report.data) out.push(`  $${hex4(d.addr)}  ${plural(d.length, 'byte').padEnd(lengthWidth)}  ${d.kind}`);
  out.push('');
  if (report.cells.length > 0) {
    const sites = new Set(report.cells.map((c) => c.instruction)).size;
    out.push(`Code the program rewrites, read as it runs: ${plural(sites, 'site')}, ${plural(report.cells.length, 'byte')}`);
    for (const c of report.cells) {
      const what = c.kind === 'opcode' ? `opcode, a choice between ${(c.variants ?? []).join(' and ')}` : `${CELL_KIND[c.kind]} of the instruction at ${$4(c.instruction)}`;
      out.push(`  ${$4(c.addr)}  ${what}; ${plural(c.values.length, 'value')} seen`);
    }
    out.push('');
  }
  if (report.drops.length > 0) {
    out.push(`POPs that drop a return address: ${report.drops.length}`);
    for (const d of report.drops) out.push(`  ${$4(d.at)}  goes on in ${d.continuation}`);
    out.push('');
  }
  if (report.resets.length > 0) {
    out.push(`Jumps back to the entry that discard the stack: ${report.resets.length}`);
    for (const r of report.resets) out.push(`  ${r.note}`);
    out.push('');
  }
  if (report.standins.length > 0) {
    out.push(`ROM routines the runtime stands in for: ${report.standins.length}`);
    for (const s of report.standins) out.push(`  $${hex4(s.addr)}  $${s.name}  called from ${s.sites.map((a) => `$${hex4(a)}`).join(', ')}`);
    out.push('');
  }
  if (report.rom.length > 0) {
    out.push(`ROM bytes the program reads, carried in the module: ${report.rom.length}`);
    for (const r of report.rom) out.push(`  ${$4(r.addr)}  $${hex2(r.value)}`);
    out.push('');
  }
  out.push(`Refused if they run: ${report.refused.length === 0 ? 'none' : report.refused.length}`);
  for (const r of report.refused) out.push(`  ${r}`);
  return `${out.join('\n')}\n`;
}

export async function runPort(argv: string[], io: Io): Promise<number> {
  const options = {
    model: { type: 'string' },
    hints: { type: 'string' },
    trace: { type: 'string' },
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

  let trace: PortTrace | undefined;
  if (values.trace !== undefined) {
    let text: string;
    try {
      text = new TextDecoder().decode(await io.readFile(values.trace));
    } catch (e) {
      io.stderr(`fugloy port: cannot read ${values.trace}: ${(e as Error).message}\n`);
      return 1;
    }
    // A malformed trace, one of another format version, or one taken of another program: its sentence
    try {
      trace = parseTrace(text, programHash(cmd));
    } catch (e) {
      io.stderr(`fugloy port: ${values.trace}: ${(e as Error).message}\nfugloy port: nothing written\n`);
      return 1;
    }
  }

  const source = basename(path);
  // The runtime's stand-ins for the model, by name: a CALL to one runs the runtime's code for it
  const stood = new Map([...standins(model)].map(([at, s]) => [at, s.name] as const));
  const result = port(cmd, { model, runtimeImport: RUNTIME_IMPORT, source, standins: stood, ...(hints === undefined ? {} : { hints }), ...(trace === undefined ? {} : { trace }) });
  if (!result.ok) {
    for (const error of result.errors) io.stderr(`fugloy port: ${path}: ${error}\n`);
    io.stderr(`fugloy port: ${plural(result.errors.length, 'error')}; nothing written\n`);
    return 1;
  }
  for (const [file, text] of [
    [outputs.module, result.js],
    [outputs.report, formatReport(result.report, { source, model, module: basename(outputs.module), ...(values.trace === undefined ? {} : { trace: basename(values.trace) }) })],
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
