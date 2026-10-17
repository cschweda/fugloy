// Bring-your-own manuals: recognizing a dropped PDF, storing it, and finding
// the PDF page of a cited printed page. The store is fake-indexeddb; pdf.js is
// never loaded (the page count and the hash are handed in).
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { MANUALS, manualPage } from '@fugloy/disasm';
import type { ManualScan } from '@fugloy/disasm';
import { createManuals } from '../app/composables/useManuals';
import { coverUrl, findMatches, highlightTerms, readerUrl } from '../app/utils/manuals';
import { openStore } from '../app/utils/store';
import type { Store } from '../app/utils/store';
import CitationMissing from '../app/components/side/CitationMissing.vue';

const M3 = MANUALS.find((m) => m.source === 'm3-trm') as ManualScan;
const KNOWN = M3.pdfSha256[0]!;
/** A fake PDF: the magic, then a line the fake hash returns. */
const file = (text: string, name = 'manual.pdf'): File => new File([`%PDF-1.4\n${text}`], name, { type: 'application/pdf' });

let opened: Store[] = [];
afterEach(async () => {
  for (const s of opened) s.db.close();
  opened = [];
  await new Promise((r) => (indexedDB.deleteDatabase('fugloy').onsuccess = r));
});

/** The hash of a fake PDF is its second line, so a test can name a known scan's hash. */
function manuals(opts: { pages?: number; open?: () => Promise<Store | null> } = {}) {
  return createManuals({
    open:
      opts.open ??
      (async () => {
        const s = await openStore();
        if (s !== null) opened.push(s);
        return s;
      }),
    hash: async (bytes) => new TextDecoder().decode(bytes).split('\n')[1] ?? '',
    pageCount: async () => opts.pages ?? 3,
  });
}

describe('useManuals', () => {
  it('recognizes an archive.org scan by its SHA-256', async () => {
    const m = manuals();
    expect(await m.add(file(KNOWN))).toEqual({ ok: true, sourceId: 'm3-trm' });
    expect(m.list.value.find((e) => e.source.id === 'm3-trm')).toMatchObject({ have: true, scan: M3 });
    expect(m.list.value.find((e) => e.source.id === 'paay')?.have).toBe(false);
  });

  it('asks which manual an unknown PDF is', async () => {
    const r = await manuals().add(file('not a known scan'));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/which manual/i);
  });

  it('maps a cited printed page through the scan table', async () => {
    const m = manuals();
    await m.add(file(KNOWN));
    expect(await m.pdfPageFor({ source: 'm3-trm', page: '15' })).toBe(manualPage(M3, '15'));
    expect(manualPage(M3, '15')).toBe(26);
  });

  it('maps an unknown PDF by the offset the user set, numeric pages only', async () => {
    const m = manuals({ pages: 3 });
    expect(await m.add(file('my own scan'), 'm3-trm')).toEqual({ ok: true, sourceId: 'm3-trm' });
    expect(await m.pdfPageFor({ source: 'm3-trm', page: '15' })).toBeNull();
    await m.setOffset('m3-trm', 9);
    expect(await m.pdfPageFor({ source: 'm3-trm', page: '15' })).toBe(23);
    expect(await m.pdfPageFor({ source: 'm3-trm', page: '12/10' })).toBeNull();
    expect(m.mapping('m3-trm')).toBe('offset');
  });

  it('assumes the scan table for an unlisted PDF with the scan page count', async () => {
    const m = manuals({ pages: M3.pdfPages });
    await m.add(file('a rebuilt archive.org PDF'), 'm3-trm');
    expect(m.mapping('m3-trm')).toBe('assumed');
    expect(await m.pdfPageFor({ source: 'm3-trm', page: '15' })).toBe(26);
    expect(await m.pdfPageFor({ source: 'm3-trm', page: '12/10' })).toBe(manualPage(M3, '12/10'));
  });

  it('lets an offset the user set win over an assumed scan mapping', async () => {
    const m = manuals({ pages: M3.pdfPages });
    await m.add(file('a rebuilt archive.org PDF'), 'm3-trm');
    expect(m.mapping('m3-trm')).toBe('assumed');
    await m.setOffset('m3-trm', 9);
    expect(m.mapping('m3-trm')).toBe('offset');
    expect(await m.pdfPageFor({ source: 'm3-trm', page: '15' })).toBe(23);
    // A page the offset cannot place still finds the scan table's page.
    expect(await m.pdfPageFor({ source: 'm3-trm', page: '12/10' })).toBe(manualPage(M3, '12/10'));
  });

  it('reports a storage failure when setting an offset or removing', async () => {
    const failing = async (): Promise<Store | null> => {
      const s = (await openStore())!;
      opened.push(s);
      const quota = async (): Promise<never> => {
        throw new DOMException('over quota', 'QuotaExceededError');
      };
      return { ...s, db: s.db, putManual: quota, deleteManual: quota };
    };
    await manuals().add(file('mine'), 'paay');
    const m = manuals({ open: failing });
    await m.refresh();
    await expect(m.setOffset('paay', 3)).rejects.toThrow(/full/);
    await expect(m.remove('paay')).rejects.toThrow(/full/);
    expect(m.have('paay')).toBe(true);
  });

  it('forgets a removed manual', async () => {
    const m = manuals();
    await m.add(file(KNOWN));
    await m.remove('m3-trm');
    expect(m.list.value.find((e) => e.source.id === 'm3-trm')?.have).toBe(false);
    expect(await m.pdfPageFor({ source: 'm3-trm', page: '15' })).toBeNull();
    // A fresh instance reads what is stored.
    const again = manuals();
    await again.refresh();
    expect(again.list.value.find((e) => e.source.id === 'm3-trm')?.have).toBe(false);
  });

  it('keeps a manual across instances', async () => {
    await manuals().add(file(KNOWN));
    const again = manuals();
    await again.refresh();
    expect(again.have('m3-trm')).toBe(true);
    expect(await again.pdfPageFor({ source: 'm3-trm', page: '21' })).toBe(manualPage(M3, '21'));
  });

  it('explains why a manual cannot be added without storage', async () => {
    const r = await manuals({ open: async () => null }).add(file(KNOWN));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/storage is unavailable/i);
  });

  it('explains a full store', async () => {
    const full = async (): Promise<Store | null> => {
      const s = (await openStore())!;
      opened.push(s);
      return {
        ...s,
        db: s.db,
        putManual: async () => {
          throw new DOMException('over quota', 'QuotaExceededError');
        },
      };
    };
    const r = await manuals({ open: full }).add(file(KNOWN));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/full/i);
  });

  it('refuses a file that is not a PDF', async () => {
    const r = await manuals().add(new File(['hello'], 'x.pdf'), 'm3-trm');
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/not a PDF/) });
  });
});

