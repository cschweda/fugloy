/**
 * The video as a text readout: 16 lines over video RAM at $3C00-$3FFF, 64 columns, or 32 in
 * 32-column mode (on the Model III, port $EC bit 2; on the Model I, port $FF bit 3, MODESEL), where
 * the hardware shows the even-address bytes double-wide. It reads the live video RAM; it draws
 * nothing. The Model I's video RAM sits at the same addresses (models.js); the stock machine has no
 * bit 6 there, so a byte reads back, and shows, with bit 6 made from bits 5 and 7 (memory.js, which
 * cites the Technical Reference Handbook), unless the lowercase modification is fitted.
 *
 * The Model 4 has 2K of video RAM (memory.js, Model4Memory) and two screen sizes: 64×16 and, with
 * port $84 bit 2 set, 80×24, each row following the last in video RAM (row r at r × 80); port
 * $EC bit 2 halves either, to 32 or 40 columns of even-address bytes. The screen starts at the
 * first byte of the 2K whichever map is in force and whichever 1K page port $84 bit 7 puts at
 * $3C00: MAME's `screen_update_trs80m3` (src/mame/trs/trs80m3_v.cpp: "cols = BIT(m_mode, 2) ? 80 :
 * 64", "rows = BIT(m_mode, 2) ? 24 : 16", reading `m_p_videoram[x + m_start_address]` from the
 * start of the 2K) and xtrs (trs_io.c, port $84: `trs_screen_80x24`, bit 2; `trs_screen_inverse`,
 * bit 3). With inverse video (port $84 bit 3) a byte with bit 7 set is its character, bits 0-6,
 * drawn inverted rather than a graphics block (MAME: "if inverse mode, and bit 7 set, invert
 * gfx"), so the readout shows that character. MAME also honours the 6845's start address
 * (registers 12 and 13 through ports $88-$89), which is not modelled: the screen always starts at
 * the 2K's first byte (spec §5).
 */

import { fromBase64 } from '../debug/state.js';

export class Video {
  #system;

  /** @param {import('../machine/trs80-system.js').TRS80System} system */
  constructor(system) {
    this.#system = system;
  }

  /** @returns {Uint8Array} A live view of video RAM: $3C00-$3FFF (1024 bytes), or the Model 4's 2048. */
  get raw() {
    return this.#system.memory.videoRam;
  }

  /** True on a Model 4 in 80-column mode (port $84 bit 2). */
  get #wide() {
    return /** @type {any} */ (this.#system.memory).wide === true;
  }

  /** @returns {80 | 64 | 40 | 32} The columns on screen: 64 or 32, and on the Model 4 also 80 or 40. */
  get columns() {
    const full = this.#wide ? 80 : 64;
    return /** @type {80 | 64 | 40 | 32} */ (this.#system.columns32 ? full / 2 : full);
  }

  /** @returns {24 | 16} The lines on screen: 16, or 24 on a Model 4 in 80-column mode. */
  get rows() {
    return this.#wide ? 24 : 16;
  }

  /**
   * The screen as 16 lines of text (24 on a Model 4 in 80-column mode). Bytes below $20 show as
   * +$40 (the Model III character generator folds them to $40-$5F), and graphics and special bytes
   * ($80-$FF) show as '.', or, on a Model 4 with inverse video on, as their character (bits 0-6).
   * @returns {string[]}
   */
  text() {
    const ram = this.raw;
    const width = this.#wide ? 80 : 64;
    const step = this.#system.columns32 ? 2 : 1;
    const cols = width / step;
    const inverse = /** @type {any} */ (this.#system.memory).inverse === true;
    const rows = [];
    for (let row = 0, height = this.rows; row < height; row++) {
      let line = '';
      for (let col = 0; col < cols; col++) {
        let byte = ram[row * width + col * step];
        if (inverse) byte &= 0x7f;
        if (byte < 0x20) byte += 0x40;
        line += byte >= 0x20 && byte < 0x80 ? String.fromCharCode(byte) : '.';
      }
      rows.push(line);
    }
    return rows;
  }

  /**
   * The cells of video RAM that differ from a snapshot's (`m.debug.snapshot()`), row-major, as
   * byte values over the RAM layout now in force: rows of 64 bytes, or of 80 on a Model 4 in
   * 80-column mode (32- and 40-column modes show only even columns). On the Model 4 every byte of
   * the 2K is compared, so in 64-column mode the second 1K, off screen, reports as rows 16-31.
   * @param {any} snap
   * @returns {{ row: number, col: number, was: number, now: number }[]}
   */
  diff(snap) {
    const text = snap?.memory?.videoRam;
    if (typeof text !== 'string') throw new Error('video.diff needs a snapshot from m.debug.snapshot()');
    const was = fromBase64(text);
    const now = this.raw;
    const width = this.#wide ? 80 : 64;
    const out = [];
    for (let i = 0; i < now.length; i++) {
      if (was[i] !== now[i]) out.push({ row: Math.floor(i / width), col: i % width, was: was[i], now: now[i] });
    }
    return out;
  }
}
