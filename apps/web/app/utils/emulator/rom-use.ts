// The static ROM check (phase 5B Ruling 5): before a program runs on the stub ROM, find the first
// line that needs the real one. That is a ROM routine's name used on a line that assembles to
// code, an RST, or a CALL or JP to a constant address inside the ROM. Hardware names (the screen,
// the keyboard, ports) are not ROM use. A jump the check cannot see, such as JP (HL), is caught
// at run time by the HALT trap (runner.ts).
import { romNames } from '@fugloy/asm';
import type { AsmResult, ListingLine, RomName } from '@fugloy/asm';
import type { Model } from '@fugloy/emu';
import { MODEL_NAMES } from './rom-ids';
import { romEnd } from './stub-rom';

const hex4 = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

/** A name from a ROM table (not hardware, not DOS) whose address is inside the ROM. */
const isRomRoutine = (r: RomName, model: Model): boolean => r.entry.table.startsWith('rom-') && r.value < romEnd(model);

/** The ROM table's name for an address inside the ROM, if it has one. */
export function romNameAt(address: number, model: Model): RomName | undefined {
  for (const r of romNames(model).values()) if (isRomRoutine(r, model) && r.value === address) return r;
  return undefined;
}

/** The sentence's ending: what to do instead. */
export const romAdvice = (model: Model, instead = 'do this in your own code'): string => `but no ROM is loaded. Add a ${MODEL_NAMES[model]} ROM in the Run tab, or ${instead}.`;

/** How a routine is described: `$VDCLS, the ROM's routine at $01C9 (clear the screen)`. */
export const describeRom = (r: RomName): string => `${r.name}, the ROM's ${r.entry.kind} at ${hex4(r.value)} (${r.entry.purpose})`;

/** The source text without its comment (a `;` outside quotes) and without quoted strings. */
function codeOf(text: string): string {
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

/** The line's mnemonic (the first word after an optional label), upper case. */
function mnemonicOf(code: string): string {
  const m = /^(?:[^\s:]+:|[^\s:]+(?=\s))?\s*([A-Za-z.]+)/.exec(code);
  return m === null ? '' : m[1]!.toUpperCase();
}

const escape = (s: string): string => s.replace(/[$.*+?^{}()|[\]\\]/g, '\\$&');

const isCall = (op: number): boolean => op === 0xcd || (op & 0xc7) === 0xc4;
const isJump = (op: number): boolean => op === 0xc3 || (op & 0xc7) === 0xc2;
const isRst = (op: number): boolean => (op & 0xc7) === 0xc7;

/** The first line that needs the ROM, with a sentence naming the line and why; null when the stub will do. */
export function romUse(result: AsmResult, model: Model): { line: number; text: string } | null {
  const used = [...result.symbols.entries()].filter(([, s]) => s.kind === 'rom').map(([name]) => romNames(model).get(name.toUpperCase())).filter((r): r is RomName => r !== undefined && isRomRoutine(r, model));
  const byName = used.length === 0 ? null : new RegExp(`(?<![\\w$@.?])(${used.map((r) => escape(r.name)).join('|')})(?![\\w$@.?])`, 'i');
  const advice = romAdvice(model);
  for (const l of result.listing as ListingLine[]) {
    if (l.address === null || l.bytes.length === 0) continue;
    const code = codeOf(l.text);
    const mnemonic = mnemonicOf(code);
    if (mnemonic === 'DB' || mnemonic === 'DEFB' || mnemonic === 'DEFM' || mnemonic === 'DW' || mnemonic === 'DEFW' || mnemonic === 'DS' || mnemonic === 'DEFS') continue;
    const op = l.bytes[0]!;
    const verb = mnemonic === 'CALL' ? 'calls' : mnemonic === 'JP' ? 'jumps to' : 'uses';
    const named = byName?.exec(code);
    if (named) {
      const r = used.find((u) => u.name.toUpperCase() === named[1]!.toUpperCase())!;
      return { line: l.line, text: `Line ${l.line} ${verb} ${describeRom(r)}, ${advice}` };
    }
    if (mnemonic === 'RST' && l.bytes.length === 1 && isRst(op)) {
      const target = op & 0x38;
      const r = romNameAt(target, model);
      const what = r === undefined ? `the ROM at ${hex4(target)}` : describeRom(r);
      return { line: l.line, text: `Line ${l.line} uses RST ${target.toString(16).toUpperCase().padStart(2, '0')}H, which calls ${what}, ${advice}` };
    }
    if ((mnemonic === 'CALL' || mnemonic === 'JP') && l.bytes.length === 3 && (isCall(op) || isJump(op))) {
      const target = l.bytes[1]! | (l.bytes[2]! << 8);
      if (target < romEnd(model)) {
        const r = romNameAt(target, model);
        const what = r === undefined ? `${hex4(target)}, inside the ROM` : describeRom(r);
        return { line: l.line, text: `Line ${l.line} ${verb} ${what}, ${advice}` };
      }
    }
  }
  return null;
}
