// A part of the page loaded on first use by dynamic import (Source ✎ now, Run ▶
// in Task 4), with its loading state and, when the chunk cannot be fetched
// (offline, or a deploy replaced it), a sentence for the page to show beside a
// Retry button that calls `load` again.
import { defineAsyncComponent, h, ref, shallowRef } from 'vue';
import type { Component, Ref, ShallowRef } from 'vue';

export interface Lazy<T> {
  value: ShallowRef<T | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  /** Loads it unless it is loaded or loading; after a failure, tries again. */
  load(): Promise<void>;
}

/** The sentence for a part of the site whose chunk could not be fetched: `what` (capitalised) and the next step. */
export const loadFailed = (what: string, next = 'Press Retry'): string =>
  `${what} could not be loaded: the connection may have dropped, or the site was updated since this page opened. ${/^reload/i.test(next) ? `${next}.` : `${next}, or reload the page if that fails.`}`;

/**
 * A component loaded on first show by dynamic import. Vue keeps a rejected load for the page's
 * life, so reopening cannot retry it: it is tried once more at once, and after a second failure
 * says so with reloading as the next step (the only one that works). `loading` is its loading state.
 */
export function lazyComponent(loader: () => Promise<unknown>, what: string, loading?: Component, testid?: string): Component {
  return defineAsyncComponent({
    loader: loader as () => Promise<{ default: never }>,
    ...(loading === undefined ? {} : { loadingComponent: loading, delay: 0 }),
    errorComponent: { render: () => h('p', { role: 'alert', ...(testid === undefined ? {} : { 'data-testid': testid }) }, loadFailed(what, 'Reload the page')) },
    onError: (_err, retry, fail, attempts) => (attempts <= 1 ? retry() : fail()),
  });
}

export function lazyLoad<T>(loader: () => Promise<T>, failure: string): Lazy<T> {
  const value = shallowRef<T | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let pending: Promise<void> | null = null;
  function load(): Promise<void> {
    if (value.value !== null) return Promise.resolve();
    pending ??= (async () => {
      loading.value = true;
      error.value = null;
      try {
        value.value = await loader();
      } catch {
        error.value = failure;
      } finally {
        loading.value = false;
        pending = null;
      }
    })();
    return pending;
  }
  return { value, loading, error, load };
}
