/**
 * The 16-bit words a DW row writes (design spec §4.5): which of them are jump-table
 * entries, which are other typed words, and where a row must start, which the
 * listing, zmac, and Pass 2 all decide the same way.
 */
import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/pipeline.js';
import { dataWords, rowStarts } from '../../src/analysis/words.js';
import type { WordLayout } from '../../src/analysis/words.js';
import { emitZmac } from '../../src/emit/zmac.js';
import { emptyAnnotations } from '../../src/hints/apply.js';
import type { Annotations } from '../../src/hints/apply.js';
import { renderPass1Listing } from '../../src/listing.js';
import { loadRaw } from '../../src/raw.js';
import { selectSymbols } from '../../src/symbols/select.js';
import { entry, tablesOf } from '../symbols/helpers.js';

const BASE = 0x5200;
const ann = (partial: Partial<Annotations>): Annotations => ({ ...emptyAnnotations(), ...partial });

/** A raw program at $5200: `bytes` from the base, everything past them zero up to `size`. */
const program = (size: number, at: Record<number, number[]>): Uint8Array => {
  const bytes = new Uint8Array(size);
  for (const [offset, data] of Object.entries(at)) bytes.set(data, Number(offset));
  return bytes;
};

/** The words of an analyzed program, laid out the way Pass 2 lays them out. */
function wordsOf(bytes: Uint8Array, annotations: Annotations, skip?: (addr: number) => boolean) {
  const a = analyze(loadRaw(bytes, BASE), { annotations });
  const layout: WordLayout = {
    image: a.module.image,
    space: a.space,
    map: a.pass1.map,
    tables: a.annotations.tables,
    startsRow: rowStarts(a.symbols, a.annotations, a.pass1.instructions),
    skip: skip ?? (() => false),
  };
  return dataWords(layout);
}

