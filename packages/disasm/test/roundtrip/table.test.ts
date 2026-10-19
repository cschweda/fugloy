/**
 * Every Z80 encoding, emitted as the emitter would emit it, assembled by the
 * pinned zmac in one file, must come back as its own bytes. This is what
 * decides the byte-exact exception list and the undocumented spellings.
 */
import { expect } from 'vitest';
import { TABLES, decodeAt } from '@fugloy/z80';
import { instructionLine } from '../../src/emit/zmac.js';
import { assemble, withAssembler } from './zmac.js';

const test = withAssembler();

const SECTIONS: { prefix: number[]; cb: boolean; table: keyof typeof TABLES }[] = [
  { prefix: [], cb: false, table: 'base' },
  { prefix: [0xcb], cb: false, table: 'cb' },
  { prefix: [0xed], cb: false, table: 'ed' },
  { prefix: [0xdd], cb: false, table: 'dd' },
  { prefix: [0xfd], cb: false, table: 'fd' },
  { prefix: [0xdd, 0xcb], cb: true, table: 'ddcb' },
  { prefix: [0xfd, 0xcb], cb: true, table: 'fdcb' },
];

test('every encoding emitted by instructionLine assembles back to its own bytes', () => {
  const bytes: number[] = [];
  const lines: string[] = ['\tORG\t0'];
  const lineStart: number[] = [];
  for (const s of SECTIONS) {
    for (let op = 0; op < 256; op++) {
      if (TABLES[s.table][op]!.prefix !== undefined) continue;
      const stream = s.cb ? [...s.prefix, 0x12, op] : [...s.prefix, op, 0x12, 0x34];
      const ins = decodeAt(stream, 0, bytes.length); // address = running offset, so JR targets stay consistent
      lineStart.push(bytes.length);
      lines.push(instructionLine(ins));
      bytes.push(...ins.bytes);
    }
  }
  lines.push('\tEND\t0');
  const { module } = assemble(`${lines.join('\n')}\n`);
  const got = Array.from(module.image.bytes.subarray(0, bytes.length));
  const firstDiff = got.findIndex((b, i) => b !== bytes[i]);
  let detail = '';
  if (firstDiff >= 0) {
    let i = 0;
    while (i + 1 < lineStart.length && lineStart[i + 1]! <= firstDiff) i++;
    detail = `first difference at offset ${firstDiff}: line "${lines[i + 1]!.trim()}" (bytes ${bytes.slice(lineStart[i], (lineStart[i + 1] ?? bytes.length)).map((b) => b.toString(16)).join(' ')}) assembled to ${got.slice(lineStart[i], (lineStart[i + 1] ?? bytes.length)).map((b) => b.toString(16)).join(' ')}`;
  }
  expect(firstDiff, detail).toBe(-1);
  expect(module.image.runs()).toEqual([{ start: 0, end: bytes.length - 1, length: bytes.length }]);
  expect(lines.length - 2).toBe(7 * 256 - 6); // six prefix slots: CB, DD, ED, FD, DD CB, FD CB
});
