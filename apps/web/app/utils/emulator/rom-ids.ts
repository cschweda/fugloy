// What the site knows about ROM images, for recognising one the user adds:
// emu's table of known hashes and the sizes each model takes. Facts only; no
// ROM bytes are ever bundled or fetched. useRoms loads this file lazily, so emu
// stays off the first screen.
import { ROM_HASHES } from '@fugloy/emu';
import type { ModelId } from '../store';

/** The image sizes each model's ROM may have, in bytes (emu's src/machine/models.js `romSizes`, which test/roms.test.ts checks). */
export const ROM_SIZES: Readonly<Record<ModelId, readonly number[]>> = {
  1: [0x3000],
  3: [0x3800, 0x4000],
  4: [0x3800, 0x4000],
};

export const MODEL_NAMES: Readonly<Record<ModelId, string>> = { 1: 'Model I', 3: 'Model III', 4: 'Model 4' };

/** A known ROM's ROM_HASHES name and its model (from the name's prefix); null for a hash Fugløy does not know. */
export function recognise(sha256: string): { name: string; model: ModelId } | null {
  if (!Object.hasOwn(ROM_HASHES, sha256)) return null;
  const name = ROM_HASHES[sha256]!;
  const m = /^model([134])-/.exec(name);
  return m === null ? null : { name, model: Number(m[1]) as ModelId };
}
