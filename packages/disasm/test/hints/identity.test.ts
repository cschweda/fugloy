import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/hash.js';
import { loadBas } from '../../src/bas.js';
import { rebaseBas } from '../../src/bas-rebase.js';
import { loadCmd } from '../../src/cmd.js';
import { applyHints } from '../../src/hints/apply.js';
import { parseHints, writeHints } from '../../src/hints/format.js';
import { basIdentityNormalizer, blockIdentities, IDENTITY_BYTES, programHash } from '../../src/hints/identity.js';
import { BAS_FIXTURES, pattern } from '../fixtures.js';
import { image } from '../images.js';
import { readSample, resolveSample } from '../real/samples.js';

describe('blockIdentities', () => {
  it('identifies each run by index, start, length, and 16 hex digits of the hash of its first 64 bytes', () => {
    const img = image({ 0x6000: pattern(100), 0x7000: [1, 2, 3] });
    const ids = blockIdentities(img);
    expect(IDENTITY_BYTES).toBe(64);
    expect(ids.map((b) => [b.index, b.start, b.length, b.hash.length])).toEqual([[0, 0x6000, 100, 16], [1, 0x7000, 3, 16]]);
    expect(ids[0]!.hash).toBe(sha256Hex(Uint8Array.from(pattern(64))).slice(0, 16));
    expect(ids[1]!.hash).toBe(sha256Hex(Uint8Array.from([1, 2, 3])).slice(0, 16));
  });

  it('does not depend on where a run was loaded', () => {
    const a = blockIdentities(image({ 0x6000: pattern(200) }))[0]!;
    const b = blockIdentities(image({ 0x9000: pattern(200) }))[0]!;
    expect([b.length, b.hash]).toEqual([a.length, a.hash]);
    expect(b.start).not.toBe(a.start);
  });

  it('hashes the whole file for the program identity', () => {
    const bytes = Uint8Array.from(pattern(300));
    expect(programHash(bytes)).toBe(sha256Hex(bytes));
  });

  const present = (files: string[]) => files.every((f) => resolveSample(f) !== null);
  it.skipIf(!present(['asylum1b.cmd', 'asylum1c.cmd', 'asylum1d.cmd']))('gives the relocated asylum1b/1c/1d builds one identity for their main run', () => {
    const ids = ['asylum1b.cmd', 'asylum1c.cmd', 'asylum1d.cmd'].map((f) => blockIdentities(loadCmd(readSample(f)).image)[0]!);
    expect(new Set(ids.map((b) => `${b.length}:${b.hash}`)).size).toBe(1);
    expect(new Set(ids.map((b) => b.start)).size).toBe(3);
  });
  it.skipIf(!present(['asylum1e.cmd', 'asylum32.cmd', 'asylumd.bad']))('matches asylum1e, asylum32, and asylumd.bad on their shared main run', () => {
    const main = (f: string) => blockIdentities(loadCmd(readSample(f)).image).find((b) => b.length > 1000)!;
    const ids = ['asylum1e.cmd', 'asylum32.cmd', 'asylumd.bad'].map(main);
    expect(new Set(ids.map((b) => `${b.length}:${b.hash}`)).size).toBe(1);
  });
});

describe('.BAS identity', () => {
  it('is the same from any base once each line pointer is read as an offset from the base', () => {
    const a = loadBas(BAS_FIXTURES['prog-62c8']!());
    const b = loadBas(BAS_FIXTURES['prog-7000']!());
    const [ia] = blockIdentities(a.image, basIdentityNormalizer(a));
    const [ib] = blockIdentities(b.image, basIdentityNormalizer(b));
    expect([ia!.length, ia!.hash]).toEqual([ib!.length, ib!.hash]);
    expect(blockIdentities(a.image)[0]!.hash).not.toBe(blockIdentities(b.image)[0]!.hash);
  });

  it('lets hints written for a program apply to it rebased, with no block unmatched', () => {
    const a = loadBas(BAS_FIXTURES['prog-62c8']!());
    const blocks = blockIdentities(a.image, basIdentityNormalizer(a)).map(({ index, length, hash }) => ({ index, length, hash }));
    const { file, errors } = parseHints(`${writeHints({ version: 1, blocks, hints: [] })}block 0:$0004 comment the title line\n`);
    expect(errors).toEqual([]);
    const b = loadBas(rebaseBas(BAS_FIXTURES['prog-62c8']!(), 0x7000));
    const applied = applyHints(file, b.image, undefined, basIdentityNormalizer(b));
    expect(applied.unmatched).toEqual([]);
    expect(applied.annotations.comments.get(0x7004)).toBe('the title line');
  });
});
