// The browser's own storage for the user's work: one IndexedDB database,
// `fugloy`, holding hint files and per-program machine and DOS settings, keyed
// by the program's SHA-256; the user's manuals, keyed by source id; (from
// version 2, phase 5B) the user's Z80 sources, keyed by their id, and the ROMs
// they added, keyed by model. Nothing here leaves the machine. When IndexedDB is missing or refuses (a private
// window), openStore() gives null and the workbench carries on without saving.
import type { SymbolSelection } from '@fugloy/disasm';
import type { Sources } from '../composables/useSources';

export type Machine = SymbolSelection['machine'];
export type Dos = SymbolSelection['dos'];

export interface SavedHints {
  name: string;
  text: string;
  savedAt: number;
}

export interface Prefs {
  machine: Machine;
  dos: Dos;
}

/** A manual the user added, keyed by its source id. Never leaves the browser, never in a backup. */
export interface StoredManual {
  blob: Blob;
  /** The PDF's SHA-256, lowercase hex. */
  sha256: string;
  /** The file name it was added as. */
  name: string;
  /** For a PDF that is not a known scan: the PDF page that holds printed page 1. */
  offset?: number;
  /** The PDF's page count, when known (it decides whether an unlisted PDF may use the scan table). */
  pdfPages?: number;
  addedAt: number;
}

/** A TRS-80 model the emulator builds: the Model I, III or 4. */
export type ModelId = 1 | 3 | 4;

/** A Z80 source the user writes in the Source tab (plan 5B, Ruling 11). Goes in a backup. */
export interface StoredSource {
  id: string;
  name: string;
  text: string;
  /** The model it is written for: it assembles and runs for this one (Ruling 7). */
  model: ModelId;
  savedAt: number;
}

/** A ROM the user added, keyed by model (Ruling 6). Never leaves the browser, never in a backup. */
export interface StoredRom {
  bytes: Uint8Array;
  /** The ROM's SHA-256, lowercase hex. */
  sha256: string;
  /** emu's ROM_HASHES name for it (`model3-rev-c-2ef8`); null for a ROM Fugløy does not know. */
  recognized: string | null;
  /** The file name it was added as. */
  name: string;
  addedAt: number;
}

export interface Store {
  getHints(hash: string): Promise<SavedHints | undefined>;
  putHints(hash: string, value: { name: string; text: string }): Promise<void>;
  allHints(): Promise<{ hash: string; name: string; text: string }[]>;
  getPrefs(hash: string): Promise<Prefs | undefined>;
  allPrefs(): Promise<{ hash: string; prefs: Prefs }[]>;
  putPrefs(hash: string, prefs: Prefs): Promise<void>;
  /** Forgets one program: its hints and its settings. */
  deleteProgram(hash: string): Promise<void>;
  getManual(id: string): Promise<StoredManual | undefined>;
  putManual(id: string, value: StoredManual): Promise<void>;
  deleteManual(id: string): Promise<void>;
  /** The source ids of the stored manuals. */
  manualIds(): Promise<string[]>;
  allSources(): Promise<StoredSource[]>;
  putSource(source: StoredSource): Promise<void>;
  deleteSource(id: string): Promise<void>;
  /** The id of the source last open in the Source tab; null when none. */
  getCurrentSource(): Promise<string | null>;
  putCurrentSource(id: string | null): Promise<void>;
  getRom(model: ModelId): Promise<StoredRom | undefined>;
  putRom(model: ModelId, rom: StoredRom): Promise<void>;
  deleteRom(model: ModelId): Promise<void>;
  /** The models that have a ROM stored. */
  romModels(): Promise<ModelId[]>;
  /** The open database. */
  readonly db: IDBDatabase;
  /** True once another tab's upgrade closed this connection; every call then throws StoreClosedError. */
  readonly closed: boolean;
}

