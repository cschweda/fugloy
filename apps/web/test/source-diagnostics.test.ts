import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { assemble } from '@fugloy/asm';
import { columnsToRange, toCmDiagnostics } from '../app/utils/source/diagnostics';

const SRC = '\tORG\t7000H\n\tMOV\tA,B\n\tPUSH\tA\n\tLDA\n\tADD\tA,(5)\n';

describe('asm diagnostics as CodeMirror ranges', () => {
  it('maps a 1-based line and columns (endColumn exclusive) to the characters they name, a tab counting as one column', () => {
    const state = EditorState.create({ doc: SRC });
    const diags = assemble(SRC).diagnostics;
    const lda = diags.find((d) => d.message.includes('LDA'))!;
    const r = columnsToRange(state.doc, lda);
    expect(state.doc.sliceString(r.from, r.to)).toBe('LDA');
    const push = diags.find((d) => d.message.startsWith('PUSH'))!;
    const p = columnsToRange(state.doc, push);
    expect(state.doc.sliceString(p.from, p.to)).toBe('A');
    // Two tabs before the word: columns 3..6 are 'abc'.
    const doc = EditorState.create({ doc: 'x\n\t\tabc def\n' }).doc;
    const q = columnsToRange(doc, { line: 2, column: 3, endColumn: 6 });
    expect(doc.sliceString(q.from, q.to)).toBe('abc');
  });

  it('keeps a range inside its line: past the end it stops at the end, an empty range covers one character where it can', () => {
    const doc = EditorState.create({ doc: 'ab\ncd' }).doc;
    expect(columnsToRange(doc, { line: 1, column: 2, endColumn: 40 })).toEqual({ from: 1, to: 2 });
    expect(columnsToRange(doc, { line: 2, column: 1, endColumn: 1 })).toEqual({ from: 3, to: 4 });
    expect(columnsToRange(doc, { line: 9, column: 1, endColumn: 2 })).toEqual({ from: 3, to: 4 });
    const empty = EditorState.create({ doc: 'a\n\nb' }).doc;
    expect(columnsToRange(empty, { line: 2, column: 1, endColumn: 1 })).toEqual({ from: 2, to: 2 });
  });

  it('counts columns in UTF-16 code units, as asm does, and never splits an astral character', () => {
    // asm's columns are string indices: after an astral character (two code units) they run one ahead of the characters seen.
    const src = "\tORG\t7000H\n\tDB\t'\u{1F600}'\n";
    const asmDiag = assemble(src).diagnostics[0]!;
    expect({ line: asmDiag.line, column: asmDiag.column, endColumn: asmDiag.endColumn }).toEqual({ line: 2, column: 6, endColumn: 7 });
    const doc = EditorState.create({ doc: src }).doc;
    const r = columnsToRange(doc, asmDiag);
    // asm names only the high surrogate; the mark takes the whole character.
    expect(doc.sliceString(r.from, r.to)).toBe('\u{1F600}');
    const line = EditorState.create({ doc: "\tDB '\u{1F600}',ZZZ" }).doc;
    const z = columnsToRange(line, { line: 1, column: 10, endColumn: 13 });
    expect(line.sliceString(z.from, z.to)).toBe('ZZZ');
  });

  it('carries severity and message, and offers a Fix action only where asm gives a fix', () => {
    const state = EditorState.create({ doc: SRC });
    const diags = assemble(SRC).diagnostics;
    const cm = toCmDiagnostics(state.doc, diags, () => undefined);
    expect(cm).toHaveLength(diags.length);
    const lda = cm.find((d) => d.message.includes('LDA'))!;
    expect(lda.severity).toBe('error');
    expect(lda.actions ?? []).toHaveLength(0);
    const add = cm.find((d) => d.message.startsWith('ADD'))!;
    expect(add.severity).toBe('warning');
    expect(add.actions?.map((a) => a.name)).toEqual(['Fix']);
  });

  it('hands the Fix action the asm fix, so the editor applies it', () => {
    const state = EditorState.create({ doc: SRC });
    const diags = assemble(SRC).diagnostics;
    const got: unknown[] = [];
    const cm = toCmDiagnostics(state.doc, diags, (fix) => got.push(fix));
    const mov = cm.find((d) => d.message.startsWith('MOV'))!;
    mov.actions![0]!.apply(null as never, mov.from, mov.to);
    expect(got).toEqual([{ line: 2, column: 2, endColumn: 9, replacement: 'LD A,B' }]);
  });
});
