// @vitest-environment happy-dom
// The running line in Source ✎ (phase 5C Rulings 2-4 and 7), through useDebug: a CodeMirror
// dispatch only when the set of marks changes, at most 30 a second, none while the panel is hidden
// (the latest set once it shows); an edit after Run hides the marks and says why; a pause brings
// the paused line into view without moving the selection.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import * as realKit from '../app/utils/emulator/kit';
import type { Holder } from './source-run-support';
import { clickGutter, FakeIO, gutterMarks, LOOP, mountSource, prepare } from './source-run-support';

const holder: Holder = { sources: null, run: null };
vi.mock('../app/composables/useSources', async (orig) => ({
  ...(await orig<typeof import('../app/composables/useSources')>()),
  useSources: () => holder.sources,
}));
vi.mock('../app/composables/useRun', async (orig) => ({
  ...(await orig<typeof import('../app/composables/useRun')>()),
  useRun: () => holder.run,
}));
const { default: SourceTab } = await import('../app/components/source/SourceTab.vue');

const stopSelectionChange = (e: Event): void => e.stopImmediatePropagation();
window.addEventListener('selectionchange', stopSelectionChange, true);

const CHANGED = 'The source has changed since this Run, so the running line is not shown. Press Run to see it again.';

let w: VueWrapper | null = null;
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', FakeIO);
});
afterEach(() => {
  holder.run?.stop();
  w?.unmount();
  w = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('the running line in Source', () => {
  it('ten frames with the same marks make exactly one dispatch', async () => {
    // One line that loops on itself: every frame's window holds only it.
    const text = '        ORG     7000H\nSTART:  LD      A,1\nWAIT:   JR      WAIT\n        END     START\n';
    const { clock } = await prepare(holder, text);
    const m = await mountSource(SourceTab, holder, clock);
    w = m.w;
    await m.run.run();
    await flushPromises();
    // The Run's start shows the entry line; from then on, the loop.
    expect(m.sent).toEqual([[{ line: 2, class: 'fg-run-now' }]]);
    m.sent.length = 0;
    for (let k = 0; k < 10; k++) {
      clock.frame();
      await flushPromises();
    }
    expect(m.sent).toEqual([[{ line: 3, class: 'fg-run-now' }]]);
    expect(m.view().dom.querySelector('.cm-line.fg-run-now')?.textContent).toContain('JR');
  });

  it('ten changing frames within 100 ms make at most 3 dispatches (30 a second)', async () => {
    let k = 0;
    // A runner whose marks change every frame.
    const kit = { ...realKit, trailOf: () => ({ now: 4 + (k++ % 3), trail: [], out: null }) };
    const { clock } = await prepare(holder, LOOP, { kit });
    const m = await mountSource(SourceTab, holder, clock);
    w = m.w;
    await m.run.run();
    for (let f = 0; f < 10; f++) {
      clock.frame(10);
      await flushPromises();
    }
    expect(clock.now()).toBe(100);
    expect(m.sent.length).toBeGreaterThan(0);
    expect(m.sent.length).toBeLessThanOrEqual(3);
  });

  it('a hidden panel gets no dispatch, then the latest set once it shows', async () => {
    let k = 0;
    const kit = { ...realKit, trailOf: () => ({ now: 4 + (k++ % 3), trail: [], out: null }) };
    const { clock } = await prepare(holder, LOOP, { kit });
    const host = document.createElement('div');
    const m = await mountSource(SourceTab, holder, clock, host);
    w = m.w;
    host.style.display = 'none';
    await m.run.run();
    for (let f = 0; f < 10; f++) {
      clock.frame();
      await flushPromises();
    }
    expect(m.sent).toEqual([]);
    const latest = m.run.debug.marks.value;
    expect(latest.length).toBe(1);
    host.style.display = '';
    FakeIO.show();
    await flushPromises();
    expect(m.sent).toEqual([latest]);
  });

  it('an edit after Run clears the marks and says why; Run shows them again', async () => {
    const { clock } = await prepare(holder, LOOP);
    const m = await mountSource(SourceTab, holder, clock);
    w = m.w;
    await m.run.run();
    clock.frame();
    await flushPromises();
    expect(m.sent.at(-1)!.length).toBeGreaterThan(0);
    expect(m.w.find('[data-testid="source-run-changed"]').exists()).toBe(false);
    const v = m.view();
    v.dispatch({ changes: { from: v.state.doc.length, insert: '; more\n' }, userEvent: 'input.type' });
    await flushPromises();
    expect(m.sent.at(-1)).toEqual([]);
    expect(v.dom.querySelector('[class*="fg-run-"]')).toBeNull();
    expect(m.w.get('[data-testid="source-run-changed"]').text()).toBe(CHANGED);
    // The listing still has the running program's marks.
    expect(m.run.debug.marks.value.length).toBeGreaterThan(0);
    await m.run.run();
    clock.frame();
    await flushPromises();
    expect(m.w.find('[data-testid="source-run-changed"]').exists()).toBe(false);
    expect(m.sent.at(-1)!.length).toBeGreaterThan(0);
  });

  it('a pause at a breakpoint lights the line, puts ▶ in the gutter, and scrolls to it without moving the selection', async () => {
    const { clock } = await prepare(holder, LOOP);
    const m = await mountSource(SourceTab, holder, clock);
    w = m.w;
    const v = m.view();
    v.dispatch({ selection: { anchor: v.state.doc.line(1).from } });
    clickGutter(v, 5);
    await flushPromises();
    await m.run.run();
    const before = m.transactions.length;
    clock.frame();
    await flushPromises();
    expect(m.run.debug.mode.value).toBe('paused');
    expect(m.run.debug.marks.value.find((x) => x.class === 'fg-run-paused')?.line).toBe(5);
    expect(v.dom.querySelector('.cm-line.fg-run-paused')?.textContent).toContain('DEC');
    expect(gutterMarks(v).map((g) => g.text).sort()).toEqual(['▶', '●'].sort());
    // A scroll to line 5's start, and the selection where it was.
    const scrolls = m.transactions.slice(before).filter((tr) => tr.effects.some((e) => (e.value as { range?: { from: number } } | null)?.range?.from === v.state.doc.line(5).from));
    expect(scrolls.length).toBe(1);
    expect(v.state.selection.main.head).toBe(0);
    expect(m.transactions.slice(before).every((tr) => !tr.selection)).toBe(true);
  });

  it('a paused stop names the line in run.message, and a step moves the paused line', async () => {
    const { clock } = await prepare(holder, LOOP);
    const m = await mountSource(SourceTab, holder, clock);
    w = m.w;
    clickGutter(m.view(), 5);
    await flushPromises();
    await m.run.run();
    clock.frame();
    await flushPromises();
    expect(m.run.debug.announce.value).toBe('Paused at line 5, DEC A, at a breakpoint.');
    expect(m.run.message.value).toBe('Paused at line 5, DEC A, at a breakpoint.');
    m.run.debug.step();
    await flushPromises();
    expect(m.run.debug.marks.value.find((x) => x.class === 'fg-run-paused')?.line).toBe(6);
    expect(m.run.debug.announce.value).toBe('Line 6, JR LOOP. Changed: A, F.');
    m.run.debug.continue();
    expect(m.run.debug.mode.value).toBe('running');
    clock.frame();
    expect(m.run.debug.mode.value).toBe('paused');
  });
});
