// The Explain tab's cache and helpers. The engine (@fugloy/disasm's explain)
// keeps its own indexes per analysis; this keeps each finished explanation per
// session and address, and each routine summary per session and routine start,
// so stepping back and forth through lines costs a map lookup. A new session
// (a hint edit, another symbol table) gets fresh entries: its analysis differs.
import { explainLine, explainRow, sentenceText, summarizeRoutine } from '@fugloy/disasm';
import type { Details, Explanation, Piece, Row, RoutineSummary, Sentence, Session } from '@fugloy/disasm';
import { hex4 } from '@fugloy/z80';

const lines = new WeakMap<Session, Map<number, Explanation>>();
/** Rows that are not lines of the program (ORG, notes, header), by kind, address and text. */
const others = new WeakMap<Session, Map<string, Explanation>>();
/** Summaries by routine start, and the start each asked-for address belongs to (null: no routine reaches it). */
const summaries = new WeakMap<Session, { byStart: Map<number, RoutineSummary>; startOf: Map<number, number | null> }>();

function mapOf<K, V>(m: WeakMap<Session, Map<K, V>>, s: Session): Map<K, V> {
  let hit = m.get(s);
  if (hit === undefined) {
    hit = new Map();
    m.set(s, hit);
  }
  return hit;
}

/** The explanation of the line at `addr`, cached per session and address. */
export function explainAt(s: Session, addr: number): Explanation {
  const cache = mapOf(lines, s);
  let e = cache.get(addr);
  if (e === undefined) {
    e = explainLine(s, addr);
    cache.set(addr, e);
  }
  return e;
}

/** The explanation of a listing row: a line of the program through explainAt, any other row by its own kind. */
export function explainRowAt(s: Session, row: Row): Explanation {
  if (row.kind === 'code' || row.kind === 'data' || row.kind === 'label' || row.kind === 'basic') return explainAt(s, row.addr);
  const key = `${row.kind}:${'addr' in row ? row.addr : ''}:${'text' in row ? row.text : ''}`;
  const cache = mapOf(others, s);
  let e = cache.get(key);
  if (e === undefined) {
    e = explainRow(s, row);
    cache.set(key, e);
  }
  return e;
}

/** The summary of the routine around `addr`, cached per session and routine start; null when no routine reaches it. */
export function summaryAt(s: Session, addr: number): RoutineSummary | null {
  let c = summaries.get(s);
  if (c === undefined) {
    c = { byStart: new Map(), startOf: new Map() };
    summaries.set(s, c);
  }
  if (c.startOf.has(addr)) {
    const start = c.startOf.get(addr)!;
    return start === null ? null : c.byStart.get(start)!;
  }
  const r = summarizeRoutine(s, addr);
  if (r === null) {
    c.startOf.set(addr, null);
    return null;
  }
  const kept = c.byStart.get(r.start) ?? r;
  c.byStart.set(r.start, kept);
  c.startOf.set(addr, r.start);
  return kept;
}

/**
 * Builds the engine's routine index for a session in idle time, by summarizing
 * the routine at `addr` (the entry), so the first step with Explain open does
 * not pay for it. Returns a function that cancels it if it has not run.
 */
export function warmExplain(s: Session, addr: number, done?: () => void): () => void {
  const run = (): void => {
    summaryAt(s, addr);
    done?.();
  };
  const g = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (typeof g.requestIdleCallback === 'function' && typeof g.cancelIdleCallback === 'function') {
    const id = g.requestIdleCallback(run, { timeout: 2000 });
    return () => g.cancelIdleCallback!(id);
  }
  const id = setTimeout(run, 0);
  return () => clearTimeout(id);
}

/** The details strip as one quiet line: size, T-states (both when conditional), the flags it changes, and "undocumented". */
export function detailsText(d: Details): string {
  const parts = [d.bytes === 1 ? '1 byte' : `${d.bytes} bytes`];
  parts.push(d.cyclesNotTaken === undefined ? `${d.cycles} T-states` : `${d.cycles} or ${d.cyclesNotTaken} T-states`);
  parts.push(d.flags === '' ? 'flags unchanged' : `changes ${d.flags.split('').join(' ')}`);
  if (!d.documented) parts.push('undocumented');
  return parts.join(' · ');
}

/** The most bytes a region picture draws (16K). */
export const PICTURE_MAX = 0x4000;

const pictures = new WeakMap<Session, Map<string, Uint8Array>>();

/**
 * The bytes a region picture draws, from the runtime image (where relocated
 * code runs), at most PICTURE_MAX. Cached per session and region, so stepping
 * through a region's rows hands the picture the same array and it does not redraw.
 */