describe('dataWords', () => {
  it('lists the entries of a declared table as jump words and other typed words as data words', () => {
    // RET, then a 2-entry table at $5210 and a 2-word region at $5218
    const bytes = program(0x20, { 0: [0xc9], 0x10: [0x49, 0x00, 0x2d, 0x40], 0x18: [0x00, 0x3c, 0x40, 0x3d] });
    const words = wordsOf(bytes, ann({ tables: [{ addr: 0x5210, count: 2, width: 2 }], overrides: [{ addr: 0x5218, kind: 'words', length: 4 }] }));
    expect(words).toEqual([
      { addr: 0x5210, value: 0x0049, jump: true },
      { addr: 0x5212, value: 0x402d, jump: true },
      { addr: 0x5218, value: 0x3c00, jump: false },
      { addr: 0x521a, value: 0x3d40, jump: false },
    ]);
  });

  it('lists nothing for bytes that are not typed as words', () => {
    const bytes = program(0x20, { 0: [0xcd, 0x49, 0x00, 0xc9], 0x10: [0x00, 0x3c, 0x40, 0x3d] });
    expect(wordsOf(bytes, emptyAnnotations())).toEqual([]);
    expect(wordsOf(bytes, ann({ overrides: [{ addr: 0x5210, kind: 'bytes', length: 4 }] }))).toEqual([]);
  });

  it('leaves an odd trailing byte out, as the emitters write it as DB', () => {
    const bytes = program(0x20, { 0: [0xc9], 0x10: [0x00, 0x3c, 0x40] });
    expect(wordsOf(bytes, ann({ overrides: [{ addr: 0x5210, kind: 'words', length: 3 }] }))).toEqual([{ addr: 0x5210, value: 0x3c00, jump: false }]);
  });

  it('starts pairing again after a symbol, so a label inside a word breaks that word and nothing else', () => {
    // A name at $5211 (the high byte of the first word) cuts the region: $5210 is a lone byte, then $5211-$5214 are two words
    const bytes = program(0x20, { 0: [0xc9], 0x10: [0x00, 0x3c, 0x40, 0x3d, 0x49] });
    const words = wordsOf(bytes, ann({ overrides: [{ addr: 0x5210, kind: 'words', length: 5 }], names: new Map([[0x5211, 'MIDDLE']]) }));
    expect(words).toEqual([
      { addr: 0x5211, value: 0x403c, jump: false },
      { addr: 0x5213, value: 0x493d, jump: false },
    ]);
  });

  it('starts pairing again after a hint comment', () => {
    const bytes = program(0x20, { 0: [0xc9], 0x10: [0x00, 0x3c, 0x40, 0x3d] });
    // $5210 is a lone byte, $5211-$5212 a word, and $5213 a lone byte again
    const words = wordsOf(bytes, ann({ overrides: [{ addr: 0x5210, kind: 'words', length: 4 }], comments: new Map([[0x5211, 'inside the word']]) }));
    expect(words).toEqual([{ addr: 0x5211, value: 0x403c, jump: false }]);
  });

  it('starts a new segment at each typed region, so two adjacent regions never pair across their border', () => {
    const bytes = program(0x20, { 0: [0xc9], 0x10: [0x11, 0x22, 0x33, 0x44, 0x55] });
    const words = wordsOf(
      bytes,
      ann({ overrides: [{ addr: 0x5210, kind: 'words', length: 3 }, { addr: 0x5213, kind: 'words', length: 2 }] }),
    );
    expect(words).toEqual([
      { addr: 0x5210, value: 0x2211, jump: false },
      { addr: 0x5213, value: 0x5544, jump: false },
    ]);
  });

  it('does not take a word of a declared table that is not one of its entries as a data word', () => {
    // A name at $5211 shifts the pairing by one byte: the pairs at $5211 and $5213 lie inside the table but are not entries
    const bytes = program(0x20, { 0: [0xc9], 0x10: [0x49, 0x00, 0x2d, 0x40, 0x00, 0x3c] });
    const names = new Map([[0x5211, 'MIDDLE']]);
    expect(wordsOf(bytes, ann({ tables: [{ addr: 0x5210, count: 3, width: 2 }], names }))).toEqual([]);
    // A name at an entry boundary changes nothing
    const aligned = ann({ tables: [{ addr: 0x5210, count: 3, width: 2 }], names: new Map([[0x5212, 'SECOND']]) });
    expect(wordsOf(bytes, aligned).map((w) => [w.addr, w.jump])).toEqual([[0x5210, true], [0x5212, true], [0x5214, true]]);
  });

  it('skips the words the caller says are not data, such as a .BAS program\'s line headers', () => {
    const bytes = program(0x20, { 0: [0xc9], 0x10: [0x00, 0x3c, 0x40, 0x3d] });
    const words = wordsOf(bytes, ann({ overrides: [{ addr: 0x5210, kind: 'words', length: 4 }] }), (addr) => addr === 0x5210);
    expect(words).toEqual([{ addr: 0x5212, value: 0x3d40, jump: false }]);
  });

  it('walks a relocated piece at its runtime address, reading the bytes the program runs on', () => {
    // 4 bytes at file $5210 run at $6000; a words hint inside them is in runtime terms
    const bytes = program(0x20, { 0: [0xc9], 0x10: [0x00, 0x3c, 0x40, 0x3d] });
    const annotations = ann({ relocations: [{ fileAddr: 0x5210, length: 4, runAddr: 0x6000 }], overrides: [{ addr: 0x6000, kind: 'words', length: 4 }] });
    expect(wordsOf(bytes, annotations)).toEqual([
      { addr: 0x6000, value: 0x3c00, jump: false },
      { addr: 0x6002, value: 0x3d40, jump: false },
    ]);
  });
});

