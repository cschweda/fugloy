/**
 * The hint file: line-oriented text, one decision per line, keyed by block
 * and offset so it diffs in git and survives relocation (see the plan's "Hint
 * file" section and spec §4). Numbers are `$hex`, `hexH`, `0xhex`, or decimal;
 * bare hex is rejected so a length is never misread.
 */
import { TABLES } from '@fugloy/z80';

export interface HintBlock {
  index: number;
  length: number;
  /** 16 hex digits. */
  hash: string;
  /** Start address when the file was written; informational only. */
  start?: number;
}

export type Directive =
  | { directive: 'entry' }
  | { directive: 'code'; length?: number }
  | { directive: 'bytes'; length: number }
  | { directive: 'words'; length: number }
  | { directive: 'string'; length?: number }
  | { directive: 'nocode' }
  | { directive: 'table'; count: number; width: number }
  | { directive: 'name'; name: string }
  | { directive: 'comment'; text: string }
  | { directive: 'relocate'; addr: number; length: number };

/** `at` is set only on a `name` or `comment` keyed by a runtime address (an `at` line); `block` and `offset` are then both -1. */
export type Hint = Directive & { block: number; offset: number; line: number; at?: number };

export interface HintFile {
  version: 1;
  /** SHA-256 of the program file, hex. */
  program?: string;
  blocks: HintBlock[];
  hints: Hint[];
}

export interface HintError {
  line: number;
  message: string;
}

const REGISTERS = ['A', 'B', 'C', 'D', 'E', 'H', 'L', 'I', 'R', 'F', 'AF', 'BC', 'DE', 'HL', 'SP', 'PC', 'IX', 'IY', 'IXH', 'IXL', 'IYH', 'IYL'];
const CONDITIONS = ['NZ', 'Z', 'NC', 'C', 'PO', 'PE', 'P', 'M'];
const ZMAC = [
  'ORG', 'END', 'EQU', 'DEFL', 'DB', 'DW', 'DS', 'DD', 'DEFB', 'DEFW', 'DEFS', 'DEFM', 'DEFD', 'DEFQ', 'DC', 'IF', 'ELSE', 'ENDIF', 'IFDEF', 'IFNDEF',
  'IF1', 'IF2', 'COND', 'ENDC', 'MACRO', 'ENDM', 'REPT', 'IRP', 'IRPC', 'EXITM', 'LOCAL', 'INCLUDE', 'INCBIN', 'PUBLIC', 'EXTRN', 'EXTERN', 'GLOBAL',
  'NAME', 'TITLE', 'SUBTTL', 'PAGE', 'EJECT', 'SPACE', 'LIST', 'NOLIST', 'MLIST', 'ASEG', 'CSEG', 'DSEG', 'COMMON', 'PHASE', 'DEPHASE', 'SET', 'ASSERT',
  'ERROR', 'BYTE', 'WORD', 'TEXT', 'ASCII', 'ASCIZ', 'ASCIS', 'RADIX', 'JPERROR', 'JRPROMOTE', 'DSYM', 'DIAG', 'SETT', 'RSYM', 'SKIP',
  'AND', 'OR', 'XOR', 'NOT', 'MOD', 'SHL', 'SHR', 'EQ', 'NE', 'LT', 'LE', 'GT', 'GE', 'HIGH', 'LOW', 'NUL', 'DEFINED', 'Z80', 'Z180',
  'T', 'TILO', 'TIHI', 'OCF', // zmac's instruction-timing operators
];
const mnemonics = new Set<string>();
for (const table of Object.values(TABLES)) for (const t of table) if (t.prefix === undefined) mnemonics.add(t.mnemonic);

/** Words a user label may not be: Z80 mnemonics, registers, conditions, zmac directives and operators. Upper case. */
export const RESERVED: ReadonlySet<string> = new Set([...mnemonics, ...REGISTERS, ...CONDITIONS, ...ZMAC].map((w) => w.toUpperCase()));

