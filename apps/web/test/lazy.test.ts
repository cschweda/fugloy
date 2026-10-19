// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { lazyComponent, lazyLoad, loadFailed } from '../app/utils/lazy';

describe('lazyLoad', () => {
  it('loads once, even when asked twice at the same time', async () => {
    let calls = 0;
    const l = lazyLoad(async () => (calls++, 'tab'), 'failed');
    expect(l.loading.value).toBe(false);
    const a = l.load();
    expect(l.loading.value).toBe(true);
    await Promise.all([a, l.load()]);
    await l.load();
    expect(calls).toBe(1);
    expect(l.value.value).toBe('tab');
    expect(l.loading.value).toBe(false);
  });

  it('gives the failure sentence when the load fails, and a retry can succeed', async () => {
    let fail = true;
    const l = lazyLoad(async () => {
      if (fail) throw new TypeError('Failed to fetch dynamically imported module');
      return 'tab';
    }, 'The editor could not be loaded. Press Retry.');
    await l.load();
    expect(l.value.value).toBeNull();
    expect(l.error.value).toBe('The editor could not be loaded. Press Retry.');
    expect(l.loading.value).toBe(false);
    fail = false;
    await l.load();
    expect(l.error.value).toBeNull();
    expect(l.value.value).toBe('tab');
  });
});

describe('loadFailed', () => {
  it('ends on the next step alone when that step is reloading', () => {
    expect(loadFailed('The Explain tab', 'Reload the page')).toMatch(/since this page opened\. Reload the page\.$/);
    expect(loadFailed('The Run tab')).toMatch(/Press Retry, or reload the page if that fails\.$/);
  });
});

describe('lazyComponent', () => {
  const Tab = defineComponent({ render: () => h('p', 'the tab') });

  it('tries a failed load once more, and shows the tab when the second try works', async () => {
    let calls = 0;
    const C = lazyComponent(async () => {
      if (++calls === 1) throw new TypeError('Failed to fetch dynamically imported module');
      return { __esModule: true, default: Tab }; // as a dynamic import's module object
    }, 'The Explain tab');
    const w = mount(defineComponent({ render: () => h('div', [h(C)]) }));
    await vi.waitFor(() => expect(w.text()).toBe('the tab'));
    expect(calls).toBe(2);
    expect(w.text()).toBe('the tab');
  });

  it('after the second failure shows a sentence whose next step is reloading', async () => {
    let calls = 0;
    const C = lazyComponent(async () => {
      calls++;
      throw new TypeError('Failed to fetch dynamically imported module');
    }, 'The Explain tab', undefined, 'explain-load-error');
    const w = mount(defineComponent({ render: () => h('div', [h(C)]) }));
    await flushPromises();
    await flushPromises();
    expect(calls).toBe(2);
    const alert = w.get('[data-testid="explain-load-error"]');
    expect(alert.attributes('role')).toBe('alert');
    expect(alert.text()).toBe(loadFailed('The Explain tab', 'Reload the page'));
  });
});
