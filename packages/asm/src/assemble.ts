/**
 * The assembler's two passes.
 *
 * Pass 1 parses every line, places labels, and sizes every instruction from
 * its template alone (so no value can change a length, and pass 1 is exact).
 * EQUs are then resolved in line order, forward references included. Pass 2
 * evaluates operands and encodes. A line with an error has no bytes, but it
 * keeps its size so later addresses do not move, and every other line still
 * assembles, so every error in the program shows at once. Only an error-free
 * result has an image.
 *
 * Every line has two addresses: where its bytes load and where they run.
 * They differ only under .PHASE; labels, `$`, relative jumps, the listing's
 * `address`, and the source map use the run address, and the image the load
 * address. Lines after END are listed but never read. The directives follow
 * zmac (see directives.ts).
 *
 * The chosen model's ROM and hardware names (and, with `dos`, that DOS's) are
 * predefined at the lowest priority (Ruling 5, symbols.ts): a definition in
 * the source wins with no message, and a name the source never defines that a
 * table has resolves to the table's value. An instruction that uses, as a
 * number, an address whose code differs between the Model I and Model III
 * ROMs draws a note naming both: a warning when no model is given, info when
 * one is (romWarning).
 */
import { MemoryImage } from '@fugloy/disasm';
import type { Dos, TableEntry } from '@fugloy/disasm';
import { asSource, encode, lengthOf, show } from './encode.js';
import type { EncodeOptions } from './encode.js';
import { evaluate, ExprError, loneSymbol } from './expr.js';
import type { EvalContext, Expr } from './expr.js';
import { address, addressProblem, DATA_BYTES, DATA_WORDS, end, endPhase, fillProblem, org, REDEFINERS, registerWords, reserve, RESERVE, spanOf, startPhase } from './directives.js';
import { CONDITIONS, isKeyword, isMnemonic, OPERATOR_WORDS, REGISTERS } from './names.js';
import { parseLine } from './parse.js';
import type { OperandNode, Statement } from './parse.js';
import type { Operand, Shape } from './shape.js';
import { distance, nearest, nearestRomName, orList, suggestOperation } from './suggest.js';
import { DEFAULT_MODEL, machineText, nameElsewhere, romDifference, romNames, selectionProblem, TABLE_TEXT } from './symbols.js';
import type { Model, RomName } from './symbols.js';

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  /** 1-based line. */
  line: number;
  /** 1-based column of the first character the message is about. */
  column: number;
  /** Column just past the last character the message is about. */
  endColumn: number;
  severity: Severity;
  message: string;
  /**
   * A stable name for a diagnostic a caller may want to tell apart from the
   * rest; only `rom-difference` (the Model I/III note: a warning when no
   * model is given, info when one is) has one so far.
   */
  code?: 'rom-difference';
  /**
   * When the message gives an exact rewrite, the edit that makes it: replace
   * columns `column` up to (not including) `endColumn` of `line` with
   * `replacement`. An editor can offer it as a one-click fix.
   */
  fix?: Fix;
}

/** One edit to the source: columns are 1-based, `endColumn` just past the last character replaced (equal to `column` to insert). */
export interface Fix {
  line: number;
  column: number;
  endColumn: number;
  replacement: string;
}

export type SymbolKind = 'label' | 'equ' | 'defl' | 'rom';

export interface SymbolInfo {
  value: number;
  /** The defining line; 0 for a ROM, hardware, or DOS name the source used without defining it. */
  line: number;
  kind: SymbolKind;
}

export interface ListingLine {
  line: number;
  /** Where the line runs (the .PHASE address under .PHASE); null for a line that takes no space. */
  address: number | null;
  /** Where the line's bytes load; the same as `address` outside .PHASE. */
  load: number | null;
  bytes: number[];
  text: string;
  /** The value an EQU, DEFL, or `=` line defines. */
  value?: number;
}

/** A line that emitted code at a run address, with the bytes it put there and after it. */
export interface LineAt {
  line: number;
  bytes: number[];
}

/**
 * Keyed by run address, so the line the PC is on can be found under .PHASE
 * too. Several lines can share a run address: a relocating loader's own code
 * and the block it moves there, or an ORG over earlier bytes.
 */
export interface SourceMap {
  /**
   * The line that emitted code at `address`, or null. Where several did, this
   * is the first in source order; to know which is running, use `linesOf` and
   * pick the candidate whose bytes match current memory.
   */
  lineOf(address: number): number | null;
  /** Every line that emitted code at `address`, in source order, each with the bytes it emitted from there on. */
  linesOf(address: number): LineAt[];
  /** Every run address the line emitted code at. */
  addressesOf(line: number): number[];
}

export interface AsmOptions {
  /**
   * The machine whose ROM names are predefined: 1, 3 (the default), or 4 (its
   * LS-DOS 6 service calls and the Model III ROM). Naming it also makes the
   * Model I/III note info rather than a warning.
   */
  model?: Model;
  /** The DOS whose names are predefined too: `trsdos` (Model III only), `ldos`, or `none` (the default). */
  dos?: Dos;
}

export interface AsmResult {
  ok: boolean;
  image: MemoryImage | null;
  entry: number | null;
  /**
   * Keyed by each name as first written (`Loop` stays `Loop`), though names
   * match case-insensitively, as in zmac; use `symbol` to look one up as the
   * assembler does. ROM names appear only where the source uses them.
   */
  symbols: Map<string, SymbolInfo>;
  /** The symbol `name` means, in any case (`loop`, `LOOP`, and `Loop` are one name), or undefined. */
  symbol(name: string): SymbolInfo | undefined;
  sourceMap: SourceMap;
  listing: ListingLine[];
  diagnostics: Diagnostic[];
}

/** Where a program with no ORG starts (Ruling 4). */
export const DEFAULT_ORIGIN = 0x5200;

const RELATIVE: ReadonlySet<string> = new Set(['JR', 'DJNZ']);
/** The jumps and calls, whose last operand is where to go. */
const GOES: ReadonlySet<string> = new Set(['JP', 'CALL', 'JR', 'DJNZ']);

