/**
 * @fugloy/runtime, M1 Task 1: the keyboard. The runtime's key table (a name's row and bit) must equal
 * @fugloy/emu's for every name `m.keyboard.press` accepts, and `press` and `release` must hold and let
 * go of keys as emu's do, SHIFT combinations included. Emu's names are its own: the single characters
 * (src/devices/key-queue.js `matrixKey`, which swaps a letter's case, and keyboard.js's KEY_MAP) and the
 * words below, which this test lists because emu does not export them.
 */
import { Machine } from '@fugloy/emu';
import { describe, expect, it } from 'vitest';
import { KEY_TABLE, createZ } from '../src/index.js';

/** The names key-queue.js's NAMES gives (lines 14-24). */
const NAMED = ['ENTER', 'CLEAR', 'BREAK', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'SHIFT', 'SPACE'];
/** The browser key names keyboard.js's KEY_MAP gives (lines 82-93), which `press` passes through. */
const BROWSER = ['Enter', 'Clear', 'Home', 'Escape', 'Pause', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'Backspace', 'ArrowRight', 'Shift'];
/** Names near the real ones that emu refuses, and words an object's prototype answers to. */
const NOT_KEYS = ['', 'enter', 'Space', 'Tab', 'F1', 'AA', 'ShiftLeft', 'RSHIFT', 'constructor', '__proto__', 'toString', 'hasOwnProperty'];
/** Every one-character name, U+0000 through U+00FF: emu takes the printable ones and '\n'. */
const SINGLE = Array.from({ length: 256 }, (_, code) => String.fromCharCode(code));
const CANDIDATES = [...SINGLE, ...NAMED, ...BROWSER, ...NOT_KEYS];

const emu = () => new Machine({ roms: { level2: new Uint8Array(0x3800) } });
/** The matrix's eight rows as a program reads them: the byte at $3801, $3802, $3804 ... $3880. */
const rowsOf = (m) => Array.from({ length: 8 }, (_, row) => m.mem.read(0x3800 + (1 << row), 1)[0]);
/** The matrix positions rows have down, as sorted `row * 8 + bit` numbers. */
const positionsOf = (rows) => rows.flatMap((byte, row) => [0, 1, 2, 3, 4, 5, 6, 7].filter((bit) => byte & (1 << bit)).map((bit) => row * 8 + bit)).sort((a, b) => a - b);

/** The rows emu's `press(name)` makes, or null when it refuses the name; the key is released again. */
function emuRows(m, name) {
  try {
    m.keyboard.press(name);
  } catch {
    return null;
  }
  const rows = rowsOf(m);
  m.keyboard.release(name);
  return rows;
}

