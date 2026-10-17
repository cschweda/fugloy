// Saves the user's work in the browser (utils/store) and brings it back. Hints
// save on every change to the open program's hint file (an edit, an undo, a
// redo, a dropped file), 500 ms after the last one; the machine and DOS save as
// the user picks them. Opening a program restores both (saved hints beat an
// example's committed ones; saved settings beat the manifest and the verdict).
// With no storage the workbench works as before and says so. DOM-free.
import { computed, ref, shallowRef, watch } from 'vue';
import type { ComputedRef, Ref, ShallowRef } from 'vue';
import { withHintText, withSelection, writeHints } from '@fugloy/disasm';
import type { Session, SymbolSelection } from '@fugloy/disasm';
import { bestCarryOver } from '../utils/carry-over';
import type { CarryCandidate } from '../utils/carry-over';
import { openStore, requestPersistence } from '../utils/store';
import type { Store } from '../utils/store';
import { useWorkbench } from './useWorkbench';
import type { Workbench } from './useWorkbench';

export const SAVE_DELAY_MS = 500;

export type SaveState = 'saved' | 'unsaved' | 'no hints yet' | 'not saved (storage unavailable)';

export interface Persistence {
  /** The status line's save state. */
  status: ComputedRef<SaveState>;
  /** The store, once opened; null when storage is unavailable; undefined while opening. */
  store: ShallowRef<Store | null | undefined>;
  /** Saved hints for another build that pair with the open program, waiting for a yes or no. */
  carry: ShallowRef<CarryCandidate | null>;
  acceptCarry(): void;
  dismissCarry(): void;
  /** Opens the store (browser only); safe to call again. */
  start(): Promise<Store | null>;
  /** Writes any change still waiting out its delay. */
  flush(): Promise<void>;
  /** Re-reads the open program's saved work, as after a restore. */
  refresh(): Promise<void>;
}

const selKey = (sel: SymbolSelection | undefined): string => (sel === undefined ? '' : `${sel.machine}/${sel.dos}`);
const hintText = (s: Session): string => writeHints(s.hintFile);
/** A file name for hints nobody named: the program's, with `.hints`. */
const defaultName = (s: Session): string => `${s.name.replace(/\.[^.]+$/, '')}.hints`;

