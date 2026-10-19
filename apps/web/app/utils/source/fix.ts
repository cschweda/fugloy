// One-click fixes (plan 5B, Task 3): asm's `fix` replaces columns
// column..endColumn (1-based, end exclusive, a tab one column) of its line.
// The edit is one transaction isolated in the history, so one undo takes it
// back, even right after typing. Loaded only with the Source tab's chunk.
import { Transaction } from '@codemirror/state';
import type { Text, TransactionSpec } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import type { AsmFix } from './diagnostics';

/** The document range the fix replaces, or null when its line or columns are not in the document. */
export function fixRange(doc: Text, fix: AsmFix): { from: number; to: number } | null {
  if (fix.line < 1 || fix.line > doc.lines || fix.column < 1 || fix.endColumn < fix.column) return null;
  const line = doc.line(fix.line);
  if (fix.endColumn - 1 > line.length) return null;
  return { from: line.from + fix.column - 1, to: line.from + fix.endColumn - 1 };
}

/**
 * The transaction that applies the fix, or null when it no longer fits: its
 * line is gone, or (given `expected`, the text it was made for) the text there
 * has changed since asm looked.
 */
export function fixSpec(doc: Text, fix: AsmFix, expected?: string): TransactionSpec | null {
  const r = fixRange(doc, fix);
  if (r === null) return null;
  if (expected !== undefined && doc.sliceString(r.from, r.to) !== expected) return null;
  return {
    changes: { from: r.from, to: r.to, insert: fix.replacement },
    selection: { anchor: r.from + fix.replacement.length },
    annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.fix')],
    scrollIntoView: true,
  };
}