describe('manual links and highlights', () => {
  it('builds archive.org reader and cover addresses', () => {
    expect(readerUrl('Model_III_Technical_Reference_Manual_1981_Tandy', 26)).toBe(
      'https://archive.org/details/Model_III_Technical_Reference_Manual_1981_Tandy/page/n25/mode/1up',
    );
    expect(coverUrl('abc')).toBe('https://archive.org/services/img/abc');
  });

  it('spells a port and an address the ways manuals print them', () => {
    expect(highlightTerms({ name: 'MODEPORT', key: 0xec, kind: 'port' })).toEqual(['MODEPORT', '0ECH', 'ECH', '$EC', "X'EC'", '&HEC']);
    const t = highlightTerms({ name: 'KBWAIT', key: 0x0049, kind: 'routine' });
    expect(t.slice(0, 3)).toEqual(['KBWAIT', '0049H', '$0049']);
    expect(t).not.toContain('73');
    expect(highlightTerms({ name: 'KEY', key: 0x4b9e, kind: 'routine' })).toEqual(['KEY', '4B9EH', '$4B9E', "X'4B9E'", '&H4B9E', '4B9E', '19358']);
    // Small keys get no bare-number forms: `40` would mark any 40 on the page.
    expect(highlightTerms({ name: 'X', key: 0x40, kind: 'variable' })).toEqual(['X', '0040H', '$0040', "X'0040'", '&H0040']);
    expect(highlightTerms({ name: 'P', key: 0x40, kind: 'port' })).toEqual(['P', '40H', '$40', "X'40'", '&H40']);
  });

  it('finds a term across stray spaces, at word boundaries only', () => {
    const items = [{ str: 'Port Address:' }, { str: '0EC H' }, { str: 'TECH' }];
    expect(findMatches(items, ['MODEPORT', '0ECH', 'ECH'])).toEqual({ term: '0ECH', hits: [{ item: 1, start: 0, end: 5 }] });
    expect(findMatches([{ str: 'TECHNICAL' }], ['ECH'])).toBeNull();
  });
});

describe('a citation without the manual', () => {
  it('shows the cover, the archive.org page, and Add this manual', async () => {
    const html = await renderToString(createSSRApp({ render: () => h(CitationMissing, { cite: { source: 'm3-trm', page: '15' } }) }));
    expect(html).toContain('https://archive.org/services/img/Model_III_Technical_Reference_Manual_1981_Tandy');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain('cover image from archive.org');
    expect(html).toContain('Open page 15 on archive.org');
    expect(html).toContain('/page/n25/mode/1up');
    expect(html).toContain('Add this manual');
  });
});
