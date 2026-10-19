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
import { SYMBOL_SOURCES, manualPage } from '@fugloy/disasm';
import type { Cite, ManualScan, Source } from '@fugloy/disasm';
import { sha256 } from '../utils/hash';
import { looksLikePdf, scanByHash, scanOf } from '../utils/manuals';
import { openStore, requestPersistence, STORE_BLOCKED, storeBlocked } from '../utils/store';
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

/** Why nothing can be stored: another tab holds the database, or there is no storage. */
const noStorage = (): string => (storeBlocked() ? STORE_BLOCKED : NO_STORAGE);

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

/** Why a write failed, for what was being done: adding the manual, saving its offset, or removing it. */
function storeError(err: unknown, doing: 'add' | 'offset' | 'remove' = 'add'): string {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  const what = { add: 'the manual was not kept', offset: 'the page offset was not saved', remove: 'the manual was not removed' }[doing];
  if (name === 'StoreClosedError') return (err as Error).message;
  if (name === 'QuotaExceededError') return `Your browser’s storage for this site is full, so ${what}. Remove a manual you no longer need, or free space in the browser, and try again. The workbench keeps working.`;
  return `Your browser refused the change, so ${what} (${err instanceof Error ? err.message : String(err)}). The workbench keeps working, and citations still link to archive.org.`;
}

export function createManuals(deps: ManualsDeps = {}): Manuals {
  const open = deps.open ?? openStore;
  const hash = deps.hash ?? sha256;
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
    // An offset the user set beats a mapping only assumed from the page count.
    if (m.offset !== undefined) return 'offset';
    if (scan !== undefined && m.pdfPages === scan.pdfPages) return 'assumed';
    return 'unset';
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
    if (s === null) return { ok: false, reason: noStorage() };
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
    if (s !== null) {
      try {
        await s.deleteManual(id);
      } catch (err) {
        throw new Error(storeError(err, 'remove'));
      }
    }
    const { [id]: _gone, ...rest } = stored.value;
    stored.value = rest;
  }

  async function setOffset(id: string, pdfPageOfPrinted1: number): Promise<void> {
    const s = await start();
    if (s === null) throw new Error(noStorage());
    const next = await (async () => {
      try {
        const m = await s.getManual(id);
        if (m === undefined) return undefined;
        const n = { ...m, offset: pdfPageOfPrinted1 };
        await s.putManual(id, n);
        return n;
      } catch (err) {
        throw new Error(storeError(err, 'offset'));
      }
    })();
    if (next === undefined) return;
    const { blob: _blob, ...facts } = next;
    stored.value = { ...stored.value, [id]: facts };
  }

  async function pdfPageFor(cite: Cite): Promise<number | null> {
    await start();
    const m = stored.value[cite.source];
    if (m === undefined) return null;
    const scan = scanOf(cite.source);
    const table = (): number | null => (scan === undefined ? null : manualPage(scan, cite.page));
    // A known scan: its table. Otherwise the user's offset for plain page numbers,
    // then the scan table when the page count matches (assumed).
    if (scan !== undefined && scan.pdfSha256.includes(m.sha256)) return table();
    if (m.offset !== undefined && /^\d+$/.test(cite.page)) return Number(cite.page) + m.offset - 1;
    if (scan !== undefined && m.pdfPages === scan.pdfPages) return table();
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
    unavailable: computed(() => (store.value === null ? noStorage() : null)),
  };
}

let shared: Manuals | null = null;

/** The page's manuals (one per app). */
export function useManuals(): Manuals {
  shared ??= createManuals();
  return shared;
}
