/**
 * The Model III video as a text readout: 16 lines over video RAM at $3C00-$3FFF, 64 columns, or
 * 32 in 32-column mode (port $EC bit 2), where the hardware shows the even-address bytes
 * double-wide. It reads the live video RAM; it draws nothing.
 */

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
}
