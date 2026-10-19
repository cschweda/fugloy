// What a source line holds, read from asm's listing: its code without the comment, whether its
// bytes are data (DB, DW, DS and their DEF spellings), and whether a breakpoint on it can stop
// (phase 5C Ruling 8). Shared by Source ✎ (hollow breakpoints from its own assembly, before any
// Run and after edits) and the Run kit (rom-use's checks, and the Stepper), both lazy; no emu here.
import type { AsmResult, ListingLine } from '@fugloy/asm';

/** The source text without its comment (a `;` outside quotes) and without quoted strings. */
export function codeOf(text: string): string {
  let out = '';
  let quote: string | null = null;
  for (const ch of text) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === ';') break;
    if (ch === '"' || ch === "'") {
      // AF' is a register, not a string.
      if (ch === "'" && /AF$/i.test(out)) {
        out += ch;
        continue;
      }
      quote = ch;
      out += ' ';
      continue;
    }
    out += ch;
  }
  return out;
}

const DATA = /^(?:[^\s:;]+:?)?\s+(DB|DEFB|DEFM|DW|DEFW|DS|DEFS)\b/i;
/** True when a line's code (from `codeOf`) is a data directive. */
export const isData = (code: string): boolean => DATA.test(code) || /^(DB|DEFB|DEFM|DW|DEFW|DS|DEFS)\b/i.test(code.trim());
/** True for a DB, DW, or DS line (and their DEF spellings): its bytes are data. */
export const isDataLine = (l: ListingLine): boolean => isData(codeOf(l.text));

/** Why a breakpoint on `line` cannot stop, as a sentence; null when it can. */
export function inactiveReason(result: AsmResult, line: number): string | null {
  if (result.sourceMap.addressesOf(line).length === 0) return `Line ${line} has no instruction to stop at.`;
  const l = result.listing.find((x) => x.line === line);
  return l !== undefined && isDataLine(l) ? `Line ${line} holds data, not an instruction to stop at.` : null;
}
