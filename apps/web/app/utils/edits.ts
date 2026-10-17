/**
 * Edits as hint-file changes. Every edit the workbench makes (mark a range,
 * declare a table, name or comment an address) is a new hint file built from
 * the session's, so the hint file stays the one source of truth: undo is a
 * stack of hint files, and the CLI reads exactly what the browser wrote.
 * Pure: no Vue, no DOM. The caller re-analyzes with `withHintFile`.
 */
import { addressKey, nameProblem, parseHints, selectSymbols, skeletonHints, writeHints } from '@fugloy/disasm';
import type { Hint, HintFile, Session, TableId } from '@fugloy/disasm';

export type MarkKind = 'code' | 'bytes' | 'words' | 'string';

/** `from` and `to` are runtime addresses, both inclusive. */
export type Edit =
  | { op: 'mark'; from: number; to: number; as: MarkKind }
  /** A jump table of 2-byte entries: count = length / 2. */
  | { op: 'table'; from: number; to: number }
  /** An empty name removes the user name there. */
  | { op: 'name'; addr: number; name: string }
  /** Empty text removes the comment there. */
  | { op: 'comment'; addr: number; text: string };

export type EditResult = { file: HintFile } | { error: string };

const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');
const $ = (n: number): string => `$${hex4(n)}`;

/** Directives that say what bytes are: a new one at an address replaces any other there. */
const MARKS = new Set<Hint['directive']>(['code', 'bytes', 'words', 'string', 'table']);
const family = (d: Hint['directive']): string => (MARKS.has(d) ? 'mark' : d);

type Key = { block: number; offset: number } | { at: number };

const sameKey = (h: Hint, k: Key): boolean => ('at' in k ? h.at === k.at : h.at === undefined && h.block === k.block && h.offset === k.offset);

/** Bytes a mark hint covers from its offset; one for a mark with no length. */
function extent(h: Hint): number {
  switch (h.directive) {
    case 'bytes':
    case 'words':
      return h.length;
    case 'code':
    case 'string':
      return h.length ?? 1;
    case 'table':
      return h.count * h.width;
    default:
      return 1;
  }
}

/**
 * Translates run indices (what `addressKey` and proposals name) into the hint
 * file's own block indices. A hint file written for another build numbers its
 * blocks its own way and may lack a run altogether; a run it lacks is declared
 * under the next free index, once.
 */
class Blocks {
  private readonly added = new Map<number, number>();
  constructor(
    private readonly s: Session,
    public file: HintFile,
  ) {}

  index(run: number): number {
    const r = this.s.module.image.runs()[run];
    const matched = r === undefined ? undefined : this.s.applied.matched.find((m) => m.run.start === r.start && m.run.end === r.end);
    if (matched !== undefined) return matched.block.index;
    const known = this.added.get(run);
    if (known !== undefined) return known;
    const identity = skeletonHints(this.s.module, this.s.bytes).blocks[run]!;
    // A declared block no run took yet but that this run's identity fits (a session that never applied a hint file has its skeleton's).
    const taken = new Set([...this.s.applied.matched.map((m) => m.block.index), ...this.added.values()]);
    const declared = this.file.blocks.find((b) => !taken.has(b.index) && b.length === identity.length && b.hash === identity.hash);
    if (declared !== undefined) {
      this.added.set(run, declared.index);
      return declared.index;
    }
    const index = this.file.blocks.reduce((n, b) => Math.max(n, b.index + 1), 0);
    this.file = { ...this.file, blocks: [...this.file.blocks, { ...identity, index }] };
    this.added.set(run, index);
    return index;
  }
}

/** The file with `hint` in place of any hint of the same kind at the same key. */
function put(file: HintFile, hint: Hint, key: Key): HintFile {
  const hints = file.hints.filter((h) => !(sameKey(h, key) && family(h.directive) === family(hint.directive)));
  return { ...file, hints: [...hints, hint] };
}

function remove(file: HintFile, directive: Hint['directive'], key: Key): HintFile {
  return { ...file, hints: file.hints.filter((h) => !(sameKey(h, key) && h.directive === directive)) };
}

const isDos = (t: TableId): boolean => t.startsWith('dos-') || t.startsWith('svc-');

/** Why `name` cannot go at `addr`, or null. */
function nameError(s: Session, file: HintFile, addr: number, key: Key, name: string): string | null {
  const problem = nameProblem(name);
  if (problem !== null) return problem;
  const upper = name.toUpperCase();
  if (s.selection !== undefined) {
    const entry = selectSymbols(s.selection)
      .entries()
      .find((e) => e.name.toUpperCase() === upper);
    if (entry !== undefined) return `${entry.name} is a ${isDos(entry.table) ? 'DOS' : 'ROM/hardware'} name; choose another`;
  }
  const symbol = s.analysis.symbols.list().find((sym) => sym.addr !== addr && sym.name.toUpperCase() === upper);
  if (symbol !== undefined) return `${name} is already the name of ${$(symbol.addr)}`;
  // Names the analysis does not show (a block no run matched, an `at` on a loaded address) still collide when the file is read back.
  const hint = file.hints.find((h) => h.directive === 'name' && h.name.toUpperCase() === upper && !sameKey(h, key));
  if (hint !== undefined) return `${name} is already the name of ${hint.at === undefined ? `block ${hint.block}:${$(hint.offset)}` : $(hint.at)}`;
  return null;
}

