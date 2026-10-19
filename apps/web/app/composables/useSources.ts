// The user's Z80 sources, written in the Source tab (plan 5B, Ruling 11):
// several, each with a name, its text and the model it is written for, kept in
// this browser's IndexedDB (utils/store) and carried by a backup. An edit saves
// 500 ms after typing stops, and on leave (flush); a save that fails stays
// pending, is retried by the next flush, and `saveError` says why. Writes of
// one source run one after another, so a removed source cannot come back. The
// list is in name order, so it stays still while the user types. A new source is the starter,
// asm's clear-screen.z, on the Model III. With no storage the sources live in
// memory only, and `unavailable` says so. DOM-free.
import { computed, ref, shallowRef } from 'vue';
import type { ComputedRef, Ref, ShallowRef } from 'vue';
import { freeName, newSourceId } from '../utils/source-names';
import { openStoreDetailed, requestPersistence, STORE_BLOCKED } from '../utils/store';
import type { ModelId, Store, StoredSource } from '../utils/store';

export type Source = StoredSource;

export const SOURCE_SAVE_DELAY_MS = 500;
/** The starter's name: asm's examples/clear-screen.z. */
export const STARTER_NAME = 'clear-screen.z';

export interface Sources {
  /** Every source, in name order. */
  list: ComputedRef<Source[]>;
  current: ComputedRef<Source | null>;
  /** Makes a source (the starter unless `text` is given, on the Model III unless `model` is), saves it, and makes it current. */
  create(opts?: { name?: string; text?: string; model?: ModelId }): Promise<Source>;
  select(id: string): Promise<void>;
  /** Changes the text or model at once; the save follows 500 ms after the last change. */
  update(id: string, patch: Partial<Pick<Source, 'text' | 'model'>>): void;
  /** Renames; null when done, else a sentence saying why not. */
  rename(id: string, name: string): Promise<string | null>;
  remove(id: string): Promise<void>;
  /** Writes every change still waiting out its delay. */
  flush(): Promise<void>;
  /** Opens the store and reads the sources; safe to call again. */
  start(): Promise<Store | null>;
  /** Re-reads what is stored, as after a restore. */
  refresh(): Promise<void>;
  /** Why the sources cannot be kept here, once known; null when storage works. */
  unavailable: ComputedRef<string | null>;
  /** Why the last save failed, as a sentence; null once every change is stored. */
  saveError: Ref<string | null>;
  /** The store, once opened; null when storage is unavailable; undefined while opening. */
  store: ShallowRef<Store | null | undefined>;
}

export interface SourcesDeps {
  open?: () => Promise<Store | 'blocked' | null>;
  /** The starter's text (loaded on first use, so it stays off the first screen). */
  starter?: () => Promise<string>;
}

const NO_STORAGE = 'Browser storage is unavailable here (a private window, or storage turned off), so Fugløy cannot keep a source after you leave. Copy your program somewhere safe before you close the page.';

/** Why a write failed, as a sentence with the next step. */
function saveSentence(err: unknown): string {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  if (name === 'StoreClosedError') return (err as Error).message;
  if (name === 'QuotaExceededError') return 'Your browser’s storage for this site is full, so your latest changes to the source are not saved. Remove a manual or a ROM you no longer need, or free space in the browser; Fugløy tries again on the next change.';
  return `Your browser refused to save the source (${err instanceof Error ? err.message : String(err)}), so your latest changes are not stored. Fugløy tries again on the next change; reload the page if this keeps happening.`;
}

const loadStarter = async (): Promise<string> => (await import('@fugloy/asm-examples/clear-screen.z?raw')).default;

