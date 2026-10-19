// 5C Task 1, Ruling 13: the screen as text rows, for the screen-reader mirror.
import { describe, expect, it } from 'vitest';
import { Machine } from '@fugloy/emu';
import { changedRows, screenAnnouncement, screenRows } from '../app/utils/emulator/screen-text';
import { screenView } from '../app/utils/emulator/screen';
import { stubRom } from '../app/utils/emulator/stub-rom';

const VIEW = { columns: 64, rows: 16, wide: false, inverse: false };
const blank = (): Uint8Array => new Uint8Array(1024).fill(0x20);
const put = (raw: Uint8Array, at: number, s: string | number[]): void => raw.set(typeof s === 'string' ? [...s].map((c) => c.charCodeAt(0)) : s, at);

describe('screen rows', () => {
  it('reads graphics (0BFH) as a space and trims trailing spaces', () => {
    const raw = blank();
    put(raw, 0, [0x48, 0x49, 0xbf, 0x58]);
    put(raw, 64, [0x41, 0xbf, 0x80]);
    const rows = screenRows(raw, VIEW);
    expect(rows).toHaveLength(16);
    expect(rows[0]).toBe('HI X');
    expect(rows[1]).toBe('A');
    expect(rows[2]).toBe('');
  });

  it('folds 00H-1FH to 40H-5FH, as the character generator does', () => {
    const raw = blank();
    put(raw, 0, [0x01, 0x02]);
    expect(screenRows(raw, VIEW)[0]).toBe('AB');
  });

  it('in 32-column mode reads every other byte', () => {
    const raw = blank();
    put(raw, 0, 'HxIx');
    expect(screenRows(raw, { ...VIEW, columns: 32 })[0]).toBe('HI');
  });

  it('on a Model 4 in 80 columns, reads 24 rows of 80, and inverse video as its character', () => {
    const raw = new Uint8Array(1920).fill(0x20);
    put(raw, 80, [0x41 | 0x80, 0x42]);
    const rows = screenRows(raw, { columns: 80, rows: 24, wide: true, inverse: true });
    expect(rows).toHaveLength(24);
    expect(rows[1]).toBe('AB');
  });
});

describe('the Model I without the lowercase option', () => {
  it("reads lowercase as the screen shows it: emu folds bit 6 as it stores the byte, as m.video.text() reads", () => {
    const text = 'Hello, world';
    const bytes = new Uint8Array([...text].map((c) => c.charCodeAt(0)));
    const plain = new Machine({ model: 1, roms: { level2: stubRom(1) } });
    plain.mem.write(0x3c00, new Uint8Array(1024).fill(0x20));
    plain.mem.write(0x3c00, bytes);
    const row = screenRows(plain.video.raw, screenView(plain))[0]!;
    expect(row).toBe(plain.video.text()[0]!.trimEnd());
    expect(row).not.toBe(text);
    const fitted = new Machine({ model: 1, roms: { level2: stubRom(1) }, lowercase: true });
    fitted.mem.write(0x3c00, new Uint8Array(1024).fill(0x20));
    fitted.mem.write(0x3c00, bytes);
    expect(screenRows(fitted.video.raw, screenView(fitted))[0]).toBe(text);
  });
});

describe('changes and announcements', () => {
  it('names the rows that changed', () => {
    expect(changedRows(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([1]);
    expect(changedRows(['a'], ['a'])).toEqual([]);
  });

  it('up to 3 changed rows are read out; more are summarised', () => {
    const rows = ['', 'SCORE 120', '', 'LIVES 3', '', ''];
    expect(screenAnnouncement(rows, [1, 2])).toBe('Row 2: SCORE 120. Row 3: blank.');
    expect(screenAnnouncement(rows, [0, 1, 2, 3])).toBe('The screen changed (4 rows).');
    expect(screenAnnouncement(rows, [])).toBeNull();
  });
});
