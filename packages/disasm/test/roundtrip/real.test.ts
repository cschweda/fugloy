/** Real programs (never committed; skipped when absent) must round-trip exactly, entry included. */
import { expect, it } from 'vitest';
import { loadBas } from '../../src/bas.js';
import { loadCmd } from '../../src/cmd.js';
import { emitZmac } from '../../src/emit/zmac.js';
import { analyze } from '../../src/pipeline.js';
import { listSamples, readSample, resolveSample } from '../real/samples.js';
import { assemble, expectSameImage, skipIfNoZmac } from './zmac.js';

const CMD_FILES = [
  'asylum1a.cmd', 'asylum1b.cmd', 'asylum1c.cmd', 'asylum1d.cmd', 'asylum1e.cmd', 'asylum1f.cmd', 'asylum16.cmd',
  'asylum32.cmd', 'asylum1g.cmd', 'asylumd.bad', 'volcano.cmd', 'GO.CMD', 'ARMOUR.III', 'enchante.cmd',
];

/** Runs only when both zmac (required under FUGLOY_REQUIRE_ZMAC=1) and the file are present. */
const when = (file: string): typeof it | typeof it.skip => {
  const withZmac = skipIfNoZmac();
  return resolveSample(file) === null ? it.skip : withZmac;
};

for (const file of CMD_FILES) {
  when(file)(`${file}: pass 1 + zmac reproduce the image and entry`, () => {
    const mod = loadCmd(readSample(file));
    const a = analyze(mod);
    expect(a.pass1.instructions.size).toBeGreaterThan(0);
    const { module: back } = assemble(emitZmac(mod.image, a.pass1, a.transfer, { source: file, symbols: a.symbols, annotations: a.annotations }));
    expectSameImage(back.image, mod.image);
    expect(back.entry).toBe(mod.entry);
  });
}

for (const file of listSamples((n) => /^valkyr.*\.bas$/i.test(n))) {
  when(file)(`${file}: hidden code decoded at its true addresses, with labels, zmac reproduces the image`, () => {
    const prog = loadBas(readSample(file));
    const a = analyze(prog);
    expect(a.pass1.instructions.size).toBeGreaterThan(0);
    const source = emitZmac(prog.image, a.pass1, a.transfer, { source: file, symbols: a.symbols, annotations: a.annotations });
    expect(source).toMatch(/^[A-Z][A-Z0-9_]*:$/m);
    expectSameImage(assemble(source).module.image, prog.image);
  });
}
