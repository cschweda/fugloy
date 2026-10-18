/**
 * Break conditions (Ruling 2): `<reg> <op> <value>` clauses joined by `&&`, and nothing else; no
 * expression language. `reg` is an 8-bit register, a 16-bit pair, IX IY SP PC, or a flag; `op`
 * is one of == != < <= > >=; `value` is written like an address (bare digits are hex) or is a
 * label. C and H are the registers, as in Z80 assembly; the carry and half-carry flags are CF
 * and HF (every flag also takes the F suffix, and Z S PV N work bare).
 */
import { parseAddr } from './args.js';

/** @typedef {(m: any) => number} Read */

const pair = (/** @type {string} */ hi, /** @type {string} */ lo) => (/** @type {any} */ m) => ((m.cpu.regs[hi] & 0xff) << 8) | (m.cpu.regs[lo] & 0xff);
const reg = (/** @type {string} */ name) => (/** @type {any} */ m) => m.cpu.regs[name];
const flag = (/** @type {string} */ name) => (/** @type {any} */ m) => (m.cpu.flags[name] ? 1 : 0);

/** @type {Record<string, { read: Read, max: number, flag?: boolean }>} */
const OPERANDS = {
  ...Object.fromEntries(['A', 'F', 'B', 'C', 'D', 'E', 'H', 'L', 'I', 'R'].map((n) => [n, { read: reg(n.toLowerCase()), max: 0xff }])),
  AF: { read: pair('a', 'f'), max: 0xffff },
  BC: { read: pair('b', 'c'), max: 0xffff },
  DE: { read: pair('d', 'e'), max: 0xffff },
  HL: { read: pair('h', 'l'), max: 0xffff },
  IX: { read: reg('ix'), max: 0xffff },
  IY: { read: reg('iy'), max: 0xffff },
  SP: { read: reg('sp'), max: 0xffff },
  PC: { read: reg('pc'), max: 0xffff },
  ...Object.fromEntries(['Z', 'C', 'S', 'PV', 'H', 'N'].map((n) => [`${n}F`, { read: flag(n.toLowerCase()), max: 1, flag: true }])),
  ...Object.fromEntries(['Z', 'S', 'PV', 'N'].map((n) => [n, { read: flag(n.toLowerCase()), max: 1, flag: true }])),
};

/** @type {Record<string, (a: number, b: number) => boolean>} */
const OPS = {
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
};

/** The accepted form, ending every refusal. */
export const CONDITION_FORM =
  'Write <reg> <op> <value>, joined by && (such as "A == 0D && HL >= 3C00"): reg is A F B C D E H L I R, AF BC DE HL IX IY SP PC, or a flag ZF CF SF PVF HF NF (Z S PV N also work; C and H are the registers); op is == != < <= > >=; value is written like an address (bare digits are hex: 0D, 0x0D, $0D, 0Dh) or is a label.';

const NO_OTHERS = ' (only && joins clauses; there is no ||, !, or parentheses)';

/** A value as the condition echoes it: two hex digits for an 8-bit operand, four for a pair, the bare digit for a flag. */
const show = (/** @type {number} */ v, /** @type {number} */ max) =>
  max === 1 ? String(v) : `${v.toString(16).toUpperCase().padStart(max === 0xff ? 2 : 4, '0')}h`;

/**
 * Compile a break condition into the `when(m)` the emulator calls at each hit. The function's
 * `text` is the condition as it was read, values in hex (`A == 0Dh`), so the agent sees how a
 * bare `13` was taken.
 * @param {string} text
 * @param {Map<number, { name: string }>} [labels]
 * @returns {((m: any) => boolean) & { text: string }}
 */
export function compileCondition(text, labels) {
  if (text.trim() === '') throw new Error(`The condition is empty. ${CONDITION_FORM}`);
  const refuse = (/** @type {string} */ why) => new Error(`The condition "${text}" is not understood: ${why}. ${CONDITION_FORM}`);
  /** @type {{ read: Read, op: (a: number, b: number) => boolean, value: number }[]} */
  const clauses = [];
  const shown = [];
  for (const raw of text.split('&&')) {
    const clause = raw.trim();
    if (clause === '') throw refuse('a clause is empty around &&');
    const m = /^([A-Za-z]+)\s*(==|!=|<=|>=|<|>)\s*(\S+)$/.exec(clause);
    if (!m) throw refuse(`"${clause}" is not <reg> <op> <value>${/\|\||!(?!=)|[()]/.test(clause) ? NO_OTHERS : ''}`);
    const [, name, op, valueText] = /** @type {[string, string, string, string]} */ (/** @type {unknown} */ (m));
    const operand = OPERANDS[name.toUpperCase()];
    if (operand === undefined) throw refuse(`${name} is not a register or a flag`);
    let value;
    try {
      value = parseAddr(valueText, labels);
    } catch (err) {
      const why = (err instanceof Error ? err.message : String(err)).replace(/\.$/, '');
      throw refuse(`"${valueText}" is not a value: ${why}${/[()|!]/.test(valueText) ? NO_OTHERS : ''}`);
    }
    const upper = name.toUpperCase();
    if (operand.flag && value > 1) throw refuse(`the flag ${upper} is 0 or 1, not ${value.toString(16).toUpperCase()}h`);
    if (value > operand.max) throw refuse(`${upper} is 8 bits, so ${value.toString(16).toUpperCase()}h (${value}) can never match; the most is FFh`);
    clauses.push({ read: operand.read, op: /** @type {(a: number, b: number) => boolean} */ (OPS[op]), value });
    shown.push(`${upper} ${op} ${show(value, operand.max)}`);
  }
  const test = (/** @type {any} */ m) => clauses.every((c) => c.op(c.read(m), c.value));
  return Object.assign(test, { text: shown.join(' && ') });
}
