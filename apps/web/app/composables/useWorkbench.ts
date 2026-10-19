// The workbench's one shared state: the open program (a Session), its rows and
// facts, the cursor and selection, and what went wrong opening the last file.
// Every panel reads it and later tasks (editing, persistence, export) build on
// it. No DOM here: reading example files is handed in (fetch in the browser,
// fs in the tests), and drag and drop live in the components.
import { computed, ref, shallowRef } from 'vue';
import type { ComputedRef, Ref, ShallowRef } from 'vue';
import { basRows, defaultDos, detectFormat, listingRows, OpenError, openProgram, programFacts, selectSymbols, withHintText, withSelection } from '@fugloy/disasm';
import type { ProgramFacts, Row, Session, SymbolSelection, TableEntry } from '@fugloy/disasm';
import { exampleById } from '../data/examples';
import type { Example, ExampleId } from '../data/examples';
import { fetchExample } from '../utils/example-files';

/** Reads `<example id>/<file>` from the bundled examples; null when it is not there. */
export type ExampleReader = (path: string) => Promise<Uint8Array | null>;

export interface OpenOpts {
  /** Load as a raw binary at this address, skipping format detection. */
  base?: number;
  hintText?: string;
  /** The hint file's name, for the listing header. */
  hintSource?: string;
  /** The symbol tables to use; without it the machine verdict picks them. */
  selection?: SymbolSelection;
  /** Where the program came from: `source` is a Run of a Source ✎ program (plan 5B, Ruling 10), which persistence skips. */
  origin?: 'file' | 'source';
  /** With `origin: 'source'`: the source it was assembled from. */
  sourceId?: string;
  /** Keep the tab and, if its address still exists, the cursor (a quiet refresh). */
  keepView?: boolean;
}

/** Where the open program came from: a Source ✎ program, by its source id, or null for a file or an example. */
export type SessionOrigin = { kind: 'source'; sourceId: string } | null;

/** What the Symbol tab shows: a program label, or a ROM, hardware or DOS name. */
export type SymbolFocus = { kind: 'label'; addr: number } | { kind: 'table'; entry: TableEntry };

export const notAProgramMessage = (name: string): string => `${name} is not a .CMD or .BAS program.`;
export const emptyMessage = (name: string): string => `${name} is empty (0 bytes).`;
/** The most a raw binary can be: the Z80's 64K address space. */
export const RAW_MAX = 0x10000;
export const tooBigForRawMessage = (size: number): string => `At ${size.toLocaleString('en-US')} bytes it is bigger than the 64K a TRS-80 can address, so it cannot be loaded as a raw binary.`;

/** Model III with its default DOS: the CLI's choice when nothing says otherwise. The one copy; the page uses it too. */
export const MODEL3_DEFAULT: SymbolSelection = { machine: 3, dos: defaultDos(3) };

const isPdf = (bytes: Uint8Array): boolean => bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-';

function rowsOf(s: Session | null): Row[] {
  if (s === null) return [];
  if (s.plainBasic && s.module.format === 'bas') return basRows(s.module, s.selection === undefined ? {} : { tables: selectSymbols(s.selection) });
  return listingRows(s.analysis, { source: s.name });
}

