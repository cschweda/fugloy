export { VERSION as Z80_VERSION } from '@fugloy/z80';

export const VERSION = '1.2.0';

export type { Operand, Shape } from './shape.js';
export { encode, forms, lengthOf, mnemonics } from './encode.js';
export type { EncodeOptions, EncodeResult } from './encode.js';
export { assemble, DEFAULT_ORIGIN } from './assemble.js';
export type { AsmOptions, AsmResult, Diagnostic, ListingLine, Severity, SourceMap, SymbolInfo, SymbolKind } from './assemble.js';
export { toCmd } from './output.js';