/** The shape of a synthesized label; user names may not look like one, so they can never collide. */
export const SYNTH_NAME = /^(L|SUB_|DATA_|TBL_)[0-9A-F]{4}$/i;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;

export function isValidName(name: string): boolean {
  return IDENTIFIER.test(name) && !RESERVED.has(name.toUpperCase()) && !SYNTH_NAME.test(name);
}

/** Why a name is invalid, or null when it is valid. */
export function nameProblem(name: string): string | null {
  if (!IDENTIFIER.test(name)) return `name "${name}" is not an identifier`;
  if (RESERVED.has(name.toUpperCase())) return `name "${name}" is reserved`;
  if (SYNTH_NAME.test(name)) return `name "${name}" has the shape of a generated label`;
  return null;
}

/** `$1A2F`, `1A2FH`, `0x1a2f`, or `4660`; null otherwise (bare hex is deliberately not a number). */
export function parseNumber(token: string): number | null {
  let m = /^\$([0-9a-f]+)$/i.exec(token) ?? /^0x([0-9a-f]+)$/i.exec(token) ?? /^([0-9a-f]+)h$/i.exec(token);
  if (m !== null) return parseInt(m[1]!, 16);
  m = /^([0-9]+)$/.exec(token);
  return m === null ? null : parseInt(m[1]!, 10);
}

const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');

