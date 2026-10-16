/** Real load modules that start with an LDIR mover stub: each gets a proposal, and applying it reaches the game. */
import { expect, it } from 'vitest';
import { Kind } from '../../src/analysis/map.js';
import { loadCmd } from '../../src/cmd.js';
import { applyHints } from '../../src/hints/apply.js';
import { parseHints, writeHints } from '../../src/hints/format.js';
import { blockIdentities } from '../../src/hints/identity.js';
import { analyze } from '../../src/pipeline.js';
import type { Analysis } from '../../src/pipeline.js';
import { listSamples, readSample, resolveSample } from './samples.js';
import { detectFormat } from '../../src/detect.js';

const FILES = ['pirate.cmd', 'sa04118a.cmd', 'sa04118b.cmd', 'dthmz5k1.cmd', 'dthmz5k2.cmd', 'spcwarp1.cmd', 'spcwarp3.cmd', 'seadrg01.cmd', 'seadrg02.cmd', 'seadrg03.cmd', 'seadrg05.cmd'];

function codeBytes(a: Analysis): number {
  let n = 0;
  for (const r of a.space.image.runs()) for (let x = r.start; x <= r.end; x++) if (a.pass1.map.kind(x) === Kind.Code || a.pass1.map.kind(x) === Kind.Tail) n++;
  return n;
}

for (const file of FILES) {
  it.skipIf(resolveSample(file) === null)(`${file}: its mover stub is proposed, and applying the proposal decodes at least 1,000 more bytes of code`, () => {
    const mod = loadCmd(readSample(file));
    const before = analyze(mod);
    const lines = before.proposals.flatMap((p) => (p.kind === 'move' ? p.hints : []));
    expect(lines.length).toBeGreaterThan(0);
    const blocks = blockIdentities(mod.image).map(({ index, length, hash }) => ({ index, length, hash }));
    const { file: hints, errors } = parseHints(`${writeHints({ version: 1, blocks, hints: [] })}${lines.join('\n')}\n`);
    expect(errors).toEqual([]);
    const applied = applyHints(hints, mod.image);
    expect(applied.errors).toEqual([]);
    const after = analyze(mod, { annotations: applied.annotations });
    expect(codeBytes(after) - codeBytes(before)).toBeGreaterThanOrEqual(1000);
  });
}

for (const file of listSamples((n) => /\.(cmd|bad)$/i.test(n) || n === 'ARMOUR.III')) {
  it(`${file}: every mover proposal applies together with the others, without an error`, () => {
    const bytes = readSample(file);
    if (detectFormat(bytes) !== 'cmd') return;
    const mod = loadCmd(bytes);
    const lines = analyze(mod).proposals.flatMap((p) => (p.kind === 'move' ? p.hints : []));
    if (lines.length === 0) return;
    const blocks = blockIdentities(mod.image).map(({ index, length, hash }) => ({ index, length, hash }));
    const { file: hints } = parseHints(`${writeHints({ version: 1, blocks, hints: [] })}${lines.join('\n')}\n`);
    expect(applyHints(hints, mod.image).errors).toEqual([]);
  });
}
