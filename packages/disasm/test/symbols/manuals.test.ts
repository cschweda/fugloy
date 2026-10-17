/** The page tables in data/manuals/*.json: every cited printed page of an archive.org source, mapped to its page in that item's PDF. */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildSymbolOutputs } from '../../scripts/write-symbols.js';
import { manualPage } from '../../src/symbols/manuals.js';
import { MANUALS, SOURCES, TABLES } from '../../src/symbols/tables.generated.js';
import type { ManualScan } from '../../src/symbols/types.js';

const symbolsDir = fileURLToPath(new URL('../../data/symbols/', import.meta.url));
const manualsDir = fileURLToPath(new URL('../../data/manuals/', import.meta.url));

/**
 * Cited pages a scan does not have, by `source:page`, each with the reason. A page goes here only when it cannot be found in the
 * scan (missing from it, or a different edition), never as a guess. Empty: every cited page was found and checked.
 */
const NOT_IN_SCAN: Readonly<Record<string, string>> = {};

const archived = SOURCES.filter((s) => s.archiveId !== undefined);
const cites = Object.values(TABLES).flatMap((entries) => entries.flatMap((e) => e.cite.map((c) => ({ ...c, name: e.name }))));
const scanOf = (source: string): ManualScan | undefined => MANUALS.find((m) => m.source === source);

describe('the manual page tables', () => {
  it('give one scan to each source with an archive.org item, under its archiveId, and none to any other source', () => {
    expect(MANUALS.map((m) => m.source)).toEqual(archived.map((s) => s.id));
    for (const s of archived) expect(scanOf(s.id)?.archiveId, s.id).toBe(s.archiveId);
    expect(archived.map((s) => s.id)).toEqual(['m3-basic', 'paay', 'decker', 'l2-1979', 'm3-trm', 'trsdos13', 'ldos51']);
  });

  it('map every page cited from an archive.org source to a page within its PDF', () => {
    const unmapped: string[] = [];
    for (const c of cites) {
      const source = SOURCES.find((s) => s.id === c.source);
      if (source?.archiveId === undefined) continue;
      if (`${c.source}:${c.page}` in NOT_IN_SCAN) continue;
      const scan = scanOf(c.source);
      const pdfPage = scan === undefined ? null : manualPage(scan, c.page);
      if (scan === undefined || pdfPage === null || pdfPage < 1 || pdfPage > scan.pdfPages) unmapped.push(`${c.source} p. ${c.page} (${c.name})`);
    }
    expect(unmapped).toEqual([]);
  });

  it('list only pages that are cited and absent from the allow-list, and only allow-list pages that are cited', () => {
    const cited = new Set(cites.map((c) => `${c.source}:${c.page}`));
    for (const m of MANUALS) for (const printed of Object.keys(m.pages)) expect(cited.has(`${m.source}:${printed}`), `${m.source}:${printed}`).toBe(true);
    for (const key of Object.keys(NOT_IN_SCAN)) {
      expect(cited.has(key), key).toBe(true);
      const [source, page] = key.split(':') as [string, string];
      expect(scanOf(source)?.pages[page], key).toBeUndefined();
    }
  });

  it('record each PDF by SHA-256 and page count, and give no two printed pages one PDF page', () => {
    for (const m of MANUALS) {
      expect(m.pdfSha256.length, m.source).toBeGreaterThan(0);
      for (const sha of m.pdfSha256) expect(sha, m.source).toMatch(/^[0-9a-f]{64}$/);
      expect(Number.isInteger(m.pdfPages) && m.pdfPages > 0, m.source).toBe(true);
      const pdfPages = Object.values(m.pages);
      expect(new Set(pdfPages).size, m.source).toBe(pdfPages.length);
      for (const p of pdfPages) expect(Number.isInteger(p), m.source).toBe(true);
    }
  });

  it('keep printed order: a later printed page of a chapter or numbered run is a later PDF page', () => {
    /** The printed page as a sortable pair: its chapter (or 0) and its number within it. */
    const order = (printed: string): [string, number] => {
      const m = /^(?:(.+)[/-])?(\d+)$/.exec(printed);
      if (m === null) throw new Error(`unexpected printed page ${printed}`);
      return [m[1] ?? '', Number(m[2])];
    };
    for (const m of MANUALS) {
      const runs = new Map<string, [number, number][]>();
      for (const [printed, pdf] of Object.entries(m.pages)) {
        const [run, n] = order(printed);
        runs.set(run, [...(runs.get(run) ?? []), [n, pdf]]);
      }
      for (const [run, pairs] of runs) {
        pairs.sort((a, b) => a[0] - b[0]);
        // Within one run the gap in PDF pages is at least the gap in printed pages (blank or plate pages can only add to it).
        for (let i = 1; i < pairs.length; i++) expect(pairs[i]![1] - pairs[i - 1]![1], `${m.source} ${run}`).toBeGreaterThanOrEqual(pairs[i]![0] - pairs[i - 1]![0]);
      }
    }
  });

  // Each of these was read on the PDF page itself; see the task 15 report for how every page was checked.
  it.each([
    ['m3-basic', '12/2', 72],
    ['m3-basic', '12/15', 85],
    ['m3-basic', '12/26', 96],
    ['paay', '2', 6],
    ['paay', '28', 32],
    ['decker', '5', 10],
    ['decker', '64', 69],
    ['decker', '121', 126],
    ['l2-1979', '8-8', 102],
    ['l2-1979', 'D-1', 163],
    ['l2-1979', 'D-2', 164],
    ['m3-trm', '14', 25],
    ['m3-trm', '22', 33],
    ['trsdos13', '78', 88],
    ['trsdos13', '86', 96],
    ['ldos51', '6-29', 291],
    ['ldos51', '6-34', 296],
    ['ldos51', '6-35', 297],
  ])('finds %s p. %s on PDF page %i', (source, printed, pdfPage) => {
    const scan = scanOf(source);
    expect(scan).toBeDefined();
    expect(manualPage(scan!, printed)).toBe(pdfPage);
  });

  it('records the page counts of the archive.org PDFs', () => {
    expect(Object.fromEntries(MANUALS.map((m) => [m.source, m.pdfPages]))).toEqual({
      'm3-basic': 276, paay: 84, decker: 132, 'l2-1979': 196, 'm3-trm': 154, trsdos13: 174, ldos51: 372,
    });
  });
});