/** zmac directives Fugløy does not have, with what to do instead. */
const UNSUPPORTED: Readonly<Record<string, string>> = (() => {
  const out: Record<string, string> = {};
  const conditional = 'Fugløy does not support conditional assembly (IF, ELSE, ENDIF) yet; keep the lines you want and delete the rest.';
  for (const d of ['IF', 'IFDEF', 'IFNDEF', 'IFEQ', 'IFNE', 'IFLT', 'IFGT', 'ELSE', 'ENDIF', 'COND', 'ENDC']) out[d] = conditional.replace('(IF, ELSE, ENDIF)', `(${d})`);
  const macros = 'Fugløy does not support macros yet; write the instructions out where they are used.';
  for (const d of ['MACRO', 'ENDM', 'REPT', 'IRP', 'IRPC', 'EXITM']) out[d] = macros.replace('macros', `macros (${d})`);
  for (const d of ['INCLUDE', 'MACLIB', 'INCBIN']) out[d] = `Fugløy does not support ${d} yet; put the whole program in one file.`;
  return out;
})();

export interface Sym {
  name: string;
  line: number;
  kind: SymbolKind;
  col: number;
  end: number;
  value?: number;
  /** An EQU's expression and the address of its line (for `$`). */
  expr?: Expr;
  here: number;
  state: 'done' | 'pending' | 'resolving' | 'failed';
  /** For DEFL and `=`, every definition in line order (this one first). */
  versions?: Sym[];
}

/** One source line as the passes see it. */
export interface Item {
  stmt: Statement;
  /** Where it runs; null for a line that takes no space. */
  address: number | null;
  /** Where its bytes load. */
  load: number | null;
  /** Its size from pass 1. */
  length: number;
  /** `space` is a DS that leaves a gap; `fill` a DS that writes its fill (or zeros, under .PHASE). */
  emit: 'none' | 'instr' | 'data' | 'space' | 'fill';
  /** A DS's fill operand. */
  fill?: OperandNode;
  /** For an instruction, the operands it is encoded with (the optional A of SUB A,n dropped, the A of ADD n supplied) and their shapes. */
  operands: OperandNode[];
  shapes: Shape[];
  failed: boolean;
  bytes: number[];
}

/** A repeated EQU, checked against the first once both have values. */
interface Repeat {
  sym: Sym;
  first: Sym;
}

type SymNode = Extract<Expr, { k: 'sym' }>;

/** What an operand names: where a jump or call goes, a memory address, or a plain value. */
type Place = 'go' | 'memory' | 'value';

/** The operand's shape for the encoder. */
function shapeOf(o: OperandNode): Shape {
  switch (o.kind) {
    case 'reg':
      return o.reg as Shape;
    case 'ind':
      return `(${o.reg})` as Shape;
    case 'index':
      return o.reg === 'IX' ? '(IX+d)' : '(IY+d)';
    case 'mem':
      return '(nn)';
    case 'imm':
    case 'str':
      return 'nn';
  }
}

/** SUB, AND, OR, XOR, and CP may write A first; ADD, ADC, and SBC may leave A out (zmac accepts both). */
const A_OPTIONAL: ReadonlySet<string> = new Set(['SUB', 'AND', 'OR', 'XOR', 'CP']);
const A_IMPLIED: ReadonlySet<string> = new Set(['ADD', 'ADC', 'SBC']);

/**
 * The operands to encode: `SUB A,n` as `SUB n`, `ADD n` as `ADD A,n`. A
 * supplied A takes the operation's span; the rewrite is kept only when it
 * names a form (ADD HL is still an error about ADD HL).
 */
function withOptionalA(mn: string, ops: readonly OperandNode[], op: { col: number; end: number }): OperandNode[] {
  const fits = (list: readonly OperandNode[]): boolean => {
    const shapes = list.map(shapeOf);
    return lengthOf(mn, shapes) !== null || lengthOf(mn, list.map((o) => (o.kind === 'mem' ? 'nn' : shapeOf(o)))) !== null;
  };
  if (A_OPTIONAL.has(mn) && ops.length === 2 && ops[0]!.kind === 'reg' && ops[0]!.reg === 'A') {
    const rest = ops.slice(1);
    if (fits(rest)) return rest;
  }
  if (A_IMPLIED.has(mn) && ops.length === 1) {
    const withA: OperandNode[] = [{ kind: 'reg', reg: 'A', text: 'A', col: op.col, end: op.end }, ops[0]!];
    if (fits(withA)) return withA;
  }
  return [...ops];
}

const SINGLE: ReadonlySet<string> = new Set(['B', 'C', 'D', 'E', 'H', 'L', 'I', 'R', 'IXH', 'IXL', 'IYH', 'IYL']);
/** A byte-sized place other than A: a single register, (HL), or (IX+d). */
const byteplace = (o: OperandNode): boolean => (o.kind === 'reg' && SINGLE.has(o.reg)) || (o.kind === 'ind' && o.reg === 'HL') || o.kind === 'index';

/** LD between memory and a byte-sized place other than A, the commonest slip, said plainly with the two-step fix. */
function loadThroughA(mn: string, ops: readonly OperandNode[]): string | undefined {
  if (mn !== 'LD' || ops.length !== 2) return undefined;
  const [dst, src] = ops as [OperandNode, OperandNode];
  if (byteplace(dst) && src.kind === 'mem') return `Only A can be loaded from an address; use LD A,${src.text} then LD ${dst.text},A.`;
  if (dst.kind === 'mem' && byteplace(src)) return `Only A can be stored at an address from a single register; use LD A,${src.text} then LD ${dst.text},A.`;
  return undefined;
}

/** The definition of a DEFL name that a use on `line` sees: the last one above it, or (as zmac's extra passes give) the last of all. */
function versionAt(sym: Sym, line: number): Sym {
  const versions = sym.versions!;
  let seen: Sym | undefined;
  for (const v of versions) if (v.line < line) seen = v;
  return seen ?? versions[versions.length - 1]!;
}

export class Assembly {
  /** The machine the program is for, and the names its tables predefine (upper case). */
  readonly model: Model;
  readonly rom: ReadonlyMap<string, RomName>;
  readonly dos: Dos;
  /** Whether the caller named the model (the Model I/III note is then info, not a warning). */
  readonly modelGiven: boolean;
  /** The predefined names the source used without defining them. */
  readonly romUsed = new Map<string, RomName>();
  readonly diagnostics: Diagnostic[] = [];
  readonly syms = new Map<string, Sym>();
  readonly items: Item[] = [];
  readonly repeats: Repeat[] = [];
  /** Every statement up to END, for definedLater. */
  pending: Statement[] = [];
  /** The run address ($). */
  pc = DEFAULT_ORIGIN;
  /** The load address; it moves with pc and differs from it only under .PHASE. */
  load = DEFAULT_ORIGIN;
  /** The open .PHASE's line, or null. */
  phase: number | null = null;
  sawOrg = false;
  /** Whether an ORG appears anywhere before END; if so, zmac starts at 0, and code before it is an error here. */
  orgLater = false;
  /** Whether a line took an address before any ORG. */
  usedDefault = false;
  /** The END line, if it has an entry to evaluate. */
  endItem: Item | null = null;
  entry: number | null = null;

