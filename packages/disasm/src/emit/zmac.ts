/**
 * zmac source emitter: one ORG per loaded run, instructions in zmac spelling
 * with symbol names where Pass 2 has them, data as DB or DW rows, labels on
 * their own lines (EQU when a symbol falls inside an instruction), hint
 * comments, and END with the file's own transfer address. Table names (ROM,
 * hardware, DOS) take an EQU each, ahead of the program's own. Every
 * instruction line assembles back to its own bytes under the pinned zmac
 * (test/roundtrip/table.test.ts proves it for all 1792 encodings); symbols
 * resolve to the same values, so labels never change bytes.
 */
import { hexByte, hexWord } from '@fugloy/z80';
import { dbString } from './strings.js';
import type { Instruction } from '@fugloy/z80';
import type { Pass1 } from '../analysis/descent.js';
import { externalUses } from '../analysis/externals.js';
import type { ExternalNames } from '../analysis/externals.js';
import { filePieces } from '../analysis/relocate.js';
import type { AnalysisSpace } from '../analysis/relocate.js';
import { Kind } from '../analysis/map.js';
import { outsideComments, SymbolTable } from '../analysis/symbols.js';
import { rowStarts } from '../analysis/words.js';
import { emptyAnnotations } from '../hints/apply.js';
import type { Annotations } from '../hints/apply.js';
import type { MemoryImage } from '../memory.js';
import type { TableEntry } from '../symbols/types.js';
import { externalComment, previousInstruction, renderOperands } from './operands.js';

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
  /** Pass 2 symbols: label lines, EQU for symbols inside instructions, names in operands and DW rows. */
  symbols?: SymbolTable;
  /** Hint comments appended to the row at their address. */
  annotations?: Annotations;
  /** The analysis space, when regions were relocated: they are emitted under .PHASE at their runtime addresses. */
  space?: AnalysisSpace;
  /** Table names for addresses outside the image: operands, DW words, and the comments that explain them; without it nothing is named. */
  externals?: ExternalNames;
  /** The table entries the source names, each given an EQU (service calls excepted); defaults to the entries `externals` names in this source. */
  tablesUsed?: readonly TableEntry[];
}

const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');
const key = (ins: Instruction): string => ins.bytes.slice(0, 2).map(hex2).join('');
const dbRow = (bytes: number[]): string => `\tDB\t${bytes.map(hexByte).join(',')}`;
const ROW_BYTES = 8;

/** `\tLD\tHL,3C00H`, or a DB row for undocumented forms and byte-exact exceptions. */
export function instructionLine(ins: Instruction, symbols?: SymbolTable, externals?: ExternalNames): string {
  if (ins.mnemonic === 'DB' || BYTE_EXACT_EXCEPTIONS.has(key(ins))) return dbRow(ins.bytes);
  const operands = renderOperands(ins, symbols, externals);
  return operands === '' ? `\t${ins.mnemonic}` : `\t${ins.mnemonic}\t${operands}`;
}

