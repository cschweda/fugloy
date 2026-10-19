// The user's own ROMs, one per model, kept in this browser's IndexedDB
// (utils/store), never uploaded, never fetched and never in a backup (plan 5B,
// Ruling 6). A ROM Fugløy knows is recognised by its SHA-256 (emu's
// ROM_HASHES), whose name gives its model, whatever the file is called. Any
// other file is kept only at a size its model takes, for the model the user
// picks, and marked as not recognised. DOM-free.
import { computed, ref, shallowRef } from 'vue';
import type { ComputedRef } from 'vue';
import { sha256 } from '../utils/hash';
import { openStoreDetailed, requestPersistence, STORE_BLOCKED } from '../utils/store';
import type { ModelId, Store, StoredRom } from '../utils/store';

export type AddRomResult = { ok: true; model: ModelId } | { ok: false; reason: string };

export interface RomInfo {
  /** The file name it was added as. */
  name: string;
  sha256: string;
  /** emu's ROM_HASHES name; null for a ROM Fugløy does not know. */
  recognized: string | null;
}

export interface Roms {
  have(model: ModelId): boolean;
  info(model: ModelId): RomInfo | null;
  bytes(model: ModelId): Promise<Uint8Array | null>;
  /** Adds a ROM: to its own model when recognised (refused for another), else to `model` at a size it takes. */
  add(file: File, model?: ModelId): Promise<AddRomResult>;
  remove(model: ModelId): Promise<void>;
  /** Opens the store and reads what is in it; safe to call again. */
  start(): Promise<Store | null>;
  /** Why ROMs cannot be kept here, once known; null when storage works. */
  unavailable: ComputedRef<string | null>;
}

export interface RomIds {
  ROM_SIZES: Readonly<Record<ModelId, readonly number[]>>;
  MODEL_NAMES: Readonly<Record<ModelId, string>>;
  recognise(sha256: string): { name: string; model: ModelId } | null;
}

export interface RomsDeps {
  open?: () => Promise<Store | 'blocked' | null>;
  /** SHA-256 of the file, lowercase hex. */
  hash?: (bytes: Uint8Array) => Promise<string>;
  /** What is known about ROMs (utils/emulator/rom-ids, which brings emu's hash table: loaded on first add). */
  ids?: () => Promise<RomIds>;
}

const NO_STORAGE = 'Browser storage is unavailable here (a private window, or storage turned off), so Fugløy cannot keep a ROM. Programs that do not call the ROM still run without one.';

const n = (v: number): string => v.toLocaleString('en-US');
const bytesText = (sizes: readonly number[]): string => `${sizes.map(n).join(' or ')} bytes`;

function wrongSize(name: string, size: number, sizes: RomIds['ROM_SIZES']): string {
  return `${name} is ${n(size)} bytes, which no TRS-80 ROM is: the Model I’s is ${bytesText(sizes[1])}, and the Model III’s and Model 4’s ${bytesText(sizes[3])}. Pick the ROM image itself.`;
}

function storeError(err: unknown, doing: 'add' | 'remove'): string {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  const what = doing === 'add' ? 'the ROM was not kept' : 'the ROM was not removed';
  if (name === 'StoreClosedError') return (err as Error).message;
  if (name === 'QuotaExceededError') return `Your browser’s storage for this site is full, so ${what}. Remove a manual or a ROM you no longer need, or free space in the browser, and try again.`;
  return `Your browser refused the change, so ${what} (${err instanceof Error ? err.message : String(err)}). Try again, or reload the page.`;
}

