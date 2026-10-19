/** The assembled program as a TRS-80 `.CMD` load module. */
import { writeCmd } from '@fugloy/disasm';
import type { AsmResult } from './assemble.js';

export interface CmdOptions {
  /** A `05` name record: at most 8 printable ASCII characters; anything else throws. */
  name?: string;
  /**
   * `run` (the default): the `02` record carries END's entry, or, with none,
   * the address of the first byte the source assembles, so every file runs
   * (DOS and the emulator refuse a .CMD with no `02` record). That is the
   * first byte's load address: if it is under `.PHASE`, the code there is
   * assembled to run elsewhere, and `assemble` notes it (info) on that line.
   * `source`: the
   * `02` record only when END names an entry, else `03 00`, the file zmac's
   * own output reads as.
   */
  entry?: 'run' | 'source';
}

/** Where the first assembled byte loads: the first listing line with bytes, in source order. */
function firstByte(result: AsmResult): number {
  for (const l of result.listing) if (l.bytes.length > 0 && l.load !== null) return l.load;
  throw new Error('There is nothing to write: the program has no bytes.');
}

/**
 * The image as a `.CMD` through disasm's `writeCmd`: an optional `05` name,
 * the loaded runs as `01` records, then `02` with the entry (see
 * `CmdOptions.entry` for a source with no END entry). loadCmd reads it back
 * to the same image. Phased code is written where it loads, not where it
 * runs. A result with errors, or with no bytes, throws a sentence.
 */
export function toCmd(result: AsmResult, options: CmdOptions = {}): Uint8Array {
  if (!result.ok || result.image === null) {
    const n = result.diagnostics.filter((d) => d.severity === 'error').length;
    throw new Error(`There is no .CMD to write: the source has ${n} error${n === 1 ? '' : 's'}. Fix ${n === 1 ? 'it' : 'them'} and assemble again.`);
  }
  if (result.image.runs().length === 0) throw new Error('There is nothing to write: the program has no bytes.');
  const { name } = options;
  if (name !== undefined) {
    if (name.length > 8) throw new Error(`A .CMD name has at most 8 characters; ${name} has ${name.length}.`);
    const bad = [...name].find((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) > 0x7e);
    if (bad !== undefined) throw new Error(`A .CMD name takes printable ASCII characters only; ${name} has ${bad}.`);
  }
  const entry = result.entry ?? ((options.entry ?? 'run') === 'run' ? firstByte(result) : null);
  return writeCmd(result.image, name === undefined ? { entry } : { entry, name });
}
