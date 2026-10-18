/**
 * Model descriptions: what differs between the TRS-80 models the Machine builds, as data, so the
 * memory map, the I/O ports, the clock, and the ROM checks read one description instead of
 * hard-coding the Model III (spec §5).
 *
 * Model I facts and where they come from (the ROM sources are github.com/kiwisincebirth/TRS-80-ROMS;
 * spec §5 lists what is still unverified against the Model I Technical Reference Manual):
 * - ROM: 12 KB at $0000-$2FFF. The repository's Model I Level II images `test-roms/M1L2_1.2.bin`
 *   and `M1L2_1.3.bin` are 12,288 bytes each, and its MODEL1.md describes `MDL1LEV2.Z80` as the
 *   source of the "Model I Level 2 12KB ROMS".
 * - Keyboard matrix at $3800, video RAM at $3C00 (400H bytes), RAM from $4000: CONSTANTS.Z80,
 *   "Memory Mapped Hardware" and "RAM Communications Area".
 * - $37E0-$37EF belong to the Expansion Interface (drive select $37E1, cassette select $37E4,
 *   printer $37E8, the disk controller $37EC-$37EF: CONSTANTS.Z80, "Memory Mapped Hardware,
 *   Model 1"). Without the Expansion Interface those addresses read $FF: MDL1LEV2.Z80 at $0069
 *   ("$FF if no expansion interface present") and $0696-$069C, where the ROM takes $FF (or $00) at
 *   $37EC as "no disk controller" and goes to Level II BASIC. The rest of $3000-$37FF decodes to
 *   nothing and is taken to read $FF as well (unverified).
 * - RAM sizes 4, 16, 32, and 48 KB from $4000 (spec §5, unverified against the manual; Ruling 2
 *   of the phase 6 plan). Above the fitted RAM a read is taken to float to $FF and a write is
 *   lost (unverified); the ROM's MEMORY SIZE? probe at $00C4-$00D4 needs only that a byte there
 *   does not hold the complement written to it.
 * - Clock 1,774,080 Hz: spec §5's 1.774 MHz, taken as the 10.6445 MHz crystal divided by 6 (as
 *   xtrs runs it; unverified against the manual). The ROM's PAUSE loop at $0060 is commented
 *   "BC times 14.65" µs at $06AF, and one pass of it is 26 T-states, which puts the clock at
 *   1.775 MHz.
 */

/**
 * @typedef {{ id: 1 | 3, name: string, clockHz: number, timerHz: number, romTop: number,
 *   romSizes: readonly number[], romSizeText: string, ram: readonly number[], defaultRam: number,
 *   ramNote: string, roms: readonly string[], romTitle: string, stateMachine: string }} Model
 */

/** @type {Model} */
export const MODEL_I = Object.freeze({
  id: 1,
  name: 'Model I',
  clockHz: 1774080,
  // The Expansion Interface's 40 Hz timer (spec §5); the latch that delivers it is not built yet,
  // so a Model I takes no interrupts.
  timerHz: 40,
  romTop: 0x3000,
  romSizes: Object.freeze([0x3000]),
  romSizeText: "The Model I's Level II ROM is 12KB (0x3000)",
  ram: Object.freeze([4, 16, 32, 48]),
  defaultRam: 48,
  ramNote: '',
  roms: Object.freeze(['model1-level2-1.2', 'model1-level2-1.3']),
  romTitle: 'the Model I Level II ROM',
  stateMachine: 'trs80-model1',
});

/** @type {Model} */
export const MODEL_III = Object.freeze({
  id: 3,
  name: 'Model III',
  clockHz: 2027520,
  timerHz: 30,
  romTop: 0x3800,
  // The real 14K image, or a 16K padded image of it (only $0000-$37FF is mapped).
  romSizes: Object.freeze([0x3800, 0x4000]),
  romSizeText: 'Expected 14KB (0x3800) or a 16KB (0x4000) padded image',
  ram: Object.freeze([48]),
  defaultRam: 48,
  // Ruling 2 of the phase 6 plan: 16K and 32K are cheap but would run untested programs.
  ramNote: '; 16K and 32K come in a later phase',
  roms: Object.freeze(['model3-rev-c-2ef8', 'model3-rev-c-frehd']),
  romTitle: 'the Model III ROM',
  stateMachine: 'trs80-model3',
});

/** The models built, by number. */
export const MODELS = Object.freeze({ 1: MODEL_I, 3: MODEL_III });

/**
 * The description of model `n`, or a sentence-long error for a model not built.
 * @param {unknown} n
 * @returns {Model}
 */
export function modelOf(n) {
  if (n === 1) return MODEL_I;
  if (n === 3) return MODEL_III;
  if (n === 4) throw new Error('There is no Model 4 yet: it needs a Model 4 ROM and boot disk to prove it boots, and comes in its own plan when one is supplied; use model 1 or 3.');
  throw new Error(`model must be 1 (the Model I) or 3 (the Model III), not ${String(n)}.`);
}

/**
 * Why `ram` (in K) is not a size model `desc` is built with, as a sentence, or null when it is.
 * @param {Model} desc
 * @param {unknown} ram
 * @returns {string | null}
 */
export function ramProblem(desc, ram) {
  if (desc.ram.includes(/** @type {number} */ (ram))) return null;
  const sizes = desc.ram.length === 1 ? String(desc.ram[0]) : `${desc.ram.slice(0, -1).join(', ')}, or ${desc.ram.at(-1)}`;
  const got = typeof ram === 'string' ? JSON.stringify(ram) : String(ram);
  return `The ${desc.name} takes ram: ${sizes} (K), not ${got}${desc.ramNote}.`;
}

/**
 * The CPU clock of model `n`, in Hz.
 * @param {1 | 3} n
 */
export function clockHz(n) {
  return modelOf(n).clockHz;
}

/**
 * Why a recognised ROM cannot run on model `n`, as a sentence, or null when it can (or is not
 * recognised: an unknown image is checked by its size alone).
 * @param {string | null} recognized the ROM_HASHES name
 * @param {1 | 3} n
 * @returns {string | null}
 */
export function romModelProblem(recognized, n) {
  if (recognized === null) return null;
  const wanted = modelOf(n);
  if (wanted.roms.includes(recognized)) return null;
  const owner = [MODEL_I, MODEL_III].find((d) => d.roms.includes(recognized));
  if (owner === undefined) return null;
  return `This ROM is ${owner.romTitle} (${recognized}); it runs on the ${owner.name}, not the ${wanted.name}: construct the Machine with model: ${owner.id}.`;
}
