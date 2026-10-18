/** `labels`: the session's labels as a table, by address (docs/fugloy-mcp-spec.md §5, Knowledge). */
import { z } from 'zod';
import { hex4, parseRange } from '../args.js';

const SOURCES = /** @type {const} */ (['loader', 'observed', 'user', 'disasm']);

export default {
  name: 'labels',
  description:
    'List the labels, by address: addr, kind, size, source (user: yours; observed: a call target the emulator saw, named SUB_hhhh until you name it; loader: the entry point; disasm: the disassembler\'s), name, and after ; the note and evidence. range limits it ("5200-52FF", both ends included, or { addr, len }); source limits it to one source.',
  inputSchema: {
    range: z.union([z.string(), z.object({ addr: z.union([z.string(), z.number()]), len: z.number().int() })]).optional().describe('Only labels in this range: "5200-52FF" (both ends included) or { addr, len }'),
    source: z.enum(SOURCES).optional().describe('Only labels from this source: "user", "observed", "loader", or "disasm"'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ range?: string | { addr: string | number, len: number }, source?: typeof SOURCES[number] }} args
   */
  handler(session, { range, source }) {
    session.requireProgram();
    const span = range === undefined ? undefined : parseRange(range, session.labels);
    const all = [...session.labels.values()].sort((a, b) => a.addr - b.addr);
    const shown = all.filter((l) => (source === undefined || (l.source ?? 'user') === source) && (span === undefined || (l.addr >= span.addr && l.addr < span.addr + span.len)));
    const filters = [
      ...(source === undefined ? [] : [`source ${source}`]),
      ...(span === undefined ? [] : [`in ${hex4(span.addr)}–${hex4(span.addr + span.len - 1)}`]),
    ];
    if (all.length === 0) return 'No labels yet; label names an address.';
    if (shown.length === 0) {
      const what = [...(source === undefined ? [] : [`with source ${source}`]), ...(span === undefined ? [] : [`in ${hex4(span.addr)}–${hex4(span.addr + span.len - 1)}`])].join(' ');
      return `No labels ${what} (${all.length} ${all.length === 1 ? 'label' : 'labels'} in all).`;
    }
    const lines = [filters.length === 0 ? `Labels (${all.length}):` : `Labels (${shown.length} of ${all.length}, ${filters.join(', ')}):`, 'addr   kind  size   source    name'];
    for (const l of shown) {
      const remark = [l.note, l.evidence].filter((t) => t !== undefined && t !== '').join('; ');
      const size = l.size === undefined ? '' : String(l.size);
      lines.push(`${hex4(l.addr)}  ${(l.kind ?? 'code').padEnd(4)}  ${size.padStart(5)}  ${(l.source ?? 'user').padEnd(8)}  ${l.name}${remark ? `  ; ${remark}` : ''}`);
    }
    return lines.join('\n');
  },
};