  constructor(model: Model | undefined, dos: Dos = 'none') {
    this.modelGiven = model !== undefined;
    model ??= DEFAULT_MODEL;
    this.model = model;
    this.dos = dos;
    this.rom = romNames(model, dos);
  }

  /** A predefined name the source does not define, noted as used; undefined when the tables lack it too. */
  romValue(name: string): number | undefined {
    const up = name.toUpperCase();
    const hit = this.rom.get(up);
    if (hit === undefined) return undefined;
    this.romUsed.set(up, hit);
    return hit.value;
  }

  report(severity: Severity, line: number, column: number, endColumn: number, message: string, code?: Diagnostic['code'], fix?: Fix): void {
    const d: Diagnostic = { line, column, endColumn, severity, message };
    if (code !== undefined) d.code = code;
    if (fix !== undefined) d.fix = fix;
    this.diagnostics.push(d);
  }

  error(line: number, column: number, endColumn: number, message: string, fix?: Fix): void {
    this.report('error', line, column, endColumn, message, undefined, fix);
  }

  /** Reports an ExprError at `line`, unless it was reported already. */
  exprError(line: number, e: unknown): void {
    if (!(e instanceof ExprError)) throw e;
    if (e.sentence !== null) this.error(line, e.col, e.end, e.sentence, e.fix === undefined ? undefined : { line, column: e.col, endColumn: e.end, replacement: e.fix });
  }

  // ---- pass 1 -------------------------------------------------------------

  pass1(stmt: Statement): Item {
    const item: Item = { stmt, address: null, load: null, length: 0, emit: 'none', operands: stmt.operands, shapes: [], failed: false, bytes: [] };
    this.items.push(item);
    const { line } = stmt;
    const op = stmt.op;
    const name = op?.name;
    const kind: SymbolKind = name === 'EQU' ? 'equ' : name !== undefined && REDEFINERS.has(name) ? 'defl' : 'label';
    if (stmt.error !== undefined) {
      const { col, end, message, fix } = stmt.error;
      this.error(line, col, end, message, fix === undefined ? undefined : { line, column: col, endColumn: end, replacement: fix });
      item.failed = true;
      // The label still counts (an EQU's as failed), so its uses raise nothing more.
      if (stmt.label !== undefined) this.define(stmt, kind, true);
      return item;
    }
    if (stmt.label !== undefined) this.define(stmt, kind);
    if (op === undefined || name === undefined) return item;

    if (name === 'ORG') {
      org(this, stmt, item);
      return item;
    }
    if (name === 'EQU' || REDEFINERS.has(name)) {
      if (stmt.label === undefined) {
        const example = name === 'EQU' ? 'SCREEN EQU 3C00H' : `COUNT ${name} 0`;
        this.error(line, op.col, op.end, `${name} needs a name in front of it, as in ${example}.`);
        item.failed = true;
      }
      return item;
    }
    if (name === '.PHASE') {
      startPhase(this, stmt, item);
      return item;
    }
    if (name === '.DEPHASE') {
      endPhase(this, stmt, item);
      return item;
    }
    if (name === 'END') {
      end(this, stmt, item);
      return item;
    }
    if (RESERVE.has(name)) {
      reserve(this, stmt, item);
      return item;
    }
    if (DATA_BYTES.has(name) || DATA_WORDS.has(name)) {
      if (stmt.operands.length === 0) {
        this.error(line, op.col, op.end, `${name} needs at least one value.`);
        item.failed = true;
        return item;
      }
      const size = DATA_WORDS.has(name) ? 2 : 1;
      item.length = stmt.operands.reduce((n, o) => n + (o.kind === 'str' && size === 1 ? o.chars.length : size), 0);
      this.place(item, 'data');
      return item;
    }
    if (!isMnemonic(name)) {
      this.unknown(stmt);
      item.failed = true;
      return item;
    }
    this.sizeInstruction(stmt, item);
    return item;
  }

  /** Gives an item its addresses and moves past it. Before the first ORG, when one comes later, that is an error (zmac would use 0). */
  place(item: Item, emit: Item['emit']): void {
    if (!this.sawOrg) {
      if (this.orgLater) {
        const { col, end } = spanOf(item.stmt);
        this.error(item.stmt.line, col, end, `This line comes before the first ORG, so zmac would put it at ${address(this.pc)}. Put the ORG first.`);
        item.failed = true;
      } else this.usedDefault = true;
    }
    item.emit = emit;
    item.address = this.pc;
    item.load = this.load;
    this.pc = (this.pc + item.length) & 0xffff;
    this.load = (this.load + item.length) & 0xffff;
  }

  /** Defines the statement's label; `broken` defines an EQU or DEFL as failed without a further message. */
  define(stmt: Statement, kind: SymbolKind, broken = false): void {
    const label = stmt.label!;
    const up = label.name.toUpperCase();
    const line = stmt.line;
    if (REGISTERS.has(up)) return this.error(line, label.col, label.end, `${up} is a register name, so it cannot be a label.`);
    if (CONDITIONS.has(up)) return this.error(line, label.col, label.end, `${up} is a condition name, so it cannot be a label.`);
    if (OPERATOR_WORDS.has(up)) return this.error(line, label.col, label.end, `${up} is an operator in expressions, so it cannot be a label.`);
    // Only a label takes the default origin; an EQU or DEFL places nothing.
    if (kind === 'label' && !this.sawOrg && !this.orgLater) this.usedDefault = true;
    const sym: Sym = { name: label.name, line, kind, col: label.col, end: label.end, here: this.pc, state: 'done' };
    if (kind === 'label') sym.value = this.pc;
    else if (broken) sym.state = 'failed';
    else this.valueOf(stmt, sym);
    const earlier = this.syms.get(up);
    if (earlier !== undefined) {
      // DEFL and = redefine; an EQU may repeat with the same value (checked once values are known).
      if (kind === 'defl' && earlier.kind === 'defl') {
        earlier.versions!.push(sym);
        return;
      }
      if (kind === 'equ' && earlier.kind === 'equ') {
        if (!broken) this.repeats.push({ sym, first: earlier });
        return;
      }
      return this.error(line, label.col, label.end, `${earlier.name} is defined twice, on lines ${earlier.line} and ${line}. Rename one of them.`);
    }
    if (kind === 'defl') sym.versions = [sym];
    this.syms.set(up, sym);
  }

