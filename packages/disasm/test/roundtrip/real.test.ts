/** Real programs (never committed; skipped when absent) must round-trip exactly, entry included. */
import { expect, it } from 'vitest';
import { loadBas } from '../../src/bas.js';
import { loadCmd } from '../../src/cmd.js';
import { emitZmac } from '../../src/emit/zmac.js';
import { analyze } from '../../src/pipeline.js';
import { listSamples, readSample, resolveSample } from '../real/samples.js';
import { assemble, expectSameImage, withAssembler } from './zmac.js';

const CMD_FILES = [
  'asylum1a.cmd', 'asylum1b.cmd', 'asylum1c.cmd', 'asylum1d.cmd', 'asylum1e.cmd', 'asylum1f.cmd', 'asylum16.cmd',
  'asylum32.cmd', 'asylum1g.cmd', 'asylumd.bad', 'volcano.cmd', 'GO.CMD', 'ARMOUR.III', 'enchante.cmd',
  'spcwarp1.cmd', 'spcwarp2.cmd', 'spcwarp3.cmd',
  ...Array.from({ length: 11 }, (_, i) => `seadrg${String(i + 1).padStart(2, '0')}.cmd`),
  'pirate.cmd', 'dthmz5k1.cmd', 'dthmz5k2.cmd', 'sa04118a.cmd', 'sa04118b.cmd',
  ...Array.from({ length: 7 }, (_, i) => `reargrd${i + 1}.cmd`),
  ...Array.from('abcdefgh', (c) => `elimin8${c}.cmd`), 'elimin2.bad',
  'planetf.cmd', 'PENETR.CMD', 'supnov3a.cmd',
  ...Array.from({ length: 13 }, (_, i) => `crzpnt${String(i + 1).padStart(2, '0')}.cmd`),
];

/** BASIC programs beyond Valkyrie, none with code in its lines (Star Trek loads its USR routines from startrek.obj); MONSTER names two dumps, and the first found is used. */
const BAS_FILES = ['startrek.ins', 'startrek.mch', 'MONSTER', 'elimzap.bas', 'elimzap3.bas'];

/** Runs when the file is present: through zmac and @fugloy/asm both, or asm alone without zmac (zmac is required under FUGLOY_REQUIRE_ZMAC=1). */
const when = (file: string): typeof it | typeof it.skip => {
  const check = withAssembler();
  return resolveSample(file) === null ? it.skip : check;
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

for (const file of BAS_FILES) {
  when(file)(`${file}: zmac reproduces the BASIC program's image`, () => {
    const prog = loadBas(readSample(file));
    const a = analyze(prog);
    expectSameImage(assemble(emitZmac(prog.image, a.pass1, a.transfer, { source: file, symbols: a.symbols, annotations: a.annotations })).module.image, prog.image);
  });
}
