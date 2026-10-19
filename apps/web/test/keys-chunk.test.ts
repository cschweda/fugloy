// @vitest-environment happy-dom
// When the debug keys' chunk is slow or cannot load (phase 5C): pauses are still spoken (the
// announcer is installed by the tabs themselves), Run ▶'s Run to Here says "still loading" or
// "could not be loaded", nothing is written after unmount, and Source ✎ tries twice before its
// status line says the keys are missing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import type { Roms } from '../app/composables/useRoms';
import { announcing } from '../app/utils/running/announce';
import type { Holder } from './source-run-support';
import { FakeIO, LOOP, mountSource, prepare } from './source-run-support';

const gate = vi.hoisted(() => ({ fail: 0, calls: 0, wait: null as Promise<void> | null }));
vi.mock('../app/utils/running/debug-keys', async (orig) => {
  gate.calls++;
  if (gate.wait !== null) await gate.wait;
  if (gate.fail > 0) {
    gate.fail--;
    throw new Error('offline');
  }
  return orig();
});

const holder: Holder = { sources: null, run: null };
const noRoms: Roms = { have: () => false, info: () => null, bytes: async () => null, add: async () => ({ ok: false, reason: 'x' }), remove: async () => {}, start: async () => null, unavailable: { value: null } as Roms['unavailable'] };
vi.mock('../app/composables/useRoms', async (orig) => ({ ...(await orig<typeof import('../app/composables/useRoms')>()), useRoms: () => noRoms }));
vi.mock('../app/composables/useSources', async (orig) => ({ ...(await orig<typeof import('../app/composables/useSources')>()), useSources: () => holder.sources }));
vi.mock('../app/composables/useRun', async (orig) => ({ ...(await orig<typeof import('../app/composables/useRun')>()), useRun: () => holder.run }));
const { default: RunTab } = await import('../app/components/run/RunTab.vue');
const { default: SourceTab } = await import('../app/components/source/SourceTab.vue');
window.addEventListener('selectionchange', (e) => e.stopImmediatePropagation(), true);

let w: VueWrapper | null = null;
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', FakeIO);
});
afterEach(() => {
  holder.run?.stop();
  w?.unmount();
  w = null;
  gate.fail = 0;
  gate.wait = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
const region = (): string => document.querySelector('[data-testid="debug-announcer"]')?.textContent?.trim() ?? '';

describe('without the debug keys chunk', () => {
  it('Run ▶ still speaks a breakpoint pause, mutes its message only while the announcer listens, and says the keys failed', async () => {
    gate.fail = 99;
    const { run, sources, clock } = await prepare(holder, LOOP);
    w = mount(RunTab, { props: { run, sources }, attachTo: document.body });
    await flushPromises();
    expect(run.message.value).toMatch(/^The debugger could not be loaded: .*Reload the page\.$/);
    run.debug.toggleBreakpoint(5);
    await run.run();
    clock.frame();
    await flushPromises();
    expect(region()).toBe('Paused at line 5, DEC A, at a breakpoint.');
    const msg = w.get('[data-testid="run-message"]');
    expect(msg.text()).toBe('Paused at line 5, DEC A, at a breakpoint.');
    expect(msg.attributes('aria-live')).toBe('off');
    // Not listening: the run message is the voice again.
    announcing.value = false;
    await nextTick();
    expect(msg.attributes('aria-live')).toBe('polite');
    announcing.value = true;
    await w.get('[data-testid="run-to-here"]').trigger('click');
    expect(run.message.value).toMatch(/^The debugger could not be loaded/);
  });

  it('Run to Here while the chunk is loading says so; a failure after unmount writes nothing', async () => {
    let release!: () => void;
    gate.wait = new Promise((r) => (release = r));
    gate.fail = 1;
    const { run, sources, clock } = await prepare(holder, LOOP);
    w = mount(RunTab, { props: { run, sources }, attachTo: document.body });
    await flushPromises();
    await run.run();
    clock.frame();
    run.debug.pause();
    await nextTick();
    await w.get('[data-testid="run-to-here"]').trigger('click');
    expect(run.message.value).toBe('The debugger is still loading. Press Run to Here again in a moment.');
    w.unmount();
    w = null;
    run.message.value = 'kept';
    release();
    await flushPromises();
    expect(run.message.value).toBe('kept');
  });

  // Before any test loads the chunk: vitest keeps a module once it has loaded.
  it('Source ✎ tries twice, then its status line says the debug keys are missing', async () => {
    gate.fail = 2;
    gate.calls = 0;
    const { clock } = await prepare(holder, LOOP);
    const m = await mountSource(SourceTab, holder, clock);
    w = m.w;
    await flushPromises();
    expect(gate.calls).toBe(2);
    expect(m.w.get('[data-testid="source-message"]').text()).toMatch(/^The debug keys could not be loaded: .*Reload the page to use F9/);
  });

  it('Source ✎ gets F9 when its second try loads', async () => {
    gate.fail = 1;
    gate.calls = 0;
    const { clock } = await prepare(holder, LOOP);
    const m = await mountSource(SourceTab, holder, clock);
    w = m.w;
    await flushPromises();
    expect(gate.calls).toBe(2);
    m.view().dispatch({ selection: { anchor: m.view().state.doc.line(5).from } });
    // The second try's module arrives a few ticks later.
    await vi.waitFor(() => {
      const e = new KeyboardEvent('keydown', { key: 'F9', bubbles: true, cancelable: true });
      m.view().contentDOM.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    });
    expect(m.run.debug.breakpoints.value).toEqual([5]);
    expect(m.w.text()).not.toContain('The debug keys could not be loaded');
  });
});
