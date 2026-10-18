/**
 * The spec §3 `m.keyboard`: a cycle-timed key queue over the KeyboardMatrix, and the feed buffer
 * the ROM keyboard-scan hook (spec §6) reads.
 *
 * Matrix mode presses and releases matrix keys at T-state timestamps, as a typist would; any
 * program sees them, the ROM and games that scan $3800 directly alike. Hook mode hands characters
 * to the ROM's own scan entries ($002B, $0049) without touching the matrix, so it is fast and
 * exact but reaches only code that calls the ROM. The Machine drains the queue at instruction
 * boundaries and runs the hook there.
 */
import { CPU_CLOCK_HZ } from '../machine/trs80-system.js';

/** Key names → the KeyboardMatrix's browser-key names. */
const NAMES = {
  ENTER: 'Enter',
  CLEAR: 'Clear',
  BREAK: 'Escape',
  UP: 'ArrowUp',
  DOWN: 'ArrowDown',
  LEFT: 'ArrowLeft',
  RIGHT: 'ArrowRight',
  SHIFT: 'Shift',
  SPACE: ' ',
};

/**
 * The KeyboardMatrix key for a character or key name. The matrix maps browser keys, where an
 * uppercase letter is physically shifted; on the Model III an unshifted letter key types the
 * capital, so 'A' presses the bare A key and 'a' presses SHIFT+A.
 * @param {string} key
 * @returns {string}
 */
function matrixKey(key) {
  if (Object.hasOwn(NAMES, key)) return NAMES[key];
  if (key === '\n') return 'Enter';
  if (/^[A-Z]$/.test(key)) return key.toLowerCase();
  if (/^[a-z]$/.test(key)) return key.toUpperCase();
  return key;
}

/**
 * The byte the ROM's keyboard routine returns for a fed character: its ASCII code, with '\n'
 * as ENTER ($0D).
 * @param {string} ch
 * @returns {number}
 */
function romCode(ch) {
  if (ch === '\n') return 0x0d;
  const code = ch.codePointAt(0) ?? 0;
  if (ch.length !== 1 || code < 0x01 || code > 0x7f) throw new Error(`feed: ${JSON.stringify(ch)} is not a character the ROM keyboard routine returns (ASCII $01-$7F, or '\\n' for ENTER)`);
  return code;
}

/** Sign, zero, the undocumented bits 5 and 3, and parity, as the Z80 sets them for a logical op on `v`. */
function logicFlags(v) {
  let parity = v;
  parity ^= parity >> 4;
  parity ^= parity >> 2;
  parity ^= parity >> 1;
  return (v & 0xa8) | (v === 0 ? 0x40 : 0) | ((parity & 1) === 0 ? 0x04 : 0);
}

/** F after `CP 01H` with A = `a` (the last flag-setting instruction of the $002B path, at $3100). */
function cp01Flags(a) {
  const r = (a - 1) & 0xff;
  return (r & 0x80) | (r === 0 ? 0x40 : 0) | ((a & 0x0f) < 1 ? 0x10 : 0) | ((a ^ 1) & (a ^ r) & 0x80 ? 0x04 : 0) | 0x02 | (a < 1 ? 0x01 : 0);
}

/** The KDCB, the keyboard device control block at $4015: $002B loads DE with it and returns it there. */
const KDCB = 0x4015;

