// The static ROM checks (phase 5B Ruling 5), before a program runs. Each finding names its line in
// a sentence.
//
// - romSpaceCode: code assembled into the ROM's space (ORG below the ROM's end) cannot load, on the
//   stub or on a real ROM. Refused, naming the ORG line.
// - romUse (the stub only): the first line that needs the real ROM. That is:
//   - any name from a ROM table (`rom-*`: routines, vectors, and the ROM's RAM variables such as
//     CURADDR), in code or in DB and DW;
//   - an RST;
//   - a CALL or JP to a constant inside the ROM;
//   - a memory operand `(nn)` that reads inside the ROM;
//   - a memory operand `(nn)` at one of the ROM's RAM variables, read or written.
//   Hardware names (the screen, the keyboard, ports) are not ROM use.
// - romNotes (the stub only): warnings, not refusals. LD HL with a constant inside the ROM's space
//   feeding a block copy (LDIR, LDDR, LDI, LDD) reads the stand-in's bytes. It is a warning
//   because LD HL,0 is common and HL may change before the copy.
//
// The checks read each line's bytes. The mnemonic is only used to skip DB, DW, and DS lines, whose
// bytes are data. What no static check can see (a computed jump, a read through a pointer) is
// caught at run time by the HALT trap (runner.ts) or is a stated gap.
import { romNames } from '@fugloy/asm';
import type { AsmResult, ListingLine, RomName } from '@fugloy/asm';
import type { Model } from '@fugloy/emu';
import { codeOf, isData } from '../source/lines';
import { MODEL_NAMES } from './rom-ids';
import { romEnd } from './stub-rom';

export interface RomFinding {
  line: number;
  text: string;
}

const hex4 = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

/** Every name in the model's ROM tables (not hardware, not DOS), by upper-case name. */
function romTable(model: Model): RomName[] {
  return [...romNames(model).values()].filter((r) => r.entry.table.startsWith('rom-'));
}

/** The ROM table's routine or vector at an address inside the ROM, if it has one. */
export function romNameAt(address: number, model: Model): RomName | undefined {
  return romTable(model).find((r) => r.value === address && r.value < romEnd(model) && r.entry.kind !== 'variable');
}

/** The ROM's RAM variable (or region) covering an address at or past the ROM's end, if any. */
function romVariableAt(address: number, model: Model): RomName | undefined {
  return romTable(model).find((r) => r.value >= romEnd(model) && address >= r.value && address < r.value + Math.max(1, r.entry.length));
}

/** The sentence's ending: what to do instead. */
export const romAdvice = (model: Model, instead = 'do this in your own code'): string => `but no ROM is loaded. Add a ${MODEL_NAMES[model]} ROM in the Run tab, or ${instead}.`;

/** How a name is described: `$VDCLS, the ROM's routine at $01C9 (clear the screen)`. */
export const describeRom = (r: RomName): string => `${r.name}, the ROM's ${r.entry.kind} at ${hex4(r.value)} (${r.entry.purpose})`;

const ORIGIN = /^(?:[^\s:;]+:?)?\s+(ORG|\.PHASE)\b/i;

const escape = (s: string): string => s.replace(/[$.*+?^{}()|[\]\\]/g, '\\$&');

const isCall = (op: number): boolean => op === 0xcd || (op & 0xc7) === 0xc4;
const isJump = (op: number): boolean => op === 0xc3 || (op & 0xc7) === 0xc2;
const isRst = (op: number): boolean => (op & 0xc7) === 0xc7;

/** A memory operand `(nn)` in an instruction's bytes: its address and whether it is read. */
export function memoryOperand(b: readonly number[]): { address: number; read: boolean } | null {
  if (b.length === 3 && (b[0] === 0x3a || b[0] === 0x2a || b[0] === 0x32 || b[0] === 0x22)) return { address: b[1]! | (b[2]! << 8), read: b[0] === 0x3a || b[0] === 0x2a };
  if (b.length === 4 && b[0] === 0xed && (b[1]! & 0xc7) === 0x43) return { address: b[2]! | (b[3]! << 8), read: (b[1]! & 0x08) !== 0 };
  if (b.length === 4 && (b[0] === 0xdd || b[0] === 0xfd) && (b[1] === 0x2a || b[1] === 0x22)) return { address: b[2]! | (b[3]! << 8), read: b[1] === 0x2a };
  return null;
}

/** Lines that assemble to bytes, with their code (comment and strings removed). */
function codeLines(result: AsmResult): { l: ListingLine; code: string }[] {
  return result.listing.filter((l) => l.address !== null && l.bytes.length > 0).map((l) => ({ l, code: codeOf(l.text) }));
}

/** Code assembled into the ROM's space, on any machine: the ORG (or .PHASE) line that put it there. */
export function romSpaceCode(result: AsmResult, model: Model): RomFinding | null {
  const end = romEnd(model);
  const listing = result.listing;
  for (let i = 0; i < listing.length; i++) {
    const l = listing[i]!;
    if (l.bytes.length === 0) continue;
    const at = [l.load, l.address].find((a): a is number => a !== null && a < end);
    if (at === undefined) continue;
    let org = l.line;
    for (let k = i; k >= 0; k--)
      if (ORIGIN.test(codeOf(listing[k]!.text))) {
        org = listing[k]!.line;
        break;
      }
    return {
      line: org,
      text: `Line ${org} puts the program at ${hex4(at)}, inside the ROM's space ($0000-${hex4(end - 1)}), where it cannot be loaded. Put it in free memory instead, for example with ORG 7000H.`,
    };
  }
  return null;
}

