/**
 * The directives' names and the rules for their values that do not need the
 * assembler's state. Each rule follows zmac, probed in
 * test/zmac-probes.test.ts:
 *
 * - DS without a fill leaves a gap (nothing is loaded there), except inside
 *   .PHASE, where zmac writes zeros. Its fill is 0 to 127: zmac calls 80H a
 *   Value error, though DB takes it, and a negative fill draws its "Phase
 *   error" though the bytes come out right.
 * - In DB and DW, `$` is the address of each value, not of the line.
 * - A label on an ORG or .PHASE line takes the address before the directive;
 *   one on .DEPHASE takes the run address before it.
 * - An EQU may be repeated with the same value; DEFL and `=` redefine, and a
 *   use above every definition takes the last one (zmac's extra passes).
 * - Everything after END is ignored, unread.
 */
import { show } from './encode.js';

export const DATA_BYTES: ReadonlySet<string> = new Set(['DB', 'DEFB', 'DEFM']);
export const DATA_WORDS: ReadonlySet<string> = new Set(['DW', 'DEFW']);
export const RESERVE: ReadonlySet<string> = new Set(['DS', 'DEFS']);
/** Directives that redefine the name in front of them. */
export const REDEFINERS: ReadonlySet<string> = new Set(['DEFL', '=']);

/** Why a DS count is out of range, or undefined. */
export function countProblem(name: string, count: number): string | undefined {
  if (count >= 0 && count <= 0xffff) return undefined;
  return `${name} reserves 0 to 65535 bytes; ${show(count)} is out of range.`;
}

/** Why a DS fill is out of range (zmac takes 0 to 127 there), or undefined. */
export function fillProblem(name: string, fill: number): string | undefined {
  if (fill >= 0 && fill <= 127) return undefined;
  let message = `${name} fills with a byte from 0 to 127, as zmac requires; ${show(fill)} is out of range.`;
  if (fill >= -128 && fill <= 255) message += ' Write the bytes with DB instead.';
  return message;
}

/** Why an address (ORG, .PHASE, END) is out of range, or undefined. */
export function addressProblem(name: string, value: number): string | undefined {
  if (value >= 0 && value <= 0xffff) return undefined;
  return `${name} takes an address, 0 to 65535; ${show(value)} is out of range.`;
}
