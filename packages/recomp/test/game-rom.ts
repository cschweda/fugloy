/**
 * The ROM the referee boots for a game (M2): Fugløy's stub ROM (apps/web/app/utils/emulator/stub-rom.z,
 * as helpers.ts's `stub` builds it) followed by @fugloy/runtime's STANDINS_Z, Fugløy's own Z80 for the
 * ROM routines the runtime stands in for, at the ROM's addresses. emu runs a game's call to one of them
 * through that code, which takes the ROM's time, while the port runs the runtime's JavaScript: the
 * referee holds the two to the same state at the block after the call, in CI, with no user ROM.
 * The Learn programs keep the plain stub (they never enter the ROM's space).
 */
import { STANDINS_Z } from '@fugloy/runtime';
import { assembled, stubSource } from './helpers.js';
import type { Model } from './helpers.js';

const HALT = 0x76;
/** Where each model's ROM space ends: the ROM is padded with HALT to it, as the plain stub is. */
const ROM_END: Readonly<Record<Model, number>> = { 1: 0x3000, 3: 0x3800 };

const roms = new Map<Model, Uint8Array>();

/**
 * The game stub ROM for a model: the stub's source with its END taken off (asm reads nothing after END),
 * the model's stand-ins, and END, assembled with @fugloy/asm and padded with HALT. The stub's own code
 * ends at $0015, below the first stand-in ($0060), so its bytes and RETURNED are the plain stub's. The
 * Model I has no stand-ins in M2, so its game stub is the plain stub.
 */
export function gameStubRom(model: Model): Uint8Array {
  let rom = roms.get(model);
  if (rom === undefined) {
    const head = stubSource.replace(/^\s+END\s*(;.*)?\s*$/m, '');
    if (head === stubSource) throw new Error("the stub ROM's source has no END line to take off");
    const r = assembled(model === 3 ? `${head}\n${STANDINS_Z}\n\tEND\n` : stubSource, model);
    rom = new Uint8Array(ROM_END[model]).fill(HALT);
    for (const run of r.image!.runs()) rom.set(r.image!.bytes.subarray(run.start, run.start + run.length), run.start);
    roms.set(model, rom);
  }
  return rom;
}
