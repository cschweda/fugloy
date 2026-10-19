// What the top bar and the Program tab need of Open as source ✎ (plan 5B, Task 5): whether a
// program can become a source, and the two counts between them and the workbench page. Export ▾
// (in the top bar, on every page) asks by bumping `openAsSourceAsks`; the page does the work,
// loading composables/useOpenAsSource on first use, and bumps `openAsSourceRequests` (through it)
// to show Source ✎. This module imports no part of that, so the top bar stays small.
import { ref } from 'vue';
import type { Session } from '@fugloy/disasm';

/** Whether the program can become a source: machine code, not a BASIC program. */
export const canOpenAsSource = (s: Session): boolean => s.module.format !== 'bas';

/** Bumped by Export ▾'s Open as source ✎: the page opens the program as a source. */
export const openAsSourceAsks = ref(0);

/** Bumped on each open; the page shows Source ✎ when it changes. */
export const openAsSourceRequests = ref(0);
