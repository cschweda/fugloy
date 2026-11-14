/** Sea Dragon is public domain and committed under examples/, so these tests run everywhere, CI included. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { loadCmd } from '../../src/cmd.js';
import { emitZmac } from '../../src/emit/zmac.js';
import { applyHints } from '../../src/hints/apply.js';
import { parseHints } from '../../src/hints/format.js';
import { programHash } from '../../src/hints/identity.js';
import { renderPass1Listing } from '../../src/listing.js';
import { analyze } from '../../src/pipeline.js';
import { assemble, expectSameImage, withAssembler } from '../roundtrip/zmac.js';
import { readSample, resolveSample } from './samples.js';

const examples = new URL('../../../../examples/sea-dragon/', import.meta.url);

it('ships ten Sea Dragon builds in examples/, where the tests find them', () => {
  for (const n of ['01', '02', '03', '04', '06', '07', '08', '09', '10', '11']) {
    expect(resolveSample(`seadrg${n}.cmd`), n).toBe(fileURLToPath(new URL(`seadrg${n}.cmd`, examples)));
  }
});

withAssembler()('the committed seadrg01.hints moves analysis into the game at $497F, and the zmac output still rebuilds the image', () => {
  const bytes = readSample('seadrg01.cmd');
  const mod = loadCmd(bytes);
  const parsed = parseHints(readFileSync(new URL('seadrg01.hints', examples), 'utf8'));
  expect(parsed.errors).toEqual([]);
  const applied = applyHints(parsed.file, mod.image, programHash(bytes));
  expect(applied.errors).toEqual([]);
  expect(applied.warnings).toEqual([]);
  const a = analyze(mod, { annotations: applied.annotations });
  // The game's entry, and $50C1, the code only the JP at $509A reaches once the game rewrites its target
  // (the hint file's entry there, M2 Task 4).
  expect(renderPass1Listing(a)).toContain('; pass 1: roots $8881, $497F, $50C1; 6301 of 13968 bytes decoded as code (45%);');
  const { module: back } = assemble(emitZmac(mod.image, a.pass1, a.transfer, { source: 'seadrg01.cmd', symbols: a.symbols, annotations: a.annotations, space: a.space }));
  expectSameImage(back.image, mod.image);
  expect(back.entry).toBe(mod.entry);
});
