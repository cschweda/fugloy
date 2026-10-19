// Comment and label marks for the Source editor (plan 5B, Ruling 1: no
// language package, `MatchDecorator`s). `lineMarks` reads one line as asm
// does: a comment runs from a `;` outside a string to the end of the line; a
// label is a word in column 1 (unless it is an instruction alone, which asm
// reads as the instruction) or a word ending in a colon before the operation.
import { Decoration, MatchDecorator, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import { mnemonics } from '@fugloy/asm';

export interface LineMark {
  from: number;
  to: number;
  kind: 'comment' | 'label';
}

let MNEMONICS: Set<string> | null = null;
const isMnemonic = (w: string): boolean => (MNEMONICS ??= new Set(mnemonics().map((m) => m.toUpperCase()))).has(w.toUpperCase());

const NAME = /^[A-Za-z_.$?@][\w.$?@]*/;

/** Where the comment starts (`;` outside a quoted string), or the line's length. */
function commentStart(text: string): number {
  let quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'") quote = !quote;
    else if (c === ';' && !quote) return i;
  }
  return text.length;
}

/** The marks on one line, in order. */
export function lineMarks(text: string): LineMark[] {
  const marks: LineMark[] = [];
  const end = commentStart(text);
  const code = text.slice(0, end);
  const lead = /^\s*/.exec(code)![0].length;
  const word = NAME.exec(code.slice(lead));
  if (word !== null) {
    const after = code.slice(lead + word[0].length);
    const colon = after.startsWith(':');
    const alone = after.trim() === '';
    if (colon) marks.push({ from: lead, to: lead + word[0].length + 1, kind: 'label' });
    else if (lead === 0 && !(alone && isMnemonic(word[0]))) marks.push({ from: 0, to: word[0].length, kind: 'label' });
  }
  if (end < text.length) marks.push({ from: end, to: text.length, kind: 'comment' });
  return marks;
}

const MARK = { comment: Decoration.mark({ class: 'fg-src-comment' }), label: Decoration.mark({ class: 'fg-src-label' }) };

const decorator = new MatchDecorator({
  regexp: /^.+$/g,
  decorate: (add, from, _to, match) => {
    for (const m of lineMarks(match[0])) add(from + m.from, from + m.to, MARK[m.kind]);
  },
});

/** The view plugin that styles comments and labels. */
export const sourceMarks = ViewPlugin.fromClass(
  class {
    marks: DecorationSet;
    constructor(view: EditorView) {
      this.marks = decorator.createDeco(view);
    }
    update(u: ViewUpdate): void {
      this.marks = decorator.updateDeco(u, this.marks);
    }
  },
  { decorations: (v) => v.marks },
);
