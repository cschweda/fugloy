import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadBas } from '../../src/bas.js';
import { loadCmd } from '../../src/cmd.js';
import { writeBasicCas, writeSystemCas } from '../../src/write/cas.js';
import { BAS_FIXTURES } from '../fixtures.js';
import { readCas } from '../writers/cas-reader.js';

const root = fileURLToPath(new URL('../../../../examples/', import.meta.url));
const programs = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => readdirSync(`${root}${d.name}`).filter((f) => !/\.(md|hints)$/i.test(f)).map((f) => `${d.name}/${f}`));

describe('writeSystemCas', () => {
  it.each(programs)('decodes %s back to the same loaded bytes and entry, checksums right', (rel) => {
    const mod = loadCmd(new Uint8Array(readFileSync(`${root}${rel}`)));
    const cas = readCas(writeSystemCas(mod.image, { entry: mod.entry ?? 0, name: 'Prog' }));
    if (cas.kind !== 'system') throw new Error('kind');
    expect(cas.name).toBe('PROG  ');
    expect(cas.entry).toBe(mod.entry ?? 0);
    expect(cas.checksumErrors).toBe(0);
    const bytes = new Uint8Array(65536);
    const loaded = new Uint8Array(65536);
    for (const b of cas.blocks) {
      expect(b.data.length).toBeLessThanOrEqual(256);
      bytes.set(b.data, b.addr);
      loaded.fill(1, b.addr, b.addr + b.data.length);
    }
    expect(loaded).toEqual(mod.image.loaded);
    expect(bytes).toEqual(mod.image.bytes);
  });

  it('starts with a 256-byte leader and A5 55, and writes length 00 for a 256-byte block', () => {
    const mod = loadCmd(new Uint8Array(readFileSync(`${root}${programs[0]}`)));
    const out = writeSystemCas(mod.image, { entry: 0x7000, name: 'ABCDEFGHI' });
    expect(Array.from(out.subarray(0, 256)).every((b) => b === 0)).toBe(true);
    expect(Array.from(out.subarray(256, 264))).toEqual([0xa5, 0x55, 65, 66, 67, 68, 69, 70]);
    expect(Array.from(out.subarray(-3))).toEqual([0x78, 0x00, 0x70]);
  });
});

describe('writeBasicCas', () => {
  it('decodes back to the same line numbers and bodies, rebased to $42E9', () => {
    const bytes = BAS_FIXTURES['prog-62c8']!();
    const prog = loadBas(bytes);
    const cas = readCas(writeBasicCas(bytes, 'hello'));
    if (cas.kind !== 'basic') throw new Error('kind');
    expect(cas.name).toBe('H');
    expect(cas.endsClean).toBe(true);
    expect(cas.lines.map((l) => l.number)).toEqual(prog.lines.map((l) => l.number));
    expect(cas.lines.map((l) => Array.from(l.body))).toEqual(prog.lines.map((l) => Array.from(l.body.subarray(0, -1))));
  });

  it('drops a leading FF header byte and trailing bytes', () => {
    const cas = writeBasicCas(BAS_FIXTURES['trailing-bytes']!(), 'T');
    expect(Array.from(cas.subarray(256, 261))).toEqual([0xa5, 0xd3, 0xd3, 0xd3, 0x54]);
    expect(readCas(cas).kind).toBe('basic');
  });
});