describe('rowStarts', () => {
  it('is true at a symbol, a hint comment, an instruction, and the start of a typed region, and nowhere else', () => {
    const bytes = program(0x20, { 0: [0xcd, 0x10, 0x52, 0xc9], 0x10: [0xc9, 0x01, 0x02, 0x03] });
    const annotations = ann({ comments: new Map([[0x5212, 'note']]), overrides: [{ addr: 0x5218, kind: 'words', length: 2 }] });
    const a = analyze(loadRaw(bytes, BASE), { annotations });
    const starts = rowStarts(a.symbols, a.annotations, a.pass1.instructions);
    expect(a.symbols.has(0x5210)).toBe(true); // the call target
    for (const addr of [0x5200, 0x5203, 0x5210, 0x5212, 0x5218]) expect(starts(addr), addr.toString(16)).toBe(true);
    for (const addr of [0x5201, 0x5202, 0x5211, 0x5213, 0x5219]) expect(starts(addr), addr.toString(16)).toBe(false);
  });

  it('works without a symbol table', () => {
    const a = analyze(loadRaw(program(0x10, { 0: [0xc9] }), BASE));
    const starts = rowStarts(undefined, emptyAnnotations(), a.pass1.instructions);
    expect(starts(0x5200)).toBe(true);
    expect(starts(0x5201)).toBe(false);
  });
});

describe('dataWords and the emitters', () => {
  /** A deterministic generator, so a failing layout can be replayed from its number. */
  const random = (seed: number): (() => number) => {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const SCREEN = entry('hardware-model3', 'region', 0x3000, 'SCREEN', { length: 0x1000, coined: true });
  const tables = selectSymbols({ machine: 3, dos: 'none' }, tablesOf({ 'hardware-model3': [SCREEN] }), {});

  /** The items of every DW row in a listing and in zmac source. */
  const listingItems = (text: string): string[] =>
    text.split('\n').flatMap((l) => {
      const m = /^[0-9A-F]{4} {2}.{12} {2}DW (.*?) *(?:; .*)?$/.exec(l);
      return m === null ? [] : m[1]!.split(',');
    });
  const zmacItems = (text: string): string[] =>
    text.split('\n').flatMap((l) => {
      const m = /^\tDW\t(.*?)(?:\t;.*)?$/.exec(l);
      return m === null ? [] : m[1]!.split(',');
    });

  it('names exactly the words the emitters write, whichever way labels and comments cut the rows (300 random layouts)', () => {
    let named = 0;
    for (let n = 0; n < 300; n++) {
      const next = random(n);
      const below = (k: number): number => Math.floor(next() * k);
      // RET at $5200, then 80 bytes of data whose every pairing falls inside SCREEN ($3000-$3FFF), so each word the emitters write can be named
      const bytes = new Uint8Array(0x60);
      bytes[0] = 0xc9;
      for (let i = 0x10; i < 0x60; i++) bytes[i] = 0x30 + below(0x10);
      const overrides: Annotations['overrides'] = [];
      for (let at = 0x10; at < 0x58; ) {
        const length = 1 + below(24);
        if (below(3) > 0) overrides.push({ addr: BASE + at, kind: 'words', length: Math.min(length, 0x60 - at) });
        at += length + below(4);
      }
      const names = new Map<number, string>();
      for (let i = below(5); i > 0; i--) names.set(BASE + 0x10 + below(0x48), `N${i}X${n}`);
      const comments = new Map<number, string>();
      for (let i = below(4); i > 0; i--) comments.set(BASE + 0x10 + below(0x48), `note ${i}`);

      const a = analyze(loadRaw(bytes, BASE), { tables, annotations: { ...emptyAnnotations(), overrides, names, comments } });
      const expected = a.externals.namedWords().map((w) => w.name.text).sort();
      const shown = (items: string[]): string[] => items.filter((item) => item.startsWith('SCREEN')).sort();
      const listing = listingItems(renderPass1Listing(a));
      const zmac = zmacItems(emitZmac(a.module.image, a.pass1, a.transfer, { symbols: a.symbols, annotations: a.annotations, space: a.space, externals: a.externals, tablesUsed: a.tablesUsed }));
      expect(shown(listing), `layout ${n}`).toEqual(expected);
      expect(shown(zmac), `layout ${n}`).toEqual(expected);
      // no word in the screen is left a number: every pairing the emitters made was one the analysis found
      for (const item of [...listing, ...zmac]) {
        if (/^[0-9A-F]+H$/.test(item)) {
          const value = parseInt(item, 16);
          expect(value < 0x3000 || value >= 0x4000, `layout ${n}: ${item}`).toBe(true);
        }
      }
      named += expected.length;
    }
    expect(named).toBeGreaterThan(300); // the layouts do exercise the naming
  });
});
