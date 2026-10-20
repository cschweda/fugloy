// The Space Invaders chapters' change marks in CodeMirror (phase 6C Task 1), loaded with the Learn
// page's lesson editor: `setChangeMarks` replaces the set, each a line of the document and whether it
// is new or changed since the chapter before (utils/learn/diff). A new line gets the class
// `fg-chg-new` (a green band) and a `+` in the change gutter; a changed one `fg-chg-changed` (an amber
// bar) and a `~`, so the marks are told apart by more than colour. Each gutter mark is titled with
// what it means. An empty set clears them, and the gutter then takes no room.
import { RangeSet, StateEffect, StateField } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, gutter } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import type { LineMark } from '~/utils/learn/diff';

export interface ChangeMark {
  line: number;
  mark: LineMark;
}

export const setChangeMarks = StateEffect.define<ChangeMark[]>();

const CLASS: Readonly<Record<LineMark, string>> = { new: 'fg-chg-new', changed: 'fg-chg-changed' };

class ChangeMarker extends GutterMarker {
  constructor(readonly mark: LineMark) {
    super();
  }
  override eq(other: GutterMarker): boolean {
    return other instanceof ChangeMarker && other.mark === this.mark;
  }
  override toDOM(): Node {
    const el = document.createElement('span');
    el.className = this.mark === 'new' ? 'fg-chg-plus' : 'fg-chg-tilde';
    el.dataset.testid = 'change-mark';
    el.textContent = this.mark === 'new' ? '+' : '~';
    el.title = this.mark === 'new' ? 'New in this chapter' : 'Changed in this chapter';
    return el;
  }
}
const markers: Readonly<Record<LineMark, ChangeMarker>> = { new: new ChangeMarker('new'), changed: new ChangeMarker('changed') };

/** The marks in the document, sorted, from the last `setChangeMarks`; carried through edits until the next. */
const changeField = StateField.define<{ lines: DecorationSet; gutter: RangeSet<GutterMarker> }>({
  create: () => ({ lines: Decoration.none, gutter: RangeSet.empty }),
  update(value, tr) {
    let next = tr.docChanged ? { lines: value.lines.map(tr.changes), gutter: value.gutter.map(tr.changes) } : value;
    for (const e of tr.effects) {
      if (!e.is(setChangeMarks)) continue;
      const doc = tr.state.doc;
      const marks = e.value.filter((m) => m.line >= 1 && m.line <= doc.lines).sort((a, b) => a.line - b.line);
      next = {
        lines: Decoration.set(marks.map((m) => Decoration.line({ class: CLASS[m.mark] }).range(doc.line(m.line).from))),
        gutter: RangeSet.of(marks.map((m) => markers[m.mark].range(doc.line(m.line).from))),
      };
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.lines),
});

/** The extension: the field, its gutter, and the marks' looks. */
export const changeMarks: Extension = [
  changeField,
  gutter({ class: 'fg-chg-gutter', markers: (view) => view.state.field(changeField).gutter }),
  EditorView.theme({
    '.fg-chg-gutter .cm-gutterElement': { padding: '0 3px', fontWeight: '700' },
    '.fg-chg-plus': { color: '#7ee787' },
    '.fg-chg-tilde': { color: '#e3b341' },
    // Under :where(), so the running line's band and the paused line's bar (CodeEditor's, one class more) win on a marked line.
    '.cm-line:where(.fg-chg-new)': { backgroundColor: 'rgba(126, 231, 135, 0.07)' },
    '.cm-line:where(.fg-chg-changed)': { boxShadow: 'inset 3px 0 0 #e3b341', backgroundColor: 'rgba(227, 179, 65, 0.07)' },
  }),
];
