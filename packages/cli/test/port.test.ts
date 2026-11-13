/** `fugloy port`: the module and report it writes, the sentences when a program cannot be ported, and the exit codes. */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, toCmd } from '@fugloy/asm';
import { loadCmd, programHash, skeletonHints, writeHints } from '@fugloy/disasm';
import { parseTrace, port } from '@fugloy/recomp';
import { run } from '../src/index.js';
import type { Io } from '../src/index.js';
import { formatReport, outputsOf } from '../src/port.js';

const chapter1Source = fileURLToPath(new URL('../../../apps/web/content/learn/invaders/01-blank-loop/program.z', import.meta.url));

/** Chapter 1 of Build Space Invaders as a .CMD, assembled for `model`. */
async function chapter1(model: 1 | 3): Promise<Uint8Array> {
  const r = assemble(await readFile(chapter1Source, 'utf8'), { model });
  if (!r.ok) throw new Error('chapter 1 did not assemble');
  return toCmd(r);
}

/** Sea Dragon's program, hint file and trace (examples/sea-dragon/), as files by name. */
async function seaDragon(): Promise<{ 'seadrg01.cmd': Uint8Array; 'seadrg01.hints': Uint8Array; 'seadrg01.trace.json': Uint8Array }> {
  const read = async (name: string): Promise<Uint8Array> => new Uint8Array(await readFile(fileURLToPath(new URL(`../../../examples/sea-dragon/${name}`, import.meta.url))));
  return { 'seadrg01.cmd': await read('seadrg01.cmd'), 'seadrg01.hints': await read('seadrg01.hints'), 'seadrg01.trace.json': await read('seadrg01.trace.json') };
}

/** An Io over in-memory files, capturing output and what is written. */
function capture(files: Record<string, Uint8Array | string> = {}): { io: Io; out: string[]; err: string[]; written: Map<string, string> } {
  const out: string[] = [];
  const err: string[] = [];
  const written = new Map<string, string>();
  const io: Io = {
    stdout: (s) => { out.push(s); },
    stderr: (s) => { err.push(s); },
    readFile: async (path) => {
      const f = files[path];
      if (f === undefined) throw new Error(`ENOENT: no such file, open '${path}'`);
      return typeof f === 'string' ? new TextEncoder().encode(f) : f;
    },
    writeFile: async (path, text) => { written.set(path, text); },
    fileExists: async () => false,
  };
  return { io, out, err, written };
}

/** A program the port refuses: JP (HL) jumps to an address computed as it runs. */
const jpHl = (): Uint8Array => {
  const r = assemble('\tORG\t7000H\nSTART:\tLD\tHL,THERE\n\tJP\t(HL)\nTHERE:\tRET\n\tEND\tSTART\n', { model: 3 });
  return toCmd(r);
};

