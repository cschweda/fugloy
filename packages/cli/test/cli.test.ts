import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../src/index.js';
import type { Io } from '../src/index.js';
import { loadBas } from '@fugloy/disasm';
import { assemble, expectSameImage, skipIfNoZmac } from '../../disasm/test/roundtrip/zmac.js';

const fixtures = fileURLToPath(new URL('../../../fixtures/synthetic/', import.meta.url));

function capture(existing: string[] = []): { io: Io; out: string[]; err: string[]; files: Map<string, string> } {
  const out: string[] = [];
  const err: string[] = [];
  const files = new Map<string, string>();
  const io: Io = {
    stdout: (s) => { out.push(s); },
    stderr: (s) => { err.push(s); },
    readFile: async (path) => (files.has(path) ? new TextEncoder().encode(files.get(path)!) : new Uint8Array(await readFile(path))),
    writeFile: async (path, text) => { files.set(path, text); },
    fileExists: async (path) => existing.includes(path) || files.has(path),
  };
  return { io, out, err, files };
}

describe('fugloy CLI', () => {
  it('lists a .CMD load module detected from content', async () => {
    const { io, out, err } = capture();
    expect(await run([`${fixtures}cmd/non-contiguous.cmd`], io)).toBe(0);
    const text = out.join('');
    expect(text.split('\n')[0]).toBe('; non-contiguous.cmd: load module, 2 blocks, 2 runs, 14 bytes, entry $6000 (transfer address)');
    expect(text).toContain('        ORG 6000H\n6000  21 00 3C      LD HL,3C00H             ; entry\n');
    expect(err).toEqual([]);
  });

  it('lists a tokenized .BAS program detected from content', async () => {
    const { io, out } = capture();
    expect(await run([`${fixtures}bas/prog-62c8.bas`], io)).toBe(0);
    expect(out.join('')).toContain('\n10 CLS:PRINT"VOYAGE OF THE VALKYRIE"\n');
  });

  it('lists a raw binary at --base and treats --base as forcing raw', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fugloy-'));
    const path = join(dir, 'code.bin');
    await writeFile(path, Uint8Array.from([0x3e, 0x01, 0xc9]));
    const { io, out } = capture();
    expect(await run([path, '--base', '5200'], io)).toBe(0);
    expect(out.join('')).toContain('5200  3E 01         LD A,01H                ; entry\n5202  C9            RET\n');
    const forced = capture();
    expect(await run([`${fixtures}cmd/non-contiguous.cmd`, '--base', '0x4000'], forced.io)).toBe(0);
    expect(forced.out.join('').split('\n')[0]).toMatch(/^; non-contiguous\.cmd: raw binary, \d+ bytes at \$4000-/);
  });

  it('refuses a raw file without --base and says how to list it', async () => {
    const { io, out, err } = capture();
    expect(await run([`${fixtures}README.md`], io)).toBe(2);
    expect(out).toEqual([]);
    expect(err.join('')).toContain('--base');
  });

  it('rejects a --base that is not hex or is out of range', async () => {
    for (const bad of ['zz', '10000', '-1', '']) {
      const { io, err } = capture();
      expect(await run([`${fixtures}README.md`, '--base', bad], io), bad).toBe(2);
      expect(err.join('')).toContain('--base');
    }
  });

  it('reports an unreadable file', async () => {
    const { io, err } = capture();
    expect(await run(['/nonexistent/x.cmd'], io)).toBe(1);
    expect(err.join('')).toContain('cannot read /nonexistent/x.cmd');
  });

  it('prints usage with --help, and usage plus an error when no file is given', async () => {
    const help = capture();
    expect(await run(['--help'], help.io)).toBe(0);
    expect(help.out.join('')).toContain('Usage: fugloy <file> [--base <hex> | --rebase <hex>]');
    const none = capture();
    expect(await run([], none.io)).toBe(2);
    expect(none.err.join('')).toContain('Usage: fugloy');
    const unknown = capture();
    expect(await run(['--frobnicate', 'x'], unknown.io)).toBe(2);
    expect(unknown.err.join('')).toContain('frobnicate');
  });
});

