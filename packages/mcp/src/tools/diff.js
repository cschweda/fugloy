/**
 * `diff`: the bytes that differ between two snapshots, or a snapshot and the running machine
 * (docs/fugloy-mcp-spec.md §5 Snapshots, §13 story 2; Ruling 2 of the MCP phases D–F plan).
 * Video RAM and RAM ($3C00-$FFFF) by default, `range` narrowing it; changed bytes are grouped
 * into runs of adjacent addresses, eight bytes a line, with any label inside a run, or a sized
 * label covering its start, named. On the Model 4 each side is $3C00-$FFFF as the CPU saw it, in
 * the memory map and page then in force (a note says when the two sides' differ), and a run in
 * video RAM that the screen does not show (the 2K holds more than the screen) is marked off screen.
 */
import { z } from 'zod';
import { hex4, parseRange } from '../args.js';
import { h2 } from '../format/hex.js';
import { DIFF_START, diffView, videoOffset } from '../session.js';

/** `map 3, page 2` or `map 0, video page 1` from a Model 4's port $84 byte (the page only with 128K). */
const mapText = (/** @type {number} */ reg, /** @type {boolean} */ paged) => `map ${reg & 3}${paged ? `, page ${(reg >> 4) & 7}` : ''}${(reg & 3) < 2 ? `, video page ${reg >> 7}` : ''}`;

/** Bytes shown on one `old → new` line. */
const PER_LINE = 8;

const bytes = (/** @type {Uint8Array} */ m, /** @type {number} */ from, /** @type {number} */ n) => [...m.subarray(from - DIFF_START, from - DIFF_START + n)].map(h2).join(' ');

export default {
  name: 'diff',
  description:
    'Compare two snapshots, or a snapshot and "now" (the running machine): the bytes that changed in video RAM and RAM (3C00h-FFFFh, or range inside it), grouped into runs of adjacent addresses, each as addr old → new, with a count of runs and bytes first. The way to find game variables: snapshot, play one move, diff.',
  inputSchema: {
    a: z.string().describe('The earlier side: a snapshot name, or "now"'),
    b: z.string().describe('The later side: a snapshot name, or "now"'),
    range: z.union([z.string(), z.object({ addr: z.union([z.string(), z.number()]), len: z.number().int() })]).optional()
      .describe('Only this range: "4000-7FFF" (both ends included) or { addr, len }; inside 3C00h-FFFFh (default all of it)'),
  },
  /**
   * @param {import('../session.js').Session} session
   * @param {{ a: string, b: string, range?: string | { addr: string | number, len: number } }} args
   */
  handler(session, { a, b, range }) {
    const m = session.requireMachine();
    let addr = DIFF_START;
    let len = 0x10000 - DIFF_START;
    if (range !== undefined) {
      ({ addr, len } = parseRange(range, session.labels));
      if (addr < DIFF_START) {
        throw new Error(`diff compares video RAM and RAM (3C00h–FFFFh); the range ${hex4(addr)}–${hex4(addr + len - 1)} reaches below 3C00h (ROM and the keyboard never change in a snapshot).`);
      }
    }
    const side = (/** @type {string} */ name) => {
      if (name.toLowerCase() === 'now') {
        const view = diffView(m);
        return { live: view.memory, view, program: session.program?.name ?? '(none)' };
      }
      const snap = session.useSnapshot(name, ' (or say "now" for the running machine)');
      return { live: snap.memory, view: snap, program: snap.program?.name ?? '(none)' };
    };
    const A = side(a);
    const B = side(b);
    const end = addr + len;

    /** @type {[number, number][]} runs as [start, length] */
    const runs = [];
    let changed = 0;
    for (let i = addr; i < end; i++) {
      if (A.live[i - DIFF_START] === B.live[i - DIFF_START]) continue;
      changed++;
      const last = runs.at(-1);
      if (last !== undefined && last[0] + last[1] === i) last[1]++;
      else runs.push([i, 1]);
    }
    const over = `diff ${a} → ${b} over ${hex4(addr)}–${hex4(end - 1)}`;
    const lines = [];
    if (changed === 0) lines.push(`${over}: no bytes changed`);
    else lines.push(`${over}: ${runs.length} ${runs.length === 1 ? 'run' : 'runs'}, ${changed.toLocaleString('en-US')} ${changed === 1 ? 'byte' : 'bytes'} changed`);
    if (A.program !== B.program) lines.push(`Note: ${a} belongs to ${A.program} and ${b} to ${B.program}.`);
    const ra = A.view.mapRegister;
    const rb = B.view.mapRegister;
    const paged = m.mem.ram.length > 0x10000;
    // What decides the CPU's view: the map, the page (128K only), and in maps 0-1 the video page.
    const view = (/** @type {number} */ r) => (r & 3) | (paged ? r & 0x70 : 0) | ((r & 3) < 2 ? r & 0x80 : 0);
    if (ra !== null && rb !== null && view(ra) !== view(rb)) {
      lines.push(`Note: ${a} was taken in ${mapText(ra, paged)} and ${b} in ${mapText(rb, paged)}; each side is what the CPU saw at 3C00h–FFFFh in its own map, so some of these bytes are other memory, not changes.`);
    }
    // Off screen: video RAM bytes the later side's screen does not show (the Model 4's 2K is more than 64 by 16, or 80 by 24, cells).
    const shown = B.view.geometry.width * B.view.geometry.rows;
    const offScreen = (/** @type {number} */ start, /** @type {number} */ n) => {
      for (let k = start; k < start + n; k++) {
        const off = videoOffset(B.view, k);
        if (off < 0 || off < shown) return false;
      }
      return true;
    };
    for (const [start, n] of runs) {
      // Labels inside the run, and sized labels that start before it and cover its first byte.
      const names = [...session.labels.values()]
        .filter((l) => (l.addr >= start && l.addr < start + n) || (l.size !== undefined && l.addr < start && l.addr + l.size > start))
        .sort((x, y) => x.addr - y.addr)
        .map((l) => l.name);
      if (offScreen(start, n)) names.push('video RAM off screen');
      const label = names.length > 0 ? `  ; ${names.join(', ')}` : '';
      const head = `${n === 1 ? hex4(start) : `${hex4(start)}–${hex4(start + n - 1)}`} (${n.toLocaleString('en-US')} ${n === 1 ? 'byte' : 'bytes'})`;
      if (n <= PER_LINE) {
        lines.push(`${head}  ${bytes(A.live, start, n)} → ${bytes(B.live, start, n)}${label}`);
        continue;
      }
      lines.push(`${head}${label}`);
      for (let k = start; k < start + n; k += PER_LINE) {
        const c = Math.min(PER_LINE, start + n - k);
        lines.push(`  ${hex4(k)}  ${bytes(A.live, k, c)} → ${bytes(B.live, k, c)}`);
      }
    }
    return lines.join('\n');
  },
};