describe('fugloy port', () => {
  it("writes chapter 1's port and its report beside the program, and the module imports @fugloy/runtime/ops", async () => {
    const cmd = await chapter1(3);
    const { io, out, err, written } = capture({ 'games/blank.cmd': cmd });
    expect(await run(['port', 'games/blank.cmd', '--model', '3'], io)).toBe(0);
    expect(err).toEqual([]);
    expect([...written.keys()]).toEqual(['games/blank.port.js', 'games/blank.port.txt']);
    const js = written.get('games/blank.port.js')!;
    expect(js).toMatch(/^import \* as o from '@fugloy\/runtime\/ops';$/m);
    expect(js).toContain('export const MODEL = 3;');
    // The same module port() writes for the program, the model and the runtime's helpers.
    const p = port(cmd, { model: 3, runtimeImport: '@fugloy/runtime/ops', source: 'blank.cmd' });
    if (!p.ok) throw new Error(p.errors.join(' '));
    expect(js).toBe(p.js);
    expect(written.get('games/blank.port.txt')).toBe(formatReport(p.report, { source: 'blank.cmd', model: 3, module: 'blank.port.js' }));
    const n = p.report.routines.length;
    expect(out.join('')).toBe(
      `games/blank.port.js: ${n} routine${n === 1 ? '' : 's'} (${p.report.routines.filter((x) => x.labelled).length} labelled), ` +
        `entry ${p.report.entry}; the report is games/blank.port.txt\n`,
    );
  });

  it('writes into -o and names the files after the program; --model 1 makes a Model I port', async () => {
    const { io, written } = capture({ 'blank.cmd': await chapter1(1) });
    expect(await run(['port', 'blank.cmd', '--model', '1', '-o', 'out'], io)).toBe(0);
    expect([...written.keys()]).toEqual(['out/blank.port.js', 'out/blank.port.txt']);
    expect(written.get('out/blank.port.js')).toContain('export const MODEL = 1;');
    expect(written.get('out/blank.port.txt')).toContain('for the Model I');
  });

  it('the report lists the entry, each routine, the data and the places that refuse when they run', () => {
    const text = formatReport(
      {
        entry: 'START',
        entryAddr: 0x7000,
        routines: [
          { name: 'START', addr: 0x7000, blocks: 3, labelled: true },
          { name: 'SHOW', addr: 0x7010, blocks: 1, labelled: false },
        ],
        data: [{ addr: 0x7020, length: 5, kind: 'data' }],
        refused: ['the transfer at $7002 goes to $0060, where no block of the program starts.'],
        standins: [],
        cells: [],
        drops: [],
        resets: [],
        rom: [],
      },
      { source: 'game.cmd', model: 3, module: 'game.port.js' },
    );
    expect(text).toBe(
      [
        'game.cmd, ported for the Model III by @fugloy/recomp 0.1.0',
        'Module: game.port.js (imports @fugloy/runtime/ops)',
        'Entry: START',
        "This port was not compared with the emulator. It was made with no trace, so a write into the program's code stops it with a sentence; a read of its own code, or of a ROM byte, reads $00 without stopping.",
        '',
        'Routines: 2 (1 labelled)',
        '  $7000  START  3 blocks  labelled',
        '  $7010  SHOW   1 block   structured',
        '',
        'Data: 1 region, 5 bytes (data: the hint file types it; unknown: the analysis did not reach it)',
        '  $7020  5 bytes  data',
        '',
        'Refused if they run: 1',
        '  the transfer at $7002 goes to $0060, where no block of the program starts.',
        '',
      ].join('\n'),
    );
  });

  it("a hint file's names and notes reach the module", async () => {
    const cmd = await chapter1(3);
    const plain = capture({ 'blank.cmd': cmd });
    expect(await run(['port', 'blank.cmd', '--model', '3'], plain.io)).toBe(0);
    // Chapter 1 starts at $7000 with WAIT, the routine its loop calls.
    const hints = `${writeHints(skeletonHints(loadCmd(cmd), cmd))}block 0:$0000 name PAUSE\nblock 0:$0000 note The turn's pause.\n`;
    const named = capture({ 'blank.cmd': cmd, 'blank.hints': hints });
    const code = await run(['port', 'blank.cmd', '--model', '3', '--hints', 'blank.hints'], named.io);
    expect(named.err.join('')).toBe('');
    expect(code).toBe(0);
    const js = named.written.get('blank.port.js')!;
    expect(js).toContain('export function PAUSE(');
    expect(js).toContain("The turn's pause.");
    expect(plain.written.get('blank.port.js')).not.toContain('PAUSE');
    const bad = capture({ 'blank.cmd': cmd, 'bad.hints': 'fugloy-hints 1\nblock 0:$0000 frob\n' });
    expect(await run(['port', 'blank.cmd', '--model', '3', '--hints', 'bad.hints'], bad.io)).toBe(1);
    expect(bad.err.join('')).toMatch(/^fugloy port: blank\.cmd: the hint file, line 2: /);
    expect(bad.written.size).toBe(0);
  });

  it("runs Sea Dragon's six CALL 0060H on the runtime's $DELAY, and its report lists them, on the Model III only", async () => {
    const cmd = new Uint8Array(await readFile(fileURLToPath(new URL('../../../examples/sea-dragon/seadrg01.cmd', import.meta.url))));
    const hints = await readFile(fileURLToPath(new URL('../../../examples/sea-dragon/seadrg01.hints', import.meta.url)), 'utf8');
    const { io, err, written } = capture({ 'seadrg01.cmd': cmd, 'seadrg01.hints': hints });
    expect(await run(['port', 'seadrg01.cmd', '--model', '3', '--hints', 'seadrg01.hints'], io)).toBe(0);
    expect(err.join('')).toBe('');
    const js = written.get('seadrg01.port.js')!;
    // Six calls; a block two routines share is written in each
    expect(new Set(js.match(/o\.standin\(z, 0x0060, 0x[0-9A-F]{4}\);/g)).size).toBe(6);
    const report = written.get('seadrg01.port.txt')!;
    expect(report).toContain('ROM routines the runtime stands in for: 1\n  $0060  $DELAY  called from $4EAC, $4EBC, $4EC6, $5512, $5F71, $6022\n');
    expect(report).toContain('Refused if they run: none');
    // The Model I has no stand-ins in M2: the same calls are refused there
    const m1 = capture({ 'seadrg01.cmd': cmd, 'seadrg01.hints': hints });
    expect(await run(['port', 'seadrg01.cmd', '--model', '1', '--hints', 'seadrg01.hints'], m1.io)).toBe(0);
    expect(m1.written.get('seadrg01.port.txt')).not.toContain('stands in for');
    expect(m1.written.get('seadrg01.port.txt')).toContain('Refused if they run: 6');
  });

  it("ports Sea Dragon with its hint file and trace: the module imports the runtime, and the report lists what the trace let it follow", async () => {
    const files = await seaDragon();
    const { io, out, err, written } = capture(files);
    expect(await run(['port', 'seadrg01.cmd', '--model', '3', '--hints', 'seadrg01.hints', '--trace', 'seadrg01.trace.json'], io)).toBe(0);
    expect(err.join('')).toBe('');
    const js = written.get('seadrg01.port.js')!;
    expect(js).toMatch(/^import \* as o from '@fugloy\/runtime\/ops';$/m);
    // The module port() writes for the program, its hints and its trace
    const trace = parseTrace(new TextDecoder().decode(files['seadrg01.trace.json']), programHash(files['seadrg01.cmd']));
    const p = port(files['seadrg01.cmd'], {
      model: 3, runtimeImport: '@fugloy/runtime/ops', source: 'seadrg01.cmd', hints: new TextDecoder().decode(files['seadrg01.hints']), trace,
      standins: new Map([[0x0060, 'DELAY']]),
    });
    if (!p.ok) throw new Error(p.errors.join(' '));
    expect(js).toBe(p.js);
    const report = written.get('seadrg01.port.txt')!;
    expect(report).toBe(formatReport(p.report, { source: 'seadrg01.cmd', model: 3, module: 'seadrg01.port.js', trace: 'seadrg01.trace.json' }));
    expect(report).toContain('\nLoader: The file\'s transfer routine at $8881 (15 bytes) moves the program to where it runs; the port does not translate it, and starts at $497F with its data already at its run addresses.\n');
    expect(report).toContain('\nTrace: seadrg01.trace.json\n');
    expect(report).toContain("\nThis port was not compared with the emulator. A write into the program's code that the trace does not name stops it with a sentence; a read of its own code, or of a ROM byte the trace does not name, reads $00 without stopping.\n");
    expect(report).toMatch(/\nRoutines: \d+ \(0 labelled\)\n/);
    expect(report).toContain('\nCode the program rewrites, read as it runs: 8 sites, 9 bytes\n');
    expect(report).toContain('\n  $49C1  displacement of the instruction at $49BF; 9 values seen\n');
    expect(report).toContain('\n  $509B  word operand of the instruction at $509A; 2 values seen\n');
    expect(report).toContain('\n  $5174  opcode, a choice between NOP and LD (HL),A; 2 values seen\n');
    expect(report).toContain('\nPOPs that drop a return address: 1\n  $4BAC  goes on in SUB_4BAD\n');
    expect(report).toMatch(/\nJumps back to the entry that discard the stack: 3\n  \$4CC6: .+\n  \$602D: .+\n  \$6042: .+\n/);
    expect(report).toContain('\nROM bytes the program reads, carried in the module: 2\n  $0000  $F3\n  $0003  $00\n');
    expect(report).toContain('Refused if they run: none');
    expect(report).toMatch(/\n  \$[0-9A-F]{4}  \d+ bytes? +unknown\n/);
    expect(out.join('')).toMatch(/^seadrg01\.port\.js: \d+ routines \(0 labelled\), entry L497F; the report is seadrg01\.port\.txt\n$/);
  });

  it('refuses a trace taken of another program, or one that is not a trace, with the sentence, writing nothing', async () => {
    const files = await seaDragon();
    const other = capture({ ...files, 'blank.cmd': await chapter1(3) });
    expect(await run(['port', 'blank.cmd', '--model', '3', '--trace', 'seadrg01.trace.json'], other.io)).toBe(1);
    expect(other.written.size).toBe(0);
    expect(other.err.join('')).toMatch(/^fugloy port: seadrg01\.trace\.json: the trace was taken of another program \(seadrg01\.cmd, SHA-256 [0-9a-f]{64}\), not this one \(SHA-256 [0-9a-f]{64}\); take a census of this program\nfugloy port: nothing written\n$/);
    const bad = capture({ ...files, 'bad.json': '{"fugloy-trace": 1' });
    expect(await run(['port', 'seadrg01.cmd', '--model', '3', '--trace', 'bad.json'], bad.io)).toBe(1);
    expect(bad.written.size).toBe(0);
    expect(bad.err.join('')).toMatch(/^fugloy port: bad\.json: the trace is not a port trace: it is not JSON/);
    const gone = capture(files);
    expect(await run(['port', 'seadrg01.cmd', '--model', '3', '--trace', 'gone.json'], gone.io)).toBe(1);
    expect(gone.err.join('')).toMatch(/^fugloy port: cannot read gone\.json: ENOENT/);
    // A trace taken on the Model III, for a Model I port: port()'s sentence
    const model1 = capture(files);
    expect(await run(['port', 'seadrg01.cmd', '--model', '1', '--hints', 'seadrg01.hints', '--trace', 'seadrg01.trace.json'], model1.io)).toBe(1);
    expect(model1.err.join('')).toContain('the trace was taken on the Model III, and the port is for the Model I.');
  });

  it("exits 1 with port()'s sentences, writing nothing, when the program cannot be ported", async () => {
    const { io, out, err, written } = capture({ 'jp.cmd': jpHl(), 'text.cmd': 'not a program' });
    expect(await run(['port', 'jp.cmd', '--model', '3'], io)).toBe(1);
    expect(out).toEqual([]);
    expect(written.size).toBe(0);
    expect(err.join('')).toMatch(/^fugloy port: jp\.cmd: \$7003: JP \(HL\) jumps to an address computed as it runs/);
    expect(err.join('')).toMatch(/fugloy port: 1 error; nothing written\n$/);
    const text = capture({ 'text.cmd': 'not a program' });
    expect(await run(['port', 'text.cmd', '--model', '3'], text.io)).toBe(1);
    expect(text.err.join('')).toBe('fugloy port: text.cmd: the program is not a .CMD load module.\nfugloy port: 1 error; nothing written\n');
  });

  it('exits 1 for a file it cannot read', async () => {
    const { io, err } = capture();
    expect(await run(['port', 'gone.cmd', '--model', '3'], io)).toBe(1);
    expect(err.join('')).toMatch(/^fugloy port: cannot read gone\.cmd: ENOENT/);
    const hints = capture({ 'p.cmd': await chapter1(3) });
    expect(await run(['port', 'p.cmd', '--model', '3', '--hints', 'gone.hints'], hints.io)).toBe(1);
    expect(hints.err.join('')).toMatch(/^fugloy port: cannot read gone\.hints: ENOENT/);
  });

  it('refuses usage errors with exit 2', async () => {
    const cases: [string[], string][] = [
      [['port'], 'fugloy port: expected exactly one program\n'],
      [['port', 'a.cmd', 'b.cmd', '--model', '3'], 'fugloy port: expected exactly one program\n'],
      [['port', 'a.cmd'], 'fugloy port: --model is needed: 1 (the Model I) or 3 (the Model III), the machine the port runs on\n'],
      [['port', 'a.cmd', '--model', '4'], 'fugloy port: --model must be 1 or 3\n'],
    ];
    for (const [argv, message] of cases) {
      const { io, err } = capture();
      expect(await run(argv, io), argv.join(' ')).toBe(2);
      expect(err.join('').split('\n')[0] + '\n', argv.join(' ')).toBe(message);
    }
    const unknown = capture();
    expect(await run(['port', 'a.cmd', '--frob'], unknown.io)).toBe(2);
    expect(unknown.err.join('')).toMatch(/^fugloy port: Unknown option '--frob'/);
  });

  it('--help prints the usage and the main help mentions fugloy port', async () => {
    const a = capture();
    expect(await run(['port', '--help'], a.io)).toBe(0);
    expect(a.out.join('')).toMatch(/^Usage: fugloy port <program\.cmd> --model 1\|3 \[--hints <file>\] \[--trace <file>\] \[-o <dir>\]/);
    const b = capture();
    expect(await run(['--help'], b.io)).toBe(0);
    expect(b.out.join('')).toContain('fugloy port <program.cmd> --model 1|3 [--hints <file>] [--trace <file>] [-o <dir>]');
  });

  it('outputsOf puts the two files in the directory, named after the program', () => {
    expect(outputsOf('dir/game.cmd', undefined)).toEqual({ module: 'dir/game.port.js', report: 'dir/game.port.txt' });
    expect(outputsOf('game.CMD', 'out')).toEqual({ module: 'out/game.port.js', report: 'out/game.port.txt' });
    expect(outputsOf('game', undefined)).toEqual({ module: 'game.port.js', report: 'game.port.txt' });
    // Never the program itself: the outputs add .port to its name.
    expect(outputsOf('a.port.js', undefined)).toEqual({ module: 'a.port.port.js', report: 'a.port.port.txt' });
  });

  // The bin runs dist/, which `pnpm typecheck` or `pnpm build` writes (CI typechecks before it tests).
  it.skipIf(!existsSync(fileURLToPath(new URL('../dist/main.js', import.meta.url))))('runs from the built bin and writes real files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fugloy-port-'));
    try {
      const bin = fileURLToPath(new URL('../bin/fugloy.js', import.meta.url));
      await writeFile(join(dir, 'blank.cmd'), await chapter1(3));
      const r = spawnSync(process.execPath, [bin, 'port', join(dir, 'blank.cmd'), '--model', '3'], { encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      expect(await readFile(join(dir, 'blank.port.js'), 'utf8')).toMatch(/^import \* as o from '@fugloy\/runtime\/ops';$/m);
      expect(await readFile(join(dir, 'blank.port.txt'), 'utf8')).toMatch(/^blank\.cmd, ported for the Model III/);
      await writeFile(join(dir, 'jp.cmd'), jpHl());
      const b = spawnSync(process.execPath, [bin, 'port', join(dir, 'jp.cmd'), '--model', '3'], { encoding: 'utf8' });
      expect(b.status).toBe(1);
      expect(existsSync(join(dir, 'jp.port.js'))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
