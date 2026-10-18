/**
 * The video as a text readout: 16 lines over video RAM at $3C00-$3FFF, 64 columns, or 32 in
 * 32-column mode (on the Model III, port $EC bit 2), where the hardware shows the even-address
 * bytes double-wide. It reads the live video RAM; it draws nothing. The Model I's video RAM sits
 * at the same addresses (models.js); its missing bit 6 and its 32-column bit (port $FF) are not
 * modeled yet, so a Model I reads back every byte as written and always shows 64 columns.
 */

import { fromBase64 } from '../debug/state.js';

export class Video {
  #system;

  /** @param {import('../machine/trs80-system.js').TRS80System} system */
  constructor(system) {
    this.#system = system;
  }

  /** @returns {Uint8Array} A live view of $3C00-$3FFF (1024 bytes). */
  get raw() {
    return this.#system.memory.videoRam;
  }

  /** @returns {64 | 32} */
  get columns() {
    return this.#system.columns32 ? 32 : 64;
  }

  /**
   * The screen as 16 lines of text. Bytes below $20 show as +$40 (the Model III character
   * generator folds them to $40-$5F), and graphics and special bytes ($80-$FF) show as '.'.
   * @returns {string[]}
   */
  text() {
    const ram = this.raw;
    const step = this.#system.columns32 ? 2 : 1;
    const cols = 64 / step;
    const rows = [];
    for (let row = 0; row < 16; row++) {
      let line = '';
      for (let col = 0; col < cols; col++) {
        let byte = ram[row * 64 + col * step];
        if (byte < 0x20) byte += 0x40;
        line += byte >= 0x20 && byte < 0x80 ? String.fromCharCode(byte) : '.';
      }
      rows.push(line);
    }
    return rows;
  }

  /**
   * The cells of video RAM that differ from a snapshot's (`m.debug.snapshot()`), row-major, as
   * byte values over the 64-column RAM layout (32-column mode shows only even columns).
   * @param {any} snap
   * @returns {{ row: number, col: number, was: number, now: number }[]}
   */
  diff(snap) {
    const text = snap?.memory?.videoRam;
    if (typeof text !== 'string') throw new Error('video.diff needs a snapshot from m.debug.snapshot()');
    const was = fromBase64(text);
    const now = this.raw;
    const out = [];
    for (let i = 0; i < now.length; i++) {
      if (was[i] !== now[i]) out.push({ row: i >> 6, col: i & 63, was: was[i], now: now[i] });
    }
    return out;
  }
}
