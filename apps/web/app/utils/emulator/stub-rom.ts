// The stub ROM (phase 5B Ruling 5): Fugløy's own stub-rom.z, assembled by @fugloy/asm at run time
// and padded with HALT (76H) to the model's ROM size. It holds no Tandy code.
import { assemble } from '@fugloy/asm';
import type { Model } from '@fugloy/emu';
import source from './stub-rom.z?raw';
import { ROM_SIZES } from './rom-ids';

export const STUB_ROM_SOURCE: string = source;
export const HALT = 0x76;

const built = new Map<Model, Uint8Array>();

/** Where the ROM ends for a model: the stub's size, and the first address a program may own. */
export const romEnd = (model: Model): number => ROM_SIZES[model][0]!;

/** The stub ROM for a model, assembled once per page session. */
export function stubRom(model: Model): Uint8Array {
  const hit = built.get(model);
  if (hit !== undefined) return hit;
  const r = assemble(source, { model });
  if (!r.ok || r.image === null) throw new Error(`Fugløy's stub ROM did not assemble: ${r.diagnostics.map((d) => `line ${d.line}: ${d.message}`).join(' ')}`);
  const rom = new Uint8Array(romEnd(model)).fill(HALT);
  for (const run of r.image.runs()) rom.set(r.image.bytes.subarray(run.start, run.start + run.length), run.start);
  built.set(model, rom);
  return rom;
}

/** True when `rom` is the stub for `model`. */
export function isStub(model: Model, rom: Uint8Array): boolean {
  const stub = stubRom(model);
  return rom === stub || (rom.length === stub.length && rom.every((b, i) => b === stub[i]));
}