export function createRoms(deps: RomsDeps = {}): Roms {
  const open = deps.open ?? (() => openStoreDetailed());
  const hash = deps.hash ?? sha256;
  const ids = deps.ids ?? (() => import('../utils/emulator/rom-ids'));
  const store = shallowRef<Store | null | undefined>(undefined);
  const blocked = ref(false);
  /** What is stored, without the bytes, by model. */
  const stored = ref<Partial<Record<ModelId, RomInfo>>>({});
  let starting: Promise<Store | null> | null = null;

  function start(): Promise<Store | null> {
    starting ??= open().then(async (r) => {
      blocked.value = r === 'blocked';
      const s = r === 'blocked' ? null : r;
      store.value = s;
      if (s !== null) {
        const next: Partial<Record<ModelId, RomInfo>> = {};
        try {
          for (const m of await s.romModels()) {
            const r = await s.getRom(m);
            if (r !== undefined) next[m] = { name: r.name, sha256: r.sha256, recognized: r.recognized };
          }
        } catch {
          // An unreadable store lists nothing.
        }
        stored.value = next;
      }
      return s;
    });
    return starting;
  }

  async function add(file: File, model?: ModelId): Promise<AddRomResult> {
    const { ROM_SIZES, MODEL_NAMES, recognise } = await ids();
    // A size no TRS-80 ROM has is refused before the file is read (it may be huge).
    if (!([1, 3, 4] as const).some((m) => ROM_SIZES[m].includes(file.size))) return { ok: false, reason: wrongSize(file.name, file.size, ROM_SIZES) };
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (err) {
      return { ok: false, reason: `${file.name} could not be read (${err instanceof Error ? err.message : String(err)}). Pick the file again.` };
    }
    const sha = await hash(bytes);
    const known = recognise(sha);
    let target: ModelId;
    if (known !== null) {
      if (model !== undefined && model !== known.model) {
        return { ok: false, reason: `${file.name} is the ${MODEL_NAMES[known.model]} ROM, not a ${MODEL_NAMES[model]} ROM. Add it for the ${MODEL_NAMES[known.model]}, or pick the ${MODEL_NAMES[model]}’s ROM.` };
      }
      target = known.model;
    } else {
      const size = bytes.length;
      if (model === undefined) {
        const fits = ([1, 3, 4] as const).filter((m) => ROM_SIZES[m].includes(size));
        if (fits.length === 0) return { ok: false, reason: wrongSize(file.name, size, ROM_SIZES) };
        return { ok: false, reason: `Fugløy does not recognise ${file.name}, though its size suits the ${fits.map((m) => MODEL_NAMES[m]).join(' or ')}. Which model is it for?` };
      }
      if (!ROM_SIZES[model].includes(size)) {
        return { ok: false, reason: `${file.name} is ${n(size)} bytes, but a ${MODEL_NAMES[model]} ROM is ${bytesText(ROM_SIZES[model])}. Pick the ${MODEL_NAMES[model]}’s ROM image.` };
      }
      target = model;
    }
    const s = await start();
    if (s === null) return { ok: false, reason: blocked.value ? STORE_BLOCKED : NO_STORAGE };
    const record: StoredRom = { bytes, sha256: sha, recognized: known?.name ?? null, name: file.name, addedAt: Date.now() };
    try {
      await s.putRom(target, record);
    } catch (err) {
      return { ok: false, reason: storeError(err, 'add') };
    }
    void requestPersistence();
    stored.value = { ...stored.value, [target]: { name: record.name, sha256: record.sha256, recognized: record.recognized } };
    return { ok: true, model: target };
  }

  async function remove(model: ModelId): Promise<void> {
    const s = await start();
    if (s !== null) {
      try {
        await s.deleteRom(model);
      } catch (err) {
        throw new Error(storeError(err, 'remove'));
      }
    }
    const { [model]: _gone, ...rest } = stored.value;
    stored.value = rest;
  }

  async function bytes(model: ModelId): Promise<Uint8Array | null> {
    const s = await start();
    if (s === null) return null;
    return (await s.getRom(model))?.bytes ?? null;
  }

  return {
    have: (model) => stored.value[model] !== undefined,
    info: (model) => stored.value[model] ?? null,
    bytes,
    add,
    remove,
    start,
    unavailable: computed(() => (store.value === null ? (blocked.value ? STORE_BLOCKED : NO_STORAGE) : null)),
  };
}

let shared: Roms | null = null;

/** The page's ROMs (one per app). */
export function useRoms(): Roms {
  shared ??= createRoms();
  return shared;
}
