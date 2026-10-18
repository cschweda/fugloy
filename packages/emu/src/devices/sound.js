/**
 * The Model III's only sound source is the cassette output on port $FF. This device keeps every
 * write to that port, raw and stamped with the CPU's T-state count, in a fixed ring of 65,536
 * events (typed arrays, no allocation per write). The newest events are kept; `overflowed`
 * counts the ones lost to wrap-around. It is not part of serializeState.
 */

const SIZE = 65536;

export class Sound {
  #cycles = new Float64Array(SIZE);
  #values = new Uint8Array(SIZE);
  #head = 0; // next slot to write
  #count = 0; // events held, at most SIZE
  /** @type {number} Events lost to wrap-around since the last clear. */
  overflowed = 0;

  /**
   * Record one port $FF write. Called by the I/O system.
   * @param {number} cycle T-states at the write.
   * @param {number} value The raw byte written.
   */
  record(cycle, value) {
    this.#cycles[this.#head] = cycle;
    this.#values[this.#head] = value;
    this.#head = (this.#head + 1) & (SIZE - 1);
    if (this.#count < SIZE) this.#count++;
    else this.overflowed++;
  }

  /**
   * Every port $FF write after a cycle, oldest first.
   * @param {number} [sinceCycle] Only events with `cycle > sinceCycle`.
   * @returns {{ cycle: number, value: number }[]}
   */
  events(sinceCycle = 0) {
    const out = [];
    const start = (this.#head - this.#count + SIZE) & (SIZE - 1);
    for (let k = 0; k < this.#count; k++) {
      const i = (start + k) & (SIZE - 1);
      const cycle = this.#cycles[i];
      if (cycle > sinceCycle) out.push({ cycle, value: this.#values[i] });
    }
    return out;
  }

  /** Empty the ring and reset `overflowed`. */
  clear() {
    this.#head = 0;
    this.#count = 0;
    this.overflowed = 0;
  }
}