export function pictureBytes(s: Session, region: { start: number; end: number }): Uint8Array {
  const cache = mapOf(pictures, s);
  const key = `${region.start}:${region.end}`;
  let b = cache.get(key);
  if (b === undefined) {
    const end = Math.min(region.end, region.start + PICTURE_MAX - 1);
    b = s.analysis.space.image.bytes.slice(region.start, end + 1);
    cache.set(key, b);
  }
  return b;
}

/** A piece that is only punctuation or space, such as " (" or ")": it does not separate two links to the same address. */
const PUNCT = /^[\s()[\],;:.\u2013-]*$/;

/**
 * The sentence with repeated links thinned: when adjacent pieces (ignoring
 * punctuation-only pieces) link the same address, only the first stays a link
 * ("$5200 (L5200)" links once).
 */
export function thinLinks(s: Sentence): Sentence {
  let last: number | undefined;
  let changed = false;
  const out = s.map((p) => {
    if (p.addr === undefined) {
      if (!PUNCT.test(p.text)) last = undefined;
      return p;
    }
    if (p.addr === last) {
      changed = true;
      const { addr: _drop, ...plain } = p;
      return plain;
    }
    last = p.addr;
    return p;
  });
  return changed ? out : s;
}

/** Sentences of a routine summary that say what it is, how it is reached and how it ends; the rest go behind "More about this routine". */
const HEAD = ['This is where the program starts', 'This is an entry point', 'It is called from', 'It is jumped to from', 'Its address is used at', 'A jump table entry', 'Jump table entries', 'It ends by', 'None of its paths', 'It is longer than'];

/** A routine summary split into what shows at once (its length, who reaches it, how it ends) and the facts behind a disclosure. */
export function summaryParts(r: RoutineSummary): { head: Sentence[]; more: Sentence[] } {
  const head: Sentence[] = [];
  const more: Sentence[] = [];
  r.sentences.forEach((s, i) => {
    const text = sentenceText(s);
    (i === 0 || HEAD.some((h) => text.startsWith(h)) ? head : more).push(s);
  });
  return { head, more };
}

/**
 * The pattern's sentences to show. On a block copy's own LDIR the lead already
 * says the count, source and destination, so only what it lacks remains (such
 * as "This moves the program to where it runs."); null when nothing does.
 */
export function patternSentences(e: Explanation): Sentence[] | null {
  const p = e.pattern;
  if (p === undefined) return null;
  if (p.name !== 'copy' || e.addr !== p.to) return p.sentences;
  const rest = p.sentences.filter((x) => !sentenceText(x).startsWith('Copies '));
  return rest.length === 0 ? null : rest;
}

/** The most addresses a label sentence names before "and N more". */
const LABEL_LIST = 8;

/** `$A`, `$A and $B`, `$A, $B, … and 3 more`, each a link. */
function linkList(addrs: readonly number[]): Piece[] {
  const shown = addrs.length <= LABEL_LIST ? addrs : addrs.slice(0, LABEL_LIST - 1);
  const items: Piece[][] = shown.map((x) => [{ text: `$${hex4(x)}`, addr: x }]);
  if (shown.length < addrs.length) items.push([{ text: `${addrs.length - shown.length} more` }]);
  const out: Piece[] = [];
  items.forEach((item, i) => {
    if (i > 0) out.push({ text: i === items.length - 1 ? ' and ' : ', ' });
    out.push(...item);
  });
  return out;
}

/**
 * What a label row says about its label: who calls it and jumps to it (links;
 * a jump-table entry is "reached from the table entry at"), and whether it is
 * the entry point. Null when the explanation carries no label.
 */
export function labelSentences(s: Session, e: Explanation): Sentence[] | null {
  const l = e.label;
  if (l === undefined) return null;
  const ins = s.analysis.pass1.instructions;
  const jumps = l.jumpers.filter((j) => ins.has(j));
  const table = l.jumpers.filter((j) => !ins.has(j));
  const parts: Piece[][] = [];
  if (l.callers.length > 0) parts.push([{ text: 'called from ' }, ...linkList(l.callers)]);
  if (jumps.length > 0) parts.push([{ text: 'jumped to from ' }, ...linkList(jumps)]);
  if (table.length > 0) parts.push([{ text: table.length === 1 ? 'reached from the table entry at ' : 'reached from the table entries at ' }, ...linkList(table)]);
  const out: Sentence[] = [];
  if (parts.length > 0) {
    const joined = parts.flatMap((p, i) => (i === 0 ? p : [{ text: '; ' }, ...p]));
    const first = joined[0]!;
    out.push([{ ...first, text: first.text[0]!.toUpperCase() + first.text.slice(1) }, ...joined.slice(1), { text: '.' }]);
  } else out.push([{ text: 'No call or jump to it was found.' }]);
  if (l.entry) out.push([{ text: e.addr === s.analysis.entry ? 'This is where the program starts (its entry point).' : 'This is an entry point the analysis starts from.' }]);
  return out;
}
