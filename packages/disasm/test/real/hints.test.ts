/** Hints survive relocation: a file written against one Asylum build applies unchanged to the others. */
import { expect, it } from 'vitest';
import { loadCmd } from '../../src/cmd.js';
import { emitZmac } from '../../src/emit/zmac.js';
import { applyHints } from '../../src/hints/apply.js';
import { parseHints, writeHints } from '../../src/hints/format.js';
import type { HintFile } from '../../src/hints/format.js';
import { blockIdentities, programHash } from '../../src/hints/identity.js';
import { analyze } from '../../src/pipeline.js';
import { assemble, expectSameImage, findZmac } from '../roundtrip/zmac.js';
import { readSample, resolveSample } from './samples.js';

const BUILDS = ['asylum1b.cmd', 'asylum1c.cmd', 'asylum1d.cmd'];
const present = BUILDS.every((f) => resolveSample(f) !== null);

it.skipIf(!present)('hints written against asylum1b apply unchanged to asylum1c and asylum1d', () => {
  const source = readSample('asylum1b.cmd');
  const b = loadCmd(source);
  const ids = blockIdentities(b.image);
  const base = ids[0]!.start;
  const entryOffset = b.entry! - base;
  const file: HintFile = {
    version: 1,
    program: programHash(source),
    blocks: ids.map((x) => ({ index: x.index, length: x.length, hash: x.hash, start: x.start })),
    hints: [
      { block: 0, offset: entryOffset, directive: 'name', name: 'MAIN_ENTRY', line: 0 },
      { block: 0, offset: entryOffset, directive: 'comment', text: 'the transfer address', line: 0 },
      { block: 0, offset: 0x100, directive: 'bytes', length: 16, line: 0 },
    ],
  };
  const text = writeHints(file);
  const parsed = parseHints(text);
  expect(parsed.errors).toEqual([]);

  for (const f of BUILDS) {
    const bytes = readSample(f);
    const mod = loadCmd(bytes);
    const applied = applyHints(parsed.file, mod.image, programHash(bytes));
    expect(applied.unmatched, f).toEqual([]);
    expect(applied.warnings.length, f).toBe(f === 'asylum1b.cmd' ? 0 : 1); // only the program hash differs
    const start = mod.image.runs()[0]!.start;
    expect(applied.annotations.names.get(start + entryOffset), f).toBe('MAIN_ENTRY');
    expect(applied.annotations.overrides, f).toEqual([{ addr: start + 0x100, kind: 'bytes', length: 16 }]);
    const a = analyze(mod, { annotations: applied.annotations });
    expect(a.symbols.get(mod.entry!), f).toMatchObject({ name: 'MAIN_ENTRY', source: 'user' });
    if (findZmac() !== null) {
      const { module: back } = assemble(emitZmac(mod.image, a.pass1, a.transfer, { source: f, symbols: a.symbols, annotations: a.annotations }));
      expectSameImage(back.image, mod.image);
      expect(back.entry, f).toBe(mod.entry);
    }
  }
});

it.skipIf(resolveSample('asylum16.cmd') === null)('the committed asylum16 hint file names its self-relocating loader, carries analysis on into the game, and still round-trips', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const text = readFileSync(fileURLToPath(new URL('../../../../fixtures/hints/asylum16.hints', import.meta.url)), 'utf8');
  const parsed = parseHints(text);
  expect(parsed.errors).toEqual([]);
  const bytes = readSample('asylum16.cmd');
  const mod = loadCmd(bytes);
  const applied = applyHints(parsed.file, mod.image, programHash(bytes));
  expect(applied.unmatched).toEqual([]);
  expect(applied.warnings).toEqual([]);
  const a = analyze(mod, { annotations: applied.annotations });
  // The loader's own path still ends at its JP (HL); the relocate lines carry analysis on into the game.
  expect(a.pass1.indirectJumps).toContain(0x805e);
  expect(a.symbols.get(0x8000)).toMatchObject({ name: 'LOADER', source: 'user' });
  expect(a.symbols.get(0x8072)).toMatchObject({ name: 'CLS_HOME', kind: 'sub', source: 'user' });
  expect(a.symbols.get(0x80dd)).toMatchObject({ name: 'PAYLOAD_STREAM', kind: 'data', source: 'user' });
  expect(a.pass1.instructions.size).toBeGreaterThan(71); // 71 before the relocate lines: the loader alone
  // The stream really does end with an `x` record naming $43AE.
  const run = mod.image.runs().find((r) => r.start === 0x8000)!;
  let p = 0x80dd;
  let target: number | null = null;
  while (p <= run.end) {
    const tag = mod.image.bytes[p]!;
    if (tag === 0x78) { target = mod.image.bytes[p + 1]! | (mod.image.bytes[p + 2]! << 8); break; }
    if (tag !== 0x3c) break;
    p += 4 + mod.image.bytes[p + 1]!;
  }
  expect(target).toBe(0x43ae);
  expect(mod.image.isLoaded(0x43ae)).toBe(false);
  if (findZmac() !== null) {
    const { module: back } = assemble(emitZmac(mod.image, a.pass1, a.transfer, { source: 'asylum16.cmd', symbols: a.symbols, annotations: a.annotations, space: a.space }));
    expectSameImage(back.image, mod.image);
  }
});
