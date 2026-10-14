/**
 * Decodes every encoding of every prefix and compares against the committed
 * reference table, which is built by test/reference/build-reference.ts from
 * flat per-opcode tables that share nothing with the generator.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { TABLES, decodeAt, formatInstruction } from '../src/index.js';
import type { Instruction, Template } from '../src/index.js';

const REFERENCE = fileURLToPath(new URL('./reference/z80.txt', import.meta.url));

const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');

function flowText(ins: Instruction): string {
  const base = { next: 'next', jump: 'jump', call: 'call', return: 'ret', halt: 'halt' }[ins.flow.kind];
  if (ins.flow.indirect) return `${base}*`;
  return ins.flow.conditional ? `${base}?` : base;
}

function renderDecoded(ins: Instruction): string {
  const cycles = ins.cyclesNotTaken === undefined ? `${ins.cycles}` : `${ins.cycles}/${ins.cyclesNotTaken}`;
  return `${ins.bytes.map(hex2).join(' ')} | ${formatInstruction(ins)} | ${ins.length} | ${cycles} | ${flowText(ins)} | ${ins.documented ? 'doc' : 'undoc'}`;
}

interface Section { name: keyof typeof TABLES; prefix: number[]; cb: boolean }
const SECTIONS: Section[] = [
  { name: 'base', prefix: [], cb: false },
  { name: 'cb', prefix: [0xcb], cb: false },
  { name: 'ed', prefix: [0xed], cb: false },
  { name: 'dd', prefix: [0xdd], cb: false },
  { name: 'fd', prefix: [0xfd], cb: false },
  { name: 'ddcb', prefix: [0xdd, 0xcb], cb: true },
  { name: 'fdcb', prefix: [0xfd, 0xcb], cb: true },
];

function renderEntry(section: Section, op: number, tpl: Template): string {
  const stream = section.cb ? [...section.prefix, 0x12, op] : [...section.prefix, op, 0x12, 0x34];
  if (tpl.prefix !== undefined) return `${stream.slice(0, section.prefix.length + 1).map(hex2).join(' ')} | prefix`;
  return renderDecoded(decodeAt(stream, 0, 0));
}

it('decodes all 1792 encodings exactly as the independent reference table says', () => {
  const reference = readFileSync(REFERENCE, 'utf8').split('\n').filter((l) => l !== '' && !l.startsWith('#'));
  expect(reference.length).toBe(7 * 256);
  const mismatches: string[] = [];
  let i = 0;
  for (const section of SECTIONS) {
    const table = TABLES[section.name];
    for (let op = 0; op < 256; op++) {
      const expected = reference[i++]!;
      const actual = renderEntry(section, op, table[op]!);
      if (actual !== expected) mismatches.push(`${section.name} ${hex2(op)}\n  reference: ${expected}\n  decoded:   ${actual}`);
    }
  }
  expect(mismatches, `${mismatches.length} mismatches:\n${mismatches.join('\n')}`).toEqual([]);
});
