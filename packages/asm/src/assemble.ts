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
 * Task 2 handles ORG, EQU, DB/DEFB/DEFM, and DW/DEFW; the other directives
 * (DEFL/=, DS/DEFS, .PHASE/.DEPHASE, END) are Task 3's, and the predefined
 * ROM names (the `rom` kind and the `model`/`dos` options) are Task 5's.
 */
import { MemoryImage } from '@fugloy/disasm';
import { asSource, encode, lengthOf, show } from './encode.js';
import type { EncodeOptions } from './encode.js';
import { evaluate, ExprError, loneSymbol } from './expr.js';
import type { EvalContext, Expr } from './expr.js';
import { CONDITIONS, isKeyword, isMnemonic, OPERATOR_WORDS, REGISTERS } from './names.js';
import { parseLine } from './parse.js';
import type { OperandNode, Statement } from './parse.js';
import type { Operand, Shape } from './shape.js';
import { nearest, suggestOperation } from './suggest.js';

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
}

export type SymbolKind = 'label' | 'equ' | 'defl' | 'rom';

export interface SymbolInfo {
  value: number;
  line: number;
  kind: SymbolKind;
}

export interface ListingLine {
  line: number;
  /** Where the line's bytes go; null for a line that takes no space. */
  address: number | null;
  bytes: number[];
  text: string;
}

export interface SourceMap {
  lineOf(address: number): number | null;
  addressesOf(line: number): number[];
}

export interface AsmOptions {
  model?: 1 | 3 | 4;
  dos?: string;
}

export interface AsmResult {
  ok: boolean;
  image: MemoryImage | null;
  entry: number | null;
  /** Keyed by each name as first written; names match case-insensitively, as in zmac. */
  symbols: Map<string, SymbolInfo>;
  sourceMap: SourceMap;
  listing: ListingLine[];
  diagnostics: Diagnostic[];
}

/** Where a program with no ORG starts (Ruling 4). */
export const DEFAULT_ORIGIN = 0x5200;

const DATA_BYTES: ReadonlySet<string> = new Set(['DB', 'DEFB', 'DEFM']);
const DATA_WORDS: ReadonlySet<string> = new Set(['DW', 'DEFW']);
/** Directives the language has that Task 3 implements. */
const NOT_YET: ReadonlySet<string> = new Set(['DEFL', '=', 'DS', 'DEFS', '.PHASE', '.DEPHASE', 'END']);
const RELATIVE: ReadonlySet<string> = new Set(['JR', 'DJNZ']);

interface Sym {
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
}

/** One source line as the passes see it. */
interface Item {
  stmt: Statement;
  /** Where its bytes go; null for a line that takes no space. */
  address: number | null;
  /** Its size from pass 1. */
  length: number;
  emit: 'none' | 'instr' | 'data';
  /** For an instruction, the operands it is encoded with (the optional A of SUB A,n dropped, the A of ADD n supplied) and their shapes. */
  operands: OperandNode[];
  shapes: Shape[];
  failed: boolean;
  bytes: number[];
}

type SymNode = Extract<Expr, { k: 'sym' }>;

