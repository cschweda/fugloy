/**
 * `disasm`: a linear listing from an address (docs/fugloy-mcp-spec.md §5, Ruling 7). Decoded
 * with @fugloy/z80; targets and operands named from the session's labels first, then the ROM and
 * hardware tables of @fugloy/disasm for the machine's model (the Model III's, or the Model I's
 * since emu phase 6); each line marked from coverage.
 */
import { selectSymbols } from '@fugloy/disasm';
import { COVERAGE } from '@fugloy/emu';
import { decode, formatInstruction } from '@fugloy/z80';
import { z } from 'zod';
import { hex4, parseAddr, parseCount } from '../args.js';
import { h2, h4 } from '../format/hex.js';


/** @type {Map<number, import('@fugloy/disasm').SymbolSet>} */
const symbols = new Map();
/**
 * The ROM and hardware names of model `n` (1 or 3; no DOS: a DOS the machine boots is not known
 * to the server), built once each.
 * @param {number} n
 */
export function symbolsFor(n) {
  const machine = n === 1 ? 1 : 3;
  let set = symbols.get(machine);
  if (set === undefined) symbols.set(machine, (set = selectSymbols({ machine, dos: 'none' })));
  return set;
}

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

/**
 * The name of a routine starting at `addr`: a session label there, else a ROM routine's name on
 * model `model` (used by `callees`).
 * @param {Map<number, import('../session.js').Label>} labels
 * @param {number} addr
 * @param {number} [model]
 * @returns {string | undefined}
 */
export const routineName = (labels, addr, model = 3) => labels.get(addr)?.name ?? symbolsFor(model).code(addr)?.name;

/** A ROM or hardware data name covering `addr`: a variable, vector, or region. */
function dataOnlyName(/** @type {import('@fugloy/disasm').SymbolSet} */ sym, /** @type {number} */ addr) {
  const covering = sym.data(addr);
  return covering ? plus(covering.entry.name, covering.offset) : undefined;
}

/** A ROM or hardware name for a memory operand's address: a data name covering it, or a routine starting there. */
const dataName = (/** @type {import('@fugloy/disasm').SymbolSet} */ sym, /** @type {number} */ addr) => dataOnlyName(sym, addr) ?? sym.code(addr)?.name;

/**
 * The names an instruction's operands refer to, session labels first.
 * @param {import('@fugloy/z80').Instruction} ins
 * @param {Map<number, import('../session.js').Label>} labels
 * @param {import('@fugloy/disasm').SymbolSet} sym the machine's ROM and hardware names
 * @returns {string[]}
 */
function operandNames(ins, labels, sym) {
  /** @type {string[]} */
  const names = [];
  const flow = ins.flow.kind === 'jump' || ins.flow.kind === 'call';
  for (const op of ins.operands) {
    let name;
    if (op.kind === 'rel' || op.kind === 'rst' || (op.kind === 'imm16' && flow)) {
      const target = op.kind === 'rel' ? op.target : op.kind === 'rst' ? op.addr : op.value;
      name = sessionName(labels, target) ?? sym.code(target)?.name;
    } else if (op.kind === 'mem') {
      name = sessionName(labels, op.addr) ?? dataName(sym, op.addr);
    } else if (op.kind === 'imm16') {
      // A constant that no jump or call uses may not be an address at all (LD BC,0008H is a
      // count as often as a pointer), so only a data name, never a routine's, is offered.
      name = sessionName(labels, op.value) ?? dataOnlyName(sym, op.value);
    } else if (op.kind === 'port') {
      name = sym.port(op.value)?.name;
    }
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}

export default {
  name: 'disasm',
  description:
    'Disassemble n instructions (a decimal count, default 32, at most 512) linearly from addr. Each line: a mark (* executed, as an instruction or as part of one, d read or written as data, ? never seen, from coverage since load), the address, the bytes, the instruction, and after ; the names its targets and operands refer to: your labels first, then the ROM and hardware tables of the machine\'s model (Model III or Model I). A labelled address gets a NAME: line. labels: false leaves names out. Linear decoding can start mid-instruction or run into data; the marks show where it has, and a closing note names the first line that starts on a byte executed only as another instruction\'s operand.',
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
    const sym = symbolsFor(m.model);
    const lines = [];
    /** @type {number | undefined} The first line that starts on a byte executed only as an operand. */
    let misaligned;
    let off = 0;
    for (let k = 0; k < count; k++) {
      const at = (start + off) & 0xffff;
      const ins = decode((i) => bytes[off + i], at);
      if (labels) {
        const own = session.labels.get(at)?.name ?? sym.code(at)?.name ?? (sym.data(at)?.offset === 0 ? sym.data(at)?.entry.name : undefined);
        if (own !== undefined) lines.push(`${own}:`);
      }
      let mark = '?';
      if (bits[at] & COVERAGE.EXEC) mark = '*';
      else if (bits[at] & COVERAGE.OPERAND) {
        // Executed, but as an operand of an instruction that starts earlier: this decode is out of step there.
        mark = '*';
        misaligned ??= at;
      } else {
        for (let i = 0; i < ins.length; i++) if (bits[(at + i) & 0xffff] & (COVERAGE.READ | COVERAGE.WRITE)) mark = 'd';
      }
      const names = labels ? operandNames(ins, session.labels, sym) : [];
      const text = `${mark} ${h4(at)}  ${ins.bytes.map(h2).join(' ').padEnd(11)}  ${formatInstruction(ins).padEnd(16)}${names.length > 0 ? `  ; ${names.join(', ')}` : ''}`;
      lines.push(text.trimEnd());
      off += ins.length;
    }
    lines.push('Marks: * executed, d read or written as data, ? never seen (coverage since load)');
    if (misaligned !== undefined) {
      lines.push(`(${hex4(misaligned)} was executed as an operand of an instruction that starts before it, so this listing is out of step with the code there; start disasm at an address marked * by its own instruction)`);
    }
    return lines.join('\n');
  },
};
