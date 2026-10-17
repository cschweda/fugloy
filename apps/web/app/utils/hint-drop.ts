// Telling a dropped hint file from a program, by content (never the extension).
import { parseHints } from '@fugloy/disasm';

/** The text of a dropped file if it is a hint file (UTF-8 text that parses, with the `fugloy-hints 1` header); else null. */
export function asHintText(bytes: Uint8Array): string | null {
  if (bytes.length === 0 || bytes.includes(0)) return null;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  if (!/^\s*(#[^\n]*\n\s*)*fugloy-hints\s+1\b/.test(text)) return null;
  return parseHints(text).errors.length === 0 ? text : null;
}