  /** Takes an EQU's or DEFL's expression, or reports why there is none. */
  valueOf(stmt: Statement, sym: Sym): void {
    const op = stmt.op!;
    const operand = stmt.operands[0];
    if (stmt.operands.length !== 1 || operand === undefined || operand.kind === 'reg' || operand.kind === 'ind' || operand.kind === 'index') {
      const message =
        stmt.operands.length === 0 ? `${op.name} needs a value after it.` : stmt.operands.length > 1 ? `${op.name} takes one value.` : `${op.name} needs a value; ${registerWords(operand!)}.`;
      this.error(stmt.line, op.col, operand?.end ?? op.end, message);
      sym.state = 'failed';
      return;
    }
    sym.expr = operand.expr;
    sym.state = 'pending';
  }

  /**
   * The value of an ORG's or .PHASE's single address operand, evaluated now
   * (only names above count), or undefined after reporting why not.
   */
  addressOperand(stmt: Statement, what: string): number | undefined {
    const op = stmt.op!;
    const [operand, ...rest] = stmt.operands;
    if (operand === undefined) return void this.error(stmt.line, op.col, op.end, `${what} needs an address after it.`);
    if (rest.length > 0) return void this.error(stmt.line, op.col, stmt.operands[stmt.operands.length - 1]!.end, `${what} takes one address.`);
    if (operand.kind === 'reg' || operand.kind === 'ind' || operand.kind === 'index') return void this.error(stmt.line, operand.col, operand.end, `${what} needs an address; ${registerWords(operand)}.`);
    let value: number;
    try {
      value = this.evaluateNow(operand.expr, stmt.line, what);
    } catch (e) {
      return void this.exprError(stmt.line, e);
    }
    const problem = addressProblem(what, value);
    if (problem !== undefined) return void this.error(stmt.line, operand.col, operand.end, problem);
    return value;
  }

  /** Evaluates during pass 1, where only names defined above `line` count. */
  evaluateNow(expr: Expr, line: number, what: string): number {
    return evaluate(expr, { here: this.pc, lookup: (n) => this.lookupBefore(n, line, what, new Set()) });
  }

  /**
   * A symbol's value while pass 1 is still placing lines: only names defined
   * above `line` count, since what follows depends on the answer. `at` is the
   * line whose view of a DEFL name is wanted.
   */
  lookupBefore(node: SymNode, line: number, what: string, seen: Set<Sym>, via?: Sym): number {
    const first = this.syms.get(node.name.toUpperCase());
    if (first === undefined || first.line >= line) {
      if (first === undefined && !this.definedLater(node.name, line)) {
        const rom = this.romValue(node.name);
        if (rom !== undefined) return rom;
        throw this.undefinedError(node);
      }
      throw new ExprError(`${what} cannot use ${node.name} before ${node.name} is defined, because the addresses after this line depend on it. Define ${node.name} above the ${what}.`, node.col, node.end);
    }
    let sym = first;
    if (first.versions !== undefined) {
      // A DEFL name means the definition above the line that uses it. Used by
      // an EQU or DEFL above its first definition, it would mean the last one
      // in the file (zmac's extra passes), which pass 1 has not reached.
      const at = via?.line ?? line;
      const above = first.versions.filter((v) => v.line < at);
      if (above.length === 0) {
        throw new ExprError(
          `${what} cannot use ${via!.name} here: ${via!.name} uses ${first.name} on line ${at}, before ${first.name} is defined on line ${first.line}, and the addresses after this line depend on it. Define ${first.name} above line ${at}.`,
          node.col,
          node.end,
        );
      }
      sym = above[above.length - 1]!;
    }
    if (sym.state === 'failed') throw new ExprError(null, node.col, node.end);
    if (sym.value !== undefined) return sym.value;
    if (seen.has(sym)) throw new ExprError(`${sym.name} is defined in terms of itself.`, node.col, node.end);
    seen.add(sym);
    try {
      return evaluate(sym.expr!, { here: sym.here, lookup: (n) => this.lookupBefore(n, line, what, seen, sym) });
    } catch (e) {
      // Report it at the name on the asking line, not at a column of the definition's line.
      if (e instanceof ExprError) throw new ExprError(e.sentence, node.col, node.end);
      throw e;
    } finally {
      seen.delete(sym);
    }
  }

  /** Whether a line below `line` defines `name` (pass 1 has not reached it yet). */
  definedLater(name: string, line: number): boolean {
    const up = name.toUpperCase();
    return this.pending.some((s) => s.line > line && s.label !== undefined && s.label.name.toUpperCase() === up);
  }

  unknown(stmt: Statement): void {
    const op = stmt.op!;
    const unsupported = UNSUPPORTED[op.name];
    if (unsupported !== undefined) return this.error(stmt.line, op.col, op.end, unsupported);
    if (op.name === 'MOV' || op.name === 'MVI') {
      // The 8080's MOV and MVI are the Z80's LD, and its M is (HL).
      const operands = stmt.operands.map((o) => (o.text.toUpperCase() === 'M' ? '(HL)' : o.text)).join(',');
      const rewrite = `LD${operands === '' ? '' : ` ${operands}`}`;
      const last = stmt.operands[stmt.operands.length - 1];
      const end = last?.end ?? op.end;
      const fix = operands === '' ? undefined : { line: stmt.line, column: op.col, endColumn: end, replacement: rewrite };
      return this.error(stmt.line, op.col, end, `${op.name} is the 8080's name for what the Z80 calls LD${operands === '' ? '.' : `: write ${rewrite}.`}`, fix);
    }
    const guess = suggestOperation(op.name);
    let message = `Unknown instruction ${op.name}.`;
    if (guess !== undefined) message += ` Did you mean ${guess}?`;
    const first = stmt.operands[0];
    const looksLikeLabel = stmt.operands.length === 0 || (stmt.operands.length === 1 && first !== undefined && isKeyword(first.text.split(/\s/)[0]!.toUpperCase()));
    // The label hint only when nothing close was found: a near mnemonic is the likelier slip.
    if (guess === undefined && looksLikeLabel && stmt.label === undefined) message += ` If ${op.name} is a label, start it in column 1 or end it with a colon.`;
    this.error(stmt.line, op.col, op.end, message);
  }

