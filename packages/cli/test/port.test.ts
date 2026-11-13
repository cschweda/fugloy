/** `fugloy port`: the module and report it writes, the sentences when a program cannot be ported, and the exit codes. */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, toCmd } from '@fugloy/asm';
import { loadCmd, skeletonHints, writeHints } from '@fugloy/disasm';
import { port } from '@fugloy/recomp';
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
      },
      { source: 'game.cmd', model: 3, module: 'game.port.js' },
    );
    expect(text).toBe(
      [
        'game.cmd, ported for the Model III by @fugloy/recomp 0.1.0',
        'Module: game.port.js (imports @fugloy/runtime/ops)',
        'Entry: START',
        'This port was not compared with the emulator. Self-modifying code is not detected here: a program that changes its own code will run wrong.',
        '',
        'Routines: 2 (1 labelled)',
        '  $7000  START  3 blocks  labelled',
        '  $7010  SHOW   1 block   structured',
        '',
        'Data: 1 region, 5 bytes',
        '  $7020  5 bytes',
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
    expect(a.out.join('')).toMatch(/^Usage: fugloy port <program\.cmd> --model 1\|3 \[--hints <file>\] \[-o <dir>\]/);
    const b = capture();
    expect(await run(['--help'], b.io)).toBe(0);
    expect(b.out.join('')).toContain('fugloy port <program.cmd> --model 1|3 [--hints <file>] [-o <dir>]');
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
