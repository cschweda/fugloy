/**
 * @fugloy/recomp: a TRS-80 program to a readable JavaScript port that runs on @fugloy/runtime (Part 2
 * of Fugløy, milestone M1). No DOM, no Node APIs; runtime dependencies @fugloy/z80 and @fugloy/disasm.
 */
export const VERSION = '0.1.0';

export { translate } from './translate.js';
export type { TranslateContext, Translation } from './translate.js';
export { port } from './port.js';
export type { PortOptions, PortReport, PortResult } from './port.js';
export { routinesOf } from './routines.js';
export type { Routine, Routines } from './routines.js';
export { structure } from './structure.js';
export type { Code, Exit, Flow, Piece, Structured } from './structure.js';
export { TRACE_VERSION, formatTrace, parseTrace } from './trace.js';
export type { PortTrace, TracePatch } from './trace.js';
