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
}

/** What the Symbol tab shows: a program label, or a ROM, hardware or DOS name. */
export type SymbolFocus = { kind: 'label'; addr: number } | { kind: 'table'; entry: TableEntry };

export const notAProgramMessage = (name: string): string => `${name} is not a .CMD or .BAS program.`;
export const emptyMessage = (name: string): string => `${name} is empty (0 bytes).`;

/** Model III with its default DOS: the CLI's choice when nothing says otherwise. */
const MODEL3: SymbolSelection = { machine: 3, dos: defaultDos(3) };

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
  /** Counts programs opened; the listing is keyed by it, so nothing carries over between programs. */
  openCount: Ref<number>;
  /** An example is being fetched. */
  busy: Ref<boolean>;
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
  const busy = ref(false);

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

  function commit(s: Session, from: Example | null): void {
    session.value = s;
    example.value = from;
    cursor.value = null;
    selection.value = null;
    symbolFocus.value = null;
    openCount.value++;
  }

  /** Opens and analyzes; returns the session, or null after setting the error. Never throws. */
  function open(bytes: Uint8Array, name: string, opts: OpenOpts): Session | null {
    clearProblem();
    if (bytes.length === 0) {
      fail(emptyMessage(name));
      return null;
    }
    let s: Session;
    try {
      s = openProgram(bytes, { name, selection: opts.selection ?? MODEL3, ...(opts.base === undefined ? {} : { base: opts.base }) });
    } catch (err) {
      if (err instanceof OpenError && err.kind === 'format') {
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
    if (s !== null) commit(s, null);
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
    cursor.value = null;
    selection.value = null;
    symbolFocus.value = null;
    openCount.value++;
  }

  return { session, rows, facts, example, cursor, selection, symbolFocus, error, errorDetails, rawCandidate, suggestManuals, openCount, busy, openBytes, openRaw, openExample, report, wouldReplace, setSelection, close };
}

let shared: Workbench | null = null;

/** The workbench every component shares. Opening happens only in the browser, so the prerendered page holds none. */
export function useWorkbench(): Workbench {
  shared ??= createWorkbench({ readExample: fetchExample });
  return shared;
}
