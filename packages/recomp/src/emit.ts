/**
 * A program's routines as the text of one JavaScript module: its port. The module imports the
 * runtime's helpers as `o` and exports `MODEL`, `DATA` (the program's non-code bytes), `ENTRY`, and
 * one function per routine, named from the caller's names, else the disassembler's symbols; a note at
 * a routine's start is its JSDoc. Each instruction is one statement (a line, with its address and its
 * assembly as a comment); each block begins `z.at(addr);` and ends with its tick and `z.q`.
 *
 * Within a routine the blocks are the labelled cases of `for (;;) switch (b)`. A transfer to one of
 * them sets `b`; a transfer into another routine's start returns that routine (the trampoline,
 * `o.call`, runs it next with the same return address); a transfer anywhere else throws
 * `o.unknown`'s sentence. A CALL runs its callee through `o.call`, and a RET checks with `o.ret` that
 * it returns where its CALL said.
 *
 * Time (Ruling 3): a block ticks its instructions' T-states and R at its end, on each path a
 * conditional transfer takes, and also just before an instruction that reads the time (`readsTime`),
 * so `z.cycles` and `z.r` there are its own start. A repeating instruction's statements tick each
 * iteration that repeats themselves; the block adds its last iteration.
 */
import type { Ir } from '@fugloy/disasm';
import { renderInstruction } from '@fugloy/disasm';
import type { SymbolTable } from '@fugloy/disasm';
import type { Instruction } from '@fugloy/z80';
import type { Routine, Routines } from './routines.js';
import { translate } from './translate.js';
import type { Translation } from './translate.js';

export interface EmitInput {
  model: 1 | 3;
  runtimeImport: string;
  /** What the program is, for the module's first comment (a file name, not a path). */
  source?: string;
  entry: number;
  routines: Routines;
  /** The IR: its symbols name what the caller's names do not, and its notes become JSDoc and comments. */
  ir: Ir;
  /** The analysis's instructions, by address. */
  instructions: ReadonlyMap<number, Instruction>;
  /** The analysis's symbol table, for each instruction's assembly in its comment. */
  symbols: SymbolTable;
  /** `at` comments from a hint file, by address. */
  comments: ReadonlyMap<number, string>;
  /** The caller's names, by address; they win over the IR's. */
  names: ReadonlyMap<number, string>;
  /** The program's non-code bytes, in address order. */
  data: readonly (readonly [number, Uint8Array])[];
}

export interface Emitted {
  js: string;
  /** Each routine's function name, by its start. */
  routineNames: ReadonlyMap<number, string>;
  /** The places that throw a sentence when they run: transfers to no block, HALTs. */
  refused: string[];
  /** What cannot be translated at all: the port is refused. */
  errors: string[];
}

const hex = (n: number, width: number): string => n.toString(16).toUpperCase().padStart(width, '0');
const word = (n: number): string => `0x${hex(n & 0xffff, 4)}`;
const addr = (n: number): string => `$${hex(n & 0xffff, 4)}`;

/** Names a module cannot give a routine: JavaScript's reserved words and globals, and its own names. */
const RESERVED = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum',
  'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface',
  'let', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'static', 'super', 'switch', 'this', 'throw',
  'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'arguments', 'eval', 'undefined', 'NaN', 'Infinity',
  'o', 'z', 'b', 'ret', 'MODEL', 'DATA', 'ENTRY',
]);

/** A name as a JavaScript identifier: other characters become `_`, and a reserved one takes a `_`. */
function identifier(name: string): string {
  let id = name.replace(/[^A-Za-z0-9_$]/g, '_');
  if (/^[0-9]/.test(id)) id = `_${id}`;
  return RESERVED.has(id) ? `${id}_` : id;
}

