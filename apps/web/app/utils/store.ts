// The browser's own storage for the user's work: one IndexedDB database,
// `fugloy`, holding hint files and per-program machine and DOS settings, keyed
// by the program's SHA-256 (and, from Task 16, the user's manuals). Nothing
// here leaves the machine. When IndexedDB is missing or refuses (a private
// window), openStore() gives null and the workbench carries on without saving.
import type { SymbolSelection } from '@fugloy/disasm';

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

export interface Store {
  getHints(hash: string): Promise<SavedHints | undefined>;
  putHints(hash: string, value: { name: string; text: string }): Promise<void>;
  allHints(): Promise<{ hash: string; name: string; text: string }[]>;
  getPrefs(hash: string): Promise<Prefs | undefined>;
  allPrefs(): Promise<{ hash: string; prefs: Prefs }[]>;
  putPrefs(hash: string, prefs: Prefs): Promise<void>;
  /** Forgets one program: its hints and its settings. */
  deleteProgram(hash: string): Promise<void>;
  /** The open database, for the manuals store (Task 16). */
  readonly db: IDBDatabase;
}

export const DB_NAME = 'fugloy';
const STORES = ['hints', 'prefs', 'manuals'] as const;

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
  return {
    db,
    getHints: (hash) => wrap<SavedHints | undefined>(db.transaction('hints').objectStore('hints').get(hash)),
    async putHints(hash, value) {
      const tx = db.transaction('hints', 'readwrite');
      tx.objectStore('hints').put({ name: value.name, text: value.text, savedAt: Date.now() } satisfies SavedHints, hash);
      await done(tx);
    },
    async allHints() {
      const os = db.transaction('hints').objectStore('hints');
      const [keys, values] = await Promise.all([wrap(os.getAllKeys()), wrap<SavedHints[]>(os.getAll())]);
      return keys.map((k, i) => ({ hash: String(k), name: values[i]!.name, text: values[i]!.text }));
    },
    getPrefs: (hash) => wrap<Prefs | undefined>(db.transaction('prefs').objectStore('prefs').get(hash)),
    async allPrefs() {
      const os = db.transaction('prefs').objectStore('prefs');
      const [keys, values] = await Promise.all([wrap(os.getAllKeys()), wrap<Prefs[]>(os.getAll())]);
      return keys.map((k, i) => ({ hash: String(k), prefs: values[i]! }));
    },
    async putPrefs(hash, prefs) {
      const tx = db.transaction('prefs', 'readwrite');
      tx.objectStore('prefs').put({ machine: prefs.machine, dos: prefs.dos } satisfies Prefs, hash);
      await done(tx);
    },
    async deleteProgram(hash) {
      const tx = db.transaction(['hints', 'prefs'], 'readwrite');
      tx.objectStore('hints').delete(hash);
      tx.objectStore('prefs').delete(hash);
      await done(tx);
    },
  };
}

/** Opens (creating, the first time) the database; null when IndexedDB is unavailable or refuses to open. */
export async function openStore(): Promise<Store | null> {
  try {
    if (typeof indexedDB === 'undefined' || indexedDB === null) return null;
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const name of STORES) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
    };
    return make(await wrap(req));
  } catch {
    return null;
  }
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
