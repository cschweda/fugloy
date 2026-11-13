/**
 * The TRS-80 keyboard: an 8x8 switch matrix (a key is a row and a bit), the names `press` and `release`
 * take, and the keys a host holds down. It mirrors @fugloy/emu, and cites it:
 * packages/emu/src/devices/keyboard.js (the matrix, its reads, and the keys by browser name) and
 * key-queue.js (the names `m.keyboard.press` takes over those). keys.test.js checks the table against
 * emu's for every name emu accepts.
 */

/** @typedef {{ readonly row: number, readonly bit: number }} Position a key's place in the matrix */

/** @type {Position} keyboard.js:21: SHIFT, the bit 0 of row 7 */
const SHIFT = Object.freeze({ row: 7, bit: 0 });

/** @param {number} row @param {number} bit @returns {Position} */
const at = (row, bit) => Object.freeze({ row, bit });

/**
 * The keys, row by row, bit 0 first (the layout at keyboard.js:9-13 and the letters, digits and
 * punctuation of :39-93). A letter's name is its capital: on the Model III the bare key types the
 * capital.
 */
const LAYOUT = [
  ['@', 'A', 'B', 'C', 'D', 'E', 'F', 'G'],
  ['H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'],
  ['P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W'],
  ['X', 'Y', 'Z'],
  ['0', '1', '2', '3', '4', '5', '6', '7'],
  ['8', '9', ':', ';', ',', '-', '.', '/'],
  ['ENTER', 'CLEAR', 'BREAK', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'SPACE'],
  ['SHIFT'],
];

/**
 * The symbols on the shifted number keys, each with the row and bit of the key it shares: the Level II
 * legends (keyboard.js:64-79).
 * @type {readonly (readonly [symbol: string, row: number, bit: number])[]}
 */
const SHIFTED = [
  ['!', 4, 1], ['"', 4, 2], ['#', 4, 3], ['$', 4, 4], ['%', 4, 5], ['&', 4, 6], ["'", 4, 7],
  ['(', 5, 0], [')', 5, 1], ['*', 5, 2], ['+', 5, 3], ['<', 5, 4], ['=', 5, 5], ['>', 5, 6], ['?', 5, 7],
];

/**
 * Other names for the same keys: the characters ' ' and '\n' (keyboard.js:92; key-queue.js:35) and the
 * browser key names emu's `press` passes through unchanged (keyboard.js:82-93).
 */
const ALIASES = {
  ' ': 'SPACE',
  '\n': 'ENTER',
  Enter: 'ENTER',
  Clear: 'CLEAR',
  Home: 'CLEAR',
  Escape: 'BREAK',
  Pause: 'BREAK',
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  Backspace: 'LEFT',
  ArrowRight: 'RIGHT',
  Shift: 'SHIFT',
};

/** @returns {Map<string, readonly Position[]>} */
function buildTable() {
  /** @type {Map<string, readonly Position[]>} */
  const table = new Map();
  LAYOUT.forEach((names, row) => names.forEach((name, bit) => table.set(name, Object.freeze([at(row, bit)]))));
  // key-queue.js:33-39: a lowercase letter is the capital's key with SHIFT, as the Model III types it
  for (let code = 0x41; code <= 0x5a; code++) {
    const capital = String.fromCharCode(code);
    table.set(capital.toLowerCase(), Object.freeze([...(table.get(capital) ?? []), SHIFT]));
  }
  for (const [symbol, row, bit] of SHIFTED) table.set(symbol, Object.freeze([at(row, bit), SHIFT]));
  for (const [alias, name] of Object.entries(ALIASES)) {
    const keys = table.get(name);
    if (keys !== undefined) table.set(alias, keys);
  }
  return table;
}

/**
 * Every name `press` and `release` take, to the matrix positions it holds down: one for a bare key,
 * two (the key, then SHIFT) for a lowercase letter or a shifted symbol. The names are emu's: the
 * capital letters A-Z, the lowercase a-z (with SHIFT), @ 0-9 : ; , - . / ! " # $ % & ' ( ) * + < = > ?,
 * ENTER CLEAR BREAK UP DOWN LEFT RIGHT SHIFT SPACE, ' ' and '\n', and the browser names Enter Clear Home
 * Escape Pause ArrowUp ArrowDown ArrowLeft Backspace ArrowRight Shift.
 * @type {ReadonlyMap<string, readonly Position[]>}
 */
export const KEY_TABLE = buildTable();

/** The keys held down, and the matrix they make. */
export class KeyMatrix {
  /** @type {Map<string, readonly Position[]>} the keys held, by the name each was pressed with */
  #held = new Map();

  constructor() {
    /**
     * The matrix: one byte a row, a set bit a key down. It is rebuilt in place, so whoever holds this
     * array sees every change.
     */
    this.rows = new Uint8Array(8);
  }

  /**
   * Hold the key `name` names down until it is released, as emu's `m.keyboard.press` does
   * (key-queue.js:163-165): a name pressed twice is held once, and a lowercase letter or shifted symbol
   * brings its own SHIFT.
   * @param {string} name a key of KEY_TABLE
   */
  press(name) {
    const keys = KEY_TABLE.get(name);
    if (keys === undefined) throw new Error(`press: no matrix key for ${JSON.stringify(name)}`);
    this.#held.set(name, keys);
    this.#rebuild();
  }

  /**
   * Let go of what `press(name)` held, with the same name: a mismatch leaves the key down, and a name
   * that is not held is nothing to release, as emu's `m.keyboard.release` (key-queue.js:171-173).
   * @param {string} name
   */
  release(name) {
    if (this.#held.delete(name)) this.#rebuild();
  }

  /**
   * A read of the keyboard at $3800-$3BFF: the OR of every row whose select bit is set in `select`,
   * the address's low byte (keyboard.js:111-120).
   * @param {number} select
   * @returns {number}
   */
  read(select) {
    const rows = this.rows;
    let value = 0;
    for (let row = 0; row < 8; row++) if (select & (1 << row)) value |= rows[row];
    return value;
  }

  // The matrix is always the keys still held, so a SHIFT that two names share cannot be lost when one
  // of them is released (keyboard.js:166-175).
  #rebuild() {
    this.rows.fill(0);
    for (const keys of this.#held.values()) for (const { row, bit } of keys) this.rows[row] |= 1 << bit;
  }
}
