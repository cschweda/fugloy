/**
 * A program's routines as the text of one JavaScript module: its port. The module imports the
 * runtime's helpers as `o` and exports `MODEL`, `DATA` (the program's non-code bytes), `ENTRY`, and
 * one function per routine, named from the caller's names, else the disassembler's symbols; a note at
 * a routine's start is its JSDoc. Each instruction is one statement (a line, with its address and its
 * assembly as a comment); each block begins `z.at(addr);` and ends with its tick and `z.q`.
 *
 * Within a routine, the blocks are structured code where its control flow allows (structure.ts):
 * `while (true)` loops, `if`/`else`, and `break` and `continue`, labelled from addresses alone where they
 * must name their loop or block. Where it does not (an irreducible loop), the blocks are the labelled
 * cases of `for (;;) switch (b)`, and a transfer to one of them sets `b`. Either way, each block is
 * written once and runs its statements, tick and `z.q` in the same order. A transfer into another
 * routine's start returns that routine (the trampoline, `o.call`, runs it next with the same return
 * address); a transfer anywhere else throws `o.unknown`'s sentence. A CALL runs its callee through
 * `o.call`, and a RET checks with `o.ret` that it returns where its CALL said.
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
import { structure } from './structure.js';
import type { Code, Exit } from './structure.js';
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
  /** By each routine's start: true when its blocks are the labelled cases of a `switch`, false when structured. */
  labelled: ReadonlyMap<number, boolean>;
  /** The places that throw a sentence when they run: transfers to no block, HALTs. */
  refused: string[];
  /** What cannot be translated at all: the port is refused. */
  errors: string[];
}

const hex = (n: number, width: number): string => n.toString(16).toUpperCase().padStart(width, '0');
const word = (n: number): string => `0x${hex(n & 0xffff, 4)}`;
const addr = (n: number): string => `$${hex(n & 0xffff, 4)}`;

/**
 * Names a module cannot give a routine: JavaScript's reserved words and the globals it may not shadow,
 * every binding the module itself uses (the `o` import, `MODEL`, `DATA`, `ENTRY`, the global
 * `Uint8Array` `DATA` is built with), and the parameters and local of a routine (`z`, `ret`, `b`).
 */
const RESERVED = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum',
  'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface',
  'let', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'static', 'super', 'switch', 'this', 'throw',
  'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'arguments', 'eval', 'undefined', 'NaN', 'Infinity',
  'globalThis', 'Uint8Array', 'then',
  'o', 'MODEL', 'DATA', 'ENTRY', 'z', 'ret', 'b',
]);

/**
 * A name as a JavaScript identifier: other characters become `_`, a leading digit takes a `_` before
 * it, and a reserved name a `_` after it; empty when the name is.
 */
function identifier(name: string): string {
  let id = name.replace(/[^A-Za-z0-9_$]/g, '_');
  if (/^[0-9]/.test(id)) id = `_${id}`;
  return RESERVED.has(id) ? `${id}_` : id;
}

/**
 * Text from outside the emitter (a name, a symbol, a hint note or comment, an instruction's rendering,
 * the source's name) as comment text: every JavaScript line terminator (CR, LF, U+2028, U+2029) and
 * every other control character becomes a space, so it cannot end a `//` comment, and `*\/` is broken,
 * so it cannot end a block comment. The Writer applies it to every comment it writes.
 */