export interface Workbench {
  session: ShallowRef<Session | null>;
  rows: ComputedRef<Row[]>;
  facts: ComputedRef<ProgramFacts | null>;
  /** The bundled game the session came from, for its history; null for a dropped file. */
  example: ShallowRef<Example | null>;
  cursor: Ref<number | null>;
  selection: Ref<{ from: number; to: number } | null>;
  /** The name the Symbol tab describes; cleared when another program opens. */
  symbolFocus: ShallowRef<SymbolFocus | null>;
  error: Ref<string | null>;
  /** Lines under the error, such as a hint file's parse errors. */
  errorDetails: Ref<readonly string[]>;
  /** A file that was not a program, kept so it can be loaded as a raw binary. */
  rawCandidate: ShallowRef<{ bytes: Uint8Array; name: string } | null>;
  /** The last file dropped was a PDF: point at the Manuals page. */
  suggestManuals: Ref<boolean>;
  /** Counts programs opened, a Run's refresh of its own listing included: edit history, steps and saved work start over. */
  openCount: Ref<number>;
  /**
   * The listing's key: bumps with `openCount`, except on a Run's quiet refresh of the same source's
   * listing, which swaps the program in place so the listing keeps its focus and Explain its state.
   */
  viewKey: Ref<number>;
  /** An example is being fetched. */
  busy: Ref<boolean>;
  /** Where the open program came from (Ruling 10). */
  origin: ShallowRef<SessionOrigin>;
  /** The last open asked to keep the view (a quiet refresh): the page leaves its tabs and cursor alone. */
  keptView: Ref<boolean>;
  /** The workbench is open on Source ✎ and Run ▶ with no program (Ruling 12: "Write a program", "Continue"). */
  writing: Ref<boolean>;
  /**
   * Shows a Source ✎ program's .CMD in the listing, quietly. Unless `force` (the Run tab's
   * "Show in Listing"), only when no program is open or the open one is this source's own;
   * returns whether it opened.
   */
  openSource(bytes: Uint8Array, name: string, opts: { sourceId: string; selection: SymbolSelection; force?: boolean }): boolean;
  openBytes(bytes: Uint8Array, name: string, opts?: OpenOpts): void;
  openRaw(base: number): void;
  /** Ignored while an example is loading. */
  openExample(id: ExampleId, build?: string): Promise<void>;
  /** Shows a problem that is not about the bytes (a file that could not be read), clearing any raw offer. */
  report(message: string): void;
  /** Whether opening these bytes would replace the open program: one is open, and they are a .CMD or .BAS. */
  wouldReplace(bytes: Uint8Array): boolean;
  setSelection(sel: SymbolSelection): void;
  close(): void;
}

