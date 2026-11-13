/**
 * @fugloy/recomp: a TRS-80 program to a readable JavaScript port that runs on @fugloy/runtime (Part 2
 * of Fugløy, milestone M1). No DOM, no Node APIs; runtime dependencies @fugloy/z80 and @fugloy/disasm.
 */
export const VERSION = '0.1.0';

export { translate } from './translate.js';
export type { TranslateContext, Translation } from './translate.js';
