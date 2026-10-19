// @vitest-environment happy-dom
// Run ▶'s keys (plan 5B, Rulings 8 and 9): Ctrl/⌘+Enter runs from anywhere in the workbench,
// the editor, own-keys panels and text fields included, exactly once; keys reach the TRS-80
// only while its screen has focus, Tab and modified keys pass through, and blur releases
// every key. A file dropped on the Run tab is kept as a ROM, not opened as a program.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { computed, defineComponent, h, ref, shallowRef } from 'vue';
import starter from '@fugloy/asm-examples/clear-screen.z?raw';
import { assemble } from '@fugloy/asm';
import { useWorkbenchKeys } from '../app/composables/useWorkbenchKeys';
import { createSources } from '../app/composables/useSources';
import type { Sources } from '../app/composables/useSources';
import type { Roms } from '../app/composables/useRoms';
import type { Run } from '../app/composables/useRun';
import { prepareMachine } from '../app/utils/emulator/boot';
import { stubRom } from '../app/utils/emulator/stub-rom';
import TrsScreen from '../app/components/run/TrsScreen.vue';

let sources: Sources = createSources({ open: async () => null, starter: async () => starter });
vi.mock('../app/composables/useSources', async (orig) => ({
  ...(await orig<typeof import('../app/composables/useSources')>()),
  useSources: () => sources,
}));
const added: { name: string; model: number | undefined; fallback: number | undefined }[] = [];
const fakeRoms: Roms = {
  have: () => false,
  info: () => null,
  bytes: async () => null,
  add: async (file, model, fallback) => {
    added.push({ name: file.name, model, fallback });
    return { ok: true, model: 3 };
  },
  remove: async () => {},
  start: async () => null,
  unavailable: computed(() => null),
};
vi.mock('../app/composables/useRoms', async (orig) => ({ ...(await orig<typeof import('../app/composables/useRoms')>()), useRoms: () => fakeRoms }));
const fakeRun: Run = {
  run: vi.fn(async () => {}),
  stop: vi.fn(),
  runner: shallowRef(null),
  lastResult: shallowRef(null),
  message: ref(null),
  problem: ref(false),
  state: ref('idle'),
  report: shallowRef(null),
  reveal: shallowRef(null),
  showInListing: vi.fn(async () => {}),
  onFrame: () => () => {},
  busy: ref(false),
};
const { default: SourceTab } = await import('../app/components/source/SourceTab.vue');
const { default: RunTab } = await import('../app/components/run/RunTab.vue');

// happy-dom fires selectionchange inside CodeMirror's own update (see source-tab.test.ts).
window.addEventListener('selectionchange', (e) => e.stopImmediatePropagation(), true);

let w: VueWrapper | null = null;
afterEach(() => {
  w?.unmount();
  w = null;
  document.body.innerHTML = '';
});

function attach(c: Parameters<typeof mount>[0], props: Record<string, unknown> = {}): VueWrapper {
  const host = document.createElement('div');
  document.body.append(host);
  w = mount(c, { attachTo: host, props });
  return w;
}

const ctrlEnter = (el: Element): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e;
};

describe('the Run key', () => {
  function page(opts: { active?: boolean; anywhere?: boolean; inside?: () => ReturnType<typeof h> } = {}) {
    const runs: string[] = [];
    const Page = defineComponent({
      setup() {
        useWorkbenchKeys({
          keys: { 'ctrl+enter': { run: () => runs.push('run'), anywhere: true }, g: { run: () => runs.push('g') } },
          active: () => opts.active ?? true,
          anywhereActive: () => opts.anywhere ?? true,
          inListing: (t) => t instanceof Element && t.closest('.fg-listing') !== null,
        });
        return () =>
          h('div', [
            h('div', { class: 'fg-listing', tabindex: 0, id: 'listing' }),
            h('input', { id: 'goto' }),
            h('div', { 'data-own-keys': '' }, [h('button', { id: 'own' }, 'x'), h('div', { id: 'editable', contenteditable: 'true' }), opts.inside?.()]),
          ]);
      },
    });
    attach(Page);
    return runs;
  }

  it('fires from the page, the listing, a text field, an own-keys panel, and editable text', () => {
    const runs = page();
    for (const el of [document.body, ...['listing', 'goto', 'own', 'editable'].map((id) => document.getElementById(id)!)]) expect(ctrlEnter(el).defaultPrevented).toBe(true);
    expect(runs).toEqual(['run', 'run', 'run', 'run', 'run']);
  });

  it('fires with no program open while the workbench is (anywhereActive), but not when it is closed or a dialog is open', () => {
    const runs = page({ active: false, anywhere: true });
    ctrlEnter(document.body);
    expect(runs).toEqual(['run']);
    w!.unmount();
    const closed = page({ anywhere: false });
    ctrlEnter(document.body);
    expect(closed).toEqual([]);
    const d = document.createElement('dialog');
    d.setAttribute('open', '');
    document.body.append(d);
    ctrlEnter(document.body);
    expect(closed).toEqual([]);
  });

  it('runs once from the editor: its keymap handles the key, and the page leaves a handled key alone', async () => {
    sources = createSources({ open: async () => null, starter: async () => starter });
    const editorRuns: string[] = [];
    const runs = page({ inside: () => h(SourceTab, { onRun: () => editorRuns.push('run') }) });
    await flushPromises();
    await flushPromises();
    const content = document.querySelector('.cm-content')!;
    const e = ctrlEnter(content);
    expect(e.defaultPrevented).toBe(true);
    expect(editorRuns).toEqual(['run']);
    expect(runs).toEqual([]);
  });
});

