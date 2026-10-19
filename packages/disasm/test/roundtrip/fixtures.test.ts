/** Every synthetic fixture, through pass 1 and the emitter, assembled by the pinned zmac, must reproduce its image. */
import { expect } from 'vitest';
import { loadBas } from '../../src/bas.js';
import { loadCmd } from '../../src/cmd.js';
import { emitZmac } from '../../src/emit/zmac.js';
import { analyze } from '../../src/pipeline.js';
import { loadRaw } from '../../src/raw.js';
import { BAS_FIXTURES, CMD_FIXTURES, pattern } from '../fixtures.js';
import { assemble, expectSameImage, withAssembler } from './zmac.js';

const test = withAssembler();

for (const [name, make] of Object.entries(CMD_FIXTURES)) {
  test(`cmd/${name} round-trips through zmac to the same image, bitmap, and entry`, () => {
    const mod = loadCmd(make());
    const a = analyze(mod);
    const { module: back } = assemble(emitZmac(mod.image, a.pass1, a.transfer, { source: name, symbols: a.symbols, annotations: a.annotations }));
    expectSameImage(back.image, mod.image);
    // zmac writes an 02 record only for END with an address; a file that had none (or an 03) reloads with the lowest address.
    expect(back.entrySource).toBe(mod.entrySource === 'transfer' ? 'transfer' : 'lowest');
    expect(back.entry).toBe(mod.entrySource === 'transfer' ? mod.entry : mod.image.lowestLoaded());
  });
}

for (const [name, make] of Object.entries(BAS_FIXTURES)) {
  test(`bas/${name} round-trips with its lines typed, its code decoded, and a bare END`, () => {
    const prog = loadBas(make());
    const a = analyze(prog);
    const source = emitZmac(prog.image, a.pass1, a.transfer, { source: name, symbols: a.symbols, annotations: a.annotations });
    expect(source.trimEnd().endsWith('\tEND')).toBe(true);
    expectSameImage(assemble(source).module.image, prog.image);
  });
}

const RAW: [string, number, number[]][] = [
  ['program', 0x5200, [0x21, 0x00, 0x3c, 0x36, 0x41, 0xc9]],
  ['pattern-300', 0x7000, pattern(300)],
  ['ends-in-cd', 0x6000, [0x3e, 0x01, 0xcd]],
];
for (const [name, base, bytes] of RAW) {
  test(`raw/${name} round-trips from its base with the entry there`, () => {
    const mod = loadRaw(Uint8Array.from(bytes), base);
    const a = analyze(mod);
    const { module: back } = assemble(emitZmac(mod.image, a.pass1, a.transfer, { source: name, symbols: a.symbols, annotations: a.annotations }));
    expectSameImage(back.image, mod.image);
    expect(back.entry).toBe(base);
  });
}
