/**
 * The ROMs (never committed; skipped when absent): pass 1 from their documented entry points, and
 * the round trip through zmac and @fugloy/asm. The Model I Level II ROM is a sample; the Model III
 * and Model 4 ROMs are the ones fugloy.mcp.json names, read as the emulator's tests read them.
 */
import { expect, it } from 'vitest';
import { Kind } from '../../src/analysis/map.js';
import { emitZmac } from '../../src/emit/zmac.js';
import { analyze } from '../../src/pipeline.js';
import { loadRaw } from '../../src/raw.js';
import { assemble, expectSameImage, withAssembler } from '../roundtrip/zmac.js';
import { readSample, resolveSample } from './samples.js';
import { configuredRom } from '../../../emu/test/rom.js';

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

(present ? withAssembler() : it.skip)('reassembles byte for byte through zmac', () => {
  const { mod, a } = analyzed();
  const { module: back } = assemble(emitZmac(mod.image, a.pass1, a.transfer, { source: ROM, symbols: a.symbols, annotations: a.annotations, space: a.space }));
  expectSameImage(back.image, mod.image);
});

for (const model of ['model3', 'model4'] as const) {
  const rom = configuredRom(model);
  (rom === null ? it.skip : withAssembler())(`reassembles the ${model} ROM from fugloy.mcp.json byte for byte through zmac and @fugloy/asm`, () => {
    const mod = loadRaw(rom!, 0x0000);
    const a = analyze(mod, { entries: ENTRIES.filter((e) => e < rom!.length) });
    const { module: back } = assemble(emitZmac(mod.image, a.pass1, a.transfer, { source: `${model}.rom`, symbols: a.symbols, annotations: a.annotations, space: a.space }));
    expectSameImage(back.image, mod.image);
  });
}
