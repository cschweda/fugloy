/**
 * Loading a port and running it: the host's two calls. A port is the module @fugloy/recomp's
 * `port()` writes; it exports `MODEL`, `DATA` (its non-code bytes, as `[address, bytes]`), `CODE` (its
 * code, as `[first, last]` address ranges, none of whose bytes it carries), `CELLS` (the code bytes the
 * program rewrites, its trace's cells, each as `[address, byte as loaded]`), `ROM` (the ROM bytes the
 * program reads as data, its trace's ROM reads, each as `[address, byte]`), `ENTRY` (the routine the
 * program starts at) and each routine by name.
 */
import { top } from './ops.js';

/**
 * @typedef {{
 *   MODEL: 1 | 3,
 *   DATA: ReadonlyArray<readonly [number, Uint8Array]>,
 *   CODE?: ReadonlyArray<readonly [number, number]>,
 *   CELLS?: ReadonlyArray<readonly [number, number]>,
 *   ROM?: ReadonlyArray<readonly [number, number]>,
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
 * Put the port's data into memory: each of `ROM`'s bytes stored straight into `z.mem` (a write through
 * `z.write` to ROM is lost, as on the machine), so the program reads at those addresses what it read in
 * the census and the port needs no ROM of anyone's; every byte of `DATA` written through `z.write`, as
 * emu's .CMD loader writes a program through its memory (loaders/cmd-format.js, fastLoadCmd), so the
 * Model I's video RAM takes its bit 6 here too; and each of `CELLS` with its initial value, which the
 * instruction it is an operand of reads when it runs. The port's code has no other bytes to load. Then the write
 * guard (`z.guard`): from here a write to a byte of `CODE` that is not one of `CELLS` throws a sentence,
 * since the program would go on running code the port no longer matches. A module with no `CODE` installs
 * none.
 * @param {import('./z.js').Z} z
 * @param {PortModule} mod
 */
export function load(z, mod) {
  sameModel(z, mod);
  z.guard = null;
  for (const [addr, v] of mod.ROM ?? []) z.mem[addr & 0xffff] = v & 0xff;
  for (const [addr, bytes] of mod.DATA) {
    for (let k = 0; k < bytes.length; k++) z.write((addr + k) & 0xffff, bytes[k]);
  }
  const code = mod.CODE ?? [];
  const cells = mod.CELLS ?? [];
  for (const [addr, v] of cells) z.write(addr, v);
  if (code.length === 0) return;
  const guard = new Uint8Array(0x10000);
  for (const [first, last] of code) guard.fill(1, first, last + 1);
  for (const [addr] of cells) guard[addr] = 0;
  z.guard = guard;
}

/**
 * Run the port from its entry until the entry returns. The address it must return to is the one on
 * top of the stack as it starts: the address the stub ROM pushes before it hands over to a program
 * (its RETURNED, apps/web/app/utils/emulator/stub-rom.z), so the runtime needs none of the stub's bytes.
 * It runs in the top-level trampoline (ops.js, `top`): an unwind no routine's trampoline took ends there,
 * and a reset (a jump back to an entry that reloads SP) runs the entry again with the same return address.
 * A RET to any other address, and anything else the port cannot follow, throws a sentence.
 * @param {import('./z.js').Z} z the machine, its registers and memory as at the program's entry
 * @param {PortModule} mod
 * @returns {{ reason: 'returned' }}
 */
export function runPort(z, mod) {
  sameModel(z, mod);
  top(z, mod.ENTRY, z.read16(z.sp));
  return { reason: 'returned' };
}
