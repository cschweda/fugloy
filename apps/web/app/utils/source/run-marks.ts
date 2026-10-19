// Source ✎'s running line and breakpoints in CodeMirror (phase 5C Rulings 4 and 8), loaded with
// the Source tab's lazy chunk:
// - `setLines` replaces the whole set of line classes (the running line, its trail, paused,
//   stopped); the paused line also gets a ▶ in the breakpoint gutter, a cue that is not colour.
// - `setBreakpointMarks` replaces the breakpoints: ● for one that stops, ○ for a line with no
//   instruction to stop at (its title says why). They are carried through edits: a line moved by
//   an edit takes its breakpoint along, and a line deleted whole loses it.
// - `breakpointGutter(onToggle)` draws them and reports a click on a line.
import { Annotation, RangeSet, StateEffect, StateField } from '@codemirror/state';
import type { ChangeSet, EditorState, Extension, Line, Text } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, gutter } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';

export interface LineClass {
  line: number;
  class: string;
}

/** A change that replaces the text from outside (a restore): breakpoints it drops are not reported. */
export const external = Annotation.define<boolean>();

export const setLines = StateEffect.define<LineClass[]>();

export const lineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setLines)) continue;
      const doc = tr.state.doc;
      const marks = e.value
        .filter((l) => l.line >= 1 && l.line <= doc.lines)
        .sort((a, b) => a.line - b.line)
        .map((l) => Decoration.line({ class: l.class }).range(doc.line(l.line).from));
      next = Decoration.set(marks, true);
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

class PcMarker extends GutterMarker {
  override elementClass = 'fg-bp-pc-line';
  override toDOM(): Node {
    const el = document.createElement('span');
    el.className = 'fg-bp-pc';
    el.textContent = '▶';
    el.title = 'Paused here';
    return el;
  }
}
const pcMarker = new PcMarker();

/** The ▶ on the paused line, from the last `setLines`. */
const pcField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    let next = set.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setLines)) continue;
      const doc = tr.state.doc;
      const at = e.value.find((l) => l.class === 'fg-run-paused' && l.line >= 1 && l.line <= doc.lines);
      next = at === undefined ? RangeSet.empty : RangeSet.of([pcMarker.range(doc.line(at.line).from)]);
    }
    return next;
  },
});

class BreakpointMarker extends GutterMarker {
  constructor(readonly why: string | null) {
    super();
  }
  override eq(other: GutterMarker): boolean {
    return other instanceof BreakpointMarker && other.why === this.why;
  }
  override toDOM(): Node {
    const el = document.createElement('span');
    el.className = this.why === null ? 'fg-bp' : 'fg-bp fg-bp-off';
    el.textContent = this.why === null ? '●' : '○';
    el.title = this.why ?? 'Breakpoint: the program pauses before this line. Click to remove it.';
    return el;
  }
}
const stops = new BreakpointMarker(null);

/** The breakpoints: each line, and why it cannot stop (null when it can). */
export const setBreakpointMarks = StateEffect.define<{ line: number; why: string | null }[]>();

/** True when one change deletes the whole of `line` with a line break next to it. */
function deletesLine(changes: ChangeSet, line: Line): boolean {
  let gone = false;
  changes.iterChangedRanges((fromA, toA) => {
    if (fromA <= line.from && toA >= line.to && (toA > line.to || fromA < line.from)) gone = true;
  });
  return gone;
}

function mapBreakpoints(set: RangeSet<BreakpointMarker>, changes: ChangeSet, before: Text, after: Text): RangeSet<BreakpointMarker> {
  const out: { from: number; value: BreakpointMarker }[] = [];
  const seen = new Set<number>();
  set.between(0, before.length, (from, _to, value) => {
    const line = before.lineAt(from);
    if (deletesLine(changes, line)) return;
    // Text inserted at the line's start pushes the line (and its breakpoint) down.
    const now = after.lineAt(changes.mapPos(line.from, 1));
    if (seen.has(now.number)) return;
    seen.add(now.number);
    out.push({ from: now.from, value });
  });
  return RangeSet.of(out.map((x) => x.value.range(x.from)), true);
}

export const breakpointField = StateField.define<RangeSet<BreakpointMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    let next = tr.docChanged ? mapBreakpoints(set, tr.changes, tr.startState.doc, tr.state.doc) : set;
    for (const e of tr.effects) {
      if (!e.is(setBreakpointMarks)) continue;
      const doc = tr.state.doc;
      const marks = e.value
        .filter((b) => b.line >= 1 && b.line <= doc.lines)
        .sort((a, b) => a.line - b.line)
        .map((b) => (b.why === null ? stops : new BreakpointMarker(b.why)).range(doc.line(b.line).from));
      next = RangeSet.of(marks, true);
    }
    return next;
  },
});

/** The breakpoint lines in a state, in order. */
export function breakpointLines(state: EditorState): number[] {
  const lines: number[] = [];
  state.field(breakpointField).between(0, state.doc.length, (from) => {
    lines.push(state.doc.lineAt(from).number);
  });
  return lines;
}

class Spacer extends GutterMarker {
  override toDOM(): Node {
    return document.createTextNode('●');
  }
}

/** The breakpoint gutter; `onToggle` gets the line a primary click landed on. */
export function breakpointGutter(onToggle: (line: number) => void): Extension {
  return [
    breakpointField,
    pcField,
    gutter({
      class: 'fg-bp-gutter',
      markers: (v) => [v.state.field(breakpointField), v.state.field(pcField)],
      initialSpacer: () => new Spacer(),
      domEventHandlers: {
        mousedown(view, block, event) {
          if ((event as MouseEvent).button !== 0) return false;
          onToggle(view.state.doc.lineAt(block.from).number);
          return true;
        },
      },
    }),
  ];
}
