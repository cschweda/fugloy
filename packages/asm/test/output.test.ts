/** toCmd: the result as a .CMD through disasm's writeCmd, which loadCmd reads back to the same image and entry. */
import { describe, expect, it } from 'vitest';
import { loadCmd } from '../../disasm/src/cmd.js';
import { assemble, toCmd } from '../src/index.js';
import type { AsmResult } from '../src/index.js';

function reloadsTo(r: AsmResult, name?: string): void {
  expect(r.ok).toBe(true);
  const back = loadCmd(toCmd(r, name === undefined ? {} : { name }));
  // loadCmd notes a 03 end record (no entry) as not directly executable; nothing else.
  expect(back.warnings.filter((w) => !w.startsWith('03 record'))).toEqual([]);
  expect(Array.from(back.image.loaded)).toEqual(Array.from(r.image!.loaded));
  for (let a = 0; a < 0x10000; a++) if (r.image!.loaded[a] === 1) expect(back.image.bytes[a]).toBe(r.image!.bytes[a]);
  expect(back.entry).toBe(r.entry);
}

describe('toCmd', () => {
  it('writes a .CMD that reloads to the same image and entry', () => {
    const r = assemble(['\tORG 6000H', 'S:\tLD A,1', '\tDS 300,55H', '\tORG 7000H', '\tJP S', '\tEND S'].join('\n'));
    reloadsTo(r);
    expect(r.entry).toBe(0x6000);
  });
  it('with no entry it ends with 03 00, and loadCmd gives no entry', () => {
    const r = assemble('\tORG 6000H\n\tNOP\n');
    const cmd = toCmd(r);
    expect(Array.from(cmd)).toEqual([0x01, 0x03, 0x00, 0x60, 0x00, 0x03, 0x00]);
    reloadsTo(r);
  });
  it('writes the name as a 05 header record', () => {
    const r = assemble('\tORG 6000H\nS:\tNOP\n\tEND S\n');
    expect(Array.from(toCmd(r, { name: 'HELLO' }))).toEqual([0x05, 0x05, 0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x01, 0x03, 0x00, 0x60, 0x00, 0x02, 0x02, 0x00, 0x60]);
    reloadsTo(r, 'HELLO');
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
