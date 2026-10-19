// Does a source opened from a disassembly (Open as source ✎, plan 5B Task 5) assemble back to
// the program? asm builds zmac's bytes from every source the disassembler writes, so the answer
// is yes unless the text was changed; when it is no, one sentence says where. Loaded with asm,
// off the first screen.
import { assemble } from '@fugloy/asm';
import type { MemoryImage, Session } from '@fugloy/disasm';
import type { ModelId } from '../store';

const hex4 = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;
/** As zmac writes it: `7000H`, `0A000H`. */
const zmacHex = (n: number): string => {
  const h = n.toString(16).toUpperCase().padStart(4, '0');
  return /^[A-F]/.test(h) ? `0${h}H` : `${h}H`;
};

/** The lowest address where the two images differ (loaded or not, or in the byte loaded), or null when they agree. */
export function firstDifference(want: MemoryImage, got: MemoryImage | null): number | null {
  if (got === null) return want.lowestLoaded();
  for (let a = 0; a < 0x10000; a++) {
    const w = want.loaded[a] !== 0;
    if (w !== (got.loaded[a] !== 0)) return a;
    if (w && want.bytes[a] !== got.bytes[a]) return a;
  }
  return null;
}

/** Null when `text` assembles to the program's image and entry; else one sentence naming the first problem. */
export function reassemblyNote(s: Session, text: string, model: ModelId): string | null {
  const r = assemble(text, { model });
  const err = r.diagnostics.find((d) => d.severity === 'error');
  if (err !== undefined) return `This source does not assemble yet: line ${err.line} says “${err.message}” Fix it in Source ✎ before you run it.`;
  const at = firstDifference(s.module.image, r.image);
  if (at !== null) return `This source assembles to different bytes from ${s.name}, first at ${hex4(at)}, so Run will not run the original exactly. Compare that line with the Listing before you rely on it.`;
  const want = s.analysis.transfer;
  if (want !== null && r.entry !== want) return `This source starts at ${r.entry === null ? 'its first byte' : hex4(r.entry)}, but ${s.name} starts at ${hex4(want)}. Change the END line to END ${zmacHex(want)} to run it as the original does.`;
  return null;
}
