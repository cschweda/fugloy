/**
 * Content-based format detection; extensions are never consulted. A tokenized
 * BASIC program is checked first because its validation spans the whole file
 * (a consistent pointer chain), whereas a load module only needs one
 * well-formed record at the start, which a headerless .BAS can imitate.
 */
import { isBas } from './bas.js';
import { isCmd } from './cmd.js';

export type Format = 'cmd' | 'bas' | 'raw';

export function detectFormat(bytes: Uint8Array): Format {
  if (isBas(bytes)) return 'bas';
  if (isCmd(bytes)) return 'cmd';
  return 'raw';
}
