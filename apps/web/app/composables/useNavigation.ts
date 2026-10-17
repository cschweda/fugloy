// Browser-style navigation over the cursor: following a link pushes where you
// were, back and forward walk the two stacks. DOM-free; the page hands in what
// scrolls the listing.
import { computed, ref, watch } from 'vue';
import type { ComputedRef } from 'vue';
import { useWorkbench } from './useWorkbench';
import type { Workbench } from './useWorkbench';

export interface Navigation {
  goTo(addr: number): void;
  back(): void;
  forward(): void;
  canBack: ComputedRef<boolean>;
  canForward: ComputedRef<boolean>;
}

export function createNavigation(wb: Workbench, scroll: (addr: number) => void): Navigation {
  const backStack = ref<number[]>([]);
  const forwardStack = ref<number[]>([]);

  function show(addr: number): void {
    wb.cursor.value = addr;
    wb.selection.value = null;
    scroll(addr);
  }

  function goTo(addr: number): void {
    const here = wb.cursor.value;
    if (here !== addr) {
      if (here !== null) backStack.value.push(here);
      forwardStack.value = [];
    }
    show(addr);
  }

  function back(): void {
    const to = backStack.value.pop();
    if (to === undefined) return;
    if (wb.cursor.value !== null) forwardStack.value.push(wb.cursor.value);
    show(to);
  }

  function forward(): void {
    const to = forwardStack.value.pop();
    if (to === undefined) return;
    if (wb.cursor.value !== null) backStack.value.push(wb.cursor.value);
    show(to);
  }

  // A different program has different addresses: start over. (No stop handle: lives with the page.)
  let seen = wb.openCount.value;
  watch(
    wb.openCount,
    (n) => {
      if (n === seen) return;
      seen = n;
      backStack.value = [];
      forwardStack.value = [];
    },
    { flush: 'sync' },
  );

  return { goTo, back, forward, canBack: computed(() => backStack.value.length > 0), canForward: computed(() => forwardStack.value.length > 0) };
}

/** The page's navigation; `scroll` moves the listing. */
export function useNavigation(scroll: (addr: number) => void): Navigation {
  return createNavigation(useWorkbench(), scroll);
}
