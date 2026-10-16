import { describe, expect, it } from 'vitest';
import { applyHints, emptyAnnotations } from '../../src/hints/apply.js';
import type { HintFile } from '../../src/hints/format.js';
import { blockIdentities } from '../../src/hints/identity.js';
import type { MemoryImage } from '../../src/memory.js';
import { loadCmd } from '../../src/cmd.js';
import { CMD_FIXTURES, HINT_FIXTURES, pattern } from '../fixtures.js';
import { image } from '../images.js';

/** A hint file whose block lines come from `source` (as --write-hints would produce) plus the given hints. */
const fileFor = (source: MemoryImage, hints: HintFile['hints'], program?: string): HintFile => ({
  version: 1,
  ...(program === undefined ? {} : { program }),
  blocks: blockIdentities(source).map((b) => ({ index: b.index, length: b.length, hash: b.hash, start: b.start })),
  hints,
});
const h = (block: number, offset: number, directive: HintFile['hints'][number]['directive'], extra: object = {}) =>
  ({ block, offset, directive, line: 0, ...extra }) as HintFile['hints'][number];

describe('applyHints', () => {
  it('matches a block by length and hash wherever the run was loaded, and addresses hints from the matched run', () => {
    const written = image({ 0x6000: pattern(100) });
    const file = fileFor(written, [h(0, 5, 'name', { name: 'FIVE' }), h(0, 0, 'entry')]);
    const applied = applyHints(file, image({ 0x7000: pattern(100) }));
    expect(applied.matched.map((m) => [m.block.index, m.run.start])).toEqual([[0, 0x7000]]);
    expect(applied.unmatched).toEqual([]);
    expect(applied.annotations.names.get(0x7005)).toBe('FIVE');
    expect(applied.annotations.entries).toEqual([0x7000]);
    expect(applied.warnings).toEqual([]);
  });

  it('breaks ties between identical runs by index order', () => {
    const img = image({ 0x6000: pattern(50), 0x7000: pattern(50) });
    const file = fileFor(img, [h(0, 0, 'name', { name: 'FIRST' }), h(1, 0, 'name', { name: 'SECOND' })]);
    const applied = applyHints(file, img);
    expect(applied.annotations.names.get(0x6000)).toBe('FIRST');
    expect(applied.annotations.names.get(0x7000)).toBe('SECOND');
  });

  it('reports an unmatched block with its hint count and skips its hints', () => {
    const img = image({ 0x6000: pattern(100) });
    const file = fileFor(img, [h(0, 1, 'entry'), h(1, 0, 'entry'), h(1, 1, 'nocode')]);
    file.blocks.push({ index: 1, length: 2, hash: '0000000000000000' });
    const applied = applyHints(file, img);
    expect(applied.unmatched).toEqual([{ block: { index: 1, length: 2, hash: '0000000000000000' }, hints: 2 }]);
    expect(applied.warnings).toEqual(['hint block 1 (length $0002, hash 0000000000000000) has no matching run; 2 hints skipped']);
    expect(applied.annotations.entries).toEqual([0x6001]);
    expect(applied.annotations.overrides).toEqual([]);
  });

  it('warns on a program hash mismatch but still applies matching blocks', () => {
    const img = image({ 0x6000: pattern(100) });
    const applied = applyHints(fileFor(img, [h(0, 0, 'entry')], 'a'.repeat(64)), img, 'b'.repeat(64));
    expect(applied.warnings).toEqual(["program hash differs from the hint file's; the hints were written for another file, so blocks are matched by content"]);
    expect(applied.annotations.entries).toEqual([0x6000]);
    expect(applyHints(fileFor(img, [], 'a'.repeat(64)), img, 'a'.repeat(64)).warnings).toEqual([]);
    expect(applyHints(fileFor(img, []), img, 'a'.repeat(64)).warnings).toEqual([]);
  });

  it('turns directives into overrides, tables, names, and comments at absolute addresses', () => {
    const img = image({ 0x6000: pattern(100) });
    const applied = applyHints(fileFor(img, [
      h(0, 0x10, 'bytes', { length: 4 }), h(0, 0x20, 'words', { length: 6 }), h(0, 0x30, 'code'), h(0, 0x40, 'code', { length: 8 }),
      h(0, 0x50, 'nocode'), h(0, 0x08, 'table', { count: 3, width: 2 }), h(0, 0x30, 'comment', { text: 'hello' }),
    ]), img);
    expect(applied.annotations.overrides).toEqual([
      { addr: 0x6010, kind: 'bytes', length: 4 }, { addr: 0x6020, kind: 'words', length: 6 },
      { addr: 0x6030, kind: 'code', length: 0 }, { addr: 0x6040, kind: 'code', length: 8 }, { addr: 0x6050, kind: 'nocode', length: 1 },
    ]);
    expect(applied.annotations.tables).toEqual([{ addr: 0x6008, count: 3, width: 2 }]);
    expect(applied.annotations.comments.get(0x6030)).toBe('hello');
  });

  it('resolves a string without a length through its terminator, and clips lengths to the run', () => {
    const img = image({ 0x6000: [0x48, 0x49, 0x0d, 0x41, 0x00, 0x42, 0x43] });
    const applied = applyHints(fileFor(img, [h(0, 0, 'string'), h(0, 3, 'string'), h(0, 5, 'string'), h(0, 5, 'bytes', { length: 10 })]), img);
    expect(applied.annotations.overrides).toEqual([
      { addr: 0x6000, kind: 'string', length: 3 },   // 'HI' + 0DH
      { addr: 0x6003, kind: 'string', length: 2 },   // 'A' + 00H
      { addr: 0x6005, kind: 'string', length: 2 },   // no terminator: to the run end
      { addr: 0x6005, kind: 'bytes', length: 2 },    // clipped
    ]);
    expect(applied.warnings).toEqual(['bytes at 0:$0005 runs past the end of the run; clipped to $0002 bytes']);
  });

  it('clips a table to its run with a warning instead of retyping the next run', () => {
    const img = image({ 0x6000: pattern(8), 0x6010: [0x3e, 0x01, 0xc9, 0x00] });
    const applied = applyHints(fileFor(img, [h(0, 4, 'table', { count: 8, width: 2 })]), img);
    expect(applied.annotations.tables).toEqual([{ addr: 0x6004, count: 2, width: 2 }]);
    expect(applied.warnings).toEqual(['table at 0:$0004 runs past the end of the run; clipped to 2 entries']);
  });

  it('starts from empty annotations', () => {
    expect(emptyAnnotations()).toEqual({ entries: [], overrides: [], tables: [], names: new Map(), comments: new Map(), relocations: [] });
  });
});

describe('relocate hints', () => {
  it('apply first, so every other hint is read at its runtime address', () => {
    const mod = loadCmd(CMD_FIXTURES['relocated-code']!());
    const applied = applyHints(HINT_FIXTURES['relocated-code']!(), mod.image);
    expect(applied.errors).toEqual([]);
    expect(applied.annotations.relocations).toEqual([{ fileAddr: 0x8000, length: 0x0b, runAddr: 0x5000 }]);
    expect(applied.annotations.names.get(0x5008)).toBe('SETONE');
    expect(applied.annotations.comments.get(0x5003)).toBe('skip the padding');
  });

  it('report a relocation that cannot apply as an error and drop it', () => {
    const mod = loadCmd(CMD_FIXTURES['relocated-code']!());
    const file = HINT_FIXTURES['relocated-code']!();
    file.hints = [{ block: 0, offset: 0, line: 0, directive: 'relocate', addr: 0x8105, length: 0x0b }];
    const applied = applyHints(file, mod.image);
    expect(applied.errors).toEqual(['relocate at $8000: the destination $8105-$810F overlaps loaded memory at $8105']);
    expect(applied.annotations.relocations).toEqual([]);
  });
});
