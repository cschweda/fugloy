/** The hint-paths fixture, with its hints applied and labels on, must reassemble to its image. */
import { expect } from 'vitest';
import { loadCmd } from '../../src/cmd.js';
import { emitZmac } from '../../src/emit/zmac.js';
import { applyHints } from '../../src/hints/apply.js';
import { analyze } from '../../src/pipeline.js';
import { CMD_FIXTURES, HINT_FIXTURES } from '../fixtures.js';
import { assemble, expectSameImage, skipIfNoZmac } from './zmac.js';

const test = skipIfNoZmac();

test('hint-paths round-trips through zmac with labels, EQU, DW, and comments', () => {
  const mod = loadCmd(CMD_FIXTURES['hint-paths']!());
  const applied = applyHints(HINT_FIXTURES['hint-paths']!(), mod.image);
  expect(applied.unmatched).toEqual([]);
  const a = analyze(mod, { annotations: applied.annotations });
  expect([...a.pass1.instructions.keys()].sort((x, y) => x - y)).toContain(0x6019);
  const { module: back } = assemble(emitZmac(mod.image, a.pass1, a.transfer, { source: 'hint-paths.cmd', symbols: a.symbols, annotations: a.annotations }));
  expectSameImage(back.image, mod.image);
  expect(back.entry).toBe(0x6000);
});