/**
 * Return from the ROM keyboard routine at `pc` ($002B or $0049) as the Model III ROM does with
 * `code` in A, verified against the ROM listing (spec §6, "Keyboard-scan hook"): DE = $4015 (the
 * KDCB), BC, HL, IX, IY and the alternate set unchanged, F as the routine's last flag-setting
 * instruction leaves it (`CP 01H` at $3100 for $002B, `OR A` at $004C for $0049), and the return
 * address popped.
 *
 * The Model I Level II ROM keeps the same contract (MDL1LEV2.Z80, kiwisincebirth/TRS-80-ROMS at
 * 736bcba): `_KBD` at $002B loads DE with the KDCB ($4015) and goes through `_GET` ($0013) and
 * `CIO` ($03C2), which saves BC, HL, IX, and that DE and restores them at `CIORTN` ($03DD), to the
 * keyboard driver `KBDDRV` ($03E3, the KDCB's driver address at $4016), whose path for a key ends
 * with `CP $01` at $0453 (the BREAK test) and `RET NZ`, or for BREAK `RST 28H` (a RET under
 * Level II, $400C) and `RET`; `_KEY` at $0049 is `CALL _KBD / OR A / RET NZ / JR _KEY`. So the
 * stand-in is the same on both models (phase 6 plan, Ruling 6). It also does what the CPU does at the end of any instruction: clears `afterPrefix`
 * and counts a pending EI down. It costs what a RET costs, 10 T-states and one refresh-counter step; the
 * routine's RAM side effects (its key-rollover buffer at $4036, the repeat counters) are not made.
 * @param {import('../cpu/z80cpu.js').Z80CPU} cpu
 * @param {number} pc
 * @param {number} code
 */
export function romKeyReturn(cpu, pc, code) {
  const r = cpu.registers;
  cpu.afterPrefix = false;
  r.A = code;
  r.F = pc === 0x0049 ? logicFlags(code) : cp01Flags(code);
  r.D = KDCB >> 8;
  r.E = KDCB & 0xff;
  const sp = r.SP;
  r.PC = cpu.readMemory(sp) | (cpu.readMemory((sp + 1) & 0xffff) << 8);
  r.SP = (sp + 2) & 0xffff;
  cpu.incrementR();
  // The end of any instruction (Z80CPU.executeInstruction): a pending EI counts down and takes effect.
  if (cpu.pendingEI > 0) {
    cpu.pendingEI--;
    if (cpu.pendingEI === 0) {
      cpu.IFF1 = true;
      cpu.IFF2 = true;
    }
  }
  cpu.lastOpCycles = 10;
  cpu.cycles += 10;
}

/**
 * @typedef {{ at: number, down: boolean, key: string, code: string }} KeyEvent
 */

export class KeyQueue {
  /** @type {import('./keyboard.js').KeyboardMatrix} */
  #matrix;
  /** @type {() => number} */
  #now;
  /** @type {number} */
  #clockHz;
  /** @type {KeyEvent[]} Matrix events in time order. */
  #events = [];
  /** @type {number} Index of the next undelivered matrix event. */
  #next = 0;
  /** @type {number[]} ROM codes waiting for the keyboard-scan hook. */
  #feed = [];
  #feedNext = 0;
  /** @type {number} The T-state the queued typing ends at; new typing starts no earlier. */
  #end = 0;
  #seq = 0;
  /** T-state of the next matrix event, Infinity when none: the Machine's cheap per-instruction check. */
  nextAt = Infinity;

  /**
   * @param {import('./keyboard.js').KeyboardMatrix} matrix
   * @param {() => number} now the current T-state
   */
  /**
   * @param {import('./keyboard.js').KeyboardMatrix} matrix
   * @param {() => number} now the CPU's T-state count
   * @param {number} [clockHz] the CPU clock `type`'s cps counts in (the Model III's by default)
   */
  constructor(matrix, now, clockHz = CPU_CLOCK_HZ) {
    this.#matrix = matrix;
    this.#now = now;
    this.#clockHz = clockHz;
  }

  /**
   * Press a key now and hold it until `release`.
   * @param {string} key a character ('A', '1', ' ') or a name: ENTER, CLEAR, BREAK, UP, DOWN, LEFT, RIGHT, SHIFT, SPACE
   */
  press(key) {
    this.#matrix.keyDown(this.#mapped(key, 'press'), `press:${key}`);
  }

  /**
   * Release a key `press` holds.
   * @param {string} key
   */
  release(key) {
    this.#matrix.keyUp(`press:${key}`);
  }

