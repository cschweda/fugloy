/**
 * `disasm`: a linear listing from an address (docs/fugloy-mcp-spec.md §5, Ruling 7). Decoded
 * with @fugloy/z80; targets and operands named from the session's labels first, then the Model
 * III ROM and hardware tables of @fugloy/disasm; each line marked from coverage.
 */
import { selectSymbols } from '@fugloy/disasm';
import { COVERAGE } from '@fugloy/emu';
import { decode, formatInstruction } from '@fugloy/z80';
import { z } from 'zod';
import { parseAddr, parseCount } from '../args.js';

const h2 = (/** @type {number} */ n) => n.toString(16).toUpperCase().padStart(2, '0');
const h4 = (/** @type {number} */ n) => (n & 0xffff).toString(16).toUpperCase().padStart(4, '0');

/** @type {import('@fugloy/disasm').SymbolSet | undefined} */
let symbols;
/** The Model III ROM and hardware names (no DOS: the machine boots none before emu phase 5). */
const model3 = () => (symbols ??= selectSymbols({ machine: 3, dos: 'none' }));

/** `NAME` or `NAME+C0h` for an offset into a named span. */
const plus = (/** @type {string} */ name, /** @type {number} */ offset) => (offset === 0 ? name : `${name}+${offset.toString(16).toUpperCase()}h`);

/**
 * A session label at `addr`, or one whose `size` covers it.
 * @param {Map<number, import('../session.js').Label>} labels
 * @param {number} addr
 */
function sessionName(labels, addr) {
  const exact = labels.get(addr);
  if (exact) return exact.name;
  for (const l of labels.values()) if (l.size !== undefined && addr > l.addr && addr < l.addr + l.size) return plus(l.name, addr - l.addr);
  return undefined;
}

/** A ROM or hardware name for a data address: a variable, vector, or region covering it, or a routine starting there. */
function dataName(/** @type {number} */ addr) {
  const covering = model3().data(addr);
  if (covering) return plus(covering.entry.name, covering.offset);
  return model3().code(addr)?.name;
}

/**
 * The names an instruction's operands refer to, session labels first.
 * @param {import('@fugloy/z80').Instruction} ins
 * @param {Map<number, import('../session.js').Label>} labels
 * @returns {string[]}
 */
function operandNames(ins, labels) {
  /** @type {string[]} */
  const names = [];
  const flow = ins.flow.kind === 'jump' || ins.flow.kind === 'call';
  for (const op of ins.operands) {
    let name;
    if (op.kind === 'rel' || op.kind === 'rst' || (op.kind === 'imm16' && flow)) {
      const target = op.kind === 'rel' ? op.target : op.kind === 'rst' ? op.addr : op.value;
      name = sessionName(labels, target) ?? model3().code(target)?.name;
    } else if (op.kind === 'mem' || op.kind === 'imm16') {
      const addr = op.kind === 'mem' ? op.addr : op.value;
      name = sessionName(labels, addr) ?? dataName(addr);
    } else if (op.kind === 'port') {
      name = model3().port(op.value)?.name;
    }
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}

export default {
  name: 'disasm',
  description:
    'Disassemble n instructions (a decimal count, default 32, at most 512) linearly from addr. Each line: a mark (* executed, d read or written as data, ? never seen, from coverage since load), the address, the bytes, the instruction, and after ; the names its targets and operands refer to: your labels first, then the Model III ROM and hardware tables. A labelled address gets a NAME: line. labels: false leaves names out. Linear decoding can start mid-instruction or run into data; the marks show where it has.',
  inputSchema: {
    addr: z.union([z.string(), z.number()]).describe('Start address: 5200, 0x5200, $5200, 5200h, a decimal number, or a label name'),
    n: z.number().int().optional().describe('Instructions to list, a decimal count (default 32)'),
    labels: z.boolean().optional().describe('Name targets and labelled addresses (default true)'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ addr: string | number, n?: number, labels?: boolean }} args
   */
  handler(session, { addr, n = 32, labels = true }) {
    const m = session.requireMachine();
    const start = parseAddr(addr, session.labels);
    const count = parseCount(n, { name: 'n', min: 1, max: 512 });
    const bytes = m.mem.read(start, count * 4);
    const bits = m.debug.coverage.bits;
    const lines = [];
    let off = 0;
    for (let k = 0; k < count; k++) {
      const at = (start + off) & 0xffff;
      const ins = decode((i) => bytes[off + i], at);
      if (labels) {
        const own = session.labels.get(at)?.name ?? model3().code(at)?.name ?? (model3().data(at)?.offset === 0 ? model3().data(at)?.entry.name : undefined);
        if (own !== undefined) lines.push(`${own}:`);
      }
      let mark = '?';
      if (bits[at] & COVERAGE.EXEC) mark = '*';
      else {
        for (let i = 0; i < ins.length; i++) if (bits[(at + i) & 0xffff] & (COVERAGE.READ | COVERAGE.WRITE)) mark = 'd';
      }
      const names = labels ? operandNames(ins, session.labels) : [];
      const text = `${mark} ${h4(at)}  ${ins.bytes.map(h2).join(' ').padEnd(11)}  ${formatInstruction(ins).padEnd(16)}${names.length > 0 ? `  ; ${names.join(', ')}` : ''}`;
      lines.push(text.trimEnd());
      off += ins.length;
    }
    lines.push('Marks: * executed, d read or written as data, ? never seen (coverage since load)');
    return lines.join('\n');
  },
};