export function parseHints(text: string): { file: HintFile; errors: HintError[] } {
  const errors: HintError[] = [];
  const blocks: HintBlock[] = [];
  const hints: Hint[] = [];
  const named = new Set<string>();
  /** Upper-cased user names already taken, with where; zmac folds label case. */
  const usedNames = new Map<string, string>();
  let program: string | undefined;
  let headerSeen = false;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = i + 1;
    const raw = lines[i]!;
    const fail = (message: string): void => { errors.push({ line, message }); };
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const tokens = trimmed.split(/\s+/);
    if (!headerSeen) {
      if (tokens[0] === 'fugloy-hints' && tokens[1] === '1') { headerSeen = true; continue; }
      fail(tokens[0] === 'fugloy-hints' ? 'unsupported hint file version' : 'expected "fugloy-hints 1" first');
      continue;
    }
    if (tokens[0] === 'program' && tokens[1] === 'sha256') {
      if (tokens[2] === undefined || !/^[0-9a-f]{64}$/i.test(tokens[2])) { fail('bad program hash'); continue; }
      program = tokens[2].toLowerCase();
      continue;
    }
    if (tokens[0] === 'at') {
      // at <addr> name <label> | at <addr> comment <text to end of line>
      if (tokens[1] === undefined || tokens[2] === undefined) { fail('unexpected line'); continue; }
      const at = parseNumber(tokens[1]);
      if (at === null) { fail(`bad number "${tokens[1]}"`); continue; }
      if (at > 0xffff) { fail(`address $${at.toString(16).toUpperCase()} is past $FFFF`); continue; }
      const base = { block: -1, offset: -1, line, at };
      if (tokens[2] === 'comment') {
        const from = raw.indexOf('comment', raw.indexOf(tokens[1]) + tokens[1].length);
        const text = raw.slice(from + 'comment'.length).trim();
        if (text === '') { fail('comment needs text'); continue; }
        hints.push({ ...base, directive: 'comment', text });
        continue;
      }
      if (tokens[2] !== 'name') { fail(`unknown directive "${tokens[2]}"`); continue; }
      const name = tokens[3];
      if (name === undefined) { fail('name needs an identifier'); continue; }
      if (tokens[4] !== undefined && !tokens[4].startsWith('#')) { fail(`unexpected argument "${tokens[4]}"`); continue; }
      const problem = nameProblem(name);
      if (problem !== null) { fail(problem); continue; }
      const key = `at:${at}`;
      if (named.has(key)) { fail(`address $${hex4(at)} already has a name`); continue; }
      const elsewhere = usedNames.get(name.toUpperCase());
      if (elsewhere !== undefined) { fail(`name "${name}" is already used at ${elsewhere}`); continue; }
      named.add(key);
      usedNames.set(name.toUpperCase(), `$${hex4(at)}`);
      hints.push({ ...base, directive: 'name', name });
      continue;
    }
    if (tokens[0] !== 'block' || tokens[1] === undefined) { fail('unexpected line'); continue; }

    if (!tokens[1].includes(':')) {
      // block <i> length <n> hash <h>  [# comment]
      const index = parseNumber(tokens[1]);
      const length = tokens[2] === 'length' && tokens[3] !== undefined ? parseNumber(tokens[3]) : null;
      const hash = tokens[4] === 'hash' ? tokens[5] : undefined;
      if (index === null || length === null || hash === undefined || !/^[0-9a-f]{16}$/i.test(hash)) { fail('unexpected line'); continue; }
      if (blocks.some((b) => b.index === index)) { fail(`block ${index} is already declared`); continue; }
      const startMatch = /#\s*start\s+(\S+)/i.exec(raw);
      const start = startMatch === null ? null : parseNumber(startMatch[1]!);
      blocks.push(start === null ? { index, length, hash: hash.toLowerCase() } : { index, length, hash: hash.toLowerCase(), start });
      continue;
    }

    // block <i>:<offset> <directive> [args]
    const [blockText, offsetText] = tokens[1].split(':', 2) as [string, string];
    const blockIndex = parseNumber(blockText);
    const offset = parseNumber(offsetText);
    if (blockIndex === null) { fail(`bad number "${blockText}"`); continue; }
    if (offset === null) { fail(`bad number "${offsetText}"`); continue; }
    const block = blocks.find((b) => b.index === blockIndex);
    if (block === undefined) { fail(`block ${blockIndex} is not declared`); continue; }
    if (offset >= block.length) { fail(`offset $${hex4(offset)} is past the end of block ${blockIndex} (length $${hex4(block.length)})`); continue; }
    const directive = tokens[2];
    // A trailing `# comment` is allowed on every line except `comment`, whose text runs to the end.
    const rawArgs = tokens.slice(3);
    const hashAt = rawArgs.findIndex((t) => t.startsWith('#'));
    const args = directive === 'comment' || hashAt < 0 ? rawArgs : rawArgs.slice(0, hashAt);
    const base = { block: blockIndex, offset, line };
    const noExtra = (allowed: number): boolean => {
      if (args.length <= allowed) return true;
      fail(`unexpected argument "${args[allowed]}"`);
      return false;
    };
    const optionalLength = (): number | null | undefined => {
      if (args[0] === undefined) return undefined;
      const n = parseNumber(args[0]);
      if (n === null) fail(`bad number "${args[0]}"`);
      return n;
    };
    switch (directive) {
      case 'entry':
        if (noExtra(0)) hints.push({ ...base, directive: 'entry' });
        break;
      case 'nocode':
        if (noExtra(0)) hints.push({ ...base, directive: 'nocode' });
        break;
      case 'code':
      case 'string': {
        if (!noExtra(1)) break;
        const n = optionalLength();
        if (n === null) break;
        hints.push(n === undefined ? { ...base, directive } : { ...base, directive, length: n });
        break;
      }
      case 'bytes':
      case 'words': {
        if (args[0] === undefined) { fail(`${directive} needs a length`); break; }
        if (!noExtra(1)) break;
        const n = parseNumber(args[0]);
        if (n === null) { fail(`bad number "${args[0]}"`); break; }
        hints.push({ ...base, directive, length: n });
        break;
      }
      case 'table': {
        if (args[0] === undefined || args[1] === undefined) { fail('table needs a count and a width'); break; }
        if (!noExtra(2)) break;
        const count = parseNumber(args[0]);
        const width = parseNumber(args[1]);
        if (count === null) { fail(`bad number "${args[0]}"`); break; }
        if (width === null) { fail(`bad number "${args[1]}"`); break; }
        if (count < 1) { fail('table needs a count of at least 1'); break; }
        if (width !== 2) { fail(`table width ${width} is not supported`); break; }
        hints.push({ ...base, directive: 'table', count, width });
        break;
      }
      case 'name': {
        const name = args[0];
        if (name === undefined) { fail('name needs an identifier'); break; }
        if (!noExtra(1)) break;
        const problem = nameProblem(name);
        if (problem !== null) { fail(problem); break; }
        const key = `${blockIndex}:${offset}`;
        if (named.has(key)) { fail(`address ${blockIndex}:$${hex4(offset)} already has a name`); break; }
        const upper = name.toUpperCase();
        const elsewhere = usedNames.get(upper);
        if (elsewhere !== undefined) { fail(`name "${name}" is already used at ${elsewhere}`); break; }
        named.add(key);
        usedNames.set(upper, `${blockIndex}:$${hex4(offset)}`);
        hints.push({ ...base, directive: 'name', name });
        break;
      }
      case 'relocate': {
        if (args[0] === undefined || args[1] === undefined) { fail('relocate needs an address and a length'); break; }
        if (!noExtra(2)) break;
        const addr = parseNumber(args[0]);
        const length = parseNumber(args[1]);
        if (addr === null) { fail(`bad number "${args[0]}"`); break; }
        if (length === null) { fail(`bad number "${args[1]}"`); break; }
        if (length < 1) { fail('relocate needs a length of at least 1'); break; }
        if (addr + length > 0x10000) { fail(`relocate destination $${hex4(addr)} plus ${length} bytes runs past $FFFF`); break; }
        hints.push({ ...base, directive: 'relocate', addr, length });
        break;
      }
      case 'comment': {
        const at = raw.indexOf('comment');
        hints.push({ ...base, directive: 'comment', text: raw.slice(at + 'comment'.length).trim() });
        break;
      }
      default:
        fail(directive === undefined ? 'unexpected line' : `unknown directive "${directive}"`);
    }
  }
  const file: HintFile = program === undefined ? { version: 1, blocks, hints } : { version: 1, program, blocks, hints };
  return { file, errors };
}

