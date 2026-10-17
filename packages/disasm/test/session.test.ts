import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../cli/src/index.js';
import type { Io } from '../../cli/src/index.js';
import { programHash } from '../src/hints/identity.js';
import { addressKey, openProgram, OpenError, renderSession, withHintText, withSelection } from '../src/session.js';

const dir = fileURLToPath(new URL('../../../examples/sea-dragon/', import.meta.url));
const cmdPath = `${dir}seadrg01.cmd`;
const hintsPath = `${dir}seadrg01.hints`;
const bytes = new Uint8Array(readFileSync(cmdPath));
const hintText = readFileSync(hintsPath, 'utf8');

async function cli(args: string[]): Promise<string> {
  let out = '';
  const io: Io = {
    stdout: (s) => { out += s; },
    stderr: (s) => { throw new Error(s); },
    readFile: async (p) => new Uint8Array(readFileSync(p)),
    writeFile: async () => {},
    fileExists: async () => false,
  };
  expect(await run(args, io)).toBe(0);
  return out;
}

const selection = { machine: 3, dos: 'trsdos' } as const;
const open = () => openProgram(bytes, { name: 'seadrg01.cmd', selection });

describe('session', () => {
  it('opens a .CMD with no hints and the program hash', () => {
    const s = openProgram(bytes);
    expect(s.module.format).toBe('cmd');
    expect(s.hintFile.hints.length).toBe(0);
    expect(s.hash).toBe(programHash(bytes));
  });

  it('renders the listing the CLI prints', async () => {
    expect(renderSession(open(), 'listing')).toBe(await cli([cmdPath]));
  });

  it('renders the CLI listing with the hint file applied, header line included', async () => {
    const s = withHintText(open(), hintText, 'seadrg01.hints');
    expect(renderSession(s, 'listing')).toBe(await cli([cmdPath, '--hints', hintsPath]));
    expect(renderSession(s, 'zmac')).toBe(await cli([cmdPath, '--hints', hintsPath, '--format', 'zmac']));
  });

  it('names as --machine 1 does', async () => {
    const s = withSelection(open(), { machine: 1, dos: 'ldos' });
    expect(renderSession(s, 'listing')).toBe(await cli([cmdPath, '--machine', '1']));
  });

  it('maps a relocated runtime address to its hint key', () => {
    const s = withHintText(open(), hintText, 'seadrg01.hints');
    expect(addressKey(s, 0x497f)).toEqual({ block: 0, offset: 0 });
    expect(addressKey(s, 0x0001)).toBeNull();
  });

  it('throws a format error for bytes that are neither .CMD nor .BAS', () => {
    expect(() => openProgram(new Uint8Array([0xde, 0xad]))).toThrow(OpenError);
    try {
      openProgram(new Uint8Array([0xde, 0xad]));
    } catch (e) {
      expect((e as OpenError).kind).toBe('format');
    }
  });

  it('throws a hints error for text that is not a hint file', () => {
    try {
      withHintText(open(), 'nonsense');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(OpenError);
      expect((e as OpenError).kind).toBe('hints');
      expect((e as OpenError).details[0]).toMatch(/^line \d+: /);
    }
  });
});
