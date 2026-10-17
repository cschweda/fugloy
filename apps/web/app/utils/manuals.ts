// Manuals, without pdf.js: archive.org addresses, which known scan a PDF is,
// and how a symbol's name or address is spelled on a page so the Manual tab can
// highlight it. DOM-free.
import { MANUALS } from '@fugloy/disasm';
import type { ManualScan, TableEntry } from '@fugloy/disasm';

/** archive.org's reader at a 1-based PDF page (the reader counts leaves from 0). */
export function readerUrl(archiveId: string, pdfPage: number): string {
  return `https://archive.org/details/${archiveId}/page/n${pdfPage - 1}/mode/1up`;
}

/** archive.org's item-image service: the item's cover. A third-party request, made only where a page says so. */
export function coverUrl(archiveId: string): string {
  return `https://archive.org/services/img/${archiveId}`;
}

export function scanOf(sourceId: string): ManualScan | undefined {
  return MANUALS.find((m) => m.source === sourceId);
}

/** The known scan a PDF is, by its SHA-256. */
export function scanByHash(sha256: string): ManualScan | undefined {
  const h = sha256.toLowerCase();
  return MANUALS.find((m) => m.pdfSha256.includes(h));
}

/** True when the bytes start like a PDF (`%PDF-`, allowing a little leading junk as readers do). */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

const hex = (n: number, digits: number): string => n.toString(16).toUpperCase().padStart(digits, '0');

/**
 * What to look for on a page, best first: the name, then the address or port as
 * manuals print it (`0ECH`, `$EC`, `X'EC'`, `&HEC`; an address of $0100 or more
 * also bare and in decimal, as the BASIC manuals give them).
 */
export function highlightTerms(e: Pick<TableEntry, 'name' | 'key' | 'kind'>): string[] {
  if (e.kind === 'svc') return [e.name];
  const port = e.kind === 'port';
  const h = hex(e.key, port ? 2 : 4);
  const zeroed = /^[A-F]/.test(h) ? `0${h}` : h;
  const terms = [e.name, `${zeroed}H`];
  if (zeroed !== h) terms.push(`${h}H`);
  terms.push(`$${h}`, `X'${h}'`, `&H${h}`);
  // Bare hex and decimal only for a full address: `40` would mark any 40 on the page.
  if (!port && e.key >= 0x100) terms.push(h, String(e.key));
  return terms;
}

export interface TextHit {
  /** Index of the text item. */
  item: number;
  /** Character range in the item's string. */
  start: number;
  end: number;
}

const escape = (c: string): string => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The first term (in order) found in the page's text items, and every place it
 * occurs. Case and stray spaces inside the term are ignored (OCR prints `0F1 H`);
 * a match must not run into a letter or digit on either side.
 */
export function findMatches(items: readonly { str: string }[], terms: readonly string[]): { term: string; hits: TextHit[] } | null {
  for (const term of terms) {
    const body = [...term.replace(/\s+/g, '')].map(escape).join('\\s*');
    if (body === '') continue;
    const re = new RegExp(`(?<![0-9A-Za-z])${body}(?![0-9A-Za-z])`, 'gi');
    const hits: TextHit[] = [];
    items.forEach((it, i) => {
      for (const m of it.str.matchAll(re)) hits.push({ item: i, start: m.index, end: m.index + m[0].length });
    });
    if (hits.length > 0) return { term, hits };
  }
  return null;
}
