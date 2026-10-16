import { describe, expect, it } from 'vitest';
import { compareRoms, renderComparison } from '../../src/symbols/compare.js';
import type { TableEntry } from '../../src/symbols/types.js';

const rom = (table: 'rom-model1' | 'rom-model3', key: number, name: string, over: Partial<TableEntry> = {}): TableEntry => ({
  table,
  kind: 'routine',
  key,
  name,
  length: 1,
  purpose: 'p',
  cite: [{ source: 'm3-basic', page: '1' }],
  coined: false,
  ...over,
});
const one = (key: number, name: string, over: Partial<TableEntry> = {}): TableEntry => rom('rom-model1', key, name, over);
const three = (key: number, name: string, over: Partial<TableEntry> = {}): TableEntry => rom('rom-model3', key, name, over);

describe('compareRoms', () => {
  it('classes an address both tables name alike as shared', () => {
    expect(compareRoms([one(0x49, '$KBWAIT')], [three(0x49, '$KBWAIT')])).toEqual({ classes: { '0049': 'shared' }, unexplained: [] });
  });

  it('classes an address with a different name as different, and reports it when neither entry has a note', () => {
    expect(compareRoms([one(0x49, '$KEY')], [three(0x49, '$KBWAIT')])).toEqual({
      classes: { '0049': 'different' },
      unexplained: ['$0049 is $KEY (routine) in rom-model1.json but $KBWAIT (routine) in rom-model3.json, and neither entry has a note saying why'],
    });
  });

  it('classes an address with the same name but a different kind as different', () => {
    const r = compareRoms([one(0x4000, 'CURSOR', { kind: 'variable' })], [three(0x4000, 'CURSOR')]);
    expect(r.classes).toEqual({ '4000': 'different' });
    expect(r.unexplained).toHaveLength(1);
  });

  it('accepts a note on either entry as the explanation, and still classes the address different', () => {
    for (const [m1, m3] of [
      [one(0x60, '$DELAY', { note: 'a longer loop on Model I' }), three(0x60, 'DELAY3')],
      [one(0x60, '$DELAY'), three(0x60, 'DELAY3', { note: 'the Model III loop is shorter' })],
    ] as const) {
      expect(compareRoms([m1], [m3])).toEqual({ classes: { '0060': 'different' }, unexplained: [] });
    }
  });

  it('classes an address in one table as model1-only or model3-only', () => {
    expect(compareRoms([one(0x1a19, '$INKEY')], [three(0x33, '$VDCHAR')]).classes).toEqual({ '0033': 'model3-only', '1A19': 'model1-only' });
  });

  it('keys the classes by four uppercase hex digits', () => {
    const r = compareRoms([one(0x1a19, 'A_ONE'), one(0, 'RESET')], [three(0x33, 'B_TWO'), three(0xfff0, 'C_THREE'), three(0x4000, 'D_FOUR')]);
    expect(Object.keys(r.classes).sort()).toEqual(['0000', '0033', '1A19', '4000', 'FFF0']);
  });
});

describe('renderComparison', () => {
  const m1 = [one(0x33, '$VDCHAR'), one(0x60, '$DELAY', { note: 'the Model I loop | is longer' })];
  const m3 = [three(0x33, '$VDCHAR'), three(0x49, '$KBWAIT'), three(0x60, 'DELAY3')];
  const text = renderComparison(m1, m3, compareRoms(m1, m3).classes);
  const lines = text.split('\n');

  it('counts the addresses in each class', () => {
    expect(lines).toContain('| shared | 1 |');
    expect(lines).toContain('| different | 1 |');
    expect(lines).toContain('| model1-only | 0 |');
    expect(lines).toContain('| model3-only | 1 |');
  });

  it('lists every address, ascending, with its class, both names and kinds, and the notes', () => {
    const rows = lines.filter((l) => l.startsWith('| `$'));
    expect(rows).toEqual([
      '| `$0033` | shared | `$VDCHAR` (routine) | `$VDCHAR` (routine) |  |',
      '| `$0049` | model3-only | - | `$KBWAIT` (routine) |  |',
      '| `$0060` | different | `$DELAY` (routine) | `DELAY3` (routine) | Model I: the Model I loop \\| is longer |',
    ]);
  });

  it('is one document ending in a single newline', () => {
    expect(text.startsWith('# Model I and Model III ROMs compared\n')).toBe(true);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  it('renders the count table and no address rows for empty tables', () => {
    const empty = renderComparison([], [], {}).split('\n');
    expect(empty).toContain('| shared | 0 |');
    expect(empty.filter((l) => l.startsWith('| `$'))).toEqual([]);
  });
});