export const DB_NAME = 'fugloy';
/** Version 1 (the 1.x site): hints, prefs, manuals. Version 2 adds sources and roms. */
export const DB_VERSION = 2;
const STORES = ['hints', 'prefs', 'manuals', 'sources', 'roms'] as const;
type StoreName = (typeof STORES)[number];

/** How long to wait for other tabs to let go of an older version of the database before giving up. */
export const BLOCKED_WAIT_MS = 3000;

/** The sentence for a database another Fugløy tab, still on an older version of the site, holds open. */
export const STORE_BLOCKED = 'Another Fugløy tab, still running an older version of the site, is holding your saved work open, so this tab cannot reach it. Close the other Fugløy tabs, then reload this page.';

/** Thrown by every call on a store whose connection closed because another tab upgraded the database. */
export class StoreClosedError extends Error {
  constructor() {
    super('Fugløy was updated in another tab, so this tab can no longer save. Reload this page to keep saving.');
    this.name = 'StoreClosedError';
  }
}
/** The key, in the sources store, of the current source's id; source ids never start with a colon. */
const CURRENT = ':current';

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function make(db: IDBDatabase): Store {
  let closed = false;
  // Another tab opening a newer version asks this one to step aside, so its upgrade is not blocked.
  // From then on this connection is dead: every call fails with StoreClosedError's sentence.
  db.onversionchange = () => {
    closed = true;
    db.close();
  };
  const t = (names: StoreName | StoreName[], mode?: IDBTransactionMode): IDBTransaction => {
    if (closed) throw new StoreClosedError();
    return db.transaction(names, mode);
  };
  async function put(name: StoreName, value: unknown, key: IDBValidKey): Promise<void> {
    const tx = t(name, 'readwrite');
    tx.objectStore(name).put(value, key);
    await done(tx);
  }
  async function del(name: StoreName, key: IDBValidKey): Promise<void> {
    const tx = t(name, 'readwrite');
    tx.objectStore(name).delete(key);
    await done(tx);
  }
  return {
    db,
    get closed() {
      return closed;
    },
    getHints: async (hash) => wrap<SavedHints | undefined>(t('hints').objectStore('hints').get(hash)),
    async putHints(hash, value) {
      const tx = t('hints', 'readwrite');
      tx.objectStore('hints').put({ name: value.name, text: value.text, savedAt: Date.now() } satisfies SavedHints, hash);
      await done(tx);
    },
    async allHints() {
      const os = t('hints').objectStore('hints');
      const [keys, values] = await Promise.all([wrap(os.getAllKeys()), wrap<SavedHints[]>(os.getAll())]);
      return keys.map((k, i) => ({ hash: String(k), name: values[i]!.name, text: values[i]!.text }));
    },
    getPrefs: async (hash) => wrap<Prefs | undefined>(t('prefs').objectStore('prefs').get(hash)),
    async allPrefs() {
      const os = t('prefs').objectStore('prefs');
      const [keys, values] = await Promise.all([wrap(os.getAllKeys()), wrap<Prefs[]>(os.getAll())]);
      return keys.map((k, i) => ({ hash: String(k), prefs: values[i]! }));
    },
    async putPrefs(hash, prefs) {
      const tx = t('prefs', 'readwrite');
      tx.objectStore('prefs').put({ machine: prefs.machine, dos: prefs.dos } satisfies Prefs, hash);
      await done(tx);
    },
    getManual: async (id) => wrap<StoredManual | undefined>(t('manuals').objectStore('manuals').get(id)),
    async putManual(id, value) {
      const tx = t('manuals', 'readwrite');
      tx.objectStore('manuals').put(value, id);
      await done(tx);
    },
    async deleteManual(id) {
      const tx = t('manuals', 'readwrite');
      tx.objectStore('manuals').delete(id);
      await done(tx);
    },
    manualIds: async () => (await wrap(t('manuals').objectStore('manuals').getAllKeys())).map(String),
    async allSources() {
      // Keys and values in one transaction, in the same order; the current source's id is kept under its own key.
      const os = t('sources').objectStore('sources');
      const [keys, values] = await Promise.all([wrap(os.getAllKeys()), wrap<StoredSource[]>(os.getAll())]);
      return values.filter((_, i) => keys[i] !== CURRENT);
    },
    putSource: (source) => put('sources', { id: source.id, name: source.name, text: source.text, model: source.model, savedAt: source.savedAt } satisfies StoredSource, source.id),
    deleteSource: (id) => del('sources', id),
    async getCurrentSource() {
      const v = await wrap<{ id: string } | undefined>(t('sources').objectStore('sources').get(CURRENT));
      return v?.id ?? null;
    },
    putCurrentSource: (id) => (id === null ? del('sources', CURRENT) : put('sources', { id }, CURRENT)),
    getRom: async (model) => wrap<StoredRom | undefined>(t('roms').objectStore('roms').get(model)),
    putRom: (model, rom) => put('roms', rom, model),
    deleteRom: (model) => del('roms', model),
    romModels: async () => (await wrap(t('roms').objectStore('roms').getAllKeys())).map((k) => Number(k) as ModelId),
    async deleteProgram(hash) {
      const tx = t(['hints', 'prefs'], 'readwrite');
      tx.objectStore('hints').delete(hash);
      tx.objectStore('prefs').delete(hash);
      await done(tx);
    },
  };
}

