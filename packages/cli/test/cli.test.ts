import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../src/index.js';
import type { Io } from '../src/index.js';

const fixtures = fileURLToPath(new URL('../../../fixtures/synthetic/', import.meta.url));

function capture(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    stdout: (s) => { out.push(s); },
    stderr: (s) => { err.push(s); },
    readFile: async (path) => new Uint8Array(await readFile(path)),
  };
  return { io, out, err };
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
    expect(help.out.join('')).toContain('Usage: fugloy <file> [--base <hex>]');
    const none = capture();
    expect(await run([], none.io)).toBe(2);
    expect(none.err.join('')).toContain('Usage: fugloy');
    const unknown = capture();
    expect(await run(['--frobnicate', 'x'], unknown.io)).toBe(2);
    expect(unknown.err.join('')).toContain('frobnicate');
  });
});