  sizeInstruction(stmt: Statement, item: Item): void {
    const op = stmt.op!;
    const mn = op.name;
    const ops = withOptionalA(mn, stmt.operands, op);
    item.operands = ops;
    let shapes = ops.map(shapeOf);
    let length = lengthOf(mn, shapes);
    // zmac: where the instruction has no memory form, a parenthesised number
    // is the number (SUB (5) is SUB 5); LD never falls back, and JP (nn) only
    // draws a warning from zmac, which is an error here.
    if (length === null && mn !== 'LD' && ops.some((o) => o.kind === 'mem')) {
      const alt = ops.map((o) => (o.kind === 'mem' ? 'nn' : shapeOf(o)));
      const altLength = lengthOf(mn, alt);
      if (altLength !== null) {
        const mem = ops.find((o) => o.kind === 'mem')! as Extract<OperandNode, { kind: 'mem' }>;
        if (mn === 'JP' && ops.length === 1) {
          this.error(stmt.line, mem.col, mem.end, `JP ${mem.text} jumps to ${mem.inner}; it does not read an address from memory there. Write JP ${mem.inner}.`, {
            line: stmt.line,
            column: mem.col,
            endColumn: mem.end,
            replacement: mem.inner,
          });
          item.failed = true;
        } else {
          const written = `${mn} ${stmt.operands.map((o) => o.text).join(',')}`;
          const meant = `${mn} ${stmt.operands.map((o) => (o.kind === 'mem' ? o.inner : o.text)).join(',')}`;
          let message = `${written} reads as ${meant}: ${mn} has no form that reads memory there, so the parentheses only group. Write ${meant} to say so.`;
          // The arithmetic reads memory only through (HL) or an index register; say how, in case the byte was meant.
          const viaHl = lengthOf(mn, alt.map((sh) => (sh === 'nn' ? '(HL)' : sh)));
          if (viaHl !== null) {
            const form = ops.map((o) => (o.kind === 'mem' ? '(HL)' : o.text)).join(',');
            message += ` To use the byte at address ${mem.inner}, point HL at it: LD HL,${mem.inner} then ${mn} ${form}.`;
          }
          const lastOp = stmt.operands[stmt.operands.length - 1]!;
          this.report('warning', stmt.line, mem.col, mem.end, message, undefined, { line: stmt.line, column: op.col, endColumn: lastOp.end, replacement: meant });
        }
        shapes = alt;
        length = altLength;
      }
    }
    item.shapes = shapes;
    // No such form: size 0; pass 2 asks the encoder for the sentence, after the values.
    item.length = length ?? 0;
    this.place(item, 'instr');
  }

  // ---- between the passes -------------------------------------------------

  /** Resolves every EQU and DEFL in line order, then checks each repeated EQU against the first. */
  resolveAll(): void {
    for (const sym of this.definitions()) {
      if (sym.state !== 'pending') continue;
      try {
        this.resolve(sym, []);
      } catch (e) {
        if (!(e instanceof ExprError)) throw e;
      }
    }
    for (const { sym, first } of this.repeats) {
      if (sym.state !== 'done' || first.state !== 'done' || sym.value === first.value) continue;
      this.error(sym.line, sym.col, sym.end, `${first.name} is defined twice with different values, ${show(first.value!)} on line ${first.line} and ${show(sym.value!)} on line ${sym.line}. Rename one of them.`);
    }
  }

  /** An EQU's or DEFL's value, resolving what it depends on; errors are reported at its line. */
  resolve(sym: Sym, chain: Sym[]): number {
    if (sym.state === 'done') return sym.value!;
    if (sym.state === 'failed') throw new ExprError(null, sym.col, sym.end);
    if (sym.state === 'resolving') {
      const loop = [...chain.slice(chain.indexOf(sym)), sym];
      this.error(sym.line, sym.col, sym.end, `${sym.name} is defined in terms of itself: ${loop.map((s) => s.name).join(' → ')}.`);
      for (const s of loop) s.state = 'failed';
      throw new ExprError(null, sym.col, sym.end);
    }
    sym.state = 'resolving';
    chain.push(sym);
    try {
      const value = evaluate(sym.expr!, { here: sym.here, lookup: (n) => this.lookup(n, sym.line, chain) });
      sym.value = value;
      sym.state = 'done';
      return value;
    } catch (e) {
      // A loop found further down has marked it failed and reported already.
      if ((sym.state as Sym['state']) !== 'failed') {
        sym.state = 'failed';
        this.exprError(sym.line, e);
      }
      throw new ExprError(null, sym.col, sym.end);
    } finally {
      chain.pop();
    }
  }

  /** A symbol's value as `line` sees it (which matters only for a DEFL name). */
  /**
   * A symbol's value as `line` sees it (which matters only for a DEFL name).
   * `place` says whether the name is a jump or call target, a memory
   * address, or a plain value, for the message when it is not defined.
   */
  lookup(node: SymNode, line: number, chain: Sym[] = [], place: Place = 'value'): number {
    const sym = this.syms.get(node.name.toUpperCase());
    if (sym === undefined) {
      const rom = this.romValue(node.name);
      if (rom !== undefined) return rom;
      throw this.undefinedError(node, place);
    }
    return this.resolve(sym.versions === undefined ? sym : versionAt(sym, line), chain);
  }

  /** The error for a name nothing defines, with the hex rewrite as a fix where there is one. */
  undefinedError(node: SymNode, place: Place = 'value'): ExprError {
    const { name } = node;
    let fix: string | undefined;
    if (/^[A-F][0-9A-F]*H$/i.test(name)) fix = `0${name}`;
    else if (/^\$[0-9A-F]+H$/i.test(name)) fix = name.slice(0, -1);
    return new ExprError(this.undefinedMessage(name, place), node.col, node.end, fix);
  }

  /** Whether every line has been through pass 1, so the symbols are all known and messages can be kept. */
  placed = false;
  /** undefinedMessage's answers once `placed`, by name and context: a deleted label used 60 times costs one search, not 60. */
  readonly undefinedMessages = new Map<string, string>();

  undefinedMessage(name: string, place: Place = 'value'): string {
    if (!this.placed) return this.findUndefinedMessage(name, place);
    const key = `${place} ${name}`;
    let message = this.undefinedMessages.get(key);
    if (message === undefined) {
      message = this.findUndefinedMessage(name, place);
      this.undefinedMessages.set(key, message);
    }
    return message;
  }

