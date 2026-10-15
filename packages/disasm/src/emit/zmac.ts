/**
 * zmac source emitter for Pass 1: one ORG per loaded run, instructions with
 * absolute operands in zmac spelling, everything else as DB rows, and END
 * with the entry. Every instruction line assembles back to its own bytes
 * under the pinned zmac (test/roundtrip/table.test.ts proves it for all 1792
 * encodings); the few encodings zmac re-spells are emitted as DB.
 */
import { formatInstruction, hexByte, hexWord } from '@fugloy/z80';
import type { Instruction } from '@fugloy/z80';
import type { Pass1 } from '../analysis/descent.js';
import type { MemoryImage } from '../memory.js';

/**
 * Encodings the pinned zmac assembles to different (shorter) bytes, keyed by
 * their first two bytes: the ED-prefixed forms of LD (nn),HL and LD HL,(nn),
 * which zmac writes as 22/2A.
 */
export const BYTE_EXACT_EXCEPTIONS: ReadonlySet<string> = new Set(['ED63', 'ED6B']);

export interface EmitOptions {
  /** File name for the header comment. */
  source?: string;
  /** Append `; 6000H` to each instruction line (off by default: noise for the round trip). */
  addresses?: boolean;
}

const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');
const key = (ins: Instruction): string => ins.bytes.slice(0, 2).map(hex2).join('');
const dbRow = (bytes: number[]): string => `\tDB\t${bytes.map(hexByte).join(',')}`;

/** `\tLD\tHL,3C00H`, or a DB row for undocumented forms and byte-exact exceptions. */
export function instructionLine(ins: Instruction): string {
  if (ins.mnemonic === 'DB' || BYTE_EXACT_EXCEPTIONS.has(key(ins))) return dbRow(ins.bytes);
  const text = formatInstruction(ins);
  const space = text.indexOf(' ');
  return space < 0 ? `\t${text}` : `\t${text.slice(0, space)}\t${text.slice(space + 1)}`;
}

export function emitZmac(image: MemoryImage, pass1: Pass1, entry: number | null, opts: EmitOptions = {}): string {
  const runs = image.runs();
  const loaded = runs.reduce((n, r) => n + r.length, 0);
  const out: string[] = [
    `; ${opts.source === undefined ? '' : `${opts.source}: `}Fugløy pass 1, ${runs.length} run${runs.length === 1 ? '' : 's'}, ${loaded} bytes, ${entry === null ? 'no entry' : `entry ${hexWord(entry)}`}`,
  ];
  for (const run of runs) {
    out.push(`\tORG\t${hexWord(run.start)}`);
    let pending: number[] = [];
    const flush = (): void => {
      for (let i = 0; i < pending.length; i += 8) out.push(dbRow(pending.slice(i, i + 8)));
      pending = [];
    };
    let addr = run.start;
    while (addr <= run.end) {
      const ins = pass1.instructions.get(addr);
      if (ins !== undefined) {
        flush();
        out.push(opts.addresses === true ? `${instructionLine(ins)}\t; ${hexWord(addr)}` : instructionLine(ins));
        addr += ins.length;
      } else {
        pending.push(image.bytes[addr]!);
        if (pending.length === 8) flush();
        addr++;
      }
    }
    flush();
  }
  out.push(entry === null ? '\tEND' : `\tEND\t${hexWord(entry)}`);
  return `${out.join('\n')}\n`;
}