export function createWorkbench(deps: { readExample: ExampleReader }): Workbench {
  const session = shallowRef<Session | null>(null);
  const example = shallowRef<Example | null>(null);
  const cursor = ref<number | null>(null);
  const selection = ref<{ from: number; to: number } | null>(null);
  const symbolFocus = shallowRef<SymbolFocus | null>(null);
  const error = ref<string | null>(null);
  const errorDetails = ref<readonly string[]>([]);
  const rawCandidate = shallowRef<{ bytes: Uint8Array; name: string } | null>(null);
  const suggestManuals = ref(false);
  const openCount = ref(0);
  const viewKey = ref(0);
  const busy = ref(false);
  const origin = shallowRef<SessionOrigin>(null);
  const keptView = ref(false);
  const writing = ref(false);

  const rows = computed(() => rowsOf(session.value));
  const facts = computed(() => (session.value === null ? null : programFacts(session.value.analysis)));

  function fail(message: string, details: readonly string[] = []): void {
    error.value = message;
    errorDetails.value = details;
  }

  function clearProblem(): void {
    error.value = null;
    errorDetails.value = [];
    rawCandidate.value = null;
    suggestManuals.value = false;
  }

  function commit(s: Session, from: Example | null, opts: OpenOpts = {}): void {
    const keep = opts.keepView === true ? cursor.value : null;
    const inPlace = opts.keepView === true && opts.sourceId !== undefined && origin.value?.sourceId === opts.sourceId && session.value !== null;
    origin.value = opts.origin === 'source' && opts.sourceId !== undefined ? { kind: 'source', sourceId: opts.sourceId } : null;
    keptView.value = opts.keepView === true;
    session.value = s;
    example.value = from;
    // A quiet refresh keeps the cursor where its address still has a row.
    cursor.value = keep !== null && rows.value.some((r) => 'addr' in r && r.addr === keep) ? keep : null;
    selection.value = null;
    if (!inPlace) symbolFocus.value = null;
    openCount.value++;
    if (!inPlace) viewKey.value++;
  }

  /** Opens and analyzes; returns the session, or null after setting the error. Never throws. */
  function open(bytes: Uint8Array, name: string, opts: OpenOpts): Session | null {
    clearProblem();
    if (bytes.length === 0) {
      fail(emptyMessage(name));
      return null;
    }
    // Over 64K a raw load would wrap through memory: refused before anything reads (or hashes) the bytes.
    if (opts.base !== undefined && bytes.length > RAW_MAX) {
      fail(`${name} cannot be loaded as a raw binary. ${tooBigForRawMessage(bytes.length)}`);
      return null;
    }
    let s: Session;
    try {
      s = openProgram(bytes, { name, selection: opts.selection ?? MODEL3_DEFAULT, ...(opts.base === undefined ? {} : { base: opts.base }) });
    } catch (err) {
      if (err instanceof OpenError && err.kind === 'format') {
        if (bytes.length > RAW_MAX) {
          // A disk image, say: not a program, and too big to offer as a raw binary.
          fail(`${notAProgramMessage(name)} ${tooBigForRawMessage(bytes.length)}`);
          suggestManuals.value = isPdf(bytes);
          return null;
        }
        fail(notAProgramMessage(name));
        rawCandidate.value = { bytes, name };
        suggestManuals.value = isPdf(bytes);
      } else fail(`${name} could not be opened: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
    if (opts.hintText !== undefined) {
      try {
        s = withHintText(s, opts.hintText, opts.hintSource);
      } catch (err) {
        // The program still opens, without the hints, and says why.
        const what = err instanceof OpenError ? err.message : `could not apply (${err instanceof Error ? err.message : String(err)})`;
        fail(`${opts.hintSource ?? 'the hints'}: ${what}; opened without them.`, err instanceof OpenError ? err.details : []);
      }
    }
    if (opts.selection === undefined) {
      // The verdict sets the picker when it names exactly one machine (spec, "Machine and DOS").
      const fit = programFacts(s.analysis).machine.fit;
      if (fit === 'model1') s = withSelection(s, { machine: 1, dos: defaultDos(1) });
    }
    return s;
  }

  function openBytes(bytes: Uint8Array, name: string, opts: OpenOpts = {}): void {
    const s = open(bytes, name, opts);
    if (s !== null) commit(s, null, opts);
  }

  function openSource(bytes: Uint8Array, name: string, opts: { sourceId: string; selection: SymbolSelection; force?: boolean }): boolean {
    const o = origin.value;
    const own = session.value === null || (o !== null && o.sourceId === opts.sourceId);
    if (!own && opts.force !== true) return false;
    const s = open(bytes, name, { selection: opts.selection });
    if (s === null) return false;
    commit(s, null, { origin: 'source', sourceId: opts.sourceId, keepView: own });
    return true;
  }

  function openRaw(base: number): void {
    const c = rawCandidate.value;
    if (c === null) return;
    openBytes(c.bytes, c.name, { base });
  }

  function report(message: string): void {
    clearProblem();
    fail(message);
  }

  function wouldReplace(bytes: Uint8Array): boolean {
    return session.value !== null && bytes.length > 0 && detectFormat(bytes) !== 'raw';
  }

  async function openExample(id: ExampleId, build?: string): Promise<void> {
    if (busy.value) return;
    const e = exampleById(id);
    const file = build ?? e.mainBuild;
    if (!e.builds.includes(file)) {
      report(`${e.title} has no build ${file}.`);
      return;
    }
    busy.value = true;
    try {
      const bytes = await deps.readExample(`${e.id}/${file}`);
      if (bytes === null) {
        report(`could not load ${file}.`);
        return;
      }
      let hintText: string | undefined;
      // The committed hints belong to the main build.
      if (file === e.mainBuild && e.hints !== undefined) {
        const h = await deps.readExample(`${e.id}/${e.hints}`);
        if (h !== null) hintText = new TextDecoder().decode(h);
      }
      const s = open(bytes, file, {
        selection: { machine: e.machine, dos: defaultDos(e.machine) },
        ...(hintText === undefined ? {} : { hintText, hintSource: e.hints }),
      });
      if (s !== null) commit(s, e);
    } finally {
      busy.value = false;
    }
  }

  function setSelection(sel: SymbolSelection): void {
    const s = session.value;
    if (s === null) return;
    try {
      session.value = withSelection(s, sel);
      // A table entry belongs to the tables just replaced.
      if (symbolFocus.value?.kind === 'table') symbolFocus.value = null;
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  }

  function close(): void {
    clearProblem();
    session.value = null;
    example.value = null;
    origin.value = null;
    keptView.value = false;
    writing.value = false;
    cursor.value = null;
    selection.value = null;
    symbolFocus.value = null;
    openCount.value++;
    viewKey.value++;
  }

  return { session, rows, facts, example, cursor, selection, symbolFocus, error, errorDetails, rawCandidate, suggestManuals, openCount, viewKey, busy, origin, keptView, writing, openSource, openBytes, openRaw, openExample, report, wouldReplace, setSelection, close };
}

let shared: Workbench | null = null;

/** The workbench every component shares. Opening happens only in the browser, so the prerendered page holds none. */
export function useWorkbench(): Workbench {
  shared ??= createWorkbench({ readExample: fetchExample });
  return shared;
}