  findUndefinedMessage(name: string, place: Place): string {
    if (/^[A-F][0-9A-F]*H$/i.test(name)) return `${name} is not defined. A hex number must start with a digit: write 0${name}.`;
    if (/^\$[0-9A-F]+H$/i.test(name)) return `${name} is not defined. A hex number takes $ or H, not both: write ${name.slice(0, -1)} or 0${name.slice(1)}.`;
    if (isMnemonic(name.toUpperCase())) return `${name.toUpperCase()} is an instruction, not a value; put one instruction per line.`;
    const near = nearest(name, [...this.syms.values()].map((s) => s.name));
    if (near.length > 0) return `${name} is not defined. Did you mean ${near.join(' or ')}?`;
    const machine = machineText(this.model);
    // A service call or port is a number, never somewhere to go, so a target suggests ROM routines, and an address anything but those.
    const names = [...this.rom.values()];
    const fits = (r: RomName): boolean => (place === 'go' ? r.entry.kind === 'routine' || r.entry.kind === 'vector' : r.entry.kind !== 'svc' && r.entry.kind !== 'port');
    const places = names.filter(fits).map((r) => r.name);
    const placeText = (rom: string[]): string =>
      rom.length === 1 ? `${rom[0]}, ${describeName(this.rom.get(rom[0]!.toUpperCase())!)}` : orList(rom);
    const elsewhere = nameElsewhere(this.model, this.dos, name);
    if (elsewhere !== undefined) {
      let message = `${name} is not defined. ${elsewhereText(elsewhere, machine)}`;
      // CALL CLS on the Model III: the ROM routine whose name holds the call's ($VDCLS) is the likely aim.
      if (elsewhere.table === 'svc-lsdos6' && place === 'go') {
        const want = elsewhere.name.toUpperCase().replace(/^[$@]/, '');
        const rom = places
          .filter((n) => n.toUpperCase().replace(/^[$@]/, '').includes(want))
          .sort((a, b) => a.length - b.length || (a < b ? -1 : 1))
          .slice(0, 3);
        if (rom.length > 0) message += ` On the ${machine}, did you mean ${placeText(rom)}?`;
      }
      return message;
    }
    if (place !== 'value') {
      const rom = nearestRomName(name, places);
      // Only a service call spelled almost as the word: the call is a different thing, so a loose match would mislead.
      const core = name.toUpperCase().replace(/^[$@]/, '');
      const svc = names.filter((r) => r.entry.kind === 'svc' && distance(core, r.name.toUpperCase().replace(/^[$@]/, '')) <= 1).map((r) => r.name);
      const call = svc.length > 0 ? `${svc[0]} is an LS-DOS 6 service call number, not an address: to use it, write LD A,${svc[0]} then RST 28H.` : '';
      if (rom.length > 0) return `${name} is not defined. Did you mean ${placeText(rom)}?${call === '' ? '' : ` (${call})`}`;
      if (call !== '') return `${name} is not defined. ${call}`;
    }
    const rom = nearestRomName(name, names.map((r) => r.name));
    if (rom.length > 0) return `${name} is not defined. Did you mean ${placeText(rom)}?`;
    return `${name} is not defined.`;
  }

  /**
   * Notes once for a line whose instruction uses an address the Model I and
   * Model III ROM tables give different meanings: a CALL or JP target, or a
   * memory address in parentheses (not an IN or OUT port). A predefined ROM
   * name is never noted, since it comes from the chosen model's table and
   * so already says which machine it means. With no model given the note is
   * a warning (the address may have been copied from the other machine's
   * listing); with a model given it is an info note with the same code.
   */
  romWarning(item: Item, operands: readonly Operand[]): void {
    const { stmt } = item;
    const mn = stmt.op!.name;
    if (mn === 'IN' || mn === 'OUT') return;
    for (let i = 0; i < operands.length; i++) {
      const { shape, value } = operands[i]!;
      const node = item.operands[i]!;
      if (value === undefined || !('expr' in node)) continue;
      const name = loneSymbol(node.expr);
      if (name !== undefined && !this.syms.has(name.toUpperCase()) && this.rom.has(name.toUpperCase())) continue;
      if (!(shape === '(nn)' || (shape === 'nn' && (mn === 'CALL' || mn === 'JP')))) continue;
      const diff = romDifference(value & 0xffff);
      if (diff === undefined) continue;
      // The Model 4 runs Model III code with the Model III ROM.
      const [mine, theirs, machine, other] = this.model === 1 ? [diff.model1, diff.model3, 'Model I', 'Model III'] : [diff.model3, diff.model1, 'Model III', 'Model I'];
      const head = `${address(value)} means different things in the two ROMs: on the ${machine} it is ${mine.name} (${mine.purpose}), on the ${other} ${theirs.name} (${theirs.purpose}).`;
      if (this.modelGiven) this.report('info', stmt.line, node.col, node.end, `${head} This line is right for the ${machine} only.`, 'rom-difference');
      else {
        this.report(
          'warning',
          stmt.line,
          node.col,
          node.end,
          `${head} No model was chosen, so the program is assembled for the ${machine}, and this line is right for it only; choose the model the program is for.`,
          'rom-difference',
        );
      }
      return;
    }
  }

  // ---- pass 2 -------------------------------------------------------------

  pass2(item: Item): void {
    if (item === this.endItem) return this.entryOf(item);
    if (item.failed || item.emit === 'none' || item.emit === 'space') return;
    const { stmt } = item;
    const ctx: EvalContext = { here: item.address!, lookup: (n) => this.lookup(n, stmt.line) };
    try {
      item.bytes = item.emit === 'instr' ? this.encodeInstruction(item, ctx) : item.emit === 'fill' ? this.encodeFill(item, ctx) : this.encodeData(item, ctx);
    } catch (e) {
      this.exprError(stmt.line, e);
      item.bytes = [];
      item.failed = true;
      return;
    }
    if (item.failed) item.bytes = [];
    else if (item.bytes.length !== item.length) {
      throw new Error(`internal: line ${stmt.line} sized ${item.length} in pass 1 but encoded ${item.bytes.length} bytes`);
    }
  }

  /**
   * zmac lets a later line write over bytes already placed, and the later
   * bytes win; say so once for each pair of lines, with the range.
   */
  checkOverlaps(): void {
    const owner = new Uint32Array(0x10000);
    for (const item of this.items) {
      if (item.bytes.length === 0) continue;
      const hit = new Map<number, [number, number]>();
      item.bytes.forEach((_, k) => {
        const a = (item.load! + k) & 0xffff;
        const earlier = owner[a]!;
        if (earlier !== 0 && earlier !== item.stmt.line) {
          const range = hit.get(earlier);
          if (range === undefined) hit.set(earlier, [a, a]);
          else range[1] = a;
        }
        owner[a] = item.stmt.line;
      });
      const { col, end } = spanOf(item.stmt);
      for (const [earlier, [lo, hi]] of hit) {
        const where = lo === hi ? address(lo) : `${address(lo)} to ${address(hi)}`;
        this.report('warning', item.stmt.line, col, end, `Line ${item.stmt.line} writes over ${where}, which line ${earlier} already filled; the later bytes win, as in zmac.`);
      }
    }
  }