describe('pass 1 flags', () => {
  const file = `${fixtures}cmd/non-contiguous.cmd`;

  it('prints the Pass 1 listing by default and the linear sweep with --sweep', async () => {
    const a = capture();
    expect(await run([file], a.io)).toBe(0);
    expect(a.out.join('')).toContain('; pass 1: roots $6000;');
    const b = capture();
    expect(await run([file, '--sweep'], b.io)).toBe(0);
    expect(b.out.join('')).not.toContain('; pass 1:');
    expect(b.out.join('')).toContain('7000  00            NOP');
  });

  it('emits zmac source with --format zmac', async () => {
    const { io, out } = capture();
    expect(await run([file, '--format', 'zmac'], io)).toBe(0);
    const text = out.join('');
    expect(text.startsWith('; non-contiguous.cmd: Fugløy pass 1')).toBe(true);
    expect(text).toContain('\tORG\t6000H\n\tLD\tHL,3C00H\n');
    expect(text.trimEnd().endsWith('\tEND\t6000H')).toBe(true);
  });

  it('emits the IR as JSON with --format ir', async () => {
    const { io, out } = capture();
    expect(await run([file, '--format', 'ir'], io)).toBe(0);
    const ir = JSON.parse(out.join('')) as { fugloyIr: number; entry: number; source: string };
    expect(ir.fugloyIr).toBe(1);
    expect(ir.entry).toBe(0x6000);
    expect(ir.source).toBe('non-contiguous.cmd');
  });

  it('adds roots with --entry, which may repeat', async () => {
    const { io, out } = capture();
    expect(await run([file, '--entry', '7000', '--entry', '0x7004'], io)).toBe(0);
    const text = out.join('');
    expect(text).toContain('; pass 1: roots $6000, $7000, $7004;');
    expect(text).toContain('7000  00            NOP                     ; entry');
  });

  it('rejects a malformed or unloaded --entry with exit 2 and nothing on stdout', async () => {
    const bad = capture();
    expect(await run([file, '--entry', 'zz'], bad.io)).toBe(2);
    expect(bad.err.join('')).toContain('--entry');
    expect(bad.out).toEqual([]);
    const unloaded = capture();
    expect(await run([file, '--entry', '9000'], unloaded.io)).toBe(2);
    expect(unloaded.err.join('')).toContain('$9000');
    expect(unloaded.out).toEqual([]);
  });

  it('rejects an unknown --format', async () => {
    const { io, err, out } = capture();
    expect(await run([file, '--format', 'pdf'], io)).toBe(2);
    expect(err.join('')).toContain('--format');
    expect(out).toEqual([]);
  });

  it('refuses --sweep with another --format and --entry with --sweep instead of ignoring them', async () => {
    const a = capture();
    expect(await run([file, '--sweep', '--format', 'zmac'], a.io)).toBe(2);
    expect(a.err.join('')).toContain('--sweep');
    expect(a.out).toEqual([]);
    const b = capture();
    expect(await run([file, '--sweep', '--entry', '7000'], b.io)).toBe(2);
    expect(b.err.join('')).toContain('--entry');
    expect(b.out).toEqual([]);
  });

  it('emits a bare END for a load module that had no transfer record', async () => {
    const { io, out } = capture();
    expect(await run([`${fixtures}cmd/missing-02.cmd`, '--format', 'zmac'], io)).toBe(0);
    expect(out.join('').trimEnd().endsWith('\tEND')).toBe(true);
  });

  it('writes to a file with -o and prints nothing', async () => {
    const { io, out, files } = capture();
    expect(await run([file, '--format', 'zmac', '-o', '/tmp/out.z'], io)).toBe(0);
    expect(out).toEqual([]);
    expect(files.get('/tmp/out.z')).toContain('\tORG\t6000H');
  });

  it('keeps the BASIC listing for a .BAS file and emits DB rows for --format zmac', async () => {
    const bas = `${fixtures}bas/prog-62c8.bas`;
    const a = capture();
    expect(await run([bas], a.io)).toBe(0);
    expect(a.out.join('')).toContain('\n10 CLS:PRINT"VOYAGE OF THE VALKYRIE"\n');
    const b = capture();
    expect(await run([bas, '--format', 'zmac'], b.io)).toBe(0);
    expect(b.out.join('')).toContain('\tORG\t62C8H\n\tDW\t62E8H,000AH\n\tDB\t84H,3AH,0B2H,22H,56H,4FH,59H,41H\t; 10 CLS:PRINT"VOYAGE OF THE VALKYRIE"\n');
    expect(b.out.join('').trimEnd().endsWith('\tEND')).toBe(true);
  });

  it('lists a .BAS file with hidden code through pass 1 by default', async () => {
    const { io, out } = capture();
    expect(await run([`${fixtures}bas/hidden-code.bas`], io)).toBe(0);
    const text = out.join('');
    expect(text).toContain('; code lines: 1; entries mined: 0\n');
    expect(text).toContain('\n10 GOTO 30\n; line 20: machine code, 6 bytes at $700D\n700D  C3 00 00      JP 0000H                ; entry\n');
  });

  it('rebases a .BAS file with --rebase, names the original base, and keeps its hints matching', async () => {
    const bas = `${fixtures}bas/prog-62c8.bas`;
    const a = capture();
    expect(await run([bas, '--rebase', '7000'], a.io)).toBe(0);
    const text = a.out.join('');
    expect(text).toContain('saved from $7000');
    expect(text).toContain('\n; rebased from $62C8 to $7000\n');
    const skel = capture();
    expect(await run([bas, '--write-hints', '/virtual/p.hints'], skel.io)).toBe(0);
    const b = capture();
    b.files.set('/virtual/p.hints', `${skel.files.get('/virtual/p.hints')!}block 0:$0004 comment the title line\n`);
    expect(await run([bas, '--rebase', '7000', '--hints', '/virtual/p.hints'], b.io)).toBe(0);
    expect(b.out.join('')).toContain('1 block matched, 0 unmatched, 1 hint applied');
  });

  it('refuses --rebase on a .CMD file and with a bad address', async () => {
    const a = capture();
    expect(await run([`${fixtures}cmd/hint-paths.cmd`, '--rebase', '7000'], a.io)).toBe(2);
    expect(a.err.join('')).toContain('--rebase applies to a tokenized BASIC program');
    const b = capture();
    expect(await run([`${fixtures}bas/prog-62c8.bas`, '--rebase', 'XYZ'], b.io)).toBe(2);
    expect(b.err.join('')).toContain('--rebase needs a hex address');
  });

  skipIfNoZmac()('reassembles a rebased .BAS into the program saved from the new base', async () => {
    const { io, out } = capture();
    expect(await run([`${fixtures}bas/prog-62c8.bas`, '--rebase', '7000', '--format', 'zmac'], io)).toBe(0);
    const saved7000 = loadBas(new Uint8Array(await readFile(`${fixtures}bas/prog-7000.bas`)));
    expectSameImage(assemble(out.join('')).module.image, saved7000.image);
  });

  it('runs pass 1 on a .BAS file when --entry names its hidden code', async () => {
    const bas = `${fixtures}bas/hidden-code.bas`;
    const { io, out } = capture();
    expect(await run([bas, '--entry', '700D'], io)).toBe(0); // line 20's body: C3 00 00 C9 00 3E
    const text = out.join('');
    expect(text).toContain('; pass 1: roots $700D;');
    expect(text).toContain('700D  C3 00 00      JP 0000H                ; entry');
  });

  skipIfNoZmac()('a .BAS file\'s zmac output assembles back to the same image', async () => {
    const bas = `${fixtures}bas/prog-62c8.bas`;
    const { io, out } = capture();
    expect(await run([bas, '--format', 'zmac'], io)).toBe(0);
    const original = loadBas(new Uint8Array(await readFile(bas)));
    expectSameImage(assemble(out.join('')).module.image, original.image);
  });
});

