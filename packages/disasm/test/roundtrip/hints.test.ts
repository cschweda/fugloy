/** The hint-paths fixture, with its hints applied and labels on, must reassemble to its image. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { loadCmd } from '../../src/cmd.js';
import { emitZmac } from '../../src/emit/zmac.js';
import { applyHints } from '../../src/hints/apply.js';
import { parseHints } from '../../src/hints/format.js';
import { emptyAnnotations } from '../../src/hints/apply.js';
import { analyze } from '../../src/pipeline.js';
import { addressKey, openProgram, renderSession, withHintText } from '../../src/session.js';
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

test('a user name outside the image is defined by an EQU and reassembles to the same image', () => {
  const mod = loadRaw(Uint8Array.from([0x3a, 0x00, 0x7f, 0x32, 0x01, 0x7f, 0xc9]), 0x7000);
  const parsed = parseHints('fugloy-hints 1\nat $7F00 name SCORE\nat $7F00 comment player score\nat $7F01 name LIVES\n');
  const applied = applyHints(parsed.file, mod.image);
  const a = analyze(mod, { entries: [0x7000], annotations: applied.annotations });
  const source = emitZmac(mod.image, a.pass1, a.transfer, { symbols: a.symbols, annotations: a.annotations });
  expect(source).toContain('SCORE\tEQU\t7F00H\t; player score\nLIVES\tEQU\t7F01H\n');
  expect(source).toContain('\tLD\tA,(SCORE)\n\tLD\t(LIVES),A\n');
  expectSameImage(assemble(source).module.image, mod.image);
});

test('a note at the relocated Sea Dragon routine reassembles to the same image', () => {
  const dir = fileURLToPath(new URL('../../../../examples/sea-dragon/', import.meta.url));
  const bytes = new Uint8Array(readFileSync(`${dir}seadrg01.cmd`));
  const hints = readFileSync(`${dir}seadrg01.hints`, 'utf8');
  const base = withHintText(openProgram(bytes, { name: 'seadrg01.cmd', selection: { machine: 3, dos: 'trsdos' } }), hints);
  const key = addressKey(base, 0x497f)!;
  const noted = withHintText(base, `${hints}\nblock ${key.block}:$${key.offset.toString(16).toUpperCase().padStart(4, '0')} note The relocated routine.\nblock ${key.block}:$${key.offset.toString(16).toUpperCase().padStart(4, '0')} note\n`);
  const source = renderSession(noted, 'zmac');
  expect(source).toContain('; The relocated routine.\n;\nL497F:\n');
  // The committed hints may already note L497F; the added note follows theirs, in file order.
  const existing = base.analysis.annotations.notes.get(0x497f) ?? [];
  if (existing.length > 0) expect(source).toContain(`; ${existing.at(-1)}\n; The relocated routine.\n`);
  expectSameImage(assemble(source).module.image, base.module.image);
});
