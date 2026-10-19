// The stub ROM (phase 5B Ruling 5): Fugløy's own stub-rom.z, assembled by @fugloy/asm at run time
// and padded with HALT (76H) to the model's ROM size. It holds no Tandy code.
import { assemble } from '@fugloy/asm';
import type { Model } from '@fugloy/emu';
import source from './stub-rom.z?raw';
import { ROM_SIZES } from './rom-ids';

export const STUB_ROM_SOURCE: string = source;
export const HALT = 0x76;

interface Built {
  rom: Uint8Array;
  /** The HALT the stub waits at once it has started (a program that jumps to $0000 ends here too). */
  booted: number;
  /** The HALT a program's final RET comes back to: the stub pushes its address before BOOTED. */
  returned: number;
}

const built = new Map<Model, Built>();

/** Where the ROM ends for a model: the stub's size, and the first address past the ROM's space. */
export const romEnd = (model: Model): number => ROM_SIZES[model][0]!;

function build(model: Model): Built {
  const hit = built.get(model);
  if (hit !== undefined) return hit;
  const r = assemble(source, { model });
  if (!r.ok || r.image === null) throw new Error(`Fugløy's stub ROM did not assemble: ${r.diagnostics.map((d) => `line ${d.line}: ${d.message}`).join(' ')}`);
  const rom = new Uint8Array(romEnd(model)).fill(HALT);
  for (const run of r.image.runs()) rom.set(r.image.bytes.subarray(run.start, run.start + run.length), run.start);
  const b = { rom, booted: r.symbol('BOOTED')!.value, returned: r.symbol('RETURNED')!.value };
  built.set(model, b);
  return b;
}

/** The stub ROM for a model, assembled once per page session. */
export const stubRom = (model: Model): Uint8Array => build(model).rom;

/** The stub's two known HALTs, for the trap's sentences. */
export function stubHalts(model: Model): { booted: number; returned: number } {
  const { booted, returned } = build(model);
  return { booted, returned };
}

/** True when `rom` is the stub for `model`. */
export function isStub(model: Model, rom: Uint8Array): boolean {
  const stub = stubRom(model);
  return rom === stub || (rom.length === stub.length && rom.every((b, i) => b === stub[i]));
}
