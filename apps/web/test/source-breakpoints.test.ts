// @vitest-environment happy-dom
// Breakpoints in Source ✎'s gutter (phase 5C Ruling 8): a click sets one, saved with the source;
// edits carry it with its line, and deleting the line removes it; a line with no instruction shows
// a hollow mark saying why; a toggle while running reaches emu at once, but waits for the next Run
// once the source has changed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { breakpointLines } from '../app/utils/source/run-marks';
import type { Holder } from './source-run-support';
import { clickGutter, FakeIO, gutterMarks, LOOP, memoryStore, mountSource, prepare } from './source-run-support';

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

let w: VueWrapper | null = null;
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', FakeIO);
});
afterEach(() => {
  holder.run?.stop();
  w?.unmount();
  w = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('breakpoints in the Source gutter', () => {
  it('a click on line 5 sets a breakpoint, saved with the source 500 ms later', async () => {
    const mem = memoryStore();
    const { clock } = await prepare(holder, LOOP, { store: mem.store });
    const m = await mountSource(SourceTab, holder, clock);
    w = m.w;
    vi.useFakeTimers();
    mem.puts.length = 0;
    clickGutter(m.view(), 5);
    await flushPromises();
    expect(breakpointLines(m.view().state)).toEqual([5]);
    expect(gutterMarks(m.view())).toEqual([{ text: '●', title: expect.stringMatching(/^Breakpoint/) }]);
    expect(m.sources.current.value?.breakpoints).toEqual([5]);
    expect(m.run.debug.breakpoints.value).toEqual([5]);
    await vi.advanceTimersByTimeAsync(499);
    expect(mem.puts).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(mem.puts.at(-1)?.breakpoints).toEqual([5]);
    // A second click removes it.
    clickGutter(m.view(), 5);
    await flushPromises();
    expect(breakpointLines(m.view().state)).toEqual([]);
    expect(m.sources.current.value?.breakpoints).toEqual([]);
  });

  it('inserting 2 lines above moves it to line 7, and deleting its line removes it', async () => {
    const { clock } = await prepare(holder, LOOP);
    const m = await mountSource(SourceTab, holder, clock);
    w = m.w;
    clickGutter(m.view(), 5);
    await flushPromises();
    const v = m.view();
    v.dispatch({ changes: { from: v.state.doc.line(2).from, insert: '; one\n; two\n' }, userEvent: 'input.type' });
    await flushPromises();
    expect(breakpointLines(v.state)).toEqual([7]);
    expect(m.sources.current.value?.breakpoints).toEqual([7]);
    // Typing inside the line keeps it there.
    v.dispatch({ changes: { from: v.state.doc.line(7).from, insert: ' ' }, userEvent: 'input.type' });
    expect(breakpointLines(v.state)).toEqual([7]);
    const line = v.state.doc.line(7);
    v.dispatch({ changes: { from: line.from, to: line.to + 1 }, userEvent: 'delete' });
    await flushPromises();
    expect(breakpointLines(v.state)).toEqual([]);
    expect(m.sources.current.value?.breakpoints).toEqual([]);
  });

  it('opens a source with its saved breakpoints', async () => {
    const { clock, sources } = await prepare(holder, LOOP);
    sources.update(sources.current.value!.id, { breakpoints: [4, 6] });
    const m = await mountSource(SourceTab, holder, clock);
    w = m.w;
    expect(breakpointLines(m.view().state)).toEqual([4, 6]);
  });

  it('a line with no code shows a hollow mark that says why', async () => {
    const { clock } = await prepare(holder, LOOP);
    const m = await mountSource(SourceTab, holder, clock);
    w = m.w;
    await m.run.run();
    clickGutter(m.view(), 3);
    await flushPromises();
    expect(m.run.debug.inactive.value).toEqual([3]);
    expect(gutterMarks(m.view())).toEqual([{ text: '○', title: 'Line 3 has no instruction to stop at.' }]);
    // No emu breakpoint for it.
    expect(m.run.runner.value!.machine.debug.breaks).toEqual([]);
  });

  it('a toggle while running sets or removes the emu breakpoint at once; once the source changed, it waits for the next Run', async () => {
    const { clock } = await prepare(holder, LOOP);
    const m = await mountSource(SourceTab, holder, clock);
    w = m.w;
    await m.run.run();
    const mach = m.run.runner.value!.machine;
    clickGutter(m.view(), 5);
    await flushPromises();
    expect(mach.debug.breaks.map((b) => b.addr)).toEqual([m.run.lastResult.value!.sourceMap.addressesOf(5)[0]]);
    clock.frame();
    expect(m.run.debug.mode.value).toBe('paused');
    clickGutter(m.view(), 5);
    await flushPromises();
    expect(mach.debug.breaks).toEqual([]);
    // An edit: the running program no longer matches the text, so a toggle waits.
    const v = m.view();
    v.dispatch({ changes: { from: v.state.doc.length, insert: '; more\n' }, userEvent: 'input.type' });
    await flushPromises();
    expect(m.run.debug.dirty.value).toBe(true);
    clickGutter(v, 4);
    await flushPromises();
    expect(m.sources.current.value?.breakpoints).toEqual([4]);
    expect(mach.debug.breaks).toEqual([]);
    // The next Run applies it.
    await m.run.run();
    const next = m.run.runner.value!.machine;
    expect(next.debug.breaks.map((b) => b.addr)).toEqual([m.run.lastResult.value!.sourceMap.addressesOf(4)[0]]);
  });
});