describe('--color', () => {
  const file = `${fixtures}cmd/non-contiguous.cmd`;
  const terminal = (env: Record<string, string | undefined> = {}) => {
    const c = capture();
    c.io.stdoutIsTerminal = true;
    c.io.env = env;
    return c;
  };

  it('colors the listing when stdout is a terminal', async () => {
    const { io, out, err } = terminal();
    expect(await run([file, '--color'], io)).toBe(0);
    expect(out.join('')).toContain('\x1b[94mLD\x1b[0m');
    expect(err).toEqual([]);
  });

  it('stays plain when piped, written with -o, with NO_COLOR set, or without --color', async () => {
    const piped = capture();
    expect(await run([file, '--color'], piped.io)).toBe(0);
    expect(piped.out.join('')).not.toContain('\x1b[');
    const noColor = terminal({ NO_COLOR: '1' });
    expect(await run([file, '--color'], noColor.io)).toBe(0);
    expect(noColor.out.join('')).not.toContain('\x1b[');
    const toFile = terminal();
    expect(await run([file, '--color', '-o', 'out.lst'], toFile.io)).toBe(0);
    expect(toFile.files.get('out.lst')).not.toContain('\x1b[');
    const unasked = terminal();
    expect(await run([file], unasked.io)).toBe(0);
    expect(unasked.out.join('')).not.toContain('\x1b[');
  });

  it('refuses --color with --format zmac or ir, whose output is input to other tools', async () => {
    for (const format of ['zmac', 'ir']) {
      const { io, out, err } = terminal();
      expect(await run([file, '--color', '--format', format], io), format).toBe(2);
      expect(out).toEqual([]);
      expect(err.join('')).toContain(`--color applies to the listing format only, not --format ${format}`);
    }
  });
});

