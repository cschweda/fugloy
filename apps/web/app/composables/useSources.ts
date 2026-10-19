// The user's Z80 sources, written in the Source tab (plan 5B, Ruling 11):
// several, each with a name, its text and the model it is written for, kept in
// this browser's IndexedDB (utils/store) and carried by a backup. An edit saves
// 500 ms after typing stops, and on leave (flush). A new source is the starter,
// asm's clear-screen.z, on the Model III. With no storage the sources live in
// memory only, and `unavailable` says so. DOM-free.
import { computed, ref, shallowRef } from 'vue';
import type { ComputedRef, Ref, ShallowRef } from 'vue';
import { freeName, newSourceId } from '../utils/source-names';
import { openStore, requestPersistence } from '../utils/store';
import type { ModelId, Store, StoredSource } from '../utils/store';

export type Source = StoredSource;

export const SOURCE_SAVE_DELAY_MS = 500;
/** The starter's name: asm's examples/clear-screen.z. */
export const STARTER_NAME = 'clear-screen.z';

export interface Sources {
  /** Every source, the most recently saved first. */
  list: ComputedRef<Source[]>;
  current: Ref<Source | null>;
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
  /** The store, once opened; null when storage is unavailable; undefined while opening. */
  store: ShallowRef<Store | null | undefined>;
}

export interface SourcesDeps {
  open?: () => Promise<Store | null>;
  /** The starter's text (loaded on first use, so it stays off the first screen). */
  starter?: () => Promise<string>;
}

const NO_STORAGE = 'Browser storage is unavailable here (a private window, or storage turned off), so Fugløy cannot keep a source after you leave. Copy your program somewhere safe before you close the page.';

const loadStarter = async (): Promise<string> => (await import('@fugloy/asm-examples/clear-screen.z?raw')).default;

export function createSources(deps: SourcesDeps = {}): Sources {
  const open = deps.open ?? openStore;
  const starter = deps.starter ?? loadStarter;
  const store = shallowRef<Store | null | undefined>(undefined);
  const byId = ref<Record<string, Source>>({});
  const currentId = ref<string | null>(null);
  /** Sources with a change waiting out the delay, and their timers. */
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
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
    starting ??= open().then(async (s) => {
      store.value = s;
      if (s !== null) await load(s);
      return s;
    });
    return starting;
  }

  const list = computed(() => Object.values(byId.value).sort((a, b) => b.savedAt - a.savedAt));
  const newest = (): Source | undefined => list.value[0];
  const current = computed(() => (currentId.value === null ? null : (byId.value[currentId.value] ?? null)));

  /** Writes one source now; a failed write is retried by the next change or flush. */
  async function write(id: string): Promise<void> {
    const src = byId.value[id];
    const s = store.value;
    if (src === undefined || s === null || s === undefined) return;
    try {
      await s.putSource(src);
    } catch {
      // Kept in memory; the next save tries again.
    }
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
    await write(id);
    return null;
  }

  async function remove(id: string): Promise<void> {
    const t = timers.get(id);
    if (t !== undefined) clearTimeout(t);
    timers.delete(id);
    const { [id]: _gone, ...rest } = byId.value;
    byId.value = rest;
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

  async function flush(): Promise<void> {
    const ids = [...timers.keys()];
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    await Promise.all(ids.map(write));
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
    unavailable: computed(() => (store.value === null ? NO_STORAGE : null)),
    store,
  };
}

let shared: Sources | null = null;

/** The page's sources (one per app). */
export function useSources(): Sources {
  shared ??= createSources();
  return shared;
}
