/** toCmd: the result as a .CMD through disasm's writeCmd, which loadCmd reads back to the same image and entry. */
import { parseCmd } from '@fugloy/emu';
import { describe, expect, it } from 'vitest';
import { loadCmd } from '../../disasm/src/cmd.js';
import { assemble, toCmd } from '../src/index.js';
import type { AsmResult, CmdOptions } from '../src/index.js';

function reloadsTo(r: AsmResult, options: CmdOptions = {}, entry: number | null = r.entry): void {
  expect(r.ok).toBe(true);
  const back = loadCmd(toCmd(r, options));
  // loadCmd notes a 03 end record (no entry) as not directly executable; nothing else.
  expect(back.warnings.filter((w) => !w.startsWith('03 record'))).toEqual([]);
  expect(Array.from(back.image.loaded)).toEqual(Array.from(r.image!.loaded));
  for (let a = 0; a < 0x10000; a++) if (r.image!.loaded[a] === 1) expect(back.image.bytes[a]).toBe(r.image!.bytes[a]);
  expect(back.entry).toBe(entry);
}

describe('toCmd', () => {
  it('writes a .CMD that reloads to the same image and entry', () => {
    const r = assemble(['\tORG 6000H', 'S:\tLD A,1', '\tDS 300,55H', '\tORG 7000H', '\tJP S', '\tEND S'].join('\n'));
    reloadsTo(r);
    expect(r.entry).toBe(0x6000);
  });
  it('with no END entry the transfer record names the first assembled byte, so the file runs', () => {
    const r = assemble('\tORG 6000H\n\tNOP\n');
    expect(r.entry).toBeNull();
    expect(Array.from(toCmd(r))).toEqual([0x01, 0x03, 0x00, 0x60, 0x00, 0x02, 0x02, 0x00, 0x60]);
    reloadsTo(r, {}, 0x6000);
  });
  it('the first assembled byte is the first in source order, not the lowest address', () => {
    const r = assemble(['\tORG 7000H', '\tNOP', '\tORG 6000H', '\tRET'].join('\n'));
    expect(Array.from(toCmd(r)).slice(-4)).toEqual([0x02, 0x02, 0x00, 0x70]);
    // A line with no bytes (a DS gap) comes before the first byte.
    const gap = assemble(['\tORG 7000H', '\tDS 4', '\tNOP'].join('\n'));
    expect(Array.from(toCmd(gap)).slice(-4)).toEqual([0x02, 0x02, 0x04, 0x70]);
  });
  it("with entry 'source' and no END entry it ends with 03 00, as zmac's file reads, and loadCmd gives no entry", () => {
    const r = assemble('\tORG 6000H\n\tNOP\n');
    expect(Array.from(toCmd(r, { entry: 'source' }))).toEqual([0x01, 0x03, 0x00, 0x60, 0x00, 0x03, 0x00]);
    reloadsTo(r, { entry: 'source' });
    // With an END entry both shapes are the same.
    const s = assemble('\tORG 6000H\nS:\tNOP\n\tEND S\n');
    expect(toCmd(s, { entry: 'source' })).toEqual(toCmd(s));
  });
  it("the emulator's .CMD parser takes what toCmd writes, with or without an END entry", () => {
    for (const [source, entry] of [
      ['\tORG 6000H\n\tNOP\n', 0x6000],
      ['\tORG 6000H\n\tNOP\nS:\tRET\n\tEND S\n', 0x6001],
    ] as const) {
      const parsed = parseCmd(toCmd(assemble(source)));
      expect(parsed.entry).toBe(entry);
      expect(parsed.blocks.map((b: { addr: number }) => b.addr)).toEqual([0x6000]);
    }
  });
  it('writes the name as a 05 header record', () => {
    const r = assemble('\tORG 6000H\nS:\tNOP\n\tEND S\n');
    expect(Array.from(toCmd(r, { name: 'HELLO' }))).toEqual([0x05, 0x05, 0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x01, 0x03, 0x00, 0x60, 0x00, 0x02, 0x02, 0x00, 0x60]);
    reloadsTo(r, { name: 'HELLO' });
  });
  it('phased code is written at its load address', () => {
    const r = assemble(['\tORG 6000H', '\t.PHASE 4000H', 'PP:\tJP PP', '\t.DEPHASE', '\tEND PP'].join('\n'));
    expect(Array.from(toCmd(r))).toEqual([0x01, 0x05, 0x00, 0x60, 0xc3, 0x00, 0x40, 0x02, 0x02, 0x00, 0x40]);
    reloadsTo(r);
  });
  it('throws a sentence for a name longer than 8 characters or outside printable ASCII', () => {
    const r = assemble('\tORG 6000H\n\tNOP\n');
    expect(() => toCmd(r, { name: 'TOOLONGNAME' })).toThrow('A .CMD name has at most 8 characters; TOOLONGNAME has 11.');
    expect(() => toCmd(r, { name: 'CAFÉ' })).toThrow('A .CMD name takes printable ASCII characters only; CAFÉ has É.');
    expect(Array.from(toCmd(r, { name: 'EIGHTCHR' }).subarray(0, 10))).toEqual([0x05, 0x08, ...Array.from('EIGHTCHR', (c) => c.charCodeAt(0))]);
  });
  it('throws a sentence for a program with no bytes', () => {
    expect(() => toCmd(assemble('K\tEQU 5\n'))).toThrow('There is nothing to write: the program has no bytes.');
    expect(() => toCmd(assemble('\tORG 6000H\n\tDS 10\n'))).toThrow('There is nothing to write: the program has no bytes.');
  });
  it('throws a sentence when the source has errors', () => {
    const r = assemble('\tORG 6000H\n\tLDA 5\n\tJMP 0\n');
    expect(() => toCmd(r)).toThrow('There is no .CMD to write: the source has 2 errors. Fix them and assemble again.');
    expect(() => toCmd(assemble('\tORG 6000H\n\tLDA 5\n'))).toThrow('There is no .CMD to write: the source has 1 error. Fix it and assemble again.');
  });
});
