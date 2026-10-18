/** Trace lines (docs/fugloy-mcp-spec.md §4): `PC  bytes  mnemonic ; label [cycles]`, loops collapsed. */
import { decode, formatInstruction } from '@fugloy/z80';

const h2 = (/** @type {number} */ n) => (n & 0xff).toString(16).toUpperCase().padStart(2, '0');
const h4 = (/** @type {number} */ n) => (n & 0xffff).toString(16).toUpperCase().padStart(4, '0');

/** @param {{ pc: number, bytes: ArrayLike<number>, cycles: number, regs?: any }} e */
function line(e, labels) {
  const bytes = Array.from(e.bytes);
  let mnemonic;
  try {
    mnemonic = formatInstruction(decode((i) => bytes[i], e.pc));
  } catch {
    mnemonic = `DB ${bytes.map(h2).join(',')}`;
  }
  const label = labels.get(e.pc & 0xffff);
  let text = `${h4(e.pc)}  ${bytes.map(h2).join(' ').padEnd(11)}  ${mnemonic.padEnd(16)}  ${label ? `; ${label.name}  ` : ''}[${e.cycles}]`;
  if (e.regs) {
    const r = e.regs;
    text += `  A=${h2(r.a)} F=${h2(r.f)} BC=${h4((r.b << 8) | r.c)} DE=${h4((r.d << 8) | r.e)} HL=${h4((r.h << 8) | r.l)} SP=${h4(r.sp)}`;
  }
  return text;
}

/**
 * `entries` is `m.debug.trace.last(n)` (plain entries) or `collapsed(n)` (`{ entries, repeat }`).
 * A collapsed group prints its sequence once, then `  ×212 (5214h–521Ah)`.
 * @param {any[]} entries
 * @param {Map<number, { name: string }>} labels
 * @returns {string}
 */
export function traceLines(entries, labels) {
  const out = [];
  for (const item of entries) {
    if (!Array.isArray(item.entries)) {
      out.push(line(item, labels));
      continue;
    }
    for (const e of item.entries) out.push(line(e, labels));
    if (item.repeat > 1) {
      const first = item.entries[0].pc;
      const last = item.entries.at(-1).pc;
      out.push(`  ×${item.repeat} (${h4(first)}h–${h4(last)}h)`);
    }
  }
  return out.join('\n');
}