/**
 * Opens (creating or upgrading, the first time) the database. 'blocked' when another tab holds an
 * older version open for longer than `blockedMs` (STORE_BLOCKED says what to do); null when
 * IndexedDB is unavailable or refuses to open.
 */
export function openStoreDetailed(opts: { blockedMs?: number } = {}): Promise<Store | 'blocked' | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: Store | 'blocked' | null): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    try {
      if (typeof indexedDB === 'undefined' || indexedDB === null) return finish(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      let timer: ReturnType<typeof setTimeout> | null = null;
      req.onupgradeneeded = () => {
        for (const name of STORES) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
      };
      req.onblocked = () => {
        timer ??= setTimeout(() => finish('blocked'), opts.blockedMs ?? BLOCKED_WAIT_MS);
      };
      req.onsuccess = () => {
        if (timer !== null) clearTimeout(timer);
        // Opened after this caller gave up: let go, so the connection blocks nobody.
        if (settled) req.result.close();
        else finish(make(req.result));
      };
      req.onerror = () => {
        if (timer !== null) clearTimeout(timer);
        finish(null);
      };
    } catch {
      finish(null);
    }
  });
}

let blocked = false;

/** True when the last open gave up because another tab held an older version of the database (STORE_BLOCKED). */
export function storeBlocked(): boolean {
  return blocked;
}

/** Opens the database; null when it is unavailable or blocked (storeBlocked() tells which). */
export async function openStore(): Promise<Store | null> {
  const r = await openStoreDetailed();
  blocked = r === 'blocked';
  return r === 'blocked' ? null : r;
}

let asked: Promise<boolean> | null = null;

/** Asks the browser not to evict the stored work. Asks once per visit; false when it cannot or the browser declines. */
export function requestPersistence(): Promise<boolean> {
  asked ??= (async () => {
    try {
      return (await navigator.storage?.persist?.()) ?? false;
    } catch {
      return false;
    }
  })();
  return asked;
}

/**
 * The Source tab's sources once loaded (composables/useSources sets this; they load on first use,
 * off the first screen). The layout's flush on leave and a backup reach them through
 * `loadedSources`; before they load nothing can be unsaved, so there is nothing to reach. It lives
 * here because both sides already import this module, so it costs the first screen no file.
 */
export const sourcesSlot: { value: Sources | null } = { value: null };

/** The page's sources if they are loaded, without loading them. */
export const loadedSources = (): Sources | null => sourcesSlot.value;
