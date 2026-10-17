import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run } from '../src/index.js';
import type { Io } from '../src/index.js';
import { loadBas, loadRaw } from '@fugloy/disasm';
import { assemble, expectSameImage, skipIfNoZmac } from '../../disasm/test/roundtrip/zmac.js';
import { writeBasic } from '../../disasm/test/writers/basic-tokenizer.js';
import type { BasicLineSpec } from '../../disasm/test/writers/basic-tokenizer.js';

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
    expect(text).toContain('        ORG 6000H\n6000  21 00 3C      LD HL,VIDEO             ; entry\n');
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
    expect(text).toContain('\tORG\t6000H\n\tLD\tHL,VIDEO\n');
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
    expect(text).toContain('\n10 GOTO 30\n; line 20: machine code, 6 bytes at $700D\n700D  C3 00 00      JP $RESET               ; entry');
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
    expect(text).toContain('700D  C3 00 00      JP $RESET               ; entry');
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

describe('--machine and --dos', () => {
  // The 27-byte routine from the social card, at $5200: clear the screen, wait for Enter with a ROM call
  // (CALL 0049H), and return to the DOS with a jump (JP 402DH).
  const ROUTINE = Uint8Array.from([
    0xf3, 0x31, 0x00, 0x70, 0x21, 0x00, 0x3c, 0x11, 0x01, 0x3c, 0x01, 0xff, 0x03, 0x36, 0x20, 0xed, 0xb0, 0xcd, 0x49, 0x00, 0xfe, 0x0d, 0x20, 0xf9, 0xc3, 0x2d, 0x40,
  ]);
  let dir: string;
  let program: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fugloy-tables-'));
    program = join(dir, 'routine.bin');
    await writeFile(program, ROUTINE);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** Runs the CLI on the routine at $5200 with these flags. */
  async function list(...flags: string[]): Promise<{ code: number; text: string; err: string }> {
    const { io, out, err } = capture();
    const code = await run([program, '--base', '5200', ...flags], io);
    return { code, text: out.join(''), err: err.join('') };
  }
  const headerOf = (text: string): string | undefined => text.split('\n').find((l) => l.startsWith('; symbols:'));

  /** Every way to choose a machine and DOS that names tables, with what the header calls them. */
  const CHOICES: { flags: string[]; tables: string }[] = [
    { flags: [], tables: 'Model III ROM, hardware, TRSDOS 1.3' },
    { flags: ['--machine', '3'], tables: 'Model III ROM, hardware, TRSDOS 1.3' },
    { flags: ['--dos', 'trsdos'], tables: 'Model III ROM, hardware, TRSDOS 1.3' },
    { flags: ['--machine', '3', '--dos', 'trsdos'], tables: 'Model III ROM, hardware, TRSDOS 1.3' },
    { flags: ['--dos', 'ldos'], tables: 'Model III ROM, hardware, LDOS 5.1' },
    { flags: ['--dos', 'none'], tables: 'Model III ROM, hardware, no DOS' },
    { flags: ['--machine', '1'], tables: 'Model I ROM, hardware, LDOS 5.1' },
    { flags: ['--machine', '1', '--dos', 'ldos'], tables: 'Model I ROM, hardware, LDOS 5.1' },
    { flags: ['--machine', '1', '--dos', 'none'], tables: 'Model I ROM, hardware, no DOS' },
    { flags: ['--machine', '4'], tables: 'Model 4 service calls (LS-DOS 6)' },
    { flags: ['--machine', '4', '--dos', 'none'], tables: 'Model 4 service calls (LS-DOS 6)' },
  ];
  const given = (flags: string[]): string => (flags.length === 0 ? 'no flags' : flags.join(' '));

  it('names ROM and DOS addresses from the Model III and TRSDOS tables by default, and the header says so', async () => {
    const { code, text, err } = await list();
    expect(code).toBe(0);
    expect(err).toBe('');
    expect(headerOf(text)).toBe('; symbols: Model III ROM, hardware, TRSDOS 1.3');
    expect(text).toContain('5211  CD 49 00      CALL $KBWAIT');
    expect(text).toContain('5218  C3 2D 40      JP $JP2DOS');
    expect(text).not.toContain('CALL 0049H');
    expect(text).not.toContain('JP 402DH');
  });

  it('names Model I and LDOS addresses with --machine 1, where the DOS defaults to LDOS', async () => {
    const { code, text, err } = await list('--machine', '1');
    expect(code).toBe(0);
    expect(err).toBe('');
    expect(headerOf(text)).toBe('; symbols: Model I ROM, hardware, LDOS 5.1');
    expect(text).toContain('5218  C3 2D 40      JP @EXIT');
    expect(text).not.toContain('$JP2DOS');
  });

  it('switches the DOS names with --dos: JP $JP2DOS by default, JP @EXIT with --machine 1 --dos ldos', async () => {
    expect((await list()).text).toContain('JP $JP2DOS');
    const ldos = await list('--machine', '1', '--dos', 'ldos');
    expect(ldos.text).toContain('JP @EXIT');
    expect(ldos.text).not.toContain('$JP2DOS');
    // With no DOS there are no DOS names, and a Model III on LDOS takes none of TRSDOS's but keeps its ROM names.
    const none = await list('--machine', '1', '--dos', 'none');
    expect(none.text).not.toContain('@EXIT');
    expect(none.text).not.toContain('$JP2DOS');
    const model3 = await list('--dos', 'ldos');
    expect(model3.text).toContain('CALL $KBWAIT');
    expect(model3.text).not.toContain('$JP2DOS');
    const bare = await list('--dos', 'none');
    expect(bare.text).toContain('CALL $KBWAIT');
    expect(bare.text).not.toContain('$JP2DOS');
  });

  for (const { flags, tables } of CHOICES) {
    it(`uses ${tables} for ${given(flags)}, and the header says so`, async () => {
      const { code, text, err } = await list(...flags);
      expect(code).toBe(0);
      expect(err).toBe('');
      expect(headerOf(text)).toBe(`; symbols: ${tables}`);
    });
  }

  it('refuses a value or a pair that names no tables, with the valid values, exit 2, and nothing on stdout', async () => {
    const cases: [string[], string][] = [
      [['--machine', '2'], 'fugloy: --machine must be 1, 3, or 4\n'],
      [['--machine', '0'], 'fugloy: --machine must be 1, 3, or 4\n'],
      [['--machine', '03'], 'fugloy: --machine must be 1, 3, or 4\n'],
      [['--machine', 'III'], 'fugloy: --machine must be 1, 3, or 4\n'],
      [['--machine', ''], 'fugloy: --machine must be 1, 3, or 4\n'],
      [['--dos', 'msdos'], 'fugloy: --dos must be trsdos, ldos, or none\n'],
      [['--dos', 'TRSDOS'], 'fugloy: --dos must be trsdos, ldos, or none\n'],
      [['--dos', ''], 'fugloy: --dos must be trsdos, ldos, or none\n'],
      [['--machine', '1', '--dos', 'trsdos'], 'fugloy: --dos trsdos is the Model III DOS; use --machine 3 or --dos ldos\n'],
      [['--machine', '4', '--dos', 'ldos'], 'fugloy: --machine 4 names LS-DOS 6 service calls only; leave out --dos\n'],
      [['--machine', '4', '--dos', 'trsdos'], 'fugloy: --machine 4 names LS-DOS 6 service calls only; leave out --dos\n'],
    ];
    for (const [flags, message] of cases) {
      const { code, text, err } = await list(...flags);
      expect(code, flags.join(' ')).toBe(2);
      expect(err, flags.join(' ')).toBe(message);
      expect(text, flags.join(' ')).toBe('');
    }
  });

  it('reports a bad selection before it reads the file', async () => {
    const { io, out, err } = capture();
    expect(await run(['/nonexistent/x.cmd', '--machine', '2'], io)).toBe(2);
    expect(out).toEqual([]);
    expect(err.join('')).toBe('fugloy: --machine must be 1, 3, or 4\n');
  });

  it('names nothing in the --sweep listing, and puts no tables header in a plain BASIC listing', async () => {
    const sweep = await list('--sweep');
    expect(sweep.code).toBe(0);
    expect(sweep.text).not.toContain('; symbols:');
    expect(sweep.text).toContain('5211  CD 49 00      CALL 0049H');
    expect(sweep.text).toContain('5218  C3 2D 40      JP 402DH');
    const bas = capture();
    expect(await run([`${fixtures}bas/prog-62c8.bas`], bas.io)).toBe(0);
    expect(bas.out.join('')).not.toContain('; symbols:');
  });

  /** Runs the CLI on a tokenized BASIC program, saved from $42E9 as Level II does, with these flags. */
  async function listBasic(lines: BasicLineSpec[], ...flags: string[]): Promise<{ code: number; text: string; lines: string[] }> {
    const path = join(dir, 'prog.bas');
    await writeFile(path, writeBasic(lines, 0x42e9));
    const { io, out } = capture();
    const code = await run([path, ...flags], io);
    const text = out.join('');
    return { code, text, lines: text.split('\n') };
  }
  const noteLines = (lines: string[]): string[] => lines.filter((l) => /^; {3}\d/.test(l));
  const VIDEO_NOTE = /^; {3}15360 = \$3C00 .+ \(VIDEO\)$/;
  const KEYBOARD_NOTE = /^; {3}14400 = \$3840 .+ \(KEYBOARD\+64\)$/;

  it('notes the PEEK and POKE addresses a plain BASIC listing uses from the selected tables, under the line that uses them', async () => {
    const program: BasicLineSpec[] = [{ number: 10, text: 'POKE 15360,65' }, { number: 20, text: 'X=PEEK(14400)' }, { number: 30, text: 'PRINT 15360' }];
    for (const flags of [[], ['--machine', '3'], ['--machine', '1'], ['--dos', 'none']]) {
      const { code, lines } = await listBasic(program, ...flags);
      expect(code, flags.join(' ')).toBe(0);
      const at = lines.indexOf('10 POKE 15360,65');
      expect(lines[at + 1], flags.join(' ')).toMatch(VIDEO_NOTE);
      expect(lines[at + 2], flags.join(' ')).toBe('20 X=PEEK(14400)');
      expect(lines[at + 3], flags.join(' ')).toMatch(KEYBOARD_NOTE);
      expect(lines[at + 4], flags.join(' ')).toBe('30 PRINT 15360');
      expect(lines.some((l) => l.startsWith('; symbols:')), flags.join(' ')).toBe(false);
    }
  });

  it('notes the PEEK of a keyboard poll in an IF condition, the PEEK in a PRINT, and the PEEK in a FOR bound', async () => {
    const { lines } = await listBasic([
      { number: 10, text: 'IF PEEK(14400)=128 THEN 10' },
      { number: 20, text: 'PRINT PEEK(14401)' },
      { number: 30, text: 'FOR I=PEEK(15360) TO 10' },
    ]);
    expect(lines[lines.indexOf('10 IF PEEK(14400)=128 THEN 10') + 1]).toMatch(KEYBOARD_NOTE);
    expect(lines[lines.indexOf('20 PRINT PEEK(14401)') + 1]).toMatch(/^; {3}14401 = \$3841 .+ \(KEYBOARD\+65\)$/);
    expect(lines[lines.indexOf('30 FOR I=PEEK(15360) TO 10') + 1]).toMatch(VIDEO_NOTE);
  });

  it('tags the note of a ROM name that differs on the other machine, as an RST comment is, and not one both ROMs share', async () => {
    // PORTFFBITS (403DH) is in the Model I ROM table only; USRVEC and PRTPAGELEN are in both (data/symbols/COMPARISON.md).
    const program: BasicLineSpec[] = [{ number: 10, text: 'X=PEEK(16445)' }, { number: 20, text: 'X=PEEK(16526)' }, { number: 30, text: 'X=PEEK(16424)' }];
    const { lines } = await listBasic(program, '--machine', '1');
    expect(lines[lines.indexOf('10 X=PEEK(16445)') + 1]).toMatch(/^; {3}16445 = \$403D .+ \(PORTFFBITS\) \[Model I\]$/);
    expect(lines[lines.indexOf('20 X=PEEK(16526)') + 1]).toMatch(/^; {3}16526 = \$408E .+ \(USRVEC\)$/);
    expect(lines[lines.indexOf('30 X=PEEK(16424)') + 1]).toMatch(/^; {3}16424 = \$4028 .+ \(PRTPAGELEN\)$/);
    // The default machine names the USR vector too, and has nothing at 403DH, which the Model III uses otherwise.
    const byDefault = (await listBasic(program)).lines;
    expect(byDefault[byDefault.indexOf('10 X=PEEK(16445)') + 1]).toBe('20 X=PEEK(16526)');
    expect(byDefault[byDefault.indexOf('20 X=PEEK(16526)') + 1]).toMatch(/^; {3}16526 = \$408E .+ \(USRVEC\)$/);
  });

  it('notes nothing in a BASIC listing under --machine 4, which names service calls only, nor with --sweep', async () => {
    const program: BasicLineSpec[] = [{ number: 10, text: 'POKE 15360,65' }, { number: 20, text: 'X=PEEK(14400)' }];
    expect(noteLines((await listBasic(program, '--machine', '4')).lines)).toEqual([]);
    expect(noteLines((await listBasic(program, '--sweep')).lines)).toEqual([]);
  });

  it('puts the same notes in the pass 1 listing of a BASIC program with hidden code', async () => {
    const program: BasicLineSpec[] = [
      { number: 10, text: 'POKE 15360,65' },
      { number: 20, raw: [0xc3, 0x00, 0x00, 0xc9, 0x00, 0x3e] },
      { number: 30, text: 'X=PEEK(14400)' },
    ];
    const { code, lines } = await listBasic(program);
    expect(code).toBe(0);
    expect(lines).toContain('; symbols: Model III ROM, hardware, TRSDOS 1.3');
    const at = lines.indexOf('10 POKE 15360,65');
    expect(lines[at + 1]).toMatch(VIDEO_NOTE);
    expect(lines[at + 2]).toMatch(/^; line 20: machine code/);
    const later = lines.indexOf('30 X=PEEK(14400)');
    expect(lines[later + 1]).toMatch(KEYBOARD_NOTE);
    expect(noteLines(lines)).toHaveLength(2);
  });

  it('colors a note line whole, as a comment, without changing a character of the listing', async () => {
    const path = join(dir, 'colored.bas');
    await writeFile(path, writeBasic([{ number: 10, text: 'POKE 15360,65' }], 0x42e9));
    const plain = capture();
    expect(await run([path], plain.io)).toBe(0);
    const { io, out } = capture();
    io.stdoutIsTerminal = true;
    io.env = {};
    expect(await run([path, '--color'], io)).toBe(0);
    const colored = out.join('');
    // eslint-disable-next-line no-control-regex
    expect(colored.replace(/\x1b\[[0-9;]*m/g, '')).toBe(plain.out.join(''));
    const note = noteLines(plain.out.join('').split('\n'))[0]!;
    expect(colored).toContain(`\x1b[90m${note}\x1b[0m`);
  });

  it('names the same addresses in --format zmac and defines each name with an EQU', async () => {
    const { code, text } = await list('--format', 'zmac');
    expect(code).toBe(0);
    expect(text).toContain('$KBWAIT\tEQU\t0049H\t');
    expect(text).toContain('$JP2DOS\tEQU\t402DH\t');
    expect(text).toContain('\tCALL\t$KBWAIT');
    expect(text).toContain('\tJP\t$JP2DOS');
    const model1 = await list('--machine', '1', '--format', 'zmac');
    expect(model1.text).toContain('@EXIT\tEQU\t402DH\t');
    expect(model1.text).toContain('\tJP\t@EXIT');
    expect(model1.text).not.toContain('$JP2DOS');
  });

  it('colors a listing that carries table names without changing a character of it', async () => {
    const { io, out } = capture();
    io.stdoutIsTerminal = true;
    io.env = {};
    expect(await run([program, '--base', '5200', '--color'], io)).toBe(0);
    const colored = out.join('');
    expect(colored).toContain('\x1b[');
    // eslint-disable-next-line no-control-regex
    expect(colored.replace(/\x1b\[[0-9;]*m/g, '')).toBe((await list()).text);
  });

  it('records the machine, the DOS, and the table names used in --format ir', async () => {
    interface NamedIr {
      machine?: number;
      dos?: string;
      tableNames?: { name: string }[];
    }
    const names = (ir: NamedIr): string[] => (ir.tableNames ?? []).map((n) => n.name);
    const byDefault = JSON.parse((await list('--format', 'ir')).text) as NamedIr;
    expect([byDefault.machine, byDefault.dos]).toEqual([3, 'trsdos']);
    expect(names(byDefault)).toEqual(expect.arrayContaining(['$KBWAIT', '$JP2DOS']));
    const model1 = JSON.parse((await list('--machine', '1', '--format', 'ir')).text) as NamedIr;
    expect([model1.machine, model1.dos]).toEqual([1, 'ldos']);
    expect(names(model1)).toContain('@EXIT');
    expect(names(model1)).not.toContain('$JP2DOS');
    const bare = JSON.parse((await list('--dos', 'none', '--format', 'ir')).text) as NamedIr;
    expect([bare.machine, bare.dos]).toEqual([3, 'none']);
    expect(names(bare)).toContain('$KBWAIT');
    expect(names(bare)).not.toContain('$JP2DOS');
  });

  for (const { flags } of CHOICES) {
    skipIfNoZmac()(`reassembles --format zmac output into the same image for ${given(flags)}`, async () => {
      const { text } = await list('--format', 'zmac', ...flags);
      expectSameImage(assemble(text).module.image, loadRaw(ROUTINE, 0x5200).image);
    });
  }

  it('documents both flags in --help', async () => {
    const { io, out } = capture();
    expect(await run(['--help'], io)).toBe(0);
    const help = out.join('');
    expect(help).toContain('[--machine 1|3|4] [--dos trsdos|ldos|none]');
    expect(help).toContain(
      [
        '  --machine <n>    name ROM, hardware, and DOS addresses for Model 1, 3',
        '                   (the default), or 4 (LS-DOS 6 service calls only)',
        '  --dos <name>     the DOS whose names to use: trsdos (Model III default),',
        '                   ldos (Model I default), or none',
        '',
      ].join('\n'),
    );
  });
});
