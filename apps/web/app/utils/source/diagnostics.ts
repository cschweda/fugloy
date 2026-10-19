// asm's diagnostics as CodeMirror lint diagnostics (plan 5B, Task 3). asm
// counts columns from 1 by character, a tab being one column, and endColumn is
// just past the last character; CodeMirror counts document offsets from 0.
// Loaded only with the Source tab's lazy chunk.
import type { Text } from '@codemirror/state';
import type { Diagnostic as CmDiagnostic } from '@codemirror/lint';
import type { Diagnostic } from '@fugloy/asm';

/** How long after the last keystroke the marks refresh (Ruling 13). */
export const RECHECK_DELAY_MS = 250;

export type AsmFix = NonNullable<Diagnostic['fix']>;

/** The document range of a 1-based line and columns, kept inside the line; an empty range covers one character where the line has one. */
export function columnsToRange(doc: Text, at: { line: number; column: number; endColumn: number }): { from: number; to: number } {
  const line = doc.line(Math.min(Math.max(at.line, 1), doc.lines));
  const from = line.from + Math.min(Math.max(at.column - 1, 0), line.length);
  let to = line.from + Math.min(Math.max(at.endColumn - 1, 0), line.length);
  if (to < from) to = from;
  if (to === from && to < line.to) to = from + 1;
  return { from, to };
}

/** The lint diagnostics for asm's, each with a Fix action when asm gives a fix; `onFix` applies it. */
export function toCmDiagnostics(doc: Text, diags: readonly Diagnostic[], onFix: (fix: AsmFix) => void): CmDiagnostic[] {
  return diags.map((d) => {
    const { from, to } = columnsToRange(doc, d);
    const fix = d.fix;
    return {
      from,
      to,
      severity: d.severity,
      message: d.message,
      ...(fix === undefined ? {} : { actions: [{ name: 'Fix', apply: () => onFix(fix) }] }),
    };
  });
}

/** "Error", "Warning" or "Note", for the list under the editor. */
export function severityWord(s: Diagnostic['severity']): string {
  return s === 'error' ? 'Error' : s === 'warning' ? 'Warning' : 'Note';
}
