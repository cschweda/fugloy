/**
 * The player's keyboard (M2): browser key events turned into the TRS-80's matrix rows, written into memory
 * the worker running the port reads once a frame. No DOM: page.js passes each event's `key`, `code` and
 * modifier flags.
 *
 * A browser key is mapped by the character it types (`key`), as @fugloy/emu's own browser mapping does
 * (packages/emu/src/devices/keyboard.js, KEY_MAP and keyDown): a lowercase letter is the bare key (the
 * Model III types its capital), a capital is the key with SHIFT, a character on a shifted TRS-80 key
 * brings its SHIFT (`"` is SHIFT+2), and Enter, Escape (BREAK), the arrows, Backspace (LEFT), Home
 * (CLEAR), the space bar and Shift are the keys they name. Each press is remembered by its physical key
 * (`code`), so the key-up releases what the key-down pressed.
 *
 * Shift follows the workbench's rule (apps/web/app/utils/emulator/keyboard.ts): the TRS-80's `:` and `@`
 * are unshifted keys that a US keyboard types with Shift, and a held SHIFT would turn `:` into `*`. So
 * while a character key is down the physical Shift is lifted from the matrix, and it is back when the
 * last character key is up with Shift still held. Shift alone, or with the arrows or the space bar, is the
 * TRS-80's SHIFT (games read it). Tab and keys with Ctrl, Cmd or Alt are never taken, so the browser keeps
 * its shortcuts. A blur releases every key.
 *
 * The worker copies the rows once a frame, so a key pressed and released between two copies would never
 * be seen. A KeyTracker therefore holds a key that is let go before the worker has copied the rows with it
 * down: the worker counts its frames in shared memory (frame.js, `frameHook`), and a released key stays in
 * the rows until that count has moved past the count at its press, that is until one copy has had it
 * down. The page calls `update()` at each frame the worker posts, which lets such keys go.
 */
import { KEY_TABLE } from '../keys.js';

/** @typedef {import('../keys.js').Position} Position */

/** emu's keyboard.js:85-93: the browser key names it maps, by name; each is a key of the runtime's table. */
const BROWSER_NAMES = ['Enter', 'Clear', 'Home', 'Escape', 'Pause', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'Backspace', 'ArrowRight', 'Shift'];
/** emu's keyboard.js:38-79: the characters it maps besides the letters, each a name of the runtime's table. */
const CHARACTERS = '@0123456789:;,-./!"#$%&\'()*+<=>? ';

/**
 * The matrix keys each browser `key` presses: emu's KEY_MAP, built from the runtime's table, whose names
 * are emu's `m.keyboard.press` names (a capital is the bare key there, a lowercase letter the key with
 * SHIFT); a browser's letters are the other way about.
 * @type {ReadonlyMap<string, readonly Position[]>}
 */
export const BROWSER_KEYS = (() => {
  /** @type {Map<string, readonly Position[]>} */
  const map = new Map();
  const of = (/** @type {string} */ name) => /** @type {readonly Position[]} */ (KEY_TABLE.get(name));
  for (let code = 0x41; code <= 0x5a; code++) {
    const capital = String.fromCharCode(code);
    map.set(capital.toLowerCase(), of(capital));
    map.set(capital, of(capital.toLowerCase()));
  }
  for (const c of CHARACTERS) map.set(c, of(c));
  for (const name of BROWSER_NAMES) map.set(name, of(name));
  return map;
})();

/** The TRS-80's SHIFT: row 7, bit 0 (emu's keyboard.js:21). */
const SHIFT_ROW = 7;
const SHIFT_BIT = 0x01;

/**
 * A key event as the tracker reads it: KeyboardEvent's `key` (the character or the key's name), `code`
 * (the physical key) and the modifiers.
 * @typedef {{ key: string, code: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean }} KeyEvent
 */

/** Turns key events into the matrix's eight rows, which it writes into `rows` at every change. */
export class KeyTracker {
  /** @type {Map<string, { keys: readonly Position[], char: boolean, pressed: number, released: boolean }>} the keys down (or held over), by `code` */
  #down = new Map();
  /** @type {Set<string>} the physical Shift keys held, by `code` */
  #shifts = new Set();

  /**
   * @param {Uint8Array} rows the eight rows the worker copies (shared memory in a browser), written here
   * @param {() => number} frame the worker's frame count (frame.js's shared counter), read when a key goes
   *   down and when it is let go
   */
  constructor(rows, frame) {
    this.rows = rows;
    this.frame = frame;
  }

  /**
   * A key went down. Returns true when it is the TRS-80's, so the page prevents the browser's default.
   * @param {KeyEvent} e
   * @returns {boolean}
   */
  down(e) {
    if (e.key === 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === 'Shift') {
      this.#shifts.add(e.code);
      this.#write();
      return true;
    }
    const keys = BROWSER_KEYS.get(e.key);
    if (keys === undefined) return false;
    // A character (not the space bar) lifts the physical Shift while it is down
    const char = e.key.length === 1 && e.key !== ' ';
    this.#down.set(e.code, { keys, char, pressed: this.frame(), released: false });
    this.#write();
    return true;
  }

  /**
   * A key went up. Returns true when it was one the tracker took. A key the worker has not yet seen down is
   * held over until it has (`update`).
   * @param {KeyEvent} e
   * @returns {boolean}
   */
  up(e) {
    if (this.#shifts.delete(e.code)) {
      this.#write();
      return true;
    }
    const held = this.#down.get(e.code);
    if (held === undefined || held.released) return false;
    held.released = true;
    if (this.frame() > held.pressed) this.#down.delete(e.code);
    this.#write();
    return true;
  }

  /** The worker has posted a frame: let go of the keys held over that it has now seen down. */
  update() {
    const now = this.frame();
    let changed = false;
    for (const [code, held] of this.#down) {
      if (held.released && now > held.pressed) {
        this.#down.delete(code);
        changed = true;
      }
    }
    if (changed) this.#write();
  }

  /** The page lost the keyboard: every key up at once, held-over ones too. */
  blur() {
    this.#down.clear();
    this.#shifts.clear();
    this.#write();
  }

  // The rows are rebuilt from every key down, so a SHIFT two keys share is never lost when one goes up
  #write() {
    const rows = new Uint8Array(8);
    let chars = false;
    for (const { keys, char } of this.#down.values()) {
      chars ||= char;
      for (const { row, bit } of keys) rows[row] |= 1 << bit;
    }
    if (!chars && this.#shifts.size > 0) rows[SHIFT_ROW] |= SHIFT_BIT;
    this.rows.set(rows);
  }
}