describe("the TRS-80 screen's keys", () => {
  async function screen() {
    const result = assemble(starter, { model: 3 });
    const machine = prepareMachine({ model: 3, rom: stubRom(3), result });
    const k = machine.system.keyboard;
    const down = vi.spyOn(k, 'keyDown');
    const reset = vi.spyOn(k, 'reset');
    const Host = defineComponent({
      setup: () => () => h('div', [h('input', { id: 'goto' }), h('div', { id: 'editable', contenteditable: 'true' }), h(TrsScreen, { machine, running: true })]),
    });
    attach(Host);
    await flushPromises();
    return { el: document.querySelector('[data-testid="trs-screen"]') as HTMLElement, down, reset, machine };
  }
  const key = (el: Element, init: KeyboardEventInit, type = 'keydown'): KeyboardEvent => {
    const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(e);
    return e;
  };

  it('keys typed in the editor or the G box never reach the matrix', async () => {
    const { down } = await screen();
    key(document.getElementById('goto')!, { key: 'a', code: 'KeyA' });
    key(document.getElementById('editable')!, { key: 'a', code: 'KeyA' });
    expect(down).not.toHaveBeenCalled();
  });

  it('keys reach it while the screen has focus; Tab and Ctrl keys pass through; blur releases every key', async () => {
    const { el, down, reset } = await screen();
    el.focus();
    expect(document.activeElement).toBe(el);
    expect(key(el, { key: 'a', code: 'KeyA' }).defaultPrevented).toBe(true);
    expect(down).toHaveBeenCalledWith('a', 'KeyA');
    down.mockClear();
    expect(key(el, { key: 'Tab', code: 'Tab' }).defaultPrevented).toBe(false);
    expect(key(el, { key: 'Enter', code: 'Enter', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(down).not.toHaveBeenCalled();
    el.blur();
    expect(reset).toHaveBeenCalled();
  });

  it('is an application a screen reader can name, and says how to type to it while it runs unfocused', async () => {
    const { el } = await screen();
    expect(el.getAttribute('role')).toBe('application');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('aria-label')).toMatch(/keys you type go to the TRS-80; press Tab to leave/);
    expect(el.textContent).toContain('Click the screen to type to the TRS-80');
    el.focus();
    await flushPromises();
    expect(el.textContent).not.toContain('Click the screen');
  });
});

describe('the Run tab', () => {
  it('keeps a file dropped on it as a ROM for its model, and the page never sees the drop', async () => {
    sources = createSources({ open: async () => null, starter: async () => starter });
    await sources.start();
    await sources.create({ text: starter, model: 1 });
    const pageDrops: Event[] = [];
    document.addEventListener('drop', (e) => pageDrops.push(e));
    attach(RunTab, { run: fakeRun, sources });
    await flushPromises();
    const file = new File([new Uint8Array(0x3000)], 'level2.rom');
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file], types: ['Files'] } });
    document.querySelector('[data-testid="run-tab"]')!.dispatchEvent(drop);
    await flushPromises();
    expect(drop.defaultPrevented).toBe(true);
    expect(added).toEqual([{ name: 'level2.rom', model: undefined, fallback: 1 }]);
    expect(pageDrops).toEqual([]);
    expect(document.querySelector('[data-testid="run-rom-message"]')!.textContent).toBe('level2.rom is kept in this browser as the Model III ROM. Press Run to use it.');
  });

  it('Run, Stop and the model select drive Run and the source', async () => {
    sources = createSources({ open: async () => null, starter: async () => starter });
    await sources.start();
    await sources.create();
    const t = attach(RunTab, { run: fakeRun, sources });
    await flushPromises();
    await t.get('[data-testid="run-run"]').trigger('click');
    expect(fakeRun.run).toHaveBeenCalled();
    await t.get('[data-testid="run-model"]').setValue('4');
    expect(sources.current.value?.model).toBe(4);
    expect(t.get('[data-testid="run-message"]').text()).toContain('on a fresh Model 4');
  });
});