export function emitZmac(image: MemoryImage, pass1: Pass1, entry: number | null, opts: EmitOptions = {}): string {
  const { symbols, externals } = opts;
  const annotations = opts.annotations ?? emptyAnnotations();
  const { map, instructions } = pass1;
  /** Bytes at runtime addresses: the analysis space when there is one, else the file image itself. */
  const view = opts.space?.image ?? image;
  const relocations = opts.space?.relocations ?? [];
  const runs = image.runs();
  const loaded = runs.reduce((n, r) => n + r.length, 0);
  const out: string[] = [
    `; ${opts.source === undefined ? '' : `${opts.source}: `}Fugløy pass 1, ${runs.length} run${runs.length === 1 ? '' : 's'}, ${loaded} bytes, ${entry === null ? 'no entry' : `entry ${hexWord(entry)}`}`,
  ];
  // A table name is defined by its entry: a port by its byte, anything else by its address. A service call is numbered, never an operand, so it has no EQU.
  const used = opts.tablesUsed ?? (externals === undefined ? [] : externalUses(instructions.values(), externals, symbols ?? new SymbolTable()));
  for (const e of used) {
    if (e.kind !== 'svc') out.push(`${e.name}\tEQU\t${e.kind === 'port' ? hexByte(e.key) : hexWord(e.key)}\t; ${e.purpose}`);
  }
  if (symbols !== undefined) {
    // A user name outside the program (an `at` hint) has no label line to define it.
    for (const s of symbols.list()) {
      if (s.source === 'user' && !view.isLoaded(s.addr)) out.push(`${s.name}\tEQU\t${hexWord(s.addr)}${s.comment === undefined ? '' : `\t; ${s.comment}`}`);
    }
    for (const c of outsideComments(annotations, symbols, view)) out.push(`; ${hexWord(c.addr)}: ${c.text}`);
    for (const s of symbols.list()) if (map.kind(s.addr) === Kind.Tail) out.push(`${s.name}\tEQU\t${hexWord(s.addr)}`);
  }
  /** The hint comment at `addr`, then what the tables say about the row, as one comment. */
  const withComment = (addr: number, line: string, note?: string): string => {
    const parts = [annotations.comments.get(addr), note].filter((part): part is string => part !== undefined);
    return parts.length === 0 ? line : `${line}\t; ${parts.join('; ')}`;
  };
  const startsRow = rowStarts(symbols, annotations, instructions);

  /** Rows for runtime addresses [from, to]. An instruction that does not end by `to` is written as bytes: its rest lies elsewhere in the file. */
  const rows = (from: number, to: number): void => {
    let addr = from;
    while (addr <= to) {
      const symbol = symbols?.get(addr);
      if (symbol !== undefined && map.kind(addr) !== Kind.Tail) out.push(`${symbol.name}:`);
      const ins = instructions.get(addr);
      if (ins !== undefined && addr + ins.length - 1 <= to) {
        const line = instructionLine(ins, symbols, externals);
        const note = externals === undefined ? undefined : externalComment(ins, previousInstruction(instructions, symbols, addr), externals, symbols);
        out.push(withComment(addr, opts.addresses === true ? `${line}\t; ${hexWord(addr)}` : line, note));
        addr += ins.length;
        continue;
      }
      // A data row: same kind throughout, cut at symbols, comments, instructions, typed-region starts, and `to`.
      const kind = map.kind(addr);
      if (kind === Kind.String) {
        let n = 1;
        while (addr + n <= to && !startsRow(addr + n) && map.kind(addr + n) === Kind.String) n++;
        const [first, ...rest] = dbString(view.bytes.subarray(addr, addr + n)).split('\n');
        out.push(withComment(addr, first!), ...rest);
        addr += n;
        continue;
      }
      let n = 1;
      while (addr + n <= to && n < ROW_BYTES && !startsRow(addr + n) && map.kind(addr + n) === kind) n++;
      let line: string;
      if (kind === Kind.Word && n >= 2) {
        if (n % 2 === 1) n--;
        const words: string[] = [];
        for (let i = 0; i < n; i += 2) {
          const value = view.bytes[addr + i]! | (view.bytes[addr + i + 1]! << 8);
          words.push(symbols?.get(value)?.name ?? externals?.word(addr + i, value)?.text ?? hexWord(value));
        }
        line = `\tDW\t${words.join(',')}`;
      } else {
        line = dbRow(Array.from(view.bytes.subarray(addr, addr + n)));
      }
      out.push(withComment(addr, line));
      addr += n;
    }
  };

  // Walk the file image, so every byte assembles where it loads; a relocated piece is written at its runtime address under .PHASE.
  for (const run of runs) {
    out.push(`\tORG\t${hexWord(run.start)}`);
    for (const piece of filePieces(run, relocations)) {
      if (piece.runAddr === null) {
        rows(piece.start, piece.end);
        continue;
      }
      out.push(`\t.PHASE\t${hexWord(piece.runAddr)}`);
      rows(piece.runAddr, piece.runAddr + piece.end - piece.start);
      out.push('\t.DEPHASE');
    }
  }
  out.push(entry === null ? '\tEND' : `\tEND\t${hexWord(entry)}`);
  return `${out.join('\n')}\n`;
}