/** The key for one address: a block offset where the program loads it, an `at` address where it does not. */
function keyFor(s: Session, blocks: Blocks, addr: number): Key | { error: string } {
  const k = addressKey(s, addr);
  if (k !== null) return { block: blocks.index(k.block), offset: k.offset };
  if (s.module.image.isLoaded(addr)) return { error: `${$(addr)} is moved by a relocation; edit it where it runs` };
  return { at: addr & 0xffff };
}

function readOnly(s: Session): string | null {
  return s.plainBasic ? `${s.name} lists as BASIC, which is read-only` : null;
}

export function applyEdit(s: Session, e: Edit): EditResult {
  const ro = readOnly(s);
  if (ro !== null) return { error: ro };
  const blocks = new Blocks(s, s.hintFile);

  if (e.op === 'name' || e.op === 'comment') {
    const key = keyFor(s, blocks, e.addr);
    if ('error' in key) return key;
    const where = 'at' in key ? { block: -1, offset: -1, at: key.at } : { block: key.block, offset: key.offset };
    if (e.op === 'name') {
      const name = e.name.trim();
      if (name === '') return { file: remove(blocks.file, 'name', key) };
      const error = nameError(s, blocks.file, e.addr, key, name);
      if (error !== null) return { error };
      return { file: put(blocks.file, { ...where, line: 0, directive: 'name', name }, key) };
    }
    // One line in the file: line breaks and tabs become spaces.
    const text = e.text.replace(/\s+/g, ' ').trim();
    if (text === '') return { file: remove(blocks.file, 'comment', key) };
    return { file: put(blocks.file, { ...where, line: 0, directive: 'comment', text }, key) };
  }

  const from = Math.min(e.from, e.to);
  const to = Math.max(e.from, e.to);
  const start = addressKey(s, from);
  const end = addressKey(s, to);
  if (start === null) return { error: `${$(from)} is not loaded; only names and comments can go outside the program` };
  if (end === null || end.block !== start.block || end.offset - start.offset !== to - from) {
    return { error: `${$(from)}–${$(to)} runs past the end of a block; mark each block separately` };
  }
  const length = to - from + 1;
  const key = { block: blocks.index(start.block), offset: start.offset };
  let hint: Hint;
  if (e.op === 'table') {
    const count = Math.floor(length / 2);
    if (count < 1) return { error: 'a table needs at least one 2-byte entry; select two bytes or more' };
    hint = { ...key, line: 0, directive: 'table', count, width: 2 };
  } else if (e.as === 'code' || e.as === 'string') hint = { ...key, line: 0, directive: e.as, length };
  else hint = { ...key, line: 0, directive: e.as, length };
  // A mark supersedes every mark wholly inside its range.
  const inside = (h: Hint): boolean =>
    h.at === undefined && MARKS.has(h.directive) && h.block === key.block && h.offset > key.offset && h.offset + extent(h) <= key.offset + length;
  const file = { ...blocks.file, hints: blocks.file.hints.filter((h) => !inside(h)) };
  return { file: put(file, hint, key) };
}

/**
 * Adds hint lines (a proposal's, which name blocks by run index) to the
 * session's hint file. A line for a key and directive already there replaces it.
 */
export function applyHintLines(s: Session, lines: readonly string[]): EditResult {
  const ro = readOnly(s);
  if (ro !== null) return { error: ro };
  const skeleton = writeHints(skeletonHints(s.module, s.bytes));
  const parsed = parseHints(`${skeleton}${lines.join('\n')}\n`);
  if (parsed.errors.length > 0) {
    const header = skeleton.split('\n').length - 1;
    return { error: parsed.errors.map((err) => `${lines[err.line - header - 1] ?? `line ${err.line}`}: ${err.message}`).join('; ') };
  }
  const blocks = new Blocks(s, s.hintFile);
  let file = blocks.file;
  for (const h of parsed.file.hints) {
    if (h.at !== undefined) {
      file = put(file, { ...h, line: 0 }, { at: h.at });
      continue;
    }
    const block = blocks.index(h.block);
    // Blocks may have grown a declaration; carry it over before adding the hint.
    file = { ...file, blocks: blocks.file.blocks };
    file = put(file, { ...h, block, line: 0 }, { block, offset: h.offset });
    blocks.file = file;
  }
  return { file };
}