  /** Every definition in line order: each label and EQU, every DEFL version, and every repeated EQU. */
  definitions(): Sym[] {
    const all: Sym[] = [];
    for (const sym of this.syms.values()) all.push(...(sym.versions ?? [sym]));
    all.push(...this.repeats.map((r) => r.sym));
    return all.sort((a, b) => a.line - b.line);
  }

  /** The value each EQU, DEFL, and = line defines, by line, for the listing. */
  definedValues(): Map<number, number> {
    const out = new Map<number, number>();
    for (const sym of this.definitions()) if (sym.kind !== 'label' && sym.value !== undefined) out.set(sym.line, sym.value & 0xffff);
    return out;
  }

  /** END's entry address. */
  entryOf(item: Item): void {
    const { stmt } = item;
    const operand = stmt.operands[0] as Extract<OperandNode, { expr: Expr }>;
    try {
      const value = evaluate(operand.expr, { here: this.pc, lookup: (n) => this.lookup(n, stmt.line) });
      const problem = addressProblem('END', value);
      if (problem !== undefined) return this.error(stmt.line, operand.col, operand.end, problem);
      this.entry = value;
    } catch (e) {
      this.exprError(stmt.line, e);
    }
  }

  /** A DS's bytes: its fill (0 to 127), or zeros under .PHASE. */
  encodeFill(item: Item, ctx: EvalContext): number[] {
    const { stmt } = item;
    const fill = item.fill as Extract<OperandNode, { expr: Expr }> | undefined;
    let value = 0;
    if (fill !== undefined) {
      value = evaluate(fill.expr, ctx);
      const problem = fillProblem(stmt.op!.name, value);
      if (problem !== undefined) {
        this.error(stmt.line, fill.col, fill.end, problem);
        item.failed = true;
        return [];
      }
    }
    return new Array<number>(item.length).fill(value & 0xff);
  }

  /** Whether operand `i` of an instruction is where to go or a memory address (not an IN or OUT port). */
  static isPlace(mn: string, shape: Shape, i: number, count: number): boolean {
    return Assembly.placeOf(mn, shape, i, count) !== 'value';
  }

  /** What operand `i` of an instruction names: where to go, a memory address (not an IN or OUT port), or a plain value. */
  static placeOf(mn: string, shape: Shape, i: number, count: number): Place {
    if (shape === '(nn)') return mn === 'IN' || mn === 'OUT' ? 'value' : 'memory';
    return GOES.has(mn) && i === count - 1 && (shape === 'nn' || shape === 'e' || shape === 'n') ? 'go' : 'value';
  }

  encodeInstruction(item: Item, ctx: EvalContext): number[] {
    const { stmt } = item;
    const op = stmt.op!;
    const nodes = item.operands;
    const operands: Operand[] = nodes.map((o, i) => {
      const shape = item.shapes[i]!;
      if (o.kind === 'reg' || o.kind === 'ind') return { shape };
      const place = Assembly.placeOf(op.name, shape, i, nodes.length);
      return { shape, value: evaluate(o.expr, place === 'value' ? ctx : { here: ctx.here, lookup: (n) => this.lookup(n, stmt.line, [], place) }) };
    });
    const first = stmt.operands[0];
    const last = stmt.operands[stmt.operands.length - 1];
    const fail = (message: string, at?: OperandNode, rewrite?: string): number[] => {
      const fix = rewrite === undefined ? undefined : { line: stmt.line, column: op.col, endColumn: last?.end ?? op.end, replacement: rewrite };
      this.error(stmt.line, at?.col ?? first?.col ?? op.col, at?.end ?? last?.end ?? op.end, message, fix);
      item.failed = true;
      return [];
    };
    // A service call or port name is a number: as a target or an address it is a slip, though it assembles.
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      if (!('expr' in node) || !Assembly.isPlace(op.name, operands[i]!.shape, i, nodes.length)) continue;
      const name = loneSymbol(node.expr);
      if (name === undefined || this.syms.has(name.toUpperCase())) continue;
      const entry = this.rom.get(name.toUpperCase())?.entry;
      if (entry?.kind === 'svc') return fail(`${name} is an LS-DOS 6 service call number (${entry.key}), not an address: to make the call, write LD A,${name} then RST 28H.`, node);
      if (entry?.kind === 'port') return fail(`${name} is a port number (${show(entry.key)}), not an address: read it with IN A,(${name}) or write it with OUT (${name}),A.`, node);
    }
    const ld = loadThroughA(op.name, nodes);
    if (ld !== undefined) return fail(ld);
    const options: EncodeOptions = { written: stmt.operands.map((o) => o.text) };
    const target = nodes[nodes.length - 1];
    if (RELATIVE.has(op.name) && target !== undefined && 'expr' in target) {
      const name = loneSymbol(target.expr);
      if (name !== undefined) options.target = name;
    }
    const out = encode(op.name, operands, item.address!, options);
    if ('bytes' in out) {
      this.romWarning(item, operands);
      return out.bytes;
    }
    let message = out.error;
    const v = operands[0]?.value;
    if (op.name === 'RST' && v !== undefined && v >= 1 && v <= 7) {
      message += ` zmac reads RST ${v} as RST ${asSource(v * 8)}; write RST ${asSource(v * 8)} if that is what you mean.`;
    }
    const culprit = out.operand === undefined ? undefined : nodes[out.operand];
    return fail(message, culprit, out.rewrite);
  }

  encodeData(item: Item, ctx: EvalContext): number[] {
    const { stmt } = item;
    const name = stmt.op!.name;
    const words = DATA_WORDS.has(name);
    const out: number[] = [];
    for (const o of stmt.operands) {
      if (o.kind === 'reg' || o.kind === 'ind' || o.kind === 'index') {
        this.error(stmt.line, o.col, o.end, `${name} takes values; ${registerWords(o)}.`);
        item.failed = true;
        return [];
      }
      if (o.kind === 'str' && !words) {
        out.push(...o.chars);
        continue;
      }
      // zmac: $ is the address of this value, not of the line.
      const value = evaluate(o.expr, { ...ctx, here: (ctx.here + out.length) & 0xffff });
      const [lo, hi, what] = words ? [-32768, 0xffff, 'words'] : [-128, 0xff, 'bytes'];
      if (value < lo || value > hi) {
        this.error(stmt.line, o.col, o.end, `${name} takes ${what}, ${lo} to ${hi}; ${show(value)} is out of range.`);
        item.failed = true;
        return [];
      }
      out.push(value & 0xff);
      if (words) out.push((value >> 8) & 0xff);
    }
    return out;
  }
}