describe('the key table', () => {
  const m = emu();
  const accepted = CANDIDATES.filter((name) => emuRows(m, name) !== null);

  it('finds the names emu accepts, and not a vacuous few', () => {
    // 52 letters, @, 10 digits, 6 punctuation marks, 15 shifted symbols, SPACE, '\n', and the words
    expect(accepted.length).toBe(52 + 1 + 10 + 6 + 15 + 2 + NAMED.length + BROWSER.length);
    for (const name of ['A', 'a', '1', '!', ' ', '\n', 'ENTER', 'Escape', 'Shift']) expect(accepted).toContain(name);
    for (const name of ['', 'F1', 'enter', 'constructor']) expect(accepted).not.toContain(name);
  });

  it("gives every name emu accepts the row and bit emu's matrix gives it", () => {
    const bad = [];
    for (const name of accepted) {
      const want = positionsOf(emuRows(m, name));
      const got = (KEY_TABLE.get(name) ?? []).map(({ row, bit }) => row * 8 + bit).sort((a, b) => a - b);
      if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${JSON.stringify(name)}: ${JSON.stringify(got)}, emu ${JSON.stringify(want)}`);
    }
    expect(bad).toEqual([]);
  });

  it('holds exactly the names emu accepts, no more', () => {
    expect([...KEY_TABLE.keys()].sort()).toEqual([...accepted].sort());
  });

  it("presses the same matrix emu's press does, name by name, and releases it clean", () => {
    const z = createZ({ model: 'flat' });
    const bad = [];
    for (const name of CANDIDATES) {
      const want = emuRows(m, name);
      let got = null;
      try {
        z.press(name);
        got = Array.from(z.keys);
        z.release(name);
      } catch {
        // refused
      }
      if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${JSON.stringify(name)}: ${JSON.stringify(got)}, emu ${JSON.stringify(want)}`);
      if (z.keys.some((byte) => byte !== 0)) bad.push(`${JSON.stringify(name)} left keys down: ${JSON.stringify(Array.from(z.keys))}`);
    }
    expect(bad).toEqual([]);
  });

  it('puts the keys where the matrix puts them: A at row 0 bit 1, a as A with SHIFT, SPACE at row 6 bit 7', () => {
    expect(KEY_TABLE.get('A')).toEqual([{ row: 0, bit: 1 }]);
    expect(KEY_TABLE.get('a')).toEqual([{ row: 0, bit: 1 }, { row: 7, bit: 0 }]);
    expect(KEY_TABLE.get('@')).toEqual([{ row: 0, bit: 0 }]);
    expect(KEY_TABLE.get('8')).toEqual([{ row: 5, bit: 0 }]);
    expect(KEY_TABLE.get('"')).toEqual([{ row: 4, bit: 2 }, { row: 7, bit: 0 }]);
    expect(KEY_TABLE.get('SPACE')).toEqual([{ row: 6, bit: 7 }]);
    expect(KEY_TABLE.get(' ')).toEqual(KEY_TABLE.get('SPACE'));
    expect(KEY_TABLE.get('\n')).toEqual(KEY_TABLE.get('ENTER'));
    expect(KEY_TABLE.get('BREAK')).toEqual(KEY_TABLE.get('Escape'));
  });
});

describe('press and release', () => {
  it('hold a key until it is released, as emu does, the SHIFT a lowercase letter or symbol carries included', () => {
    const m = emu();
    const z = createZ({ model: 3 });
    const script = [
      ['press', 'a'],
      ['press', 'SHIFT'],
      ['release', 'a'], // the explicit SHIFT stays down
      ['press', '!'],
      ['release', 'SHIFT'], // the '!' still carries its own
      ['press', 'a'],
      ['press', 'a'], // twice is once
      ['release', 'a'],
      ['release', 'a'], // and a release of what is up is nothing
      ['release', 'never pressed'],
      ['press', 'A'],
      ['release', 'a'], // another name: the key stays down
      ['release', 'A'],
      ['press', 'SPACE'],
      ['press', ' '],
      ['release', 'SPACE'], // ' ' still holds the same key
      ['release', ' '],
      ['release', '!'],
    ];
    script.forEach(([op, name], step) => {
      m.keyboard[op](name);
      z[op](name);
      expect(Array.from(z.keys), `step ${step + 1}: ${op} ${JSON.stringify(name)}`).toEqual(rowsOf(m));
    });
    expect(Array.from(z.keys)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('rebuild z.keys in place: the one Uint8Array(8) a port and its host share', () => {
    const z = createZ({ model: 1 });
    const keys = z.keys;
    z.press('ENTER');
    z.press('SHIFT');
    expect(z.keys).toBe(keys);
    expect(Array.from(keys)).toEqual([0, 0, 0, 0, 0, 0, 0x01, 0x01]);
    z.release('ENTER');
    expect(Array.from(keys)).toEqual([0, 0, 0, 0, 0, 0, 0, 0x01]);
  });

  it('refuse a name with no key with a sentence that quotes it, as emu does, and press nothing', () => {
    const z = createZ({ model: 3 });
    expect(() => z.press('F1')).toThrow('press: no matrix key for "F1"');
    expect(() => z.press('')).toThrow('press: no matrix key for ""');
    expect(() => z.press(undefined)).toThrow('press: no matrix key for undefined');
    expect(Array.from(z.keys)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(() => emu().keyboard.press('F1')).toThrow('press: no matrix key for "F1"');
  });
});
