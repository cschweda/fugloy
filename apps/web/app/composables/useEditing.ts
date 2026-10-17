// Editing the open program: each edit is a new hint file (utils/edits), applied
// by re-analyzing. Undo and redo are two stacks of hint files, so undo restores
// the previous file exactly and can never disagree with it. DOM-free.
import { computed, shallowRef, watch } from 'vue';
import type { ComputedRef } from 'vue';
import { OpenError, withHintFile, writeHints } from '@fugloy/disasm';
import type { HintFile, Session } from '@fugloy/disasm';
import { applyEdit, applyHintLines } from '../utils/edits';
import type { Edit, EditResult } from '../utils/edits';
import { useWorkbench } from './useWorkbench';
import type { Workbench } from './useWorkbench';

export interface Editing {
  /** Applies an edit; returns why it was refused (the hint file then stays as it was), or null. */
  apply(e: Edit): string | null;
  /** Adds a proposal's hint lines, as one undoable edit. */
  applyLines(lines: readonly string[]): string | null;
  undo(): void;
  redo(): void;
  canUndo: ComputedRef<boolean>;
  canRedo: ComputedRef<boolean>;
}

function analyzed(s: Session, file: HintFile): Session | string {
  try {
    return withHintFile(s, file, s.hintSource);
  } catch (err) {
    if (err instanceof OpenError) return [err.message, ...err.details].join(': ');
    return err instanceof Error ? err.message : String(err);
  }
}

export function createEditing(wb: Workbench): Editing {
  const past = shallowRef<readonly HintFile[]>([]);
  const future = shallowRef<readonly HintFile[]>([]);

  // Another program, another history. (No stop handle: lives as long as the workbench.)
  watch(
    wb.openCount,
    () => {
      past.value = [];
      future.value = [];
    },
    { flush: 'sync' },
  );

  /** Moves the session to `file`; the cursor stays on its address, since it is one. */
  function show(s: Session, file: HintFile): string | null {
    const next = analyzed(s, file);
    if (typeof next === 'string') return next;
    wb.session.value = next;
    return null;
  }

  function commit(r: EditResult): string | null {
    const s = wb.session.value;
    if (s === null) return 'no program is open';
    if ('error' in r) return r.error;
    // An edit that changes nothing (removing a comment that is not there) is not a step to undo.
    if (writeHints(r.file) === writeHints(s.hintFile)) return null;
    const error = show(s, r.file);
    if (error !== null) return error;
    past.value = [...past.value, s.hintFile];
    future.value = [];
    return null;
  }

  function step(from: typeof past, to: typeof past): void {
    const s = wb.session.value;
    const file = from.value.at(-1);
    if (s === null || file === undefined) return;
    if (show(s, file) !== null) return;
    from.value = from.value.slice(0, -1);
    to.value = [...to.value, s.hintFile];
  }

  return {
    apply: (e) => (wb.session.value === null ? 'no program is open' : commit(applyEdit(wb.session.value, e))),
    applyLines: (lines) => (wb.session.value === null ? 'no program is open' : commit(applyHintLines(wb.session.value, lines))),
    undo: () => step(past, future),
    redo: () => step(future, past),
    canUndo: computed(() => past.value.length > 0),
    canRedo: computed(() => future.value.length > 0),
  };
}

let shared: Editing | null = null;

/** The workbench's one edit history. */
export function useEditing(): Editing {
  shared ??= createEditing(useWorkbench());
  return shared;
}
