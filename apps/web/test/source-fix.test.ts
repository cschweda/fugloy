import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { Transaction } from '@codemirror/state';
import { history, undo } from '@codemirror/commands';
import { assemble } from '@fugloy/asm';
import { fixSpec } from '../app/utils/source/fix';
import { lineMarks } from '../app/utils/source/decorate';

const SRC = '\tORG\t7000H\n\tPUSH\tA\t; save it\n\tJP\tHL\n';

/** Runs an undo on a bare state, returning the state after it. */
function undone(state: EditorState): EditorState {
  let next = state;
  undo({ state, dispatch: (tr: Transaction) => (next = tr.state) });
  return next;
}

describe('applying a fix', () => {
  it('replaces exactly column..endColumn of its line with the replacement', () => {
    const state = EditorState.create({ doc: SRC });
    const fix = assemble(SRC).diagnostics.find((d) => d.message.startsWith('PUSH'))!.fix!;
    const after = state.update(fixSpec(state.doc, fix)!).state;
    expect(after.doc.toString()).toBe('\tORG\t7000H\n\tPUSH AF\t; save it\n\tJP\tHL\n');
    const fixed = assemble(after.doc.toString()).diagnostics.filter((d) => d.severity === 'error');
    expect(fixed.map((d) => d.line)).toEqual([3]);
  });

  it('is one undo step of its own, even right after typing', () => {
    let state = EditorState.create({ doc: SRC, extensions: [history()] });
    // Type a character at the end, as the user would, then fix at once.
    state = state.update({ changes: { from: state.doc.length, insert: 'X' }, userEvent: 'input.type' }).state;
    const fix = assemble(SRC).diagnostics.find((d) => d.message.startsWith('JP HL'))!.fix!;
    state = state.update(fixSpec(state.doc, fix)!).state;
    expect(state.doc.toString()).toBe('\tORG\t7000H\n\tPUSH\tA\t; save it\n\tJP (HL)\nX');
    state = undone(state);
    expect(state.doc.toString()).toBe(`${SRC}X`);
    state = undone(state);
    expect(state.doc.toString()).toBe(SRC);
  });

  it('refuses a fix whose line no longer holds the text it was made for', () => {
    const state = EditorState.create({ doc: SRC });
    const fix = assemble(SRC).diagnostics.find((d) => d.message.startsWith('PUSH'))!.fix!;
    expect(fixSpec(state.doc, fix, 'PUSH\tA')).not.toBeNull();
    expect(fixSpec(state.doc, fix, 'POP\tA')).toBeNull();
    expect(fixSpec(state.doc, { ...fix, line: 40 })).toBeNull();
  });
});

describe('comment and label marks', () => {
  it('marks a comment from its semicolon, but not a semicolon in a string', () => {
    expect(lineMarks("\tLD\tA,';'\t; a semicolon")).toEqual([{ from: 10, to: 23, kind: 'comment' }]);
    expect(lineMarks('; all comment')).toEqual([{ from: 0, to: 13, kind: 'comment' }]);
  });

  it('marks a label in column 1 or one ending in a colon', () => {
    expect(lineMarks('START:\tLD\tHL,3C00H')).toEqual([{ from: 0, to: 6, kind: 'label' }]);
    expect(lineMarks('LOOP\tJR\tLOOP ; again')).toEqual([
      { from: 0, to: 4, kind: 'label' },
      { from: 13, to: 20, kind: 'comment' },
    ]);
    expect(lineMarks('   wait:  jr wait')).toEqual([{ from: 3, to: 8, kind: 'label' }]);
    expect(lineMarks('\tLD\tA,B')).toEqual([]);
    // An instruction alone in column 1 is the instruction, as asm reads it.
    expect(lineMarks('ret ; done')).toEqual([{ from: 4, to: 10, kind: 'comment' }]);
    expect(lineMarks('DONE')).toEqual([{ from: 0, to: 4, kind: 'label' }]);
  });
});
