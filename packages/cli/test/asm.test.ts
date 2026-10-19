/** `fugloy asm`: diagnostics as file:line:col: severity: message, the .CMD it writes, the listing, and the exit codes. */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadCmd } from '@fugloy/disasm';
import { defaultOutput, formatListing } from '../src/asm.js';
import { run } from '../src/index.js';
import type { Io } from '../src/index.js';
import { assemble } from '@fugloy/asm';

const starter = fileURLToPath(new URL('../../asm/examples/clear-screen.z', import.meta.url));

/** An Io over in-memory files (`sources`), capturing output and what is written. */
function capture(sources: Record<string, string> = {}): { io: Io; out: string[]; err: string[]; written: Map<string, Uint8Array> } {
  const out: string[] = [];
  const err: string[] = [];
  const written = new Map<string, Uint8Array>();
  const io: Io = {
    stdout: (s) => { out.push(s); },
    stderr: (s) => { err.push(s); },
    readFile: async (path) => {
      if (path in sources) return new TextEncoder().encode(sources[path]);
      return new Uint8Array(await readFile(path));
    },
    writeFile: async () => { throw new Error('asm writes bytes'); },
    writeBytes: async (path, bytes) => { written.set(path, bytes); },
    fileExists: async () => false,
  };
  return { io, out, err, written };
}