export function createPersistence(wb: Workbench, open: () => Promise<Store | null> = openStore): Persistence {
  const store = shallowRef<Store | null | undefined>(undefined);
  const carry = shallowRef<CarryCandidate | null>(null);
  /** Writing failed (quota, a closed database). */
  const failed = ref(false);
  /** Bumps when the open program's saved text changes, so the status recomputes. */
  const savedText: Ref<string | null> = ref(null);
  const waiting = ref(false);
  /** Set once the open program's saved work is restored; edits before then wait for it. */
  const restored = ref(false);
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { hash: string; name: string; text: string } | null = null;
  let lastSel = '';
  let starting: Promise<Store | null> | null = null;

  function start(): Promise<Store | null> {
    starting ??= open().then((s) => {
      store.value = s;
      if (s !== null) void requestPersistence();
      return s;
    });
    return starting;
  }

  async function write(p: { hash: string; name: string; text: string }): Promise<void> {
    const s = store.value;
    if (s === null || s === undefined) return;
    try {
      await s.putHints(p.hash, { name: p.name, text: p.text });
      failed.value = false;
      if (wb.session.value?.hash === p.hash) savedText.value = p.text;
    } catch {
      failed.value = true;
    }
  }

  async function flush(): Promise<void> {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const p = pending;
    pending = null;
    waiting.value = false;
    if (p !== null) await write(p);
  }

  /** Schedules a save when the open program's hint file differs from what is stored. */
  function check(): void {
    const s = wb.session.value;
    if (s === null || !restored.value) return;
    const text = hintText(s);
    if (text === savedText.value || (savedText.value === null && s.hintFile.hints.length === 0)) {
      if (timer !== null && pending !== null && pending.hash === s.hash) {
        clearTimeout(timer);
        timer = null;
        pending = null;
        waiting.value = false;
      }
      return;
    }
    pending = { hash: s.hash, name: s.hintSource ?? defaultName(s), text };
    waiting.value = true;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => void flush(), SAVE_DELAY_MS);
  }

  async function restore(s: Session, gen: number): Promise<void> {
    const st = await start();
    if (gen !== generation || wb.session.value !== s) return;
    if (st === null) {
      restored.value = true;
      return;
    }
    try {
      const [saved, prefs] = await Promise.all([st.getHints(s.hash), st.getPrefs(s.hash)]);
      if (gen !== generation || wb.session.value !== s) return;
      let next = s;
      if (prefs !== undefined && selKey(prefs) !== selKey(s.selection)) {
        try {
          next = withSelection(next, prefs);
        } catch {
          // A setting this build no longer knows: keep the picker as opened.
        }
      }
      let carried: CarryCandidate | null = null;
      if (saved !== undefined) {
        if (saved.text !== hintText(next)) {
          try {
            next = withHintText(next, saved.text, saved.name);
          } catch {
            // Saved hints that no longer apply: keep what opened, and do not overwrite them until the user edits.
            savedText.value = saved.text;
          }
        }
        if (savedText.value === null) savedText.value = saved.text;
      } else if (s.hintFile.hints.length === 0) {
        carried = bestCarryOver(s, await st.allHints());
        if (gen !== generation || wb.session.value !== s) return;
      }
      lastSel = selKey(next.selection);
      if (next !== s) wb.session.value = next;
      carry.value = carried;
    } catch {
      failed.value = true;
    }
    restored.value = true;
    check();
  }

  function onOpen(): void {
    const previous = pending;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
    waiting.value = false;
    if (previous !== null) void write(previous);
    generation++;
    carry.value = null;
    savedText.value = null;
    restored.value = false;
    const s = wb.session.value;
    if (s === null) return;
    lastSel = selKey(s.selection);
    void restore(s, generation);
  }

  watch(wb.openCount, onOpen, { flush: 'sync' });

  // Every change to the hint file, however it was made. Not sync: opening a program sets the
  // session before the open count moves, and by the time this runs onOpen has reset the state.
  watch(
    () => wb.session.value?.hintFile,
    () => check(),
  );

  // The machine and DOS, as the user picks them.
  watch(
    () => wb.session.value?.selection,
    (sel) => {
      const s = wb.session.value;
      const st = store.value;
      if (s === null || sel === undefined || !restored.value || selKey(sel) === lastSel) return;
      lastSel = selKey(sel);
      if (st === null || st === undefined) return;
      void st.putPrefs(s.hash, { machine: sel.machine, dos: sel.dos }).catch(() => {
        failed.value = true;
      });
    },
  );

  const status = computed<SaveState>(() => {
    const s = wb.session.value;
    if (store.value === null || failed.value) return 'not saved (storage unavailable)';
    if (s === null) return 'no hints yet';
    if (s.hintFile.hints.length === 0 && savedText.value === null) return 'no hints yet';
    if (waiting.value || savedText.value !== hintText(s)) return 'unsaved';
    return 'saved';
  });

  return {
    status,
    store,
    carry,
    acceptCarry() {
      const c = carry.value;
      const s = wb.session.value;
      carry.value = null;
      if (c === null || s === null) return;
      try {
        wb.session.value = withHintText(s, c.text, c.name);
      } catch (err) {
        wb.report(`${c.name} could not be carried over: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    dismissCarry() {
      carry.value = null;
    },
    start,
    flush,
    async refresh() {
      const s = wb.session.value;
      if (s === null) return;
      generation++;
      restored.value = false;
      savedText.value = null;
      await restore(s, generation);
    },
  };
}

let shared: Persistence | null = null;

/** The workbench's one persistence. */
export function usePersistence(): Persistence {
  shared ??= createPersistence(useWorkbench());
  return shared;
}
