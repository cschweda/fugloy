// The user's own manuals: PDFs they add, kept in this browser's IndexedDB
// (utils/store), never uploaded and never in a backup. A PDF is recognized as a
// known archive.org scan by its SHA-256, and cited printed pages map to PDF
// pages through that scan's table. Any other PDF is named by the user, and maps
// by the PDF page of printed page 1 they set, unless it has the scan's exact
// page count (archive.org rebuilds its derived PDFs, which changes the hash):
// then the scan table is used, marked as assumed. DOM-free; pdf.js is reached
// only through the injected page counter.
import { computed, ref, shallowRef } from 'vue';
import type { ComputedRef } from 'vue';
import { SYMBOL_SOURCES, manualPage, sha256Hex } from '@fugloy/disasm';
import type { Cite, ManualScan, Source } from '@fugloy/disasm';
import { looksLikePdf, scanByHash, scanOf } from '../utils/manuals';
import { openStore, requestPersistence } from '../utils/store';
import type { Store, StoredManual } from '../utils/store';

export type AddResult = { ok: true; sourceId: string } | { ok: false; reason: string };
/** How a stored manual's printed pages find PDF pages. */
export type Mapping = 'scan' | 'assumed' | 'offset' | 'unset';

export interface ManualEntry {
  source: Source;
  have: boolean;
  scan?: ManualScan;
}

export interface Manuals {
  list: ComputedRef<ManualEntry[]>;
  add(file: File, sourceId?: string): Promise<AddResult>;
  remove(id: string): Promise<void>;
  setOffset(id: string, pdfPageOfPrinted1: number): Promise<void>;
  pdfPageFor(cite: Cite): Promise<number | null>;
  have(id: string): boolean;
  mapping(id: string): Mapping;
  /** The stored PDF, for the viewer. */
  blob(id: string): Promise<Blob | null>;
  /** Re-reads what is stored. */
  refresh(): Promise<void>;
  /** Why the manuals cannot be stored here, once known; null when storage works. */
  unavailable: ComputedRef<string | null>;
}

export interface ManualsDeps {
  open?: () => Promise<Store | null>;
  /** SHA-256 of the file, lowercase hex. */
  hash?: (bytes: Uint8Array) => Promise<string>;
  /** The PDF's page count (pdf.js); null when it cannot be read. */
  pageCount?: (blob: Blob) => Promise<number | null>;
}

const NO_STORAGE = 'Browser storage is unavailable here (a private window, or storage turned off), so Fugløy cannot keep a manual. The workbench still works, and every citation still links to its page on archive.org.';

/** Web Crypto when there is one (fast, off the main thread); the library's own SHA-256 otherwise. */
async function defaultHash(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle !== undefined) {
    try {
      const d = new Uint8Array(await subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
      return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // fall through
    }
  }
  return sha256Hex(bytes);
}

async function defaultPageCount(blob: Blob): Promise<number | null> {
  try {
    const { loadPdf } = await import('../utils/pdf');
    const doc = await loadPdf(blob);
    const n = doc.numPages;
    void doc.loadingTask.destroy();
    return n;
  } catch {
    return null;
  }
}

function storeError(err: unknown): string {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  if (name === 'QuotaExceededError') return 'Your browser’s storage for this site is full, so the manual was not kept. Remove a manual you no longer need, or free space in the browser, and try again. The workbench keeps working.';
  return `Your browser refused to store the manual (${err instanceof Error ? err.message : String(err)}). The workbench keeps working, and citations still link to archive.org.`;
}