describe('manualPage', () => {
  const scan: ManualScan = { source: 'x', archiveId: 'X', pdfSha256: ['0'.repeat(64)], pdfPages: 10, pages: { '12/2': 4, '6-29': 7 } };

  it('returns the PDF page of a listed printed page, as cited', () => {
    expect(manualPage(scan, '12/2')).toBe(4);
    expect(manualPage(scan, '6-29')).toBe(7);
  });

  it('returns null for a page the scan does not list, including names an object inherits', () => {
    expect(manualPage(scan, '12/3')).toBeNull();
    expect(manualPage(scan, '12 / 2')).toBeNull();
    expect(manualPage(scan, 'constructor')).toBeNull();
    expect(manualPage(scan, '__proto__')).toBeNull();
    expect(manualPage(scan, 'toString')).toBeNull();
  });
});

describe('buildSymbolOutputs on an edited copy of the manual tables', () => {
  const copies: string[] = [];
  afterAll(() => {
    for (const dir of copies) rmSync(dir, { recursive: true, force: true });
  });
  /** Builds from a fresh copy of data/symbols and data/manuals after `edit` has changed the manual of `source`. */
  const buildWith = (source: string, edit: (json: Record<string, unknown>) => unknown) => {
    const dir = mkdtempSync(join(tmpdir(), 'fugloy-manuals-'));
    copies.push(dir);
    cpSync(symbolsDir, join(dir, 'symbols'), { recursive: true });
    cpSync(manualsDir, join(dir, 'manuals'), { recursive: true });
    const file = join(dir, 'manuals', `${source}.json`);
    writeFileSync(file, JSON.stringify(edit(JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>)));
    return buildSymbolOutputs(join(dir, 'symbols'));
  };

  it('compiles the committed manuals unchanged', () => {
    const r = buildWith('paay', (json) => json);
    expect(r.errors).toEqual([]);
    expect(r.module).toContain('export const MANUALS: readonly ManualScan[] = [');
    expect(r.module).toContain("source: 'paay', archiveId: 'Level_II_ROM_Reference_Manual_1980_Micro_Products'");
  });

  it('reports a page past the end of the PDF, a page that is not a whole number, and a bad hash', () => {
    const r = buildWith('paay', (json) => ({ ...json, pdfSha256: ['ABC'], pages: { ...(json.pages as object), '2': 85, '3': 6.5 } }));
    expect(r.errors).toEqual([
      'manuals/paay.json: pdfSha256 "ABC" is not 64 lowercase hex digits',
      'manuals/paay.json: page "2" maps to 85, outside the PDF\'s 1..84',
      'manuals/paay.json: page "3" maps to 6.5, outside the PDF\'s 1..84',
    ]);
    expect(r.module).toBe('');
  });

  it('reports a manual whose source or archiveId does not match, and an unknown field', () => {
    const r = buildWith('decker', (json) => ({ ...json, source: 'paay', archiveId: 'Elsewhere', extra: 1 }));
    expect(r.errors).toEqual([
      'manuals/decker.json: unknown field "extra"',
      'manuals/decker.json: source "paay" is not decker, the source this file is named for',
      'manuals/decker.json: archiveId "Elsewhere" is not decker\'s archiveId "ROM_Routines_Documented_1983_The_Alternate_Source"',
    ]);
  });
});
