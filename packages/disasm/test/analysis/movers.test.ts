import { describe, expect, it } from 'vitest';
import { loadCmd } from '../../src/cmd.js';
import { emitZmac } from '../../src/emit/zmac.js';
import { applyHints } from '../../src/hints/apply.js';
import { parseHints, writeHints } from '../../src/hints/format.js';
import { blockIdentities } from '../../src/hints/identity.js';
import type { MemoryImage } from '../../src/memory.js';
import { analyze } from '../../src/pipeline.js';
import { CMD_FIXTURES } from '../fixtures.js';
import { assemble, expectSameImage, withAssembler } from '../roundtrip/zmac.js';
import { CmdWriter } from '../writers/cmd-writer.js';

const moves = (bytes: Uint8Array) => analyze(loadCmd(bytes)).proposals.filter((p) => p.kind === 'move');
/** A hint file holding `lines` for this image, as a user would paste them under a skeleton. */
const hintText = (image: MemoryImage, lines: string[]): string =>
  `${writeHints({ version: 1, blocks: blockIdentities(image).map(({ index, length, hash }) => ({ index, length, hash })), hints: [] })}${lines.join('\n')}\n`;

describe('proposeMovers', () => {
  it('turns an LDIR mover stub into relocate and entry lines', () => {
    expect(moves(CMD_FIXTURES['mover']!())).toEqual([
      { kind: 'move', ldir: 0x7049, src: 0x7000, dst: 0x5000, length: 0x40, hints: ['block 0:$0000 relocate $5000 $0040', 'block 0:$0000 entry'] },
    ]);
  });

  it('leaves the stub\'s own code in place when its LDIR sits inside the source', () => {
    const bytes = new CmdWriter()
      .load(0x7000, [...new Array<number>(0x30).fill(0x00), 0xed, 0xb0, 0xc3, 0x00, 0x50]) // payload, then LDIR / JP 5000H
      .load(0x7100, [0x01, 0x35, 0x00, 0x11, 0x00, 0x50, 0x21, 0x00, 0x70, 0xc3, 0x30, 0x70]) // LD BC,0035H / LD DE,5000H / LD HL,7000H / JP 7030H
      .transfer(0x7100)
      .bytes();
    expect(moves(bytes).map((m) => m.hints)).toEqual([['block 0:$0000 relocate $5000 $0030', 'block 0:$0000 entry']]);
  });

  it('gives one relocate line per loaded piece when the source spans a gap', () => {
    const bytes = new CmdWriter()
      .load(0x6000, new Array<number>(0x100).fill(0x00))
      .load(0x6200, new Array<number>(0x100).fill(0x00))
      .load(0x7000, [0x21, 0x00, 0x60, 0x11, 0x00, 0x40, 0x01, 0x00, 0x03, 0xed, 0xb0, 0xc3, 0x00, 0x40]) // LD HL,6000H / LD DE,4000H / LD BC,0300H / LDIR / JP 4000H
      .transfer(0x7000)
      .bytes();
    expect(moves(bytes).map((m) => m.hints)).toEqual([['block 0:$0000 relocate $4000 $0100', 'block 1:$0000 relocate $4200 $0100', 'block 0:$0000 entry']]);
  });

  it('takes a constant the stub pushes into the copy as an entry, as a jump to a RET there returns to it', () => {
    const bytes = new CmdWriter()
      .load(0x7000, [0xc9, ...new Array<number>(0x3f).fill(0x00)]) // a RET at what becomes $5000
      .load(0x7040, [0x21, 0x00, 0x70, 0x11, 0x00, 0x50, 0x01, 0x40, 0x00, 0xed, 0xb0, 0x21, 0x10, 0x50, 0xe5, 0xc3, 0x00, 0x50]) // ... LDIR / LD HL,5010H / PUSH HL / JP 5000H
      .transfer(0x7040)
      .bytes();
    expect(moves(bytes).map((m) => m.hints)).toEqual([['block 0:$0000 relocate $5000 $0040', 'block 0:$0000 entry', 'block 0:$0010 entry']]);
  });

  it('leaves out only the bytes that would land on memory staying loaded, such as the stub\'s first bytes', () => {
    const bytes = new CmdWriter()
      .load(0x7000, [0x21, 0x10, 0x70, 0x11, 0xd0, 0x6f, 0x01, 0x40, 0x00, 0xed, 0xb0, 0xc3, 0xd0, 0x6f, 0x00, 0x00, ...new Array<number>(0x40).fill(0x00)]) // copies $7010-$704F to $6FD0: its last 16 bytes land on this stub
      .transfer(0x7000)
      .bytes();
    expect(moves(bytes).map((m) => m.hints)).toEqual([['block 0:$0010 relocate $6FD0 $0030', 'block 0:$0010 entry']]);
  });

  it('proposes nothing for a ROM source or a destination over loaded memory', () => {
    const fromRom = new CmdWriter().load(0x7000, [0x21, 0xd2, 0x06, 0x11, 0x00, 0x40, 0x01, 0x36, 0x00, 0xed, 0xb0, 0xc9]).transfer(0x7000).bytes();
    expect(moves(fromRom)).toEqual([]);
    const overStub = new CmdWriter()
      .load(0x7000, new Array<number>(0x0c).fill(0x00))
      .load(0x7100, [0x21, 0x00, 0x70, 0x11, 0x00, 0x71, 0x01, 0x0c, 0x00, 0xed, 0xb0, 0xc9]) // copies 12 bytes exactly onto this 12-byte stub
      .transfer(0x7100)
      .bytes();
    expect(moves(overStub)).toEqual([]);
  });

  it('proposes nothing for a copy the stub never jumps into, or for a fill', () => {
    const toScreen = new CmdWriter().load(0x7000, [...new Array<number>(0x40).fill(0x20)]).load(0x7100, [0x21, 0x00, 0x70, 0x11, 0x00, 0x3c, 0x01, 0x40, 0x00, 0xed, 0xb0, 0xc9]).transfer(0x7100).bytes();
    expect(moves(toScreen)).toEqual([]);
    const fill = new CmdWriter().load(0x7000, new Array<number>(0x40).fill(0x00)).load(0x7100, [0x21, 0x00, 0x70, 0x11, 0x01, 0x70, 0x01, 0x3f, 0x00, 0xed, 0xb0, 0xc3, 0x01, 0x70]).transfer(0x7100).bytes();
    expect(moves(fill)).toEqual([]);
  });

  it('keeps every proposal for one file compatible, so they can be applied together', () => {
    const twice = new CmdWriter()
      .load(0x7000, new Array<number>(0x40).fill(0x00))
      .load(0x7100, [0x21, 0x00, 0x70, 0x11, 0x00, 0x50, 0x01, 0x40, 0x00, 0xed, 0xb0, 0x21, 0x00, 0x70, 0x11, 0x00, 0x60, 0x01, 0x40, 0x00, 0xed, 0xb0, 0xc3, 0x00, 0x60])
      .transfer(0x7100)
      .bytes(); // the same source copied twice; only the second copy is jumped into
    expect(moves(twice).map((m) => m.hints)).toEqual([['block 0:$0000 relocate $6000 $0040', 'block 0:$0000 entry']]);
  });

  it('proposes nothing for a second-stage copy out of relocated memory, which no one file offset can name', () => {
    // Once at $5000: LD HL,5100H / LD DE,6000H / LD BC,0004H / LDIR / JP 6000H, and four bytes at $5100 to copy.
    const payload = [0x21, 0x00, 0x51, 0x11, 0x00, 0x60, 0x01, 0x04, 0x00, 0xed, 0xb0, 0xc3, 0x00, 0x60, ...new Array<number>(0x100 - 14).fill(0), 0xc9, 0, 0, 0];
    const stub = [0x21, 0x00, 0x80, 0x11, 0x00, 0x50, 0x01, 0x04, 0x01, 0xed, 0xb0, 0xc3, 0x00, 0x50]; // copies $0104 bytes from $8000 to $5000
    const bytes = new CmdWriter().load(0x8000, payload).load(0x8200, stub).transfer(0x8200).bytes();
    const mod = loadCmd(bytes);
    const [first] = moves(bytes);
    expect(first!.hints).toEqual(['block 0:$0000 relocate $5000 $0104', 'block 0:$0000 entry']);
    const a = analyze(mod, { annotations: applyHints(parseHints(hintText(mod.image, first!.hints)).file, mod.image).annotations });
    expect(a.pass1.instructions.get(0x5009)?.mnemonic).toBe('LDIR'); // the second stage, decoded where it runs
    expect(a.proposals.filter((p) => p.kind === 'move')).toEqual([]);
  });

  it('proposes nothing for a source a relocate hint already moved', () => {
    const mod = loadCmd(CMD_FIXTURES['mover']!());
    const { file } = parseHints(hintText(mod.image, ['block 0:$0000 relocate $5000 $0040']));
    expect(analyze(mod, { annotations: applyHints(file, mod.image).annotations }).proposals).toEqual([]);
  });
});

withAssembler()('applying a mover proposal analyzes the copy at its runtime address and still reassembles the file', () => {
  const mod = loadCmd(CMD_FIXTURES['mover']!());
  const [proposal] = moves(CMD_FIXTURES['mover']!());
  const { file, errors } = parseHints(hintText(mod.image, proposal!.hints));
  expect(errors).toEqual([]);
  const applied = applyHints(file, mod.image);
  expect(applied.errors).toEqual([]);
  const a = analyze(mod, { annotations: applied.annotations });
  expect(a.pass1.instructions.has(0x5008)).toBe(true);
  const source = emitZmac(mod.image, a.pass1, a.transfer, { symbols: a.symbols, annotations: a.annotations, space: a.space });
  expect(source).toContain('\t.PHASE\t5000H\n');
  expectSameImage(assemble(source).module.image, mod.image);
});
