/**
 * The loaders' hand-off to a loaded program, shared by fastLoadCmd (cmd-format.js) and
 * fastLoadSystem (cas-format.js).
 */

/**
 * Jump to `entry` with nothing of the interrupted code left half-done. The CPU leaves HALT. An EI
 * still in flight (it enables interrupts only after the next instruction) takes effect now, so
 * IFF1 and IFF2 are set as they would be one instruction later; a DD/FD prefix still pending is
 * dropped. Any interrupt request latched before the load is cleared, so no request from before
 * the load interrupts the program; the next request is the next one the hardware raises.
 * Otherwise IFF1, IFF2, and the interrupt mode are left as they were.
 * @param {any} system a TRS80System (a bare { cpu } works too)
 * @param {number} entry
 * @returns {number} the entry
 */
export function startProgram(system, entry) {
  const cpu = system.cpu;
  cpu.halted = false;
  if (cpu.pendingEI > 0) {
    cpu.IFF1 = true;
    cpu.IFF2 = true;
  }
  cpu.pendingEI = 0;
  cpu.afterPrefix = false;
  if (system.io) system.io.intLatch = 0;
  cpu.registers.PC = entry;
  return entry;
}
