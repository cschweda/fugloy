import { describe, expect, it } from 'vitest';
import { lazyLoad } from '../app/utils/lazy';

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