const commentText = (text: string): string =>
  text.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/g, ' ').replace(/\*\//g, '*\\/');

/** A string as a JavaScript string literal in single quotes: every character outside printable ASCII escaped. */
const stringLiteral = (text: string): string =>
  `'${text.replace(/[\\']/g, '\\$&').replace(/[^\u0020-\u007E]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}'`;

/** The column a statement's comment starts at, unless the statement runs past it. */
const COMMENT_AT = 52;

/**
 * The module's lines. Code goes in as the emitter builds it, from numbers, identifiers and string
 * literals; every piece of free text goes in through a comment method, which passes it through
 * `commentText`.
 */
class Writer {
  readonly lines: string[] = [];
  /** One line of code, indented; with a comment, the comment aligned after it. */
  line(indent: number, code: string, comment?: string): void {
    const line = `${' '.repeat(indent)}${code}`;
    this.lines.push(comment === undefined ? line : `${line.padEnd(COMMENT_AT - 2)}  // ${commentText(comment)}`);
  }
  /** A line of code with a short comment straight after it (`case 0x7006: // FILL`). */
  tagged(indent: number, code: string, comment: string | undefined): void {
    this.lines.push(`${' '.repeat(indent)}${code}${comment === undefined ? '' : ` // ${commentText(comment)}`}`);
  }
  /** A comment on a line of its own. */
  comment(indent: number, text: string): void {
    this.lines.push(`${' '.repeat(indent)}// ${commentText(text)}`);
  }
  /** A JSDoc block: one line, or a first line and the rest, a blank one as a bare ` *`. */
  doc(first: string, rest: readonly string[] = []): void {
    if (rest.length === 0) {
      this.lines.push(`/** ${commentText(first)} */`);
      return;
    }
    this.lines.push('/**', ` * ${commentText(first)}`);
    for (const text of rest) this.lines.push(text === '' ? ' *' : ` * ${commentText(text)}`);
    this.lines.push(' */');
  }
}

export function emit(input: EmitInput): Emitted {
  const { routines, instructions, symbols, comments } = input;
  const irNames = new Map(input.ir.symbols.map((s) => [s.addr, s.name]));
  const notes = new Map((input.ir.notes ?? []).map((n) => [n.addr, n.lines]));
  /** The name an address has, from the caller, else the disassembler; undefined when it has none. */
  const nameOf = (a: number): string | undefined => input.names.get(a) ?? irNames.get(a);

  // Routine names, unique, in address order: a taken one takes its address, then a count
  const routineNames = new Map<number, string>();
  const taken = new Set<string>();
  for (const r of routines.routines) {
    const id = identifier(nameOf(r.start) ?? '') || `SUB_${hex(r.start, 4)}`;
    let unique = id;
    for (let n = 1; taken.has(unique); n++) unique = n === 1 ? `${id}_${hex(r.start, 4)}` : `${id}_${hex(r.start, 4)}_${n}`;
    taken.add(unique);
    routineNames.set(r.start, unique);
  }

  const refused: string[] = [];
  const errors: string[] = [];
  const w = new Writer();

  w.doc(`${input.source ?? 'A TRS-80 program'}, ported to JavaScript for the Model ${input.model === 1 ? 'I' : 'III'}`, [
    'by @fugloy/recomp. Generated: never edit it by hand. It runs on @fugloy/runtime:',
    '`load(z, port)`, then `runPort(z, port)`.',
  ]);
  w.line(0, `import * as o from ${stringLiteral(input.runtimeImport)};`);
  w.line(0, '');
  w.line(0, `export const MODEL = ${input.model};`);
  w.line(0, '');
  w.doc("The program's bytes that are not code (its data), as [address, bytes].");
  w.line(0, 'export const DATA = [');
  for (const [at, bytes] of input.data) {
    for (const text of notes.get(at) ?? []) w.comment(2, text);
    const label = nameOf(at);
    const head = `[${word(at)}, Uint8Array.of(`;
    const literals = [...bytes].map((v) => `0x${hex(v, 2)}`);
    const comment = label === undefined ? undefined : `${addr(at)} ${label}`;
    if (literals.length <= 16) w.line(2, `${head}${literals.join(', ')})],`, comment);
    else {
      w.line(2, head, comment);
      for (let k = 0; k < literals.length; k += 16) w.line(4, `${literals.slice(k, k + 16).join(', ')},`);
      w.line(2, ')],');
    }
  }
  w.line(0, '];');
  w.line(0, '');
  w.doc('The routine the program starts at.');
  w.line(0, `export const ENTRY = ${routineNames.get(input.entry)!};`);

  const labelled = new Map<number, boolean>();
  for (const r of routines.routines) {
    w.line(0, '');
    labelled.set(r.start, emitRoutine(r));
  }

  // A block two routines share is translated, and so reported, in each
  return { js: `${w.lines.join('\n')}\n`, routineNames, labelled, refused: [...new Set(refused)], errors: [...new Set(errors)] };

  /** Write the routine `r`, structured where its control flow allows; true when it stays labelled. */
  function emitRoutine(r: Routine): boolean {
    const name = routineNames.get(r.start)!;
    const own = new Set(r.blocks.map((b) => b.start));
    const doc = notes.get(r.start) ?? [];
    w.doc(doc.length === 0 ? `${name} (${addr(r.start)})` : `${name} (${addr(r.start)}).`, doc);
    w.line(0, `export function ${name}(z, ret) {`);

    // Every block's statements, in address order (so errors and refusals are found as before)
    const blocks = new Map<number, Stmt[]>();
    let failed = false;
    for (const block of r.blocks) {
      const code = blockCode(block.start, block.end);
      if (code === null) failed = true;
      else blocks.set(block.start, code);
    }

    const structured = failed ? null : structuredBody(r.start, blocks);
    if (structured === null) {
      w.line(2, `let b = ${word(r.start)};`);
      w.line(2, 'for (;;) switch (b) {');
      for (const [start, code] of blocks) {
        w.tagged(4, `case ${word(start)}:`, nameOf(start));
        write(code, 6, 'switch');
      }
      w.line(2, '}');
    } else {
      write(structured.body, 2, 'structured', labelsUsed(structured.body));
      for (const at of structured.unreachable) w.comment(2, `${addr(at)}: no transfer reaches the block here, so it is not written.`);
    }
    w.line(0, '}');
    return structured === null;

    /** The statement that goes to `to` from the transfer at `from`: another block, another routine, or nowhere. */
    function go(to: number, from: number, ins: Instruction): Stmt {
      if (to !== r.start && routines.starts.has(to)) return { k: 'line', code: `return ${routineNames.get(to)!};`, leaves: true };
      if (own.has(to)) return { k: 'go', to };
      return nowhere(to, from, ins);
    }

    /** The statement for a transfer to an address no block starts: it throws `o.unknown`'s sentence. */
    function nowhere(to: number, from: number, ins: Instruction): Stmt {
      refused.push(`${addr(from)}: ${renderInstruction(ins, symbols)} goes to ${addr(to)}, where no block of the port starts; the port throws there when it runs.`);
      return { k: 'line', code: `throw o.unknown(z, ${word(to)}, ${word(from)});`, leaves: true };
    }

    /** The block's statements, from `z.at` to its transfer; null when it cannot be translated (the error is recorded). */
    function blockCode(start: number, end: number): Stmt[] | null {
      const out: Stmt[] = [{ k: 'at', addr: start }];
      const line = (code: string): Stmt => ({ k: 'line', code });
      let t = 0;
      let rr = 0;
      let qPrev: 0 | 1 | null = null;
      for (let at = start; at <= end; ) {
        const ins = instructions.get(at);
        if (ins === undefined) {
          errors.push(`${addr(at)}: the block at ${addr(start)} has no instruction here.`);
          return null;
        }
        let tr: Translation;
        try {
          tr = translate(ins, at, { qPrev });
        } catch (e) {
          errors.push((e as Error).message);
          return null;
        }
        const next = (at + ins.length) & 0xffff;
        const text = renderInstruction(ins, symbols);
        if (text.trim().toUpperCase() === 'EI') refused.push(`${addr(at)}: EI enables interrupts, which a port does not take (M1)`);
        const note = comments.get(at);
        const comment = `${addr(at)}  ${text}${note === undefined ? '' : `  ; ${note}`}`;
        // A note at the routine's start is its JSDoc; any other is a comment where it is
        for (const text of at === r.start ? [] : (notes.get(at) ?? [])) out.push({ k: 'note', text });
        if (tr.readsTime && (t !== 0 || rr !== 0)) {
          out.push(line(`z.tick(${t}, ${rr});`));
          t = 0;
          rr = 0;
        }
        const last = at + ins.length > end;
        if (!last) {
          out.push(...statements(tr.lines, comment));
          t += tr.cycles;
          rr += tr.r;
          qPrev = tr.writesFlags ? 1 : 0;
          at = next;
          continue;
        }

        // The block's last instruction: its tick, Q, and where it goes
        const q = `z.q = ${tr.writesFlags ? 1 : 0};`;
        const tick = (cycles: number): Stmt => line(`z.tick(${t + cycles}, ${rr + tr.r}); ${q}`);
        const notTaken = tr.cyclesNotTaken ?? tr.cycles;
        if (tr.targetExpr !== undefined && tr.flow === 'jump') {
          errors.push(`${addr(at)}: ${text} jumps to an address computed as it runs, which M1 does not translate (a hint naming its targets is for a later milestone).`);
          return null;
        }
        switch (tr.flow) {
          case 'next':
            out.push(...statements(tr.lines, comment), tick(tr.cycles), go(next, at, ins));
            break;
          case 'jump': {
            const target = tr.target!;
            if (tr.cond === undefined) {
              out.push(...statements(tr.lines, comment), tick(tr.cycles), go(target, at, ins));
              break;
            }
            out.push(...conditional(tr, comment, [tick(tr.cycles), go(target, at, ins)]), tick(notTaken), go(next, at, ins));
            break;
          }
          case 'call': {
            const target = tr.target!;
            const known = routines.starts.has(target);
            const callee = known ? line(`o.call(z, ${routineNames.get(target)!}, ${word(next)});`) : nowhere(target, at, ins);
            if (tr.cond === undefined) {
              out.push(...statements(tr.lines, comment), tick(tr.cycles), callee);
              if (!known) break;
            } else {
              out.push(...conditional(tr, comment, [tick(tr.cycles), callee], [tick(notTaken)]));
            }
            out.push(go(next, at, ins));
            break;
          }
          case 'return': {
            const back: Stmt = { k: 'line', code: `o.ret(z, ret, ${word(at)}); return;`, leaves: true };
            if (tr.cond === undefined) {
              out.push(...statements(tr.lines, comment), tick(tr.cycles), back);
              break;
            }
            out.push(...conditional(tr, comment, [tick(tr.cycles), back]), tick(notTaken), go(next, at, ins));
            break;
          }
          case 'halt':
            out.push(...statements(tr.lines, comment), tick(tr.cycles), { k: 'line', code: `throw o.halt(z, ${word(at)});`, leaves: true });
            refused.push(`${addr(at)}: HALT waits for an interrupt, which a port does not take; the port throws there when it runs.`);
            break;
        }
        return out;
      }
      return out;
    }

    /** A conditional transfer: its statements, then `if (cond) { taken; then }`, and `else { otherwise }` when given. */
    function conditional(tr: Translation, comment: string, then: Stmt[], otherwise?: Stmt[]): Stmt[] {
      const taken = [...(tr.taken ?? []).map((code): Stmt => ({ k: 'line', code })), ...then];
      const branch: Stmt = { k: 'if', cond: tr.cond!, then: taken, ...(otherwise === undefined ? {} : { else: otherwise }) };
      if (tr.lines.length > 0) return [...statements(tr.lines, comment), branch];
      return [{ ...branch, comment }];
    }

    /** The routine's body as structured statements, or null when its control flow does not allow them. */
    function structuredBody(start: number, code: ReadonlyMap<number, Stmt[]>): { body: Stmt[]; unreachable: number[] } | null {
      const succ = new Map([...code].map(([at, stmts]) => [at, gos(stmts)]));
      const s = structure({ start, succ });
      if (!s.ok) return null;
      const body = tidied(compose(s.code, s.exits, code));
      return body === null ? null : { body, unreachable: s.unreachable };
    }
  }

  /**
   * Write statements at `indent`. In a `switch`, a block starts with its `case` (written by the caller)
   * and a transfer within the routine sets `b`; structured, `z.at` carries the block's name, and a loop
   * carries its label only when a `break` or `continue` names it.
   */
  function write(stmts: readonly Stmt[], indent: number, mode: 'switch' | 'structured', labels: ReadonlySet<string> = new Set(), loop: string | null = null): void {
    for (const s of stmts) {
      switch (s.k) {
        case 'line':
          w.line(indent, s.code, s.comment);
          break;
        case 'note':
          w.comment(indent, s.text);
          break;
        case 'at':
          if (mode === 'switch') w.line(indent, `z.at(${word(s.addr)});`);
          else w.tagged(indent, `z.at(${word(s.addr)});`, nameOf(s.addr));
          break;
        case 'go':
          w.line(indent, `b = ${word(s.to)}; continue;`);
          break;
        case 'if':
          w.line(indent, `if (${s.cond}) {`, s.comment);
          write(s.then, indent + 2, mode, labels, loop);
          if (s.else !== undefined) {
            w.line(indent, '} else {');
            write(s.else, indent + 2, mode, labels, loop);
          }
          w.line(indent, '}');
          break;
        case 'loop':
          w.line(indent, `${labels.has(s.label) ? `${s.label}: ` : ''}while (true) {`);
          write(s.body, indent + 2, mode, labels, s.label);
          w.line(indent, '}');
          break;
        case 'labelled':
          w.line(indent, `${s.label}: {`);
          write(s.body, indent + 2, mode, labels, loop);
          w.line(indent, '}');
          break;
        case 'jump':
          w.line(indent, s.loop && s.label === loop ? `${s.how};` : `${s.how} ${s.label};`);
          break;
      }
    }
  }
}

/**
 * A routine's code before it is written. `line` is code built by the emitter or the translator (with its
 * comment, free text, which the Writer sanitizes); `leaves` marks one that never completes (a return or a
 * throw). `go` is a transfer to a block of the routine, which the structure decides; `loop`, `labelled`
 * and `jump` are the structure's, labelled from addresses alone.
 */
type Stmt =
  | { k: 'line'; code: string; comment?: string; leaves?: true }
  | { k: 'note'; text: string }
  | { k: 'at'; addr: number }
  | { k: 'go'; to: number }
  | { k: 'if'; cond: string; comment?: string; then: Stmt[]; else?: Stmt[] }
  | { k: 'loop'; label: string; body: Stmt[] }
  | { k: 'labelled'; label: string; body: Stmt[] }
  | { k: 'jump'; how: 'break' | 'continue'; label: string; loop: boolean };

const loopLabel = (at: number): string => `loop_${hex(at, 4)}`;
const toLabel = (at: number): string => `to_${hex(at, 4)}`;

/** An instruction's statements, on one line with its comment, or a loop's over several; none, its comment alone. */
function statements(lines: readonly string[], comment: string): Stmt[] {
  if (lines.length === 0) return [{ k: 'note', text: comment }];
  if (lines.some((l) => l.includes('{') || l.includes('}'))) {
    return [{ k: 'line', code: lines[0]!, comment }, ...lines.slice(1).map((code): Stmt => ({ k: 'line', code }))];
  }
  return [{ k: 'line', code: lines.join(' '), comment }];
}

/** The blocks a block's statements go to, one per transfer, in the order they are written. */
function gos(stmts: readonly Stmt[]): number[] {
  return stmts.flatMap((s) => (s.k === 'go' ? [s.to] : s.k === 'if' ? [...gos(s.then), ...gos(s.else ?? [])] : []));
}

/** The structure's code as statements: each block's, its transfers written as the structure says. */
function compose(code: Code, exits: ReadonlyMap<number, ReadonlyMap<number, Exit>>, blocks: ReadonlyMap<number, Stmt[]>): Stmt[] {
  const resolve = (stmts: readonly Stmt[], how: ReadonlyMap<number, Exit>): Stmt[] =>
    stmts.flatMap((s): Stmt[] => {
      if (s.k === 'if') return [{ ...s, then: resolve(s.then, how), ...(s.else === undefined ? {} : { else: resolve(s.else, how) }) }];
      if (s.k !== 'go') return [s];
      const e = how.get(s.to)!;
      switch (e.kind) {
        case 'inline':
          return compose(e.code, exits, blocks);
        case 'continue':
          return [{ k: 'jump', how: 'continue', label: loopLabel(e.header), loop: true }];
        case 'break-loop':
          return [{ k: 'jump', how: 'break', label: loopLabel(e.header), loop: true }];
        case 'break':
          return [{ k: 'jump', how: 'break', label: toLabel(e.follow), loop: false }];
      }
    });
  return code.flatMap((p): Stmt[] => {
    if (p.kind === 'block') return resolve(blocks.get(p.addr)!, exits.get(p.addr)!);
    if (p.kind === 'loop') return [{ k: 'loop', label: loopLabel(p.header), body: compose(p.body, exits, blocks) }];
    return [{ k: 'labelled', label: toLabel(p.follow), body: compose(p.body, exits, blocks) }];
  });
}

const jumpKey = (s: { how: string; label: string }): string => `${s.how} ${s.label}`;

/**
 * Statements made plainer without changing what they do, until nothing changes: a `break` or `continue`
 * that falling off its list reaches anyway is dropped; an `if` whose arm ends by breaking a labelled block
 * that falling off its list also reaches takes the statements after it as its `else`; a labelled block
 * nothing breaks is unwrapped. Null when the result could fall off the routine's end (a check: the
 * structure's code never does), so the routine stays labelled.
 */
function tidied(body: Stmt[]): Stmt[] | null {
  let out = body;
  for (let pass = 0; pass < 16; pass++) {
    const before = JSON.stringify(out);
    const tidy1 = tidy(out, new Set());
    out = unwrap(tidy1, labelsUsed(tidy1));
    if (JSON.stringify(out) === before) break;
  }
  if (completes(out) || !safeIfs(out)) return null;
  return out;
}

/** `list` tidied, where falling off its end does what each jump in `fall` does. */
function tidy(list: readonly Stmt[], fall: ReadonlySet<string>): Stmt[] {
  let out = [...list];
  for (let i = out.length - 2; i >= 0; i--) {
    const s = out[i]!;
    const end = s.k === 'if' && s.else === undefined ? s.then[s.then.length - 1] : undefined;
    if (s.k === 'if' && end?.k === 'jump' && end.how === 'break' && !end.loop && fall.has(jumpKey(end))) {
      out = [...out.slice(0, i), { ...s, else: out.slice(i + 1) }];
    }
  }
  out = out.map((s, i): Stmt => {
    const f = i === out.length - 1 ? fall : new Set<string>();
    switch (s.k) {
      case 'if': {
        const then = tidy(s.then, f);
        const other = s.else === undefined ? [] : tidy(s.else, f);
        return other.length === 0 ? { k: 'if', cond: s.cond, ...(s.comment === undefined ? {} : { comment: s.comment }), then } : { ...s, then, else: other };
      }
      case 'loop':
        return { ...s, body: tidy(s.body, new Set([`continue ${s.label}`])) };
      case 'labelled':
        return { ...s, body: tidy(s.body, new Set([...f, `break ${s.label}`])) };
      default:
        return s;
    }
  });
  while (out.length > 0) {
    const last = out[out.length - 1]!;
    if (last.k !== 'jump' || !fall.has(jumpKey(last))) break;
    out.pop();
  }
  return out;
}

/** The labels a jump names: every labelled block's, and a loop's when the jump is not in it alone. */
function labelsUsed(stmts: readonly Stmt[], loop: string | null = null, used = new Set<string>()): Set<string> {
  for (const s of stmts) {
    if (s.k === 'jump' && !(s.loop && s.label === loop)) used.add(s.label);
    else if (s.k === 'if') {
      labelsUsed(s.then, loop, used);
      labelsUsed(s.else ?? [], loop, used);
    } else if (s.k === 'loop') labelsUsed(s.body, s.label, used);
    else if (s.k === 'labelled') labelsUsed(s.body, loop, used);
  }
  return used;
}

/** Labelled blocks that no jump names, replaced by their statements. */
function unwrap(stmts: readonly Stmt[], used: ReadonlySet<string>): Stmt[] {
  return stmts.flatMap((s): Stmt[] => {
    if (s.k === 'labelled') return used.has(s.label) ? [{ ...s, body: unwrap(s.body, used) }] : unwrap(s.body, used);
    if (s.k === 'loop') return [{ ...s, body: unwrap(s.body, used) }];
    if (s.k === 'if') return [{ ...s, then: unwrap(s.then, used), ...(s.else === undefined ? {} : { else: unwrap(s.else, used) }) }];
    return [s];
  });
}

/** Whether a jump in `stmts` breaks the loop or block `label`. */
function breaks(stmts: readonly Stmt[], label: string): boolean {
  return stmts.some((s) =>
    (s.k === 'jump' && s.how === 'break' && s.label === label) ||
    (s.k === 'if' && (breaks(s.then, label) || breaks(s.else ?? [], label))) ||
    ((s.k === 'loop' || s.k === 'labelled') && breaks(s.body, label)));
}

/** Whether running `stmts` can complete, going on to what follows them (judged by the last). */
function completes(stmts: readonly Stmt[]): boolean {
  const last = stmts[stmts.length - 1];
  if (last === undefined) return true;
  switch (last.k) {
    case 'line':
      return last.leaves !== true;
    case 'note':
    case 'at':
      return true;
    case 'go':
    case 'jump':
      return false;
    case 'if':
      return last.else === undefined || completes(last.then) || completes(last.else);
    case 'loop':
      return breaks(last.body, last.label);
    case 'labelled':
      return completes(last.body) || breaks(last.body, last.label);
  }
}

/** No `go` is left, and an `if` with no `else` before other statements never runs on into them from its arm. */
function safeIfs(stmts: readonly Stmt[]): boolean {
  return stmts.every((s, i) => {
    if (s.k === 'go') return false;
    if (s.k === 'if') return (s.else !== undefined || i === stmts.length - 1 || !completes(s.then)) && safeIfs(s.then) && safeIfs(s.else ?? []);
    if (s.k === 'loop' || s.k === 'labelled') return safeIfs(s.body);
    return true;
  });
}
