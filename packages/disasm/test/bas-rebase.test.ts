import { describe, expect, it } from 'vitest';
import { loadBas } from '../src/bas.js';
import { rebaseBas } from '../src/bas-rebase.js';
import { renderPass1Listing } from '../src/listing.js';
import { analyze } from '../src/pipeline.js';
import { BAS_FIXTURES } from './fixtures.js';

describe('rebaseBas', () => {
  it('rewrites only the pointer chain: the program saved from $62C8 becomes the one saved from $7000, byte for byte', () => {
    expect(Array.from(rebaseBas(BAS_FIXTURES['prog-62c8']!(), 0x7000))).toEqual(Array.from(BAS_FIXTURES['prog-7000']!()));
  });

  it('keeps the lines, the header byte or its absence, and the trailing bytes', () => {
    const p = loadBas(rebaseBas(BAS_FIXTURES['trailing-bytes']!(), 0x8000));
    expect([p.base, p.header, p.trailing]).toEqual([0x8000, true, 3]);
    expect(p.lines.map((l) => l.text)).toEqual(['CLS', 'END']);
    const bare = loadBas(rebaseBas(BAS_FIXTURES['no-header']!(), 0x7000));
    expect([bare.base, bare.header]).toEqual([0x7000, false]);
  });

  it('refuses a file that is not tokenized BASIC, and a base the program would not fit above', () => {
    expect(() => rebaseBas(Uint8Array.from([1, 2, 3]), 0x7000)).toThrow(/not a tokenized BASIC program/);
    expect(() => rebaseBas(BAS_FIXTURES['prog-62c8']!(), 0xfff0)).toThrow(/does not fit/);
  });
});

describe('a rebased analysis', () => {
  it('names the original base in the header and marks operands that still point into the old program', () => {
    const rebased = loadBas(rebaseBas(BAS_FIXTURES['hidden-code-ref']!(), 0x8000));
    const text = renderPass1Listing(analyze(rebased, { rebasedFrom: 0x7000 }));
    expect(text).toContain('\n; rebased from $7000 to $8000\n');
    const row = '800D  21 0D 70      LD HL,700DH';
    expect(text).toContain(`\n${row.padEnd(44)}; entry; stale: original base $7000\n`);
    expect(renderPass1Listing(analyze(loadBas(BAS_FIXTURES['hidden-code-ref']!())))).not.toContain('stale');
  });
});
