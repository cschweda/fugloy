/**
 * Loading a port and running it: the host's two calls. A port is the module @fugloy/recomp's
 * `port()` writes; it exports `MODEL`, `DATA` (its non-code bytes, as `[address, bytes]`), `ENTRY`
 * (the routine the program starts at) and each routine by name.
 */
import { call } from './ops.js';

/**
 * @typedef {{
 *   MODEL: 1 | 3,
 *   DATA: ReadonlyArray<readonly [number, Uint8Array]>,
 *   ENTRY: import('./ops.js').Routine,
 * }} PortModule
 */

/**
 * @param {import('./z.js').Z} z
 * @param {PortModule} mod
 */
function sameModel(z, mod) {
  if (z.model !== mod.MODEL) {
    const name = (/** @type {unknown} */ m) => (m === 1 ? 'the Model I' : m === 3 ? 'the Model III' : `model ${String(m)}`);
    throw new Error(`the port is for ${name(mod.MODEL)}, and this machine is ${name(z.model)}`);
  }
}

/**
 * Put the port's data into memory: every byte of `DATA` written through `z.write`, as emu's .CMD
 * loader writes a program through its memory (loaders/cmd-format.js, fastLoadCmd), so the Model I's
 * video RAM takes its bit 6 here too. The port's code has no bytes to load.
 * @param {import('./z.js').Z} z
 * @param {PortModule} mod
 */
export function load(z, mod) {
  sameModel(z, mod);
  for (const [addr, bytes] of mod.DATA) {
    for (let k = 0; k < bytes.length; k++) z.write((addr + k) & 0xffff, bytes[k]);
  }
}

/**
 * Run the port from its entry until the entry returns. The address it must return to is the one on
 * top of the stack as it starts: the address the stub ROM pushes before it hands over to a program
 * (its RETURNED, apps/web/app/utils/emulator/stub-rom.z), so the runtime needs none of the stub's bytes.
 * A RET to any other address, and anything else the port cannot follow, throws a sentence.
 * @param {import('./z.js').Z} z the machine, its registers and memory as at the program's entry
 * @param {PortModule} mod
 * @returns {{ reason: 'returned' }}
 */
export function runPort(z, mod) {
  sameModel(z, mod);
  call(z, mod.ENTRY, z.read16(z.sp));
  return { reason: 'returned' };
}