/** Splits source into lines (LF or CRLF); a final newline does not make an extra line. */
function sourceLines(source: string): string[] {
  const lines = source.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function assemble(source: string, options: AsmOptions = {}): AsmResult {
  const problem = selectionProblem(options.model ?? DEFAULT_MODEL, options.dos);
  if (problem !== undefined) throw new RangeError(problem);
  const asm = new Assembly(options.model, options.dos);
  const lines = sourceLines(source);
  // Lines are read up to END; the rest are listed but never parsed, as zmac ignores them.
  const statements: Statement[] = [];
  for (let i = 0; i < lines.length; i++) {
    const stmt = parseLine(lines[i]!, i + 1);
    statements.push(stmt);
    if (stmt.op?.name === 'END') break;
  }
  asm.pending = statements;
  asm.orgLater = statements.some((s) => s.op?.name === 'ORG');
  if (asm.orgLater) {
    asm.pc = 0;
    asm.load = 0;
  }
  for (const stmt of statements) asm.pass1(stmt);
  asm.placed = true;
  asm.resolveAll();
  for (const item of asm.items) asm.pass2(item);
  for (let i = statements.length; i < lines.length; i++) {
    asm.items.push({ stmt: { line: i + 1, text: lines[i]!, operands: [] }, address: null, load: null, length: 0, emit: 'none', operands: [], shapes: [], failed: false, bytes: [] });
  }
  asm.checkOverlaps();

  // toCmd's default transfer address is the first assembled byte's load address; under .PHASE that code is linked to run elsewhere.
  const firstPlaced = asm.items.find((i) => i.bytes.length > 0);
  if (asm.entry === null && asm.endItem === null && firstPlaced !== undefined && firstPlaced.address !== firstPlaced.load) {
    const { col, end } = spanOf(firstPlaced.stmt);
    asm.report(
      'info',
      firstPlaced.stmt.line,
      col,
      end,
      `There is no END entry, so a .CMD of this program starts at its first byte, ${address(firstPlaced.load!)}, where this line loads; but it is assembled to run at ${address(firstPlaced.address!)}. Name the start with END, as in END START.`,
    );
  }
  if (!asm.orgLater && asm.usedDefault) {
    // The note covers line 1 (at least one column), so an editor has something to mark.
    asm.report('info', 1, 1, Math.max(2, (lines[0]?.length ?? 0) + 1), `There is no ORG, so the program starts at ${address(DEFAULT_ORIGIN)}.`);
  }
  const diagnostics = asm.diagnostics.map((d, i) => ({ d, i })).sort((a, b) => a.d.line - b.d.line || a.i - b.i).map(({ d }) => d);
  const ok = !diagnostics.some((d) => d.severity === 'error');

  // The source map (by run address) and the listing. Bytes are sliced only when asked for.
  const lineAt = new Map<number, { item: Item; k: number }[]>();
  const byLine = new Map<number, number[]>();
  const valueAt = asm.definedValues();
  const listing: ListingLine[] = asm.items.map((item) => {
    const { line, text } = item.stmt;
    const addrs: number[] = [];
    item.bytes.forEach((_, k) => {
      const a = (item.address! + k) & 0xffff;
      addrs.push(a);
      const here = lineAt.get(a);
      if (here === undefined) lineAt.set(a, [{ item, k }]);
      else here.push({ item, k });
    });
    byLine.set(line, addrs);
    const placed = item.emit !== 'none';
    const entry: ListingLine = { line, address: placed ? item.address : null, load: placed ? item.load : null, bytes: item.bytes, text };
    const value = valueAt.get(line);
    if (value !== undefined) entry.value = value;
    return entry;
  });
  const sourceMap: SourceMap = {
    lineOf: (a) => lineAt.get(a & 0xffff)?.[0]?.item.stmt.line ?? null,
    linesOf: (a) => (lineAt.get(a & 0xffff) ?? []).map(({ item, k }) => ({ line: item.stmt.line, bytes: item.bytes.slice(k) })),
    addressesOf: (line) => [...(byLine.get(line) ?? [])],
  };

  let image: MemoryImage | null = null;
  if (ok) {
    image = new MemoryImage();
    // One block per run of lines whose bytes load one after another.
    let start = -1;
    let block: number[] = [];
    const flush = (): void => {
      if (block.length > 0) image!.load(start, block);
      block = [];
    };
    for (const item of asm.items) {
      if (item.bytes.length === 0) continue;
      if (block.length === 0 || ((start + block.length) & 0xffff) !== item.load) {
        flush();
        start = item.load!;
      }
      block.push(...item.bytes);
    }
    flush();
  }

  const symbols = new Map<string, SymbolInfo>();
  for (const sym of asm.syms.values()) {
    // A DEFL name reports its last value, as zmac's symbol table does, and that definition's line.
    const last = sym.versions === undefined ? sym : sym.versions[sym.versions.length - 1]!;
    if (last.value !== undefined) symbols.set(sym.name, { value: last.value & 0xffff, line: last.line, kind: sym.kind });
  }
  for (const r of asm.romUsed.values()) symbols.set(r.name, { value: r.value, line: 0, kind: 'rom' });

  const byUpper = new Map<string, SymbolInfo>();
  for (const [name, info] of symbols) byUpper.set(name.toUpperCase(), info);
  const symbol = (name: string): SymbolInfo | undefined => byUpper.get(name.toUpperCase());

  return { ok, image, entry: ok ? asm.entry : null, symbols, symbol, sourceMap, listing, diagnostics };
}

/** Where a name the chosen tables lack comes from, and how to get it. */
function elsewhereText(entry: TableEntry, machine: string): string {
  const from = TABLE_TEXT[entry.table];
  if (entry.table.startsWith('dos-')) return `${entry.name} is a ${from} name; choose ${from} as the DOS to use it.`;
  if (entry.table === 'svc-lsdos6') return `${entry.name} is an LS-DOS 6 service call, which only the Model 4 has.`;
  return `${entry.name} is a ${from} name, and this program is assembled for the ${machine}.`;
}

/** `the Model III ROM routine at $01C9 (clear the screen)`: where a predefined name comes from and what it is. */
function describeName(r: RomName): string {
  const { entry } = r;
  const from = TABLE_TEXT[entry.table];
  if (entry.kind === 'port') return `the ${from} port ${show(entry.key)} (${entry.purpose})`;
  if (entry.kind === 'svc') return `the ${from} service call ${entry.key} (${entry.purpose})`;
  return `the ${from} ${entry.kind} at ${address(entry.key)} (${entry.purpose})`;
}
