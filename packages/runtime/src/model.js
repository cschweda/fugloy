/**
 * The machines a port runs on, as data: what differs between the Model I, the Model III and the flat
 * test bench, so that z.js reads one description instead of hard-coding a model. It mirrors
 * @fugloy/emu, which is the oracle a port is compared with, and cites it:
 * packages/emu/src/machine/models.js (the clocks and where the ROM ends) and memory.js (the rest).
 */

/**
 * @typedef {{
 *   id: 1 | 3 | 'flat',
 *   name: string,
 *   clockHz: number,
 *   romTop: number,
 *   ramBase: number,
 *   videoGate: boolean,
 *   expansion: boolean,
 *   modeBit: number,
 * }} Model
 * `clockHz` is the CPU clock in Hz. `romTop` is where the ROM space ends: the first address of the
 * Model I's empty $3000-$37FF, or of the keyboard at $3800 (and 0x10000 for the flat machine, which has
 * no ROM). `ramBase` is where plain RAM starts: $4000 (0 on the flat machine, where all 64K is RAM).
 * `videoGate` is true where video RAM has no bit 6 (the stock Model I). `expansion` is true where
 * $37E0-$37EF is the Expansion Interface (the Model I). `modeBit` is the mode register's 32-column
 * bit: 0 on the flat machine, which has none.
 */

/** @type {Model} */
export const MODEL_I = Object.freeze({
  id: 1,
  name: 'Model I',
  // models.js:61, 1,774,080 Hz
  clockHz: 1774080,
  // models.js:65: the 12K Level II ROM is $0000-$2FFF
  romTop: 0x3000,
  ramBase: 0x4000,
  // memory.js:56 and :185, from the Technical Reference Handbook (memory.js:23-31)
  videoGate: true,
  // memory.js:42-43, EXPANSION_BASE and EXPANSION_LIMIT
  expansion: true,
  // io.js:84, M1_MODESEL_BIT: port $FF bit 3
  modeBit: 0x08,
});

/** @type {Model} */
export const MODEL_III = Object.freeze({
  id: 3,
  name: 'Model III',
  // models.js:80, 2,027,520 Hz
  clockHz: 2027520,
  // models.js:82: the 14K ROM is $0000-$37FF
  romTop: 0x3800,
  ramBase: 0x4000,
  videoGate: false,
  expansion: false,
  // io.js:74, MODE_32COL_BIT: port $EC bit 2
  modeBit: 0x04,
});

/**
 * A bench with no hardware: 64K of plain RAM, no map, no ports, for the per-opcode tests that compare
 * a translated instruction with emu's core over a flat bus. Its clock is the Model III's (emu's
 * CPU_CLOCK_HZ), so arithmetic on `clockHz` still means something.
 * @type {Model}
 */
export const FLAT = Object.freeze({
  id: 'flat',
  name: 'flat 64K',
  clockHz: MODEL_III.clockHz,
  romTop: 0x10000,
  ramBase: 0,
  videoGate: false,
  expansion: false,
  modeBit: 0,
});

/** The machines built, by the `model` createZ takes. */
export const MODELS = Object.freeze({ 1: MODEL_I, 3: MODEL_III, flat: FLAT });

/**
 * The description of `model`, or a sentence-long error for one that is not built.
 * @param {unknown} model
 * @returns {Model}
 */
export function modelOf(model) {
  if (model === 1) return MODEL_I;
  if (model === 3) return MODEL_III;
  if (model === 'flat') return FLAT;
  const got = typeof model === 'string' ? JSON.stringify(model) : String(model);
  throw new Error(`model must be 1 (the Model I), 3 (the Model III), or 'flat' (64K of plain RAM), not ${got}.`);
}