/** `$3C00`. */
const address = (value: number): string => `$${(value & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;

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

/** `B is a register`, `NZ is a condition`, `(HL) is a register in parentheses`, for an operand that should have been a value. */
function registerWords(o: OperandNode): string {
  if (o.kind === 'reg') return `${o.reg} is a ${CONDITIONS.has(o.reg) ? 'condition' : 'register'}`;
  return `${o.text} is a register`;
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

class Assembly {
  readonly diagnostics: Diagnostic[] = [];
  readonly syms = new Map<string, Sym>();
  readonly items: Item[] = [];
  pc = DEFAULT_ORIGIN;
  sawOrg = false;
  /** The first line that took an address before any ORG. */
  usedDefault = false;

  report(severity: Severity, line: number, column: number, endColumn: number, message: string): void {
    this.diagnostics.push({ line, column, endColumn, severity, message });
  }

  error(line: number, column: number, endColumn: number, message: string): void {
    this.report('error', line, column, endColumn, message);
  }

  /** Reports an ExprError at `line`, unless it was reported already. */
  exprError(line: number, e: unknown): void {
    if (!(e instanceof ExprError)) throw e;
    if (e.sentence !== null) this.error(line, e.col, e.end, e.sentence);
  }

  // ---- pass 1 -------------------------------------------------------------

  pass1(stmt: Statement): Item {
    const item: Item = { stmt, address: null, length: 0, emit: 'none', operands: stmt.operands, shapes: [], failed: false, bytes: [] };
    this.items.push(item);
    const { line } = stmt;
    const op = stmt.op;
    const name = op?.name;
    if (stmt.error !== undefined) {
      this.error(line, stmt.error.col, stmt.error.end, stmt.error.message);
      item.failed = true;
      // The label still counts (an EQU's as failed), so its uses raise nothing more.
      if (stmt.label !== undefined) this.define(stmt, name === 'EQU' ? 'equ' : 'label', true);
      return item;
    }
    if (op !== undefined && NOT_YET.has(op.name)) {
      this.error(line, op.col, op.end, `${op.name} is not handled yet.`);
      item.failed = true;
      return item;
    }
    if (stmt.label !== undefined) {
      if (name === 'EQU') this.define(stmt, 'equ');
      else this.define(stmt, 'label');
    }
    if (op === undefined || name === undefined) return item;

    if (name === 'ORG') {
      this.org(stmt, item);
      return item;
    }
    if (name === 'EQU') {
      if (stmt.label === undefined) {
        this.error(line, op.col, op.end, 'EQU needs a name in front of it, as in SCREEN EQU 3C00H.');
        item.failed = true;
      }
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

  /** Gives an item its address and moves past it. */
  place(item: Item, emit: Item['emit']): void {
    if (!this.sawOrg) this.usedDefault = true;
    item.emit = emit;
    item.address = this.pc;
    this.pc = (this.pc + item.length) & 0xffff;
  }

  /** Defines the statement's label; `broken` defines an EQU as failed without a further message. */
  define(stmt: Statement, kind: SymbolKind, broken = false): void {
    const label = stmt.label!;
    const up = label.name.toUpperCase();
    const line = stmt.line;
    if (REGISTERS.has(up)) return this.error(line, label.col, label.end, `${up} is a register name, so it cannot be a label.`);
    if (CONDITIONS.has(up)) return this.error(line, label.col, label.end, `${up} is a condition name, so it cannot be a label.`);
    if (OPERATOR_WORDS.has(up)) return this.error(line, label.col, label.end, `${up} is an operator in expressions, so it cannot be a label.`);
    const earlier = this.syms.get(up);
    if (earlier !== undefined) {
      return this.error(line, label.col, label.end, `${earlier.name} is defined twice, on lines ${earlier.line} and ${line}. Rename one of them.`);
    }
    if (!this.sawOrg) this.usedDefault = true;
    const sym: Sym = { name: label.name, line, kind, col: label.col, end: label.end, here: this.pc, state: 'done' };
    if (kind === 'label') sym.value = this.pc;
    else if (broken) sym.state = 'failed';
    else {
      const operand = stmt.operands[0];
      if (stmt.operands.length !== 1 || operand === undefined || operand.kind === 'reg' || operand.kind === 'ind' || operand.kind === 'index') {
        const op = stmt.op!;
        const message =
          stmt.operands.length === 0 ? 'EQU needs a value after it.' : stmt.operands.length > 1 ? 'EQU takes one value.' : `EQU needs a value; ${registerWords(operand!)}.`;
        this.error(line, op.col, operand?.end ?? op.end, message);
        sym.state = 'failed';
      } else {
        sym.expr = operand.expr;
        sym.state = 'pending';
      }
    }
    this.syms.set(up, sym);
  }

  org(stmt: Statement, item: Item): void {
    const op = stmt.op!;
    const [operand, ...rest] = stmt.operands;
    item.failed = true;
    if (operand === undefined) return this.error(stmt.line, op.col, op.end, 'ORG needs an address after it.');
    if (rest.length > 0) return this.error(stmt.line, op.col, stmt.operands[stmt.operands.length - 1]!.end, 'ORG takes one address.');
    if (operand.kind === 'reg' || operand.kind === 'ind' || operand.kind === 'index') return this.error(stmt.line, operand.col, operand.end, `ORG needs an address; ${registerWords(operand)}.`);
    let value: number;
    try {
      value = evaluate(operand.expr, { here: this.pc, lookup: (n) => this.lookupBefore(n, stmt.line, 'ORG', new Set()) });
    } catch (e) {
      return this.exprError(stmt.line, e);
    }
    if (value < 0 || value > 0xffff) return this.error(stmt.line, operand.col, operand.end, `ORG takes an address, 0 to 65535; ${show(value)} is out of range.`);
    item.failed = false;
    this.pc = value;
    this.sawOrg = true;
  }

  /**
   * A symbol's value while pass 1 is still placing lines: only names defined
   * above `line` count, since what follows depends on the answer.
   */
  lookupBefore(node: SymNode, line: number, what: string, seen: Set<Sym>): number {
    const sym = this.syms.get(node.name.toUpperCase());
    if (sym === undefined || sym.line >= line) {
      if (sym === undefined && !this.definedLater(node.name, line)) throw new ExprError(this.undefinedMessage(node.name), node.col, node.end);
      throw new ExprError(`${what} cannot use ${node.name} before ${node.name} is defined, because the addresses after this line depend on it. Define ${node.name} above the ${what}.`, node.col, node.end);
    }
    if (sym.state === 'failed') throw new ExprError(null, node.col, node.end);
    if (sym.value !== undefined) return sym.value;
    if (seen.has(sym)) throw new ExprError(`${sym.name} is defined in terms of itself.`, node.col, node.end);
    seen.add(sym);
    try {
      return evaluate(sym.expr!, { here: sym.here, lookup: (n) => this.lookupBefore(n, line, what, seen) });
    } finally {
      seen.delete(sym);
    }
  }

  /** Whether a line below `line` defines `name` (pass 1 has not reached it yet). */
  definedLater(name: string, line: number): boolean {
    const up = name.toUpperCase();
    return this.pending.some((s) => s.line > line && s.label !== undefined && s.label.name.toUpperCase() === up);
  }

  /** Every statement, for definedLater. */
  pending: Statement[] = [];

  unknown(stmt: Statement): void {
    const op = stmt.op!;
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
          this.error(stmt.line, mem.col, mem.end, `JP ${mem.text} jumps to ${mem.inner}; it does not read an address from memory there. Write JP ${mem.inner}.`);
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
          this.report('warning', stmt.line, mem.col, mem.end, message);
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

  resolveAll(): void {
    for (const sym of this.syms.values()) {
      if (sym.state !== 'pending') continue;
      try {
        this.resolve(sym, []);
      } catch (e) {
        if (!(e instanceof ExprError)) throw e;
      }
    }
  }

  /** An EQU's value, resolving what it depends on; errors are reported at the EQU's line. */
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
      const value = evaluate(sym.expr!, { here: sym.here, lookup: (n) => this.lookup(n, chain) });
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

  lookup(node: SymNode, chain: Sym[] = []): number {
    const sym = this.syms.get(node.name.toUpperCase());
    if (sym === undefined) throw new ExprError(this.undefinedMessage(node.name), node.col, node.end);
    return this.resolve(sym, chain);
  }

  undefinedMessage(name: string): string {
    if (/^[A-F][0-9A-F]*H$/i.test(name)) return `${name} is not defined. A hex number must start with a digit: write 0${name}.`;
    const near = nearest(name, [...this.syms.values()].map((s) => s.name));
    return near.length > 0 ? `${name} is not defined. Did you mean ${near.join(' or ')}?` : `${name} is not defined.`;
  }

  // ---- pass 2 -------------------------------------------------------------

  pass2(item: Item): void {
    if (item.failed || item.emit === 'none') return;
    const { stmt } = item;
    const ctx: EvalContext = { here: item.address!, lookup: (n) => this.lookup(n) };
    try {
      item.bytes = item.emit === 'instr' ? this.encodeInstruction(item, ctx) : this.encodeData(item, ctx);
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

  encodeInstruction(item: Item, ctx: EvalContext): number[] {
    const { stmt } = item;
    const op = stmt.op!;
    const nodes = item.operands;
    const operands: Operand[] = nodes.map((o, i) => {
      const shape = item.shapes[i]!;
      return o.kind === 'reg' || o.kind === 'ind' ? { shape } : { shape, value: evaluate(o.expr, ctx) };
    });
    const first = stmt.operands[0];
    const last = stmt.operands[stmt.operands.length - 1];
    const fail = (message: string, at?: OperandNode): number[] => {
      this.error(stmt.line, at?.col ?? first?.col ?? op.col, at?.end ?? last?.end ?? op.end, message);
      item.failed = true;
      return [];
    };
    const ld = loadThroughA(op.name, nodes);
    if (ld !== undefined) return fail(ld);
    const options: EncodeOptions = { written: stmt.operands.map((o) => o.text) };
    const target = nodes[nodes.length - 1];
    if (RELATIVE.has(op.name) && target !== undefined && 'expr' in target) {
      const name = loneSymbol(target.expr);
      if (name !== undefined) options.target = name;
    }
    const out = encode(op.name, operands, item.address!, options);
    if ('bytes' in out) return out.bytes;
    let message = out.error;
    const v = operands[0]?.value;
    if (op.name === 'RST' && v !== undefined && v >= 1 && v <= 7) {
      message += ` zmac reads RST ${v} as RST ${asSource(v * 8)}; write RST ${asSource(v * 8)} if that is what you mean.`;
    }
    const culprit = out.operand === undefined ? undefined : nodes[out.operand];
    return fail(message, culprit);
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
      const value = evaluate(o.expr, ctx);
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

export function assemble(source: string, _options: AsmOptions = {}): AsmResult {
  const asm = new Assembly();
  const statements = sourceLines(source).map((text, i) => parseLine(text, i + 1));
  asm.pending = statements;
  for (const stmt of statements) asm.pass1(stmt);
  asm.resolveAll();
  for (const item of asm.items) asm.pass2(item);

  if (!asm.sawOrg && asm.usedDefault) {
    // The note covers line 1 (at least one column), so an editor has something to mark.
    asm.report('info', 1, 1, Math.max(2, (statements[0]?.text.length ?? 0) + 1), `There is no ORG, so the program starts at ${address(DEFAULT_ORIGIN)}.`);
  }
  const diagnostics = asm.diagnostics.map((d, i) => ({ d, i })).sort((a, b) => a.d.line - b.d.line || a.i - b.i).map(({ d }) => d);
  const ok = !diagnostics.some((d) => d.severity === 'error');

  // The source map and listing.
  const lineAt = new Map<number, number>();
  const byLine = new Map<number, number[]>();
  const listing: ListingLine[] = asm.items.map((item) => {
    const { line, text } = item.stmt;
    const addrs: number[] = [];
    item.bytes.forEach((_, k) => {
      const a = (item.address! + k) & 0xffff;
      addrs.push(a);
      lineAt.set(a, line);
    });
    byLine.set(line, addrs);
    return { line, address: item.emit === 'none' ? null : item.address, bytes: item.bytes, text };
  });
  const sourceMap: SourceMap = {
    lineOf: (a) => lineAt.get(a & 0xffff) ?? null,
    addressesOf: (line) => [...(byLine.get(line) ?? [])],
  };

  let image: MemoryImage | null = null;
  if (ok) {
    image = new MemoryImage();
    // One block per run of lines whose bytes follow on from each other.
    let start = -1;
    let block: number[] = [];
    const flush = (): void => {
      if (block.length > 0) image!.load(start, block);
      block = [];
    };
    for (const item of asm.items) {
      if (item.bytes.length === 0) continue;
      if (block.length === 0 || ((start + block.length) & 0xffff) !== item.address) {
        flush();
        start = item.address!;
      }
      block.push(...item.bytes);
    }
    flush();
  }

  const symbols = new Map<string, SymbolInfo>();
  for (const sym of asm.syms.values()) {
    if (sym.value !== undefined) symbols.set(sym.name, { value: sym.value & 0xffff, line: sym.line, kind: sym.kind });
  }

  return { ok, image, entry: null, symbols, sourceMap, listing, diagnostics };
}
