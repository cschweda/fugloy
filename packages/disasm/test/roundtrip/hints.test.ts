/** The hint-paths fixture, with its hints applied and labels on, must reassemble to its image. */
import { expect } from 'vitest';
import { loadCmd } from '../../src/cmd.js';
import { emitZmac } from '../../src/emit/zmac.js';
import { applyHints } from '../../src/hints/apply.js';
import { emptyAnnotations } from '../../src/hints/apply.js';
import { analyze } from '../../src/pipeline.js';
import { loadRaw } from '../../src/raw.js';
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

test('relocated-code analyzes at $5000, emits .PHASE, and reassembles to its file image', () => {
  const mod = loadCmd(CMD_FIXTURES['relocated-code']!());
  const applied = applyHints(HINT_FIXTURES['relocated-code']!(), mod.image);
  const a = analyze(mod, { annotations: applied.annotations });
  expect(a.pass1.instructions.has(0x5008)).toBe(true);
  const source = emitZmac(mod.image, a.pass1, a.transfer, { source: 'relocated-code.cmd', symbols: a.symbols, annotations: a.annotations, space: a.space });
  expect(source).toContain('\t.PHASE\t5000H\n');
  const { module: back } = assemble(source);
  expectSameImage(back.image, mod.image);
  expect(back.entry).toBe(0x8100);
});

test('an instruction split across two relocated regions reassembles byte for byte', () => {
  // File $8000 holds 3E, $8003 holds 41 C9: at run time they meet at $5000 as LD A,41H / RET.
  const mod = loadRaw(Uint8Array.from([0x3e, 0xff, 0xff, 0x41, 0xc9]), 0x8000);
  const annotations = { ...emptyAnnotations(), relocations: [{ fileAddr: 0x8000, length: 1, runAddr: 0x5000 }, { fileAddr: 0x8003, length: 2, runAddr: 0x5001 }] };
  const a = analyze(mod, { entries: [0x5000], annotations });
  expect(a.pass1.instructions.get(0x5000)?.length).toBe(2);
  const source = emitZmac(mod.image, a.pass1, a.transfer, { symbols: a.symbols, annotations: a.annotations, space: a.space });
  expect(source).toContain('\t.PHASE\t5000H\n\tDB\t3EH\n\t.DEPHASE\n\tDB\t0FFH,0FFH\n\t.PHASE\t5001H\n\tDB\t41H\n\tRET\n\t.DEPHASE\n');
  expectSameImage(assemble(source).module.image, mod.image);
});
