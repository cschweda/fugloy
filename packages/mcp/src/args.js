/**
 * Argument conventions (docs/fugloy-mcp-spec.md §4), shared by every tool. Addresses take several
 * spellings and echo as `5200h`; lengths and counts are decimal integers, and a string where a
 * count belongs is refused with a sentence that says so. Every failure is a thrown Error whose
 * message is a plain sentence an agent can act on.
 */

/** @typedef {Map<number, { name: string }>} Labels Session labels by address. */

/** @param {number} n as `5200h`: uppercase digits, four wide, lowercase h. */
export const hex4 = (n) => `${n.toString(16).toUpperCase().padStart(4, '0')}h`;

/** The first address above the ROM ($0000-$37FF on the Model III). */
export const ROM_END = 0x3800;

/** The top of the Model I's 12K Level II ROM; $3000-$37FF holds the Expansion Interface's registers ($37E0-$37EF) and nothing else. */
export const MODEL1_ROM_END = 0x3000;

/** The first address above model `n`'s ROM. */
export const romEndOf = (/** @type {number} */ n) => (n === 1 ? MODEL1_ROM_END : ROM_END);

/** Model numbers as the TRS-80 names them (`Model ${MODELS[n]}`). */
export const MODELS = /** @type {Record<number, string>} */ ({ 1: 'I', 3: 'III', 4: '4' });

/** C0 controls and DEL, which §8 forbids in a name, evidence, or note. */
export const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * What to write instead of a string given where a decimal count belongs: its digits when they
 * are decimal (`"5"` → 5), the decimal value of a hex spelling (`"0x400"` → 1024), else 1024.
 * @param {string} given
 */
export function decimalFor(given) {
  const text = given.trim();
  if (/^\d+$/.test(text)) return String(Number.parseInt(text, 10));
  const hex = /^(?:0x|\$)([0-9a-f]+)$/i.exec(text)?.[1] ?? /^([0-9a-f]+)h$/i.exec(text)?.[1];
  return hex === undefined ? '1024' : String(Number.parseInt(hex, 16));
}

const FORMS = 'write 5200, 0x5200, $5200, 5200h, a decimal number such as 20992, or a label name';

/**
 * An address from any documented spelling: `"5200"` (hex), `"0x5200"`, `"$5200"`, `"5200h"`, a JSON
 * number (decimal), or a label name (any case). A bare string of hex digits is hex, so `"400"` is
 * 0400h; a label whose name is all hex digits must be written with its decimal address instead.
 * @param {unknown} value
 * @param {Labels} [labels]
 * @returns {number}
 */
export function parseAddr(value, labels) {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error(`An address must be a whole number, not ${value}.`);
    if (value < 0 || value > 0xffff) throw new Error(`Address ${value} is outside 0000h-FFFFh.`);
    return value;
  }
  if (typeof value !== 'string') throw new Error(`${JSON.stringify(value) ?? String(value)} is not an address; ${FORMS}.`);
  const text = value.trim();
  const digits = /^(?:0x|\$)([0-9a-f]+)$/i.exec(text)?.[1] ?? /^([0-9a-f]+)h$/i.exec(text)?.[1] ?? (/^[0-9a-f]+$/i.test(text) ? text : undefined);
  if (digits !== undefined) {
    const n = Number.parseInt(digits, 16);
    const named = digits === text && labels !== undefined ? [...labels].find(([, l]) => l.name.toLowerCase() === text.toLowerCase()) : undefined;
    if (named) {
      throw new Error(`"${text}" is ambiguous: read as hex it is ${hex4(n & 0xffff)}, and it is also the label at ${hex4(named[0])}; write 0x${text} for the hex address or ${named[0]} (decimal) for the label.`);
    }
    if (n > 0xffff) throw new Error(`Address ${text} is outside 0000h-FFFFh.`);
    return n;
  }
  if (labels !== undefined && text !== '') {
    const wanted = text.toLowerCase();
    for (const [addr, label] of labels) if (label.name.toLowerCase() === wanted) return addr;
  }
  throw new Error(`"${value}" is not an address; ${FORMS}${labels === undefined ? '' : ' (no label has that name)'}.`);
}

/**
 * A decimal count or length. Strings are refused, because `"400"` where a length belongs is the
 * single most likely agent mistake (the same string means 0400h as an address).
 * @param {unknown} value
 * @param {{ name: string, min?: number, max?: number }} spec
 * @returns {number}
 */
export function parseCount(value, { name, min = 0, max = Infinity }) {
  if (value === undefined || value === null) throw new Error(`${name} is required.`);
  if (typeof value === 'string') throw new Error(`${name} is a decimal count; write ${decimalFor(value)}, not ${JSON.stringify(value)}.`);
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${name} must be a whole number, not ${JSON.stringify(value)}.`);
  if (value < min || value > max) {
    throw new Error(max === Infinity ? `${name} must be at least ${min}, not ${value}.` : `${name} must be between ${min} and ${max}, not ${value}.`);
  }
  return value;
}

/**
 * A range: `"5200-52FF"` (inclusive) or `{ addr, len }`.
 * @param {unknown} value
 * @param {Labels} [labels]
 * @returns {{ addr: number, len: number }}
 */
export function parseRange(value, labels) {
  if (typeof value === 'string') {
    const parts = value.split('-');
    if (parts.length !== 2) throw new Error(`"${value}" is not a range; write "5200-52FF" (both ends included) or { addr, len }.`);
    const addr = parseAddr(parts[0], labels);
    const end = parseAddr(parts[1], labels);
    if (end < addr) throw new Error(`The range "${value}" ends before it starts.`);
    return { addr, len: end - addr + 1 };
  }
  if (value !== null && typeof value === 'object' && 'addr' in value) {
    const addr = parseAddr(value.addr, labels);
    const len = parseCount(/** @type {any} */ (value).len, { name: 'len', min: 1 });
    if (addr + len > 0x10000) throw new Error(`The range ${hex4(addr)} + ${len} bytes runs past FFFFh.`);
    return { addr, len };
  }
  throw new Error(`${JSON.stringify(value) ?? String(value)} is not a range; write "5200-52FF" (both ends included) or { addr, len }.`);
}

/** Bytes from a hex string ("21003C", spaces allowed) or an array of 0-255. */
export function parseBytes(/** @type {string | number[]} */ value) {
  if (typeof value === 'string') {
    const text = value.replace(/\s+/g, '');
    if (text === '') throw new Error('bytes is empty; give at least one byte.');
    if (!/^(?:[0-9a-f]{2})+$/i.test(text)) {
      throw new Error(`bytes ${JSON.stringify(value)} is not hex pairs; write "21003C" (two hex digits a byte) or an array such as [33, 0, 60].`);
    }
    return Array.from({ length: text.length / 2 }, (_, k) => Number.parseInt(text.slice(k * 2, k * 2 + 2), 16));
  }
  if (value.length === 0) throw new Error('bytes is empty; give at least one byte.');
  for (const b of value) if (!Number.isInteger(b) || b < 0 || b > 255) throw new Error(`bytes holds ${b}, and every byte must be a whole number from 0 to 255.`);
  return value;
}