export function createSources(deps: SourcesDeps = {}): Sources {
  const open = deps.open ?? (() => openStoreDetailed());
  const starter = deps.starter ?? loadStarter;
  const store = shallowRef<Store | null | undefined>(undefined);
  const byId = ref<Record<string, Source>>({});
  const currentId = ref<string | null>(null);
  const blocked = ref(false);
  const saveError = ref<string | null>(null);
  /** Sources with a change waiting out the delay, and their timers. */
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Sources with changes not yet stored (waiting, being written, or failed), by their change count. */
  const dirty = new Map<string, number>();
  /** Sources whose last write failed. */
  const failed = new Set<string>();
  /** Each source's chain of writes: one at a time, in order. */
  const chains = new Map<string, Promise<void>>();
  let starting: Promise<Store | null> | null = null;

  async function load(s: Store): Promise<void> {
    try {
      const all = await s.allSources();
      byId.value = Object.fromEntries(all.map((x) => [x.id, x]));
      const id = await s.getCurrentSource();
      currentId.value = id !== null && byId.value[id] !== undefined ? id : (newest()?.id ?? null);
    } catch {
      // An unreadable store lists nothing.
    }
  }

  function start(): Promise<Store | null> {
    starting ??= open().then(async (r) => {
      blocked.value = r === 'blocked';
      const s = r === 'blocked' ? null : r;
      store.value = s;
      if (s !== null) await load(s);
      return s;
    });
    return starting;
  }

  const list = computed(() => Object.values(byId.value).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id)));
  /** The most recently saved source, for a current source that is gone. */
  const newest = (): Source | undefined => Object.values(byId.value).reduce<Source | undefined>((best, x) => (best === undefined || x.savedAt > best.savedAt ? x : best), undefined);
  const current = computed(() => (currentId.value === null ? null : (byId.value[currentId.value] ?? null)));

  /** Queues a write of one source as it is now, after any write of it already under way. */
  function write(id: string): Promise<void> {
    const prev = chains.get(id) ?? Promise.resolve();
    const next = prev.then(async () => {
      const src = byId.value[id];
      const s = store.value;
      // Removed meanwhile: nothing to write, so it cannot come back.
      if (src === undefined) return;
      if (s === null || s === undefined) {
        dirty.delete(id);
        return;
      }
      const rev = dirty.get(id);
      try {
        await s.putSource(src);
        // A change made during the write keeps the source dirty.
        if (dirty.get(id) === rev) dirty.delete(id);
        failed.delete(id);
        if (failed.size === 0) saveError.value = null;
      } catch (err) {
        // Removed while the write was under way: its failure no longer matters.
        if (byId.value[id] === undefined) return;
        failed.add(id);
        saveError.value = saveSentence(err);
      }
    });
    chains.set(id, next);
    void next.finally(() => {
      if (chains.get(id) === next) chains.delete(id);
    });
    return next;
  }

  function markDirty(id: string): void {
    dirty.set(id, (dirty.get(id) ?? 0) + 1);
  }

  async function writeCurrent(): Promise<void> {
    const s = store.value;
    if (s === null || s === undefined) return;
    try {
      await s.putCurrentSource(currentId.value);
    } catch {
      // Only which source opens next time is lost.
    }
  }

  function takenNames(except?: string): Set<string> {
    return new Set(list.value.filter((x) => x.id !== except).map((x) => x.name));
  }

  async function create(opts: { name?: string; text?: string; model?: ModelId } = {}): Promise<Source> {
    await start();
    const text = opts.text ?? (await starter());
    const name = freeName(opts.name ?? (opts.text === undefined ? STARTER_NAME : 'program.z'), takenNames());
    const src: Source = { id: newSourceId(), name, text, model: opts.model ?? 3, savedAt: Date.now() };
    byId.value = { ...byId.value, [src.id]: src };
    currentId.value = src.id;
    markDirty(src.id);
    await write(src.id);
    await writeCurrent();
    if (store.value) void requestPersistence();
    return src;
  }

  async function select(id: string): Promise<void> {
    if (byId.value[id] === undefined) return;
    currentId.value = id;
    await writeCurrent();
  }

  function update(id: string, patch: Partial<Pick<Source, 'text' | 'model'>>): void {
    const src = byId.value[id];
    if (src === undefined) return;
    byId.value = { ...byId.value, [id]: { ...src, ...patch, savedAt: Date.now() } };
    markDirty(id);
    const t = timers.get(id);
    if (t !== undefined) clearTimeout(t);
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        void write(id);
      }, SOURCE_SAVE_DELAY_MS),
    );
  }

  async function rename(id: string, name: string): Promise<string | null> {
    const src = byId.value[id];
    if (src === undefined) return 'That source is gone. Pick another one from the list.';
    const trimmed = name.trim();
    if (trimmed === '') return 'A source needs a name. Type one, such as game.z.';
    if (takenNames(id).has(trimmed)) return `${trimmed} is already the name of another source. Pick a different name.`;
    byId.value = { ...byId.value, [id]: { ...src, name: trimmed } };
    markDirty(id);
    await write(id);
    return null;
  }

  async function remove(id: string): Promise<void> {
    const t = timers.get(id);
    if (t !== undefined) clearTimeout(t);
    timers.delete(id);
    dirty.delete(id);
    failed.delete(id);
    if (failed.size === 0) saveError.value = null;
    const { [id]: _gone, ...rest } = byId.value;
    byId.value = rest;
    // A write already under way finishes before the delete, so it cannot land after it.
    await chains.get(id);
    const s = store.value;
    if (s !== null && s !== undefined) {
      try {
        await s.deleteSource(id);
      } catch (err) {
        throw new Error(`Your browser refused the change, so the source was not removed (${err instanceof Error ? err.message : String(err)}). Reload the page and try again.`);
      }
    }
    if (currentId.value === id) {
      currentId.value = newest()?.id ?? null;
      await writeCurrent();
    }
  }

  /** Writes every source with unsaved changes: waiting out the delay, or failed before. */
  async function flush(): Promise<void> {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    await Promise.all([...dirty.keys()].map(write));
  }

  return {
    list,
    current,
    create,
    select,
    update,
    rename,
    remove,
    flush,
    start,
    async refresh() {
      await flush();
      const s = await start();
      if (s !== null) await load(s);
    },
    unavailable: computed(() => (store.value === null ? (blocked.value ? STORE_BLOCKED : NO_STORAGE) : null)),
    saveError,
    store,
  };
}

let shared: Sources | null = null;

/** The page's sources (one per app). */
export function useSources(): Sources {
  shared ??= createSources();
  return shared;
}
