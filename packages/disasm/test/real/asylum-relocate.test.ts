/** Asylum's game code, reached at its runtime address through relocate hints generated from its own loader stream. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { Kind } from '../../src/analysis/map.js';
import { loadCmd } from '../../src/cmd.js';
import { emitZmac } from '../../src/emit/zmac.js';
import { applyHints } from '../../src/hints/apply.js';
import { parseHints } from '../../src/hints/format.js';
import { programHash } from '../../src/hints/identity.js';
import { analyze } from '../../src/pipeline.js';
import { assemble, expectSameImage, skipIfNoZmac } from '../roundtrip/zmac.js';
import { asylumHintLines } from './asylum-relocations.js';
import { readSample, resolveSample } from './samples.js';

const present = resolveSample('asylum16.cmd') !== null;
const fixture = (): string => readFileSync(fileURLToPath(new URL('../../../../fixtures/hints/asylum16.hints', import.meta.url)), 'utf8');

function analyzed() {
  const bytes = readSample('asylum16.cmd');
  const mod = loadCmd(bytes);
  const { file, errors } = parseHints(fixture());
  expect(errors).toEqual([]);
  const applied = applyHints(file, mod.image, programHash(bytes));
  expect(applied.errors).toEqual([]);
  expect(applied.warnings).toEqual([]);
  return { mod, applied, a: analyze(mod, { annotations: applied.annotations }) };
}

it.skipIf(!present)('the committed fixture holds exactly the relocate and entry lines generated from the loader stream', () => {
  const committed = fixture().split('\n').filter((l) => /^block \d+:\S+ (relocate |entry\b)/.test(l));
  expect(committed).toEqual(asylumHintLines(loadCmd(readSample('asylum16.cmd')).image));
  expect(committed.length).toBe(124);
});

it.skipIf(!present)('with the fixture applied, the game decodes from $43AE at its runtime address', () => {
  const { mod, applied, a } = analyzed();
  expect(applied.annotations.relocations.length).toBe(123);
  expect(mod.image.isLoaded(0x43ae)).toBe(false);
  expect(a.space.image.isLoaded(0x43ae)).toBe(true);
  expect(a.pass1.instructions.has(0x43ae)).toBe(true);
  let code = 0;
  for (let x = 0x42f3; x <= 0x7ff6; x++) if (a.pass1.map.kind(x) === Kind.Code || a.pass1.map.kind(x) === Kind.Tail) code++;
  expect(code).toBeGreaterThan(4000);
  expect(emitZmac(mod.image, a.pass1, a.transfer, { symbols: a.symbols, annotations: a.annotations, space: a.space }).match(/^\t\.PHASE\t/gm)?.length).toBe(123);
});

(present ? skipIfNoZmac() : it.skip)('with the fixture applied, zmac reassembles the file image from 123 .PHASE blocks', () => {
  const { mod, a } = analyzed();
  const { module: back } = assemble(emitZmac(mod.image, a.pass1, a.transfer, { source: 'asylum16.cmd', symbols: a.symbols, annotations: a.annotations, space: a.space }));
  expectSameImage(back.image, mod.image);
  expect(back.entry).toBe(mod.entry);
});
