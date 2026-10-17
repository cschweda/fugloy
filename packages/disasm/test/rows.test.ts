import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadBas } from '../src/bas.js';
import { basRows, formatRow, listingRows, rowIndex } from '../src/rows.js';
import type { Row } from '../src/rows.js';
import { openProgram, withHintText } from '../src/session.js';
import { goldenCases, goldenPath } from './goldens.js';

const text = (rows: Row[]): string => `${rows.map(formatRow).join('\n')}\n`;

describe('listing rows reproduce the goldens', () => {
  for (const c of goldenCases()) {
    it(c.name, () => {
      const rows = c.kind === 'pass1' ? listingRows(c.analysis, c.opts) : basRows(c.prog, c.opts);
      expect(text(rows)).toBe(readFileSync(goldenPath(c), 'utf8'));
      for (const row of rows) {
        if (row.kind !== 'code' && row.kind !== 'data') continue;
        for (const sp of row.spans) {
          if (sp.kind === 'label' || sp.kind === 'table') expect(sp.target, `${sp.text} at ${row.addr}`).toBeTypeOf('number');
          expect(sp.entry !== undefined, `${sp.text} at ${row.addr}`).toBe(sp.kind === 'table');
        }
      }
    });
  }
});

describe('row spans', () => {
  const dir = fileURLToPath(new URL('../../../examples/sea-dragon/', import.meta.url));
  const s = withHintText(
    openProgram(new Uint8Array(readFileSync(`${dir}seadrg01.cmd`)), { name: 'seadrg01.cmd', selection: { machine: 3, dos: 'trsdos' } }),
    readFileSync(`${dir}seadrg01.hints`, 'utf8'),
    'seadrg01.hints',
  );
  const rows = listingRows(s.analysis, { source: 'seadrg01.cmd' });
  const index = rowIndex(rows);
  const at = (addr: number): Row => rows[index.get(addr)!]!;

  it('splits OUT (MODEPORT),A into a mnemonic, a table name for port $EC, and a register', () => {
    const row = at(0x499f);
    if (row.kind !== 'code') throw new Error(`row at $499F is ${row.kind}`);
    expect(row.spans.map(({ text, kind }) => [text, kind])).toEqual([
      ['OUT', 'mnemonic'],
      [' ', 'punct'],
      ['(', 'punct'],
      ['MODEPORT', 'table'],
      [')', 'punct'],
      [',', 'punct'],
      ['A', 'register'],
    ]);
    const name = row.spans[3]!;
    expect(name.target).toBe(0xec);
    expect(name.entry?.name).toBe('MODEPORT');
  });

  it('gives a CALL to the program’s own routine a label span with its target', () => {
    const row = at(0x499a);
    if (row.kind !== 'code') throw new Error(`row at $499A is ${row.kind}`);
    const label = row.spans.find((sp) => sp.kind === 'label');
    expect(label).toEqual({ text: 'SUB_4B9E', kind: 'label', target: 0x4b9e });
    expect(row.spans.map((sp) => sp.text).join('')).toBe('CALL SUB_4B9E');
  });

  it('indexes an address with a label at its label row', () => {
    expect(at(0x49b1)).toEqual({ kind: 'label', addr: 0x49b1, name: 'L49B1', user: false });
    expect(rows[index.get(0x49b1)! + 1]).toMatchObject({ kind: 'code', addr: 0x49b1 });
  });

  it('marks the header, the blank, the ORG, and the relocated note', () => {
    expect(rows[0]).toMatchObject({ kind: 'header' });
    const org = rows.findIndex((r) => r.kind === 'org');
    expect(rows[org - 1]).toEqual({ kind: 'blank' });
    expect(rows.slice(0, org - 1).every((r) => r.kind === 'header')).toBe(true);
    expect(rows[org + 1]).toEqual({ kind: 'note', text: '; relocated: file $5200-$8880 executes at $497F-$7FFF', addr: 0x497f });
  });
});

describe('BASIC rows', () => {
  it('prints a line with an empty body as its number alone, as the pass 1 listing always has', () => {
    // FF header, line 10 with nothing but its terminating 00, then the end marker.
    const prog = loadBas(new Uint8Array([0xff, 0x05, 0x6a, 0x0a, 0x00, 0x00, 0x00, 0x00]));
    const rows = basRows(prog);
    expect(rows[1]).toEqual({ kind: 'basic', line: 10, addr: 0x6a00, text: '' });
    expect(formatRow(rows[1]!)).toBe('10');
  });
});