const num = (n: number): string => `$${hex4(n)}`;

function directiveText(h: Hint): string {
  switch (h.directive) {
    case 'entry': return 'entry';
    case 'nocode': return 'nocode';
    case 'code': return h.length === undefined ? 'code' : `code ${num(h.length)}`;
    case 'string': return h.length === undefined ? 'string' : `string ${num(h.length)}`;
    case 'bytes': return `bytes ${num(h.length)}`;
    case 'words': return `words ${num(h.length)}`;
    case 'table': return `table ${h.count} ${h.width}`;
    case 'relocate': return `relocate ${num(h.addr)} ${num(h.length)}`;
    case 'name': return `name ${h.name}`;
    case 'comment': return `comment ${h.text}`;
  }
}

/** Canonical text: header, identities by index, hints by block then offset (input order within an address). */
export function writeHints(file: HintFile): string {
  const out = ['# Fugløy hints. Numbers: $hex or decimal. Offsets are relative to a block.', 'fugloy-hints 1'];
  if (file.program !== undefined) out.push(`program sha256 ${file.program}`);
  for (const b of [...file.blocks].sort((x, y) => x.index - y.index)) {
    out.push(`block ${b.index} length ${num(b.length)} hash ${b.hash}${b.start === undefined ? '' : `    # start ${num(b.start)}`}`);
  }
  const sorted = file.hints.map((h, i) => ({ h, i })).sort((x, y) => x.h.block - y.h.block || x.h.offset - y.h.offset || (x.h.at ?? 0) - (y.h.at ?? 0) || x.i - y.i);
  for (const { h } of sorted) out.push(h.at === undefined ? `block ${h.block}:${num(h.offset)} ${directiveText(h)}` : `at ${num(h.at)} ${directiveText(h)}`);
  return `${out.join('\n')}\n`;
}