export function createManuals(deps: ManualsDeps = {}): Manuals {
  const open = deps.open ?? openStore;
  const hash = deps.hash ?? defaultHash;
  const pageCount = deps.pageCount ?? defaultPageCount;
  const store = shallowRef<Store | null | undefined>(undefined);
  /** What is stored, without the blobs: source id → its record's mapping facts. */
  const stored = ref<Record<string, Omit<StoredManual, 'blob'>>>({});
  let starting: Promise<Store | null> | null = null;

  function start(): Promise<Store | null> {
    starting ??= open().then(async (s) => {
      store.value = s;
      if (s !== null) await load(s);
      return s;
    });
    return starting;
  }

  async function load(s: Store): Promise<void> {
    const next: Record<string, Omit<StoredManual, 'blob'>> = {};
    try {
      for (const id of await s.manualIds()) {
        const m = await s.getManual(id);
        if (m !== undefined) {
          const { blob: _blob, ...facts } = m;
          next[id] = facts;
        }
      }
    } catch {
      // An unreadable store lists nothing.
    }
    stored.value = next;
  }

  function mapping(id: string): Mapping {
    const m = stored.value[id];
    if (m === undefined) return 'unset';
    const scan = scanOf(id);
    if (scan !== undefined && scan.pdfSha256.includes(m.sha256)) return 'scan';
    if (scan !== undefined && m.pdfPages === scan.pdfPages) return 'assumed';
    return m.offset === undefined ? 'unset' : 'offset';
  }

  async function add(file: File, sourceId?: string): Promise<AddResult> {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (err) {
      return { ok: false, reason: `${file.name} could not be read: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!looksLikePdf(bytes)) return { ok: false, reason: `${file.name} is not a PDF. Add a PDF of the manual.` };
    const sha = await hash(bytes);
    const known = scanByHash(sha);
    const id = known?.source ?? sourceId;
    if (id === undefined) return { ok: false, reason: `${file.name} is not one of the archive.org scans Fugløy knows. Which manual is it?` };
    if (!SYMBOL_SOURCES.some((s) => s.id === id)) return { ok: false, reason: `There is no manual called ${id}.` };
    const s = await start();
    if (s === null) return { ok: false, reason: NO_STORAGE };
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
    const record: StoredManual = { blob, sha256: sha, name: file.name, addedAt: Date.now() };
    if (known === undefined) {
      const n = await pageCount(blob);
      if (n !== null) record.pdfPages = n;
    } else record.pdfPages = known.pdfPages;
    try {
      await s.putManual(id, record);
    } catch (err) {
      return { ok: false, reason: storeError(err) };
    }
    void requestPersistence();
    const { blob: _blob, ...facts } = record;
    stored.value = { ...stored.value, [id]: facts };
    return { ok: true, sourceId: id };
  }

  async function remove(id: string): Promise<void> {
    const s = await start();
    if (s !== null) await s.deleteManual(id);
    const { [id]: _gone, ...rest } = stored.value;
    stored.value = rest;
  }

  async function setOffset(id: string, pdfPageOfPrinted1: number): Promise<void> {
    const s = await start();
    if (s === null) return;
    const m = await s.getManual(id);
    if (m === undefined) return;
    const next = { ...m, offset: pdfPageOfPrinted1 };
    await s.putManual(id, next);
    const { blob: _blob, ...facts } = next;
    stored.value = { ...stored.value, [id]: facts };
  }

  async function pdfPageFor(cite: Cite): Promise<number | null> {
    await start();
    const m = stored.value[cite.source];
    if (m === undefined) return null;
    const how = mapping(cite.source);
    const scan = scanOf(cite.source);
    if ((how === 'scan' || how === 'assumed') && scan !== undefined) {
      const p = manualPage(scan, cite.page);
      if (p !== null) return p;
    }
    if (m.offset !== undefined && /^\d+$/.test(cite.page)) return Number(cite.page) + m.offset - 1;
    return null;
  }

  async function blob(id: string): Promise<Blob | null> {
    const s = await start();
    if (s === null) return null;
    return (await s.getManual(id))?.blob ?? null;
  }

  const list = computed<ManualEntry[]>(() =>
    SYMBOL_SOURCES.map((source) => {
      const scan = scanOf(source.id);
      return { source, have: stored.value[source.id] !== undefined, ...(scan === undefined ? {} : { scan }) };
    }),
  );

  return {
    list,
    add,
    remove,
    setOffset,
    pdfPageFor,
    have: (id) => stored.value[id] !== undefined,
    mapping,
    blob,
    async refresh() {
      const s = await start();
      if (s !== null) await load(s);
    },
    unavailable: computed(() => (store.value === null ? NO_STORAGE : null)),
  };
}

let shared: Manuals | null = null;

/** The page's manuals (one per app). */
export function useManuals(): Manuals {
  shared ??= createManuals();
  return shared;
}