/** One line of a comment: no line breaks, and nothing that closes a block comment. */
const oneLine = (text: string): string => text.replace(/[\r\n]+/g, ' ').replace(/\*\//g, '*\\/');

/** The column a statement's comment starts at, unless the statement runs past it. */
const COMMENT_AT = 52;

class Writer {
  readonly lines: string[] = [];
  /** One line, indented; with a comment, the comment aligned after it. */
  line(indent: number, text: string, comment?: string): void {
    const line = `${' '.repeat(indent)}${text}`;
    this.lines.push(comment === undefined ? line : `${line.padEnd(COMMENT_AT - 2)}  // ${comment}`);
  }
}

export function emit(input: EmitInput): Emitted {
  const { routines, instructions, symbols, comments } = input;
  const irNames = new Map(input.ir.symbols.map((s) => [s.addr, s.name]));
  const notes = new Map((input.ir.notes ?? []).map((n) => [n.addr, n.lines]));
  /** The name an address has, from the caller, else the disassembler; undefined when it has none. */
  const nameOf = (a: number): string | undefined => input.names.get(a) ?? irNames.get(a);

  // Routine names, unique, in address order
  const routineNames = new Map<number, string>();
  const taken = new Set<string>();
  for (const r of routines.routines) {
    let id = identifier(nameOf(r.start) ?? `SUB_${hex(r.start, 4)}`);
    if (taken.has(id)) id = `${id}_${hex(r.start, 4)}`;
    taken.add(id);
    routineNames.set(r.start, id);
  }

  const refused: string[] = [];
  const errors: string[] = [];
  const w = new Writer();

  w.line(0, '/**');
  w.line(0, ` * ${input.source === undefined ? 'A TRS-80 program' : oneLine(input.source)}, ported to JavaScript for the Model ${input.model === 1 ? 'I' : 'III'}`);
  w.line(0, ' * by @fugloy/recomp. Generated: never edit it by hand. It runs on @fugloy/runtime:');
  w.line(0, ' * `load(z, port)`, then `runPort(z, port)`.');
  w.line(0, ' */');
  w.line(0, `import * as o from '${input.runtimeImport.replace(/[\\']/g, '\\$&')}';`);
  w.line(0, '');
  w.line(0, `export const MODEL = ${input.model};`);
  w.line(0, '');
  w.line(0, "/** The program's bytes that are not code (its data), as [address, bytes]. */");
  w.line(0, 'export const DATA = [');
  for (const [at, bytes] of input.data) {
    for (const text of notes.get(at) ?? []) w.line(2, `// ${oneLine(text)}`);
    const label = nameOf(at);
    const head = `[${word(at)}, Uint8Array.of(`;
    const literals = [...bytes].map((v) => `0x${hex(v, 2)}`);
    const comment = label === undefined ? undefined : `${addr(at)} ${oneLine(label)}`;
    if (literals.length <= 16) w.line(2, `${head}${literals.join(', ')})],`, comment);
    else {
      w.line(2, head, comment);
      for (let k = 0; k < literals.length; k += 16) w.line(4, `${literals.slice(k, k + 16).join(', ')},`);
      w.line(2, ')],');
    }
  }
  w.line(0, '];');
  w.line(0, '');
  w.line(0, '/** The routine the program starts at. */');
  w.line(0, `export const ENTRY = ${routineNames.get(input.entry)!};`);

  for (const r of routines.routines) {
    w.line(0, '');
    emitRoutine(r);
  }

  // A block two routines share is translated, and so reported, in each
  return { js: `${w.lines.join('\n')}\n`, routineNames, refused: [...new Set(refused)], errors: [...new Set(errors)] };

  function emitRoutine(r: Routine): void {
    const name = routineNames.get(r.start)!;
    const own = new Set(r.blocks.map((b) => b.start));
    const doc = notes.get(r.start) ?? [];
    if (doc.length === 0) w.line(0, `/** ${name} (${addr(r.start)}) */`);
    else {
      w.line(0, '/**');
      w.line(0, ` * ${name} (${addr(r.start)}).`);
      for (const text of doc) w.line(0, text === '' ? ' *' : ` * ${oneLine(text)}`);
      w.line(0, ' */');
    }
    w.line(0, `export function ${name}(z, ret) {`);
    w.line(2, `let b = ${word(r.start)};`);
    w.line(2, 'for (;;) switch (b) {');
    for (const block of r.blocks) {
      const label = nameOf(block.start);
      w.line(4, label === undefined ? `case ${word(block.start)}:` : `case ${word(block.start)}: // ${oneLine(label)}`);
      w.line(6, `z.at(${word(block.start)});`);
      emitBlock(block.start, block.end);
    }
    w.line(2, '}');
    w.line(0, '}');

    /** The statement that goes to `to` from the transfer at `from`: another block, another routine, or nowhere. */
    function go(to: number, from: number, ins: Instruction): string {
      if (to !== r.start && routines.starts.has(to)) return `return ${routineNames.get(to)!};`;
      if (own.has(to)) return `b = ${word(to)}; continue;`;
      return nowhere(to, from, ins);
    }

    /** The statement for a transfer to an address no block starts: it throws `o.unknown`'s sentence. */
    function nowhere(to: number, from: number, ins: Instruction): string {
      refused.push(`${addr(from)}: ${renderInstruction(ins, symbols)} goes to ${addr(to)}, where no block of the port starts; the port throws there when it runs.`);
      return `throw o.unknown(z, ${word(to)}, ${word(from)});`;
    }

    function emitBlock(start: number, end: number): void {
      let t = 0;
      let rr = 0;
      let qPrev: 0 | 1 | null = null;
      for (let at = start; at <= end; ) {
        const ins = instructions.get(at);
        if (ins === undefined) {
          errors.push(`${addr(at)}: the block at ${addr(start)} has no instruction here.`);
          return;
        }
        let tr: Translation;
        try {
          tr = translate(ins, at, { qPrev });
        } catch (e) {
          errors.push((e as Error).message);
          return;
        }
        const next = (at + ins.length) & 0xffff;
        const text = renderInstruction(ins, symbols);
        const note = comments.get(at);
        const comment = `${addr(at)}  ${text}${note === undefined ? '' : `  ; ${oneLine(note)}`}`;
        // A note at the routine's start is its JSDoc; any other is a comment where it is
        for (const line of at === r.start ? [] : (notes.get(at) ?? [])) w.line(6, `// ${oneLine(line)}`);
        if (tr.readsTime && (t !== 0 || rr !== 0)) {
          w.line(6, `z.tick(${t}, ${rr});`);
          t = 0;
          rr = 0;
        }
        const last = at + ins.length > end;
        if (!last) {
          statements(6, tr.lines, comment);
          t += tr.cycles;
          rr += tr.r;
          qPrev = tr.writesFlags ? 1 : 0;
          at = next;
          continue;
        }

        // The block's last instruction: its tick, Q, and where it goes
        const q = `z.q = ${tr.writesFlags ? 1 : 0};`;
        const tick = (cycles: number): string => `z.tick(${t + cycles}, ${rr + tr.r}); ${q}`;
        const notTaken = tr.cyclesNotTaken ?? tr.cycles;
        if (tr.targetExpr !== undefined && tr.flow === 'jump') {
          errors.push(`${addr(at)}: ${text} jumps to an address computed as it runs, which M1 does not translate (a hint naming its targets is for a later milestone).`);
          return;
        }
        switch (tr.flow) {
          case 'next':
            statements(6, tr.lines, comment);
            w.line(6, tick(tr.cycles));
            w.line(6, go(next, at, ins));
            break;
          case 'jump': {
            const target = tr.target!;
            if (tr.cond === undefined) {
              statements(6, tr.lines, comment);
              w.line(6, tick(tr.cycles));
              w.line(6, go(target, at, ins));
              break;
            }
            conditional(tr, comment, [tick(tr.cycles), go(target, at, ins)]);
            w.line(6, tick(notTaken));
            w.line(6, go(next, at, ins));
            break;
          }
          case 'call': {
            const target = tr.target!;
            const known = routines.starts.has(target);
            const callee = known ? `o.call(z, ${routineNames.get(target)!}, ${word(next)});` : nowhere(target, at, ins);
            if (tr.cond === undefined) {
              statements(6, tr.lines, comment);
              w.line(6, tick(tr.cycles));
              w.line(6, callee);
              if (!known) break;
            } else {
              conditional(tr, comment, [tick(tr.cycles), callee], [tick(notTaken)]);
            }
            w.line(6, go(next, at, ins));
            break;
          }
          case 'return': {
            const back = `o.ret(z, ret, ${word(at)}); return;`;
            if (tr.cond === undefined) {
              statements(6, tr.lines, comment);
              w.line(6, tick(tr.cycles));
              w.line(6, back);
              break;
            }
            conditional(tr, comment, [tick(tr.cycles), back]);
            w.line(6, tick(notTaken));
            w.line(6, go(next, at, ins));
            break;
          }
          case 'halt':
            statements(6, tr.lines, comment);
            w.line(6, tick(tr.cycles));
            w.line(6, `throw o.halt(z, ${word(at)});`);
            refused.push(`${addr(at)}: HALT waits for an interrupt, which a port does not take; the port throws there when it runs.`);
            break;
        }
        return;
      }
    }

    /** A conditional transfer: its statements, then `if (cond) { taken; then }`, and `else { otherwise }` when given. */
    function conditional(tr: Translation, comment: string, then: string[], otherwise?: string[]): void {
      if (tr.lines.length > 0) {
        statements(6, tr.lines, comment);
        w.line(6, `if (${tr.cond!}) {`);
      } else w.line(6, `if (${tr.cond!}) {`, comment);
      for (const line of [...(tr.taken ?? []), ...then]) w.line(8, line);
      if (otherwise === undefined) w.line(6, '}');
      else {
        w.line(6, '} else {');
        for (const line of otherwise) w.line(8, line);
        w.line(6, '}');
      }
    }

    /** An instruction's statements, on one line with its comment, or a loop's over several. */
    function statements(indent: number, lines: readonly string[], comment: string): void {
      if (lines.length === 0) w.line(indent, `// ${comment}`);
      else if (lines.some((l) => l.includes('{') || l.includes('}'))) {
        w.line(indent, lines[0]!, comment);
        for (const line of lines.slice(1)) w.line(indent, line);
      } else w.line(indent, lines.join(' '), comment);
    }
  }
}