  /**
   * Queue typing. In matrix mode each character is pressed for half of a 1/cps-second window and
   * released for the other half, so a repeated letter registers twice; typing starts now, or when
   * the typing already queued ends. In hook mode it is `feed`.
   *
   * Pick `cps` for the program. The default 10 cps holds each key 50 ms of emulated time, long
   * enough for the ROM's keyboard driver, which debounces. A program that reads the keyboard
   * slowly, or only once a frame or less often, can miss a short tap: Rear Guard needs ENTER held
   * about half a second (`{ cps: 1 }`). A high `cps` shortens the hold and can drop keys, and
   * typing at the ROM's line editor with no pause for the ENTER can lose characters. For
   * `press` and `release`, use the same name for both: a mismatch leaves the key down.
   *
   * `str` is a string of characters, or an array whose every element is one key: a character or
   * a key name (`['A', 'ENTER', 'UP']`), so named keys can be typed in sequence; in hook mode
   * every element must be a character the ROM routine returns.
   * @param {string | string[]} str '\n' is ENTER
   * @param {{ cps?: number, mode?: 'matrix' | 'hook' }} [opts]
   */
  type(str, { cps = 10, mode = 'matrix' } = {}) {
    if (mode === 'hook') return this.feed(str);
    if (mode !== 'matrix') throw new Error(`type: mode must be 'matrix' or 'hook', not ${String(mode)}`);
    if (!(cps > 0) || !Number.isFinite(cps)) throw new Error(`type: cps must be a positive number, not ${String(cps)}`);
    const period = Math.round(this.#clockHz / cps);
    const hold = Math.round(period / 2);
    const keys = Array.from(str, (ch) => this.#mapped(ch, 'type'));
    this.#compact();
    let t = Math.max(this.#now(), this.#end);
    for (const key of keys) {
      const code = `queue:${this.#seq++}`;
      this.#events.push({ at: t, down: true, key, code }, { at: t + hold, down: false, key, code });
      t += period;
    }
    this.#end = t;
    this.nextAt = this.#events[this.#next]?.at ?? Infinity;
  }

  /**
   * Queue characters for the ROM keyboard-scan hook: each is returned once by the next call to
   * $002B or $0049. The matrix is not touched.
   * All characters are checked first, so a bad one throws and queues nothing.
   * @param {string | string[]} str '\n' is ENTER; an array holds one character an element
   */
  feed(str) {
    const codes = Array.from(str, romCode);
    for (const code of codes) this.#feed.push(code);
  }

  /** Queued events not yet delivered: matrix presses and releases, and fed characters. */
  get pending() {
    return this.#events.length - this.#next + this.#feed.length - this.#feedNext;
  }

  /** True when a fed character is waiting for the hook. */
  get hasFeed() {
    return this.#feedNext < this.#feed.length;
  }

  /** The next fed character's ROM code, removed from the buffer. */
  takeFeed() {
    const code = this.#feed[this.#feedNext++];
    if (this.#feedNext === this.#feed.length) {
      this.#feed.length = 0;
      this.#feedNext = 0;
    }
    return code;
  }

  /**
   * Deliver every matrix event due at T-state `now`, in order.
   * @param {number} now
   */
  drain(now) {
    const events = this.#events;
    while (this.#next < events.length && events[this.#next].at <= now) {
      const e = events[this.#next++];
      if (e.down) this.#matrix.keyDown(e.key, e.code);
      else this.#matrix.keyUp(e.code);
    }
    this.nextAt = this.#next < events.length ? events[this.#next].at : Infinity;
  }

  /** Drop everything queued, releasing any queued key that is down; keys held with `press` stay down. */
  clear() {
    for (let i = this.#next; i < this.#events.length; i++) {
      if (!this.#events[i].down) this.#matrix.keyUp(this.#events[i].code);
    }
    this.#events = [];
    this.#next = 0;
    this.#feed.length = 0;
    this.#feedNext = 0;
    this.#end = 0;
    this.nextAt = Infinity;
  }

  #compact() {
    if (this.#next > 0) {
      this.#events = this.#events.slice(this.#next);
      this.#next = 0;
    }
  }

  /** @param {string} key @param {string} who */
  #mapped(key, who) {
    const k = matrixKey(key);
    if (!this.#matrix.knows(k)) throw new Error(`${who}: no matrix key for ${JSON.stringify(key)}`);
    return k;
  }
}