describe('relocate hints on the command line', () => {
  const cmd = `${fixtures}cmd/relocated-code.cmd`;
  const hintsFile = `${fixtures}hints/relocated-code.hints`;

  it('emit the relocated region with .PHASE and accept --entry at a runtime address', async () => {
    const a = capture();
    expect(await run([cmd, '--hints', hintsFile, '--format', 'zmac'], a.io)).toBe(0);
    expect(a.out.join('')).toContain('\tORG\t8000H\n\t.PHASE\t5000H\nL5000:\n');
    const b = capture();
    expect(await run([cmd, '--hints', hintsFile, '--entry', '5005'], b.io)).toBe(0);
    expect(b.out.join('')).toContain('; pass 1: roots $8100, $5005;');
  });

  it('name the runtime address when --entry gives the file address of relocated code', async () => {
    const { io, out, err } = capture();
    expect(await run([cmd, '--hints', hintsFile, '--entry', '8005'], io)).toBe(2);
    expect(out).toEqual([]);
    expect(err.join('')).toBe('fugloy: --entry $8005 is a file address a relocate hint moves; it runs at $5005, so use --entry 5005\n');
  });

  it('refuse a relocate that would overwrite loaded memory, with exit 2', async () => {
    const skel = capture();
    expect(await run([cmd, '--write-hints', '/virtual/r.hints'], skel.io)).toBe(0);
    const b = capture();
    b.files.set('/virtual/r.hints', `${skel.files.get('/virtual/r.hints')!}block 0:$0000 relocate $8105 $000B\n`);
    expect(await run([cmd, '--hints', '/virtual/r.hints'], b.io)).toBe(2);
    expect(b.err.join('')).toContain('relocate at $8000: the destination $8105-$810F overlaps loaded memory at $8105');
  });
});