/** The first line that needs the ROM, on the stub; null when the stub will do. Code in the ROM's space comes first. */
export function romUse(result: AsmResult, model: Model): RomFinding | null {
  const space = romSpaceCode(result, model);
  if (space !== null) return space;
  const end = romEnd(model);
  const names = romNames(model);
  const used = [...result.symbols.entries()]
    .filter(([, s]) => s.kind === 'rom')
    .map(([name]) => names.get(name.toUpperCase()))
    .filter((r): r is RomName => r !== undefined && r.entry.table.startsWith('rom-'));
  const byName = used.length === 0 ? null : new RegExp(`(?<![\\w$@.?])(${used.map((r) => escape(r.name)).join('|')})(?![\\w$@.?])`, 'i');
  const advice = romAdvice(model);
  for (const { l, code } of codeLines(result)) {
    const b = l.bytes;
    const op = b[0]!;
    const data = isData(code);
    const named = byName?.exec(code);
    if (named) {
      const r = used.find((u) => u.name.toUpperCase() === named[1]!.toUpperCase())!;
      if (data) return { line: l.line, text: `Line ${l.line} stores ${describeRom(r)} as data, ${advice}` };
      const verb = b.length === 3 && isCall(op) ? 'calls' : b.length === 3 && isJump(op) ? 'jumps to' : r.entry.kind === 'variable' ? 'uses the ROM variable' : 'uses';
      const what = verb === 'uses the ROM variable' ? `${r.name} at ${hex4(r.value)} (${r.entry.purpose}), which the ROM sets up and keeps,` : `${describeRom(r)},`;
      return { line: l.line, text: `Line ${l.line} ${verb} ${what} ${advice}` };
    }
    if (data) continue;
    if (b.length === 1 && isRst(op)) {
      const target = op & 0x38;
      const r = romNameAt(target, model);
      const what = r === undefined ? `the ROM at ${hex4(target)}` : describeRom(r);
      return { line: l.line, text: `Line ${l.line} uses RST ${target.toString(16).toUpperCase().padStart(2, '0')}H, which calls ${what}, ${advice}` };
    }
    if (b.length === 3 && (isCall(op) || isJump(op))) {
      const target = b[1]! | (b[2]! << 8);
      if (target < end) {
        const r = romNameAt(target, model);
        const what = r === undefined ? `${hex4(target)}, inside the ROM` : describeRom(r);
        return { line: l.line, text: `Line ${l.line} ${isCall(op) ? 'calls' : 'jumps to'} ${what}, ${advice}` };
      }
    }
    const mem = memoryOperand(b);
    if (mem !== null) {
      if (mem.read && mem.address < end) {
        const r = romNameAt(mem.address, model);
        const what = r === undefined ? '' : ` (${r.name})`;
        return { line: l.line, text: `Line ${l.line} reads the ROM at ${hex4(mem.address)}${what}, ${romAdvice(model, 'read memory your program owns')}` };
      }
      const v = romVariableAt(mem.address, model);
      if (v !== undefined)
        return {
          line: l.line,
          text: `Line ${l.line} ${mem.read ? 'reads' : 'writes'} ${hex4(mem.address)}, the ROM's variable ${v.name} (${v.entry.purpose}), which the ROM sets up and keeps, ${advice}`,
        };
    }
  }
  return null;
}

const BLOCK_COPY = new Set([0xb0, 0xb8, 0xa0, 0xa8]);
const COPY_NAME: Record<number, string> = { 0xb0: 'LDIR', 0xb8: 'LDDR', 0xa0: 'LDI', 0xa8: 'LDD' };
/** How many following code lines a block copy may be from its LD HL to be noted. */
const NOTE_WINDOW = 8;

/** Warnings on the stub: LD HL with a constant in the ROM's space, then a block copy soon after. */
export function romNotes(result: AsmResult, model: Model): RomFinding[] {
  const end = romEnd(model);
  const lines = codeLines(result).filter(({ code }) => !isData(code));
  const out: RomFinding[] = [];
  lines.forEach(({ l }, i) => {
    const b = l.bytes;
    if (!(b.length === 3 && b[0] === 0x21)) return;
    const hl = b[1]! | (b[2]! << 8);
    if (hl >= end) return;
    const copy = lines.slice(i + 1, i + 1 + NOTE_WINDOW).find(({ l: c }) => c.bytes.length === 2 && c.bytes[0] === 0xed && BLOCK_COPY.has(c.bytes[1]!));
    if (copy === undefined) return;
    out.push({
      line: l.line,
      text: `Line ${l.line} points HL at ${hex4(hl)}, inside the ROM's space, and line ${copy.l.line} copies from where HL points (${COPY_NAME[copy.l.bytes[1]!]}). With no ROM loaded, that copies Fugløy's stand-in, not the ROM. Add a ${MODEL_NAMES[model]} ROM in the Run tab if the program means to read the ROM.`,
    });
  });
  return out;
}
