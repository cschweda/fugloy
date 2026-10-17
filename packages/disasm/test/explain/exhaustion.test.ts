/** Every opcode form the z80 exhaustion test enumerates explains without throwing, with a non-empty sentence. */
import { TABLES } from '@fugloy/z80';
import { describe, expect, it } from 'vitest';
import { explainLine, sentenceText } from '../../src/explain/index.js';
import { openProgram } from '../../src/session.js';

/** The z80 exhaustion test's sections: each prefix, and whether the opcode follows a displacement byte. */
const SECTIONS = [
  { name: 'base', prefix: [], cb: false },
  { name: 'cb', prefix: [0xcb], cb: false },
  { name: 'ed', prefix: [0xed], cb: false },
  { name: 'dd', prefix: [0xdd], cb: false },
  { name: 'fd', prefix: [0xfd], cb: false },
  { name: 'ddcb', prefix: [0xdd, 0xcb], cb: true },
  { name: 'fdcb', prefix: [0xfd, 0xcb], cb: true },
] as const;

/** Every byte sequence the z80 exhaustion test decodes, with the operand bytes given (`lo`, `hi`). */
function* streams(lo: number, hi: number): Generator<{ label: string; bytes: number[] }> {
  for (const s of SECTIONS) {
    for (let op = 0; op < 256; op++) {
      if (TABLES[s.name][op]!.prefix !== undefined) continue;
      const bytes = s.cb ? [...s.prefix, lo, op] : [...s.prefix, op, lo, hi];
      yield { label: `${s.name} ${op.toString(16).padStart(2, '0')}`, bytes };
    }
  }
}

const BASE = 0x5000;

describe('explainLine on every opcode form', () => {
  const cases = [
    { title: 'no tables, operands 12 34', lo: 0x12, hi: 0x34, selection: undefined },
    { title: 'Model III tables, operands pointing at the screen', lo: 0x00, hi: 0x3c, selection: { machine: 3, dos: 'trsdos' } as const },
    { title: 'Model I tables, operands pointing into ROM', lo: 0x60, hi: 0x00, selection: { machine: 1, dos: 'ldos' } as const },
  ];
  for (const c of cases) {
    it(`exhaustion: ${c.title}`, () => {
      const bad: string[] = [];
      let n = 0;
      for (const { label, bytes } of streams(c.lo, c.hi)) {
        // Trailing bytes give a short instruction something to fall into.
        const s = openProgram(new Uint8Array([...bytes, 0xc9, 0xc9]), { base: BASE, ...(c.selection === undefined ? {} : { selection: c.selection }) });
        try {
          const e = explainLine(s, BASE);
          const texts = e.sentences.map(sentenceText);
          if (texts.length === 0 || texts.some((t) => t.trim() === '')) bad.push(`${label}: empty sentence`);
          if (e.kind !== 'code' && e.kind !== 'data') bad.push(`${label}: kind ${e.kind}`);
        } catch (err) {
          bad.push(`${label}: threw ${String(err)}`);
        }
        n++;
      }
      expect(n).toBeGreaterThan(1500);
      expect(bad).toEqual([]);
    });
  }
});
