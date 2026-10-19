// A part of the page loaded on first use by dynamic import (Source ✎ now, Run ▶
// in Task 4), with its loading state and, when the chunk cannot be fetched
// (offline, or a deploy replaced it), a sentence for the page to show beside a
// Retry button that calls `load` again.
import { ref, shallowRef } from 'vue';
import type { Ref, ShallowRef } from 'vue';

export interface Lazy<T> {
  value: ShallowRef<T | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  /** Loads it unless it is loaded or loading; after a failure, tries again. */
  load(): Promise<void>;
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
