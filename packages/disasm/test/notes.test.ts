import { describe, expect, it } from 'vitest';
import { emitZmac } from '../src/emit/zmac.js';
import { emptyAnnotations } from '../src/hints/apply.js';
import { buildIr } from '../src/ir.js';
import { analyze } from '../src/pipeline.js';
import { loadRaw } from '../src/raw.js';
import { formatRow, listingRows, rowIndex } from '../src/rows.js';

// $7000 LD A,1 / $7002 NOP (labelled) / $7003 RET / $7004.. six data bytes.
const mod = loadRaw(Uint8Array.from([0x3e, 0x01, 0x00, 0xc9, 1, 2, 3, 4, 5, 6]), 0x7000);
const annotations = () => {
  const a = emptyAnnotations();
  a.names.set(0x7002, 'LOOP');
  a.comments.set(0x7002, 'spin');
  a.notes.set(0x7002, ['Waits here.', '', 'Twice.']);
  a.notes.set(0x7006, ['Data note']);
  return a;
};
const analysis = () => analyze(mod, { entries: [0x7000], annotations: annotations() });

describe('notes in the listing rows', () => {
  const rows = listingRows(analysis());
  const lines = rows.map(formatRow);

  it('puts a blank row and the note rows before the label, the comment staying in its column', () => {
    const i = lines.indexOf('LOOP:');
    expect(lines.slice(i - 4, i + 2)).toEqual(['', '; Waits here.', ';', '; Twice.', 'LOOP:', lines[i + 1]]);
    expect(rows[i - 3]).toEqual({ kind: 'note', text: '; Waits here.', addr: 0x7002 });
    expect(lines[i + 1]).toMatch(/NOP\s+; spin$/);
  });

  it('starts a new data row at a note address', () => {
    const data = rows.filter((r) => r.kind === 'data').map((r) => (r.kind === 'data' ? r.addr : 0));
    expect(data).toEqual([0x7004, 0x7006]);
    expect(lines).toContain('');
    expect(rowIndex(rows).has(0x7006)).toBe(true);
  });
});

describe('notes in zmac and the IR', () => {
  it('writes the lines above the label', () => {
    const a = analysis();
    const source = emitZmac(mod.image, a.pass1, a.transfer, { symbols: a.symbols, annotations: a.annotations });
    expect(source).toContain('\n\n; Waits here.\n;\n; Twice.\nLOOP:\n\tNOP\t; spin\n');
    expect(source).toContain('\n\n; Data note\n\tDB\t03H,04H,05H,06H\n');
  });

  it('lists notes in address order, and omits the field when there are none', () => {
    const a = analysis();
    expect(buildIr(mod, a.pass1, 'n', a).notes).toEqual([{ addr: 0x7002, lines: ['Waits here.', '', 'Twice.'] }, { addr: 0x7006, lines: ['Data note'] }]);
    const b = analyze(mod, { entries: [0x7000] });
    expect('notes' in buildIr(mod, b.pass1, 'n', b)).toBe(false);
  });
});
