/** The assembled program as a TRS-80 `.CMD` load module. */
import { writeCmd } from '@fugloy/disasm';
import type { AsmResult } from './assemble.js';

/**
 * The image as a `.CMD` through disasm's `writeCmd`: an optional `05` name
 * (at most 8 printable ASCII characters; anything else throws), the loaded runs as `01` records, then `02` with the
 * entry or `03 00` without one. loadCmd reads it back to the same image and
 * entry. Phased code is written where it loads, not where it runs. A result
 * with errors, or with no bytes, throws a sentence.
 */
export function toCmd(result: AsmResult, options: { name?: string } = {}): Uint8Array {
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
  return writeCmd(result.image, options.name === undefined ? { entry: result.entry } : { entry: result.entry, name: options.name });
}
