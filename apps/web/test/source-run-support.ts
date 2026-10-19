// Shared by the 5C Source ✎ tests: Source ✎ mounted over a real Run (createRun, its runner on a
// fake clock), with sources in memory (or in a small store that records its writes), and a stand-in
// IntersectionObserver whose callbacks the test fires, since happy-dom's never does.
import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { Transaction } from '@codemirror/state';
import * as realKit from '../app/utils/emulator/kit';
import type { RunKit } from '../app/composables/useRun';
import { createRun } from '../app/composables/useRun';
import { createSources } from '../app/composables/useSources';
import type { Sources } from '../app/composables/useSources';
import { createWorkbench } from '../app/composables/useWorkbench';
import type { Roms } from '../app/composables/useRoms';
import type { Store, StoredSource } from '../app/utils/store';
import { setLines } from '../app/utils/source/run-marks';
import { fakeClock } from './emulator-support';

/**
 * A loop with a comment line (3) and a breakpoint-friendly body: lines 4-6 repeat.
 * Line 2 LD A,1; 3 comment; 4 INC A; 5 DEC A; 6 JR LOOP.
 */
export const LOOP = '        ORG     7000H\nSTART:  LD      A,1\n        ; the loop\nLOOP:   INC     A\n        DEC     A\n        JR      LOOP\n        END     START\n';

export const noRoms: Roms = {
  have: () => false,
  info: () => null,
  bytes: async () => null,
  add: async () => ({ ok: false, reason: 'not here' }),
  remove: async () => {},
  start: async () => null,
  unavailable: { value: null } as Roms['unavailable'],
};

/** Just the store methods useSources calls, in memory; `puts` records each source written. */
export function memoryStore() {
  const rows = new Map<string, StoredSource>();
  let current: string | null = null;
  const puts: StoredSource[] = [];
  const store = {
    allSources: async () => [...rows.values()].map((s) => structuredClone(s)),
    putSource: async (s: StoredSource) => {
      // As utils/store writes it (the source may be reactive: a copy of plain data).
      const row = JSON.parse(JSON.stringify(s)) as StoredSource;
      puts.push(row);
      rows.set(s.id, structuredClone(row));
    },
    deleteSource: async (id: string) => void rows.delete(id),
    getCurrentSource: async () => current,
    putCurrentSource: async (id: string | null) => void (current = id),
  } as unknown as Store;
  return { store, rows, puts };
}

export class FakeIO {
  static all: FakeIO[] = [];
  constructor(readonly cb: (entries: { isIntersecting: boolean }[]) => void) {
    FakeIO.all.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    FakeIO.all = FakeIO.all.filter((x) => x !== this);
  }
  takeRecords(): never[] {
    return [];
  }
  /** Tells every observer its target is in view. */
  static show(): void {
    for (const io of FakeIO.all) io.cb([{ isIntersecting: true }]);
  }
}

export interface Mounted {
  w: VueWrapper;
  view: () => EditorView;
  sources: Sources;
  run: ReturnType<typeof createRun>;
  clock: ReturnType<typeof fakeClock>;
  /** The line-class sets sent to the editor so far, oldest first. */
  sent: { line: number; class: string }[][];
  /** Transactions the editor has seen since mounting. */
  transactions: Transaction[];
  host: HTMLElement;
}

export interface Holder {
  sources: Sources | null;
  run: ReturnType<typeof createRun> | null;
}

/** Makes the sources and the Run that the mocked composables hand to Source ✎. */
export async function prepare(holder: Holder, text: string, opts: { store?: Store; kit?: RunKit } = {}) {
  const sources = createSources({ open: async () => opts.store ?? null, starter: async () => text });
  await sources.start();
  await sources.create({ name: 'loop.z', text });
  const clock = fakeClock();
  const wb = createWorkbench({ readExample: async () => null });
  const run = createRun({ sources, roms: noRoms, wb, kit: async () => opts.kit ?? realKit, runner: clock });
  holder.sources = sources;
  holder.run = run;
  return { sources, run, clock };
}

/** Mounts Source ✎ inside `host` and starts recording what reaches the editor. */
export async function mountSource(component: unknown, holder: Holder, clock: ReturnType<typeof fakeClock>, host = document.createElement('div')): Promise<Mounted> {
  document.body.append(host);
  const inner = document.createElement('div');
  host.append(inner);
  const w = mount(component as never, { attachTo: inner });
  await flushPromises();
  await flushPromises();
  const view = (): EditorView => EditorView.findFromDOM(w.get('.cm-editor').element as HTMLElement)!;
  const sent: { line: number; class: string }[][] = [];
  const transactions: Transaction[] = [];
  view().dispatch({
    effects: StateEffect.appendConfig.of(
      EditorView.updateListener.of((u) => {
        for (const tr of u.transactions) {
          transactions.push(tr);
          for (const e of tr.effects) if (e.is(setLines)) sent.push(e.value);
        }
      }),
    ),
  });
  return { w, view, sources: holder.sources!, run: holder.run!, clock, sent, transactions, host };
}

/** The gutter's marks as drawn: each mark's text and title. */
export function gutterMarks(view: EditorView): { text: string; title: string }[] {
  return [...view.dom.querySelectorAll<HTMLElement>('.fg-bp-gutter .cm-gutterElement .fg-bp, .fg-bp-gutter .cm-gutterElement .fg-bp-pc')].map((m) => ({ text: m.textContent ?? '', title: m.title }));
}

/** Clicks the breakpoint gutter on `line` (happy-dom has no layout, so the click's line is given). */
export function clickGutter(view: EditorView, line: number): void {
  const at = view.lineBlockAt(view.state.doc.line(line).from);
  const original = view.lineBlockAtHeight.bind(view);
  view.lineBlockAtHeight = () => at;
  const g = view.dom.querySelector('.fg-bp-gutter')!;
  g.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
  view.lineBlockAtHeight = original;
}
