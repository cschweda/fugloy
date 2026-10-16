/** The Model I Level II ROM (never committed; skipped when absent): pass 1 from its documented entry points. */
import { expect, it } from 'vitest';
import { Kind } from '../../src/analysis/map.js';
import { emitZmac } from '../../src/emit/zmac.js';
import { analyze } from '../../src/pipeline.js';
import { loadRaw } from '../../src/raw.js';
import { assemble, expectSameImage, skipIfNoZmac } from '../roundtrip/zmac.js';
import { readSample, resolveSample } from './samples.js';

const ROM = 'level2-model1.rom';
/** Reset, the RST vectors, device output ($001B), display ($0033), keyboard wait ($0049), and BASIC's READY ($1A19). */
const ENTRIES = [0x0000, 0x0008, 0x0010, 0x0018, 0x0020, 0x0028, 0x0030, 0x0038, 0x001b, 0x0033, 0x0049, 0x1a19];
const present = resolveSample(ROM) !== null;
const analyzed = () => {
  const mod = loadRaw(readSample(ROM), 0x0000);
  return { mod, a: analyze(mod, { entries: ENTRIES }) };
};

it.skipIf(!present)('decodes code at every documented entry point and reaches at least 40% of the ROM', () => {
  const { mod, a } = analyzed();
  expect(mod.image.runs()).toEqual([{ start: 0, end: 0x2fff, length: 0x3000 }]);
  for (const e of ENTRIES) expect(a.pass1.instructions.has(e), `$${e.toString(16)}`).toBe(true);
  let code = 0;
  for (let x = 0; x < 0x3000; x++) if (a.pass1.map.kind(x) === Kind.Code || a.pass1.map.kind(x) === Kind.Tail) code++;
  expect(code / 0x3000).toBeGreaterThanOrEqual(0.4);
});

(present ? skipIfNoZmac() : it.skip)('reassembles byte for byte through zmac', () => {
  const { mod, a } = analyzed();
  const { module: back } = assemble(emitZmac(mod.image, a.pass1, a.transfer, { source: ROM, symbols: a.symbols, annotations: a.annotations, space: a.space }));
  expectSameImage(back.image, mod.image);
});
