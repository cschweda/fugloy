/** Trace lines (docs/fugloy-mcp-spec.md §4): `PC  bytes  mnemonic ; label [cycles]`, loops collapsed. */
import { decode, formatInstruction } from '@fugloy/z80';
import { h2, h4 } from './hex.js';

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

/**
 * Merge consecutive repetitions of one PC sequence (period 1 to 64, at least two repeats) into
 * `{ entries, repeat }`, as `m.debug.trace.collapsed` does (emu spec §7), for entries the server
 * keeps itself. The longest run covered wins at each point.
 * @template {{ pc: number }} E
 * @param {E[]} list
 * @returns {{ entries: E[], repeat: number }[]}
 */
export function collapse(list) {
  const out = [];
  const n = list.length;
  let i = 0;
  while (i < n) {
    let bestP = 0;
    let bestR = 0;
    for (let p = 1; p <= 64 && i + 2 * p <= n; p++) {
      let r = 1;
      while (i + (r + 1) * p <= n && list.slice(i + r * p, i + (r + 1) * p).every((e, k) => e.pc === /** @type {E} */ (list[i + k]).pc)) r++;
      if (r >= 2 && r * p > bestR * bestP) {
        bestP = p;
        bestR = r;
      }
    }
    if (bestP === 0) {
      out.push({ entries: [/** @type {E} */ (list[i])], repeat: 1 });
      i++;
    } else {
      out.push({ entries: list.slice(i, i + bestP), repeat: bestR });
      i += bestP * bestR;
    }
  }
  return out;
}
