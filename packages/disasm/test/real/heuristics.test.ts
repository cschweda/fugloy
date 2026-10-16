/** Strings and table proposals on real programs (each test skips when its sample is absent). */
import { expect, it } from 'vitest';
import { Kind } from '../../src/analysis/map.js';
import { loadCmd } from '../../src/cmd.js';
import { analyze } from '../../src/pipeline.js';
import type { Analysis } from '../../src/pipeline.js';
import { readSample, resolveSample } from './samples.js';

/** Number of separate strings typed. */
function strings(a: Analysis): number {
  let n = 0;
  for (const r of a.module.image.runs()) {
    for (let x = r.start; x <= r.end; x++) if (a.pass1.map.kind(x) === Kind.String && (x === r.start || a.pass1.map.kind(x - 1) !== Kind.String)) n++;
  }
  return n;
}

it.skipIf(resolveSample('pirate.cmd') === null)("types Pirate's Adventure's messages as strings before its code is even reached", () => {
  expect(strings(analyze(loadCmd(readSample('pirate.cmd'))))).toBeGreaterThanOrEqual(50);
});

it.skipIf(resolveSample('seadrg06.cmd') === null)("proposes Sea Dragon's jump tables, each with the hint line that declares it", () => {
  const a = analyze(loadCmd(readSample('seadrg06.cmd')));
  expect(a.proposals.length).toBeGreaterThanOrEqual(10);
  for (const p of a.proposals) expect(p.hint).toMatch(/^block \d+:\$[0-9A-F]{4} table \d+ 2$/);
});