describe('fugloy asm', () => {
  it('assembles the starter into a .CMD beside it, prints a summary, and exits 0', async () => {
    const { io, out, err, written } = capture();
    expect(await run(['asm', starter], io)).toBe(0);
    expect(err).toEqual([]);
    const target = starter.replace(/\.z$/, '.cmd');
    expect([...written.keys()]).toEqual([target]);
    expect(out.join('')).toBe(`${target}: 1 block, 16 bytes, $7000-$700F, entry $7000\n`);
    const mod = loadCmd(written.get(target)!);
    expect(mod.entry).toBe(0x7000);
    expect(Array.from(mod.image.bytes.subarray(0x7000, 0x7003))).toEqual([0x21, 0x00, 0x3c]);
  });

  it('writes to -o', async () => {
    const { io, written } = capture({ 'p.z': '\tORG 6000H\n\tRET\n' });
    expect(await run(['asm', 'p.z', '-o', 'out/game.cmd'], io)).toBe(0);
    expect([...written.keys()]).toEqual(['out/game.cmd']);
  });

  it('a program with no END entry gets a transfer record to its first byte, and the summary says so', async () => {
    const { io, out, written } = capture({ 'p.z': '\tORG 6000H\n\tRET\n' });
    expect(await run(['asm', 'p.z'], io)).toBe(0);
    expect(out.join('')).toBe('p.cmd: 1 block, 1 byte, $6000, no END entry, so it runs from its first byte, $6000\n');
    expect(Array.from(written.get('p.cmd')!)).toEqual([0x01, 0x03, 0x00, 0x60, 0xc9, 0x02, 0x02, 0x00, 0x60]);
  });

  it('prints every diagnostic as file:line:col: severity: message, writes nothing, and exits 1 on an error', async () => {
    const { io, out, err, written } = capture({ 'bad.z': '\tORG 6000H\n\tLDA 5\n\tCALL CLSS\n\tJR FAR\n\tDS 200\nFAR:\tNOP\n' });
    expect(await run(['asm', 'bad.z'], io)).toBe(1);
    expect(out).toEqual([]);
    expect(written.size).toBe(0);
    expect(err.join('')).toBe(
      [
        'bad.z:2:2: error: Unknown instruction LDA. Did you mean LD A,…?',
        'bad.z:3:7: error: CLSS is not defined. Did you mean $VDCLS, the Model III ROM routine at $01C9 (clear the screen)?',
        'bad.z:4:5: error: JR reaches 128 bytes either way; FAR is 200 bytes ahead. Use JP.',
        'fugloy asm: 3 errors; no .CMD written',
        '',
      ].join('\n'),
    );
  });

  it('prints warnings and info notes too, and still writes the .CMD', async () => {
    const { io, err, written } = capture({ 'w.z': 'START:\tCALL 0050H\n\tEND START\n' });
    expect(await run(['asm', 'w.z'], io)).toBe(0);
    expect(written.has('w.cmd')).toBe(true);
    const lines = err.join('').split('\n');
    expect(lines[0]).toMatch(/^w\.z:1:13: warning: \$0050 means different things in the two ROMs: on the Model III it is \$RSRCV/);
    expect(lines[1]).toBe('w.z:1:1: info: There is no ORG, so the program starts at $5200.');
  });

  it('--model picks the ROM names and the warning\'s order; --dos adds a DOS\'s names', async () => {
    const one = capture({ 'k.z': '\tORG 6000H\n\tCALL KBDRIVER\n\tCALL 0050H\n' });
    expect(await run(['asm', 'k.z', '--model', '1'], one.io)).toBe(0);
    expect(Array.from(one.written.get('k.cmd')!.subarray(4, 7))).toEqual([0xcd, 0xe3, 0x03]);
    expect(one.err.join('')).toContain('warning: $0050 means different things in the two ROMs: on the Model I it is CTRLCHARTAB');
    const dos = capture({ 'd.z': '\tORG 6000H\n\tJP $JP2DOS\n' });
    expect(await run(['asm', 'd.z'], dos.io)).toBe(1);
    expect(dos.err.join('')).toContain('d.z:2:5: error: $JP2DOS is not defined. $JP2DOS is a TRSDOS 1.3 name; choose TRSDOS 1.3 as the DOS to use it.');
    const trsdos = capture({ 'd.z': '\tORG 6000H\n\tJP $JP2DOS\n' });
    expect(await run(['asm', 'd.z', '--dos', 'trsdos'], trsdos.io)).toBe(0);
  });

  it('--listing prints the listing to stdout and the summary to stderr', async () => {
    const { io, out, err } = capture({ 'l.z': 'K\tEQU 5\n\tORG 6000H\nS:\tLD A,K\n\tDB "HELLO, WORLD! THIS IS LONG"\n\t.PHASE 4000H\n\tNOP\n\t.DEPHASE\n\tEND S\n' });
    expect(await run(['asm', 'l.z', '--listing'], io)).toBe(0);
    expect(out.join('')).toBe(
      [
        '    1  =0005                     K\tEQU 5',
        '    2                            \tORG 6000H',
        '    3  6000      3E 05           S:\tLD A,K',
        '    4  6002      48 45 4C 4C     \tDB "HELLO, WORLD! THIS IS LONG"',
        '                 4F 2C 20 57',
        '                 4F 52 4C 44',
        '                 21 20 54 48 +10',
        '    5                            \t.PHASE 4000H',
        '    6  4000@601C 00              \tNOP',
        '    7                            \t.DEPHASE',
        '    8                            \tEND S',
        '',
      ].join('\n'),
    );
    expect(err.join('')).toBe('l.cmd: 1 block, 29 bytes, $6000-$601C, entry $6000\n');
  });

  it('refuses usage errors with exit 2', async () => {
    const cases: [string[], string][] = [
      [['asm'], 'fugloy asm: expected exactly one source file\n'],
      [['asm', 'a.z', 'b.z'], 'fugloy asm: expected exactly one source file\n'],
      [['asm', 'a.z', '--model', '2'], 'fugloy asm: --model must be 1, 3, or 4\n'],
      [['asm', 'a.z', '--dos', 'cpm'], 'fugloy asm: --dos must be trsdos, ldos, or none\n'],
      [['asm', 'a.z', '--model', '1', '--dos', 'trsdos'], 'fugloy asm: --dos trsdos is the Model III DOS; use --model 3 or --dos ldos\n'],
      [['asm', 'a.z', '--model', '4', '--dos', 'ldos'], 'fugloy asm: --model 4 predefines the LS-DOS 6 service calls and the Model III ROM; leave out --dos\n'],
      [['asm', 'a.cmd'], 'fugloy asm: the output would overwrite the source a.cmd; choose another name with -o\n'],
    ];
    for (const [argv, message] of cases) {
      const { io, err } = capture();
      expect(await run(argv, io), argv.join(' ')).toBe(2);
      expect(err.join('').split('\n')[0] + '\n', argv.join(' ')).toBe(message);
    }
    const unknown = capture();
    expect(await run(['asm', 'a.z', '--frob'], unknown.io)).toBe(2);
    expect(unknown.err.join('')).toMatch(/^fugloy asm: Unknown option '--frob'/);
  });

  it('exits 1 for a file it cannot read or that is not text, and for a source with no bytes', async () => {
    const missing = capture();
    expect(await run(['asm', '/nonexistent/x.z'], missing.io)).toBe(1);
    expect(missing.err.join('')).toMatch(/^fugloy asm: cannot read \/nonexistent\/x\.z: /);
    const dir = await mkdtemp(join(tmpdir(), 'fugloy-asm-'));
    try {
      await writeFile(join(dir, 'b.z'), Uint8Array.from([0xff, 0xfe, 0x00]));
      const binary = capture();
      expect(await run(['asm', join(dir, 'b.z')], binary.io)).toBe(1);
      expect(binary.err.join('')).toBe(`fugloy asm: cannot read ${join(dir, 'b.z')}: it is not UTF-8 text\n`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    const empty = capture({ 'e.z': 'K\tEQU 5\n' });
    expect(await run(['asm', 'e.z'], empty.io)).toBe(1);
    expect(empty.err.join('')).toBe('fugloy asm: There is nothing to write: the program has no bytes.\n');
  });

  it('--help prints the usage and the main help mentions fugloy asm', async () => {
    const a = capture();
    expect(await run(['asm', '--help'], a.io)).toBe(0);
    expect(a.out.join('')).toMatch(/^Usage: fugloy asm <source>/);
    const b = capture();
    expect(await run(['--help'], b.io)).toBe(0);
    expect(b.out.join('')).toContain('fugloy asm <source> [-o <out.cmd>]');
  });

  it('defaultOutput changes or adds the extension', () => {
    expect(defaultOutput('dir/game.z')).toBe('dir/game.cmd');
    expect(defaultOutput('game.asm')).toBe('game.cmd');
    expect(defaultOutput('game')).toBe('game.cmd');
  });

  it('formatListing shows an empty line as its number alone', () => {
    expect(formatListing(assemble('\tORG 6000H\n\n\tNOP\n').listing)).toBe('    1                            \tORG 6000H\n    2\n    3  6000      00              \tNOP\n');
  });

  // The bin runs dist/, which `pnpm typecheck` or `pnpm build` writes (CI typechecks before it tests).
  it.skipIf(!existsSync(fileURLToPath(new URL('../dist/main.js', import.meta.url))))('runs from the built bin and writes a real file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fugloy-asm-'));
    try {
      const bin = fileURLToPath(new URL('../bin/fugloy.js', import.meta.url));
      const src = join(dir, 'clear.z');
      await writeFile(src, await readFile(starter));
      const r = spawnSync(process.execPath, [bin, 'asm', src], { encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      expect(loadCmd(new Uint8Array(await readFile(join(dir, 'clear.cmd')))).entry).toBe(0x7000);
      const bad = join(dir, 'bad.z');
      await writeFile(bad, '\tORG 6000H\n\tJMP 0\n');
      const b = spawnSync(process.execPath, [bin, 'asm', bad], { encoding: 'utf8' });
      expect(b.status).toBe(1);
      expect(b.stderr).toBe(`${bad}:2:2: error: Unknown instruction JMP. Did you mean JP?\nfugloy asm: 1 error; no .CMD written\n`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