describe('hint flags', () => {
  const file = `${fixtures}cmd/hint-paths.cmd`;
  const hints = `${fixtures}hints/hint-paths.hints`;

  it('applies --hints and shows labels, comments, and the hint summary', async () => {
    const { io, out } = capture();
    expect(await run([file, '--hints', hints], io)).toBe(0);
    const text = out.join('');
    expect(text).toContain('; hints: hint-paths.hints: 1 block matched, 0 unmatched, 11 hints applied\n');
    expect(text).toContain('PRINT:\n6020  3E 41         LD A,41H\n');
    expect(text).toContain('DW L6019,L601B');
  });

  it('carries hints into zmac and IR output', async () => {
    const z = capture();
    expect(await run([file, '--hints', hints, '--format', 'zmac'], z.io)).toBe(0);
    expect(z.out.join('')).toContain('PRINT:\n\tLD\tA,41H\n');
    const i = capture();
    expect(await run([file, '--hints', hints, '--format', 'ir'], i.io)).toBe(0);
    const ir = JSON.parse(i.out.join('')) as { symbols: { name: string }[]; hints: { applied: number } };
    expect(ir.symbols.map((s) => s.name)).toContain('DISPATCH');
    expect(ir.hints.applied).toBe(11);
  });

  it('reports every hint parse error with its line and exits 2', async () => {
    const { io, err, out, files } = capture();
    files.set('/virtual/bad.hints', 'fugloy-hints 1\nblock 0 length $5B hash 0123456789abcdef\nblock 0:$1 frob\nblock 0:$2 bytes\n');
    expect(await run([file, '--hints', '/virtual/bad.hints'], io)).toBe(2);
    expect(err.join('')).toContain('fugloy: /virtual/bad.hints:3: unknown directive "frob"\n');
    expect(err.join('')).toContain('fugloy: /virtual/bad.hints:4: bytes needs a length\n');
    expect(out).toEqual([]);
  });

  it('warns on stderr about unmatched blocks when the output is not a listing', async () => {
    const { io, err, out, files } = capture();
    files.set('/virtual/other.hints', 'fugloy-hints 1\nblock 0 length $5B hash 0000000000000000\nblock 0:$0 entry\n');
    expect(await run([file, '--hints', '/virtual/other.hints', '--format', 'zmac'], io)).toBe(0);
    expect(err.join('')).toContain('hint block 0');
    expect(out.join('')).toContain('\tORG\t6000H');
  });

  it('writes a hint skeleton with --write-hints and prints nothing', async () => {
    const { io, out, files } = capture();
    expect(await run([file, '--entry', '6019', '--write-hints', '/virtual/new.hints'], io)).toBe(0);
    expect(out).toEqual([]);
    const text = files.get('/virtual/new.hints')!;
    expect(text.startsWith('# Fugløy hints.')).toBe(true);
    expect(text).toContain('fugloy-hints 1\nprogram sha256 ');
    expect(text).toContain('block 0 length $005B hash ');
    expect(text).toContain('    # start $6000\n');
    expect(text).toContain('block 0:$0019 entry\n');
  });

  it('refuses to overwrite an existing hint file', async () => {
    const { io, err } = capture(['/virtual/taken.hints']);
    expect(await run([file, '--write-hints', '/virtual/taken.hints'], io)).toBe(2);
    expect(err.join('')).toContain('exists');
  });

  it('runs pass 1 on a .BAS file when --hints is given, like --entry', async () => {
    const bas = `${fixtures}bas/hidden-code.bas`;
    const { io, out, files } = capture();
    const skel = capture();
    expect(await run([bas, '--write-hints', '/virtual/bas.hints'], skel.io)).toBe(0);
    files.set('/virtual/bas.hints', `${skel.files.get('/virtual/bas.hints')!}block 0:$000D entry\n`);
    expect(await run([bas, '--hints', '/virtual/bas.hints'], io)).toBe(0);
    const text = out.join('');
    expect(text).toContain('; pass 1: roots $700D;');
    expect(text).toContain('; hints: bas.hints: 1 block matched, 0 unmatched, 1 hint applied');
  });

  it('refuses --sweep with --hints, and --hints with --write-hints', async () => {
    const a = capture();
    expect(await run([file, '--sweep', '--hints', hints], a.io)).toBe(2);
    expect(a.err.join('')).toContain('--hints');
    const b = capture();
    expect(await run([file, '--hints', hints, '--write-hints', '/virtual/x.hints'], b.io)).toBe(2);
    expect(b.err.join('')).toContain('--write-hints');
  });
});
