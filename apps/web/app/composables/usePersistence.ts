// Saves the user's work in the browser (utils/store) and brings it back. Hints
// save on every change to the open program's hint file (an edit, an undo, a
// redo, a dropped file), 500 ms after the last one; the machine and DOS save as
// the user picks them. Opening a program restores both (saved hints beat an
// example's committed ones; saved settings beat the manifest and the verdict).
// With no storage the workbench works as before and says so. DOM-free.
import { computed, ref, shallowRef, watch } from 'vue';
import type { ComputedRef, Ref, ShallowRef } from 'vue';
import { parseHints, withHintText, withSelection, writeHints } from '@fugloy/disasm';
import type { Session, SymbolSelection } from '@fugloy/disasm';
import { bestCarryOver } from '../utils/carry-over';
import type { CarryCandidate } from '../utils/carry-over';
import { EXAMPLES } from '../data/examples';
import { fetchExample } from '../utils/example-files';
import { openStore, requestPersistence } from '../utils/store';
import type { Store } from '../utils/store';
import { useEditing } from './useEditing';
import { useWorkbench } from './useWorkbench';
import type { ExampleReader, Workbench } from './useWorkbench';

export const SAVE_DELAY_MS = 500;

/** 'no changes yet': the hints are as the program opened (an example's committed ones), so nothing needs saving. */
export type SaveState = 'saved' | 'unsaved' | 'no hints yet' | 'no changes yet' | 'not saved (storage unavailable)';

export interface Persistence {
  /** The status line's save state. */
  status: ComputedRef<SaveState>;
  /** The store, once opened; null when storage is unavailable; undefined while opening. */
  store: ShallowRef<Store | null | undefined>;
  /** Saved hints for another build that pair with the open program, waiting for a yes or no. */
  carry: ShallowRef<CarryCandidate | null>;
  /** Lines of a carried-over hint file that did not parse or cannot apply, for the Hints tab. */
  hintErrors: Ref<readonly string[]>;
  /** Set when saved work exists that the user's early edit would overwrite; nothing saves until `resolveConflict`. */
  conflict: ShallowRef<{ name: string; text: string } | null>;
  /** Load: the saved work replaces the open hints (one undoable step, so the change can be undone back). Keep: the change replaces the saved work. */
  resolveConflict(choice: 'load' | 'keep'): void;
  /** Applies the offered file as one undoable step. */
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

export interface PersistenceDeps {
  open?: () => Promise<Store | null>;
  /** Reads the bundled examples' committed hint files, which are offered for carry-over too. */
  readExample?: ExampleReader;
  /** The edit history's loadHints, so a carry-over is one undoable step. */
  loadHints?: (text: string, source: string, opts?: { lenient?: boolean }) => string | null;
}

export function createPersistence(wb: Workbench, deps: PersistenceDeps = {}): Persistence {
  const open = deps.open ?? openStore;
  const readExample = deps.readExample ?? fetchExample;
  const loadHints = deps.loadHints ?? ((t, n, o) => useEditing().loadHints(t, n, o));
  const store = shallowRef<Store | null | undefined>(undefined);
  const carry = shallowRef<CarryCandidate | null>(null);
  /** Stored hints the user has not seen, found after they had already edited: saving waits for their choice. */
  const conflict = shallowRef<{ name: string; text: string } | null>(null);
  const hintErrors = ref<readonly string[]>([]);
  /** The hint text the open program opened with (committed or skeleton): changes from it are the user's. */
  const baseline = ref<string | null>(null);
  let committedHints: Promise<{ hash: string; name: string; text: string }[]> | null = null;
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

  /** The bundled examples' committed hint files, read once. */
  function committed(): Promise<{ hash: string; name: string; text: string }[]> {
    committedHints ??= (async () => {
      const out: { hash: string; name: string; text: string }[] = [];
      for (const e of EXAMPLES) {
        if (e.hints === undefined) continue;
        const bytes = await readExample(`${e.id}/${e.hints}`);
        if (bytes === null) continue;
        const text = new TextDecoder().decode(bytes);
        out.push({ hash: parseHints(text).file.program ?? `example:${e.id}`, name: e.hints, text });
      }
      return out;
    })();
    return committedHints;
  }

  /** Schedules a save when the open program's hint file differs from what is stored. */
  function check(): void {
    const s = wb.session.value;
    if (s === null || !restored.value || conflict.value !== null) return;
    const text = hintText(s);
    // Nothing stored: only a change from what the program opened with is worth saving.
    if (savedText.value === null ? text === baseline.value : text === savedText.value) {
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
    if (gen !== generation) return;
    if (st === null) {
      restored.value = true;
      check();
      return;
    }
    try {
      const [saved, prefs] = await Promise.all([st.getHints(s.hash), st.getPrefs(s.hash)]);
      if (gen !== generation) return;
      // The user may have acted while the saved work was being read.
      const cur = wb.session.value;
      if (cur === null) return;
      if (hintText(cur) !== hintText(s)) {
        // An edit. Stored hints that were never shown must not be overwritten: ask first.
        if (saved !== undefined && saved.text !== hintText(cur)) conflict.value = saved;
        else {
          restored.value = true;
          check();
        }
        if (conflict.value !== null) restored.value = true;
        return;
      }
      // Nothing edited (a machine or DOS change may have happened): saved work applies to the session as it is now.
      let next = cur;
      if (cur === s && prefs !== undefined && selKey(prefs) !== selKey(s.selection)) {
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
        const stored = await st.allHints();
        const have = new Set(stored.map((h) => h.hash));
        carried = bestCarryOver(s, [...stored, ...(await committed()).filter((h) => !have.has(h.hash))]);
        if (gen !== generation) return;
        if (wb.session.value !== cur || hintText(cur) !== hintText(s)) {
          restored.value = true;
          check();
          return;
        }
      }
      lastSel = selKey(next.selection);
      if (next !== cur) wb.session.value = next;
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
    hintErrors.value = [];
    conflict.value = null;
    savedText.value = null;
    restored.value = false;
    const s = wb.session.value;
    baseline.value = s === null ? null : hintText(s);
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
    if (savedText.value === null && hintText(s) === baseline.value) return s.hintFile.hints.length === 0 ? 'no hints yet' : 'no changes yet';
    if (conflict.value !== null || waiting.value || savedText.value !== hintText(s)) return 'unsaved';
    return 'saved';
  });

  return {
    status,
    store,
    carry,
    hintErrors,
    conflict,
    resolveConflict(choice) {
      const c = conflict.value;
      conflict.value = null;
      if (c === null) return;
      if (choice === 'load') {
        const refused = loadHints(c.text, c.name);
        if (refused !== null) wb.report(`${c.name} could not be loaded: ${refused}`);
        else savedText.value = c.text;
      }
      // Keep: the stored copy is replaced by the next save, which check() schedules now.
      check();
    },
    acceptCarry() {
      const c = carry.value;
      carry.value = null;
      if (c === null || wb.session.value === null) return;
      // Lenient: what parses applies, and the lines that did not are listed in the Hints tab.
      const refused = loadHints(c.text, c.name, { lenient: true });
      if (refused !== null) wb.report(`${c.name} could not be carried over: ${refused}`);
      else hintErrors.value = c.problems;
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
