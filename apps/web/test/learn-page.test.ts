// @vitest-environment happy-dom
// The Learn page's plain parts (phase 6B Task 4): the lesson text as markup (headings, paragraphs,
// lists, code, the JavaScript aside labelled), Explain's sentence for a program line after a Run,
// the model switch's options, the lesson's neighbours, the run message reworded for a page
// that has no Source ✎ tab and no ROM, and the program column's problems list, which (as Source ✎'s,
// through the same useSourceChecks) carries a Run's ROM-copy notes on their lines.
import { afterEach, describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { assemble, toCmd } from '@fugloy/asm';
import LessonText from '../app/components/learn/LessonText.vue';
import { explainSourceLine } from '../app/utils/learn/explain-line';
import { EXPLAIN_PROMPT, lessonMessage, lessonNeighbours, lessonPath, modelOptions } from '../app/utils/learn/page';
import { parseLesson } from '../app/utils/learn/lesson-format';
import type { Lesson } from '../app/utils/learn/lesson-format';
import { lessonBySlug, LESSONS } from '../app/utils/learn/lessons';
import LessonEditor from '../app/components/source/LessonEditor.vue';
import * as realKit from '../app/utils/emulator/kit';
import { createRun } from '../app/composables/useRun';
import { createSources } from '../app/composables/useSources';
import { fakeClock } from './emulator-support';

let w: VueWrapper | null = null;
afterEach(() => {
  w?.unmount();
  w = null;
});

const PROGRAM = '\tORG 7000H\nSTART:\tJR START\n\tEND START\n';
const md = (body: string[]): string => ['---', 'title: A test', 'idea: an idea', 'models: 3', '---', ...body, '', '## Try it', '', 'Change it.'].join('\n');

describe('LessonText', () => {
  it('draws headings, paragraphs, lists and code as plain markup', () => {
    const lesson = parseLesson(
      '09-test',
      md(['Some **strong** and *em* and `LD A,B`, with [a link](https://example.com/).', '', '## What the lines do', '', '- one', '- two `HL`', '', '```z80', '        LD      HL,3C00H', '```']),
      PROGRAM,
    );
    w = mount(LessonText, { props: { blocks: lesson.body } });
    const h2 = w.get('h2');
    expect(h2.text()).toBe('What the lines do');
    expect(h2.attributes('id')).toBe('what-the-lines-do');
    const p = w.get('p');
    expect(p.get('strong').text()).toBe('strong');
    expect(p.get('em').text()).toBe('em');
    expect(p.get('code').text()).toBe('LD A,B');
    expect(p.get('a').attributes('href')).toBe('https://example.com/');
    expect(w.findAll('ul > li').map((li) => li.text())).toEqual(['one', 'two HL']);
    expect(w.get('pre code').text()).toBe('LD      HL,3C00H');
    expect(w.text()).not.toContain('In JavaScript');
  });

  it('labels a js block "In JavaScript"', () => {
    const lesson = parseLesson('09-test', md(['```js', 'let hl = 0;', '```']), PROGRAM);
    w = mount(LessonText, { props: { blocks: lesson.body } });
    const fig = w.get('figure');
    expect(fig.get('figcaption').text()).toBe('In JavaScript');
    expect(fig.get('pre code').text()).toBe('let hl = 0;');
  });

  it("draws lesson 1's text", () => {
    const one = LESSONS[0]!;
    w = mount(LessonText, { props: { blocks: one.body } });
    expect(w.text()).toContain('On a TRS-80 the screen is memory.');
    expect(w.findAll('pre code').length).toBeGreaterThanOrEqual(2);
  });
});

describe('explainSourceLine', () => {
  const one = lessonBySlug('01-white-out')!;
  const lines = one.program.split('\n');
  const lineOf = (needle: string): number => lines.findIndex((l) => l.includes(needle)) + 1;
  const result = assemble(one.program, { model: 3 });
  const bytes = toCmd(result);

  it("explains lesson 1's LD HL,3C00H in a sentence naming 3C00", () => {
    const n = lineOf('LD      HL,3C00H');
    expect(n).toBeGreaterThan(0);
    const said = explainSourceLine(result, bytes, n, 3);
    expect(said).not.toBeNull();
    expect(said).toMatch(/3C00/);
  });

  it('says nothing for a comment line, a blank line, or ORG', () => {
    expect(explainSourceLine(result, bytes, 1, 3)).toBeNull();
    expect(explainSourceLine(result, bytes, lineOf('ORG'), 3)).toBeNull();
    expect(explainSourceLine(result, bytes, 4, 3)).toBeNull();
  });

  it('explains on the Model I too', () => {
    const r1 = assemble(one.program, { model: 1 });
    expect(explainSourceLine(r1, toCmd(r1), lineOf('LD      HL,3C00H'), 1)).toMatch(/3C00/);
  });
});

describe('the page helpers', () => {
  it('offers the Model I only when the lesson allows it (Review Focus 5)', () => {
    expect(modelOptions([3, 1])).toEqual([
      { value: 3, label: 'Model III' },
      { value: 1, label: 'Model I' },
    ]);
    expect(modelOptions([3])).toEqual([{ value: 3, label: 'Model III' }]);
  });

  it('finds the previous and next lessons', () => {
    const list = [{ slug: '01-a' }, { slug: '02-b' }, { slug: '03-c' }] as Lesson[];
    expect(lessonNeighbours(list, '01-a')).toEqual({ prev: null, next: list[1] });
    expect(lessonNeighbours(list, '02-b')).toEqual({ prev: list[0], next: list[2] });
    expect(lessonNeighbours(list, '03-c')).toEqual({ prev: list[1], next: null });
    expect(lessonPath('02-b')).toBe('/learn/02-b/');
  });

  it('rewords the run messages that point at Source ✎ or at adding a ROM', () => {
    expect(lessonMessage('The program has 1 error, so it did not run. The first is on line 4: Unknown instruction BAD. Fix it in Source ✎, then press Run again.')).toBe(
      'The program has 1 error, so it did not run. The first is on line 4: Unknown instruction BAD. Fix it, then press Run again.',
    );
    expect(lessonMessage('Line 5 calls $VDCLS, the ROM\'s routine at $01C9 (clear the screen), but no ROM is loaded. Add a Model III ROM in the Run tab, or do this in your own code.')).toBe(
      'Line 5 calls $VDCLS, the ROM\'s routine at $01C9 (clear the screen), but no ROM is loaded. Lessons run without one, so do this in your own code.',
    );
    expect(lessonMessage("Running on Fugløy's stub ROM (no ROM needed for this program).")).toBe("Running on Fugløy's stub ROM (no ROM needed for this program).");
    expect(EXPLAIN_PROMPT).toBe('Run the program, then click a line to read what it does.');
  });
});

describe("the lesson editor's problems list", () => {
  // As in source-tab.test: happy-dom fires selectionchange inside CodeMirror's own update; browsers do not.
  const stop = (e: Event): void => e.stopImmediatePropagation();

  it("shows a Run's ROM-copy note as a warning on its line, as Source ✎ does", async () => {
    window.addEventListener('selectionchange', stop, true);
    // Line 3 points HL into the ROM's space and line 6 copies from it: the stub's stand-in, not the ROM.
    const program = '\tORG\t7000H\nSTART:\tLD\tDE,3C00H\n\tLD\tHL,0\n\tLD\tBC,40H\n\tNOP\n\tLDIR\nWAIT:\tJR\tWAIT\n\tEND\tSTART\n';
    const sources = createSources({ open: async () => null, starter: async () => program });
    await sources.start();
    await sources.create({ name: '01-white-out.z', text: program });
    const run = createRun({ sources, stubOnly: true, listing: false, kit: async () => realKit, runner: fakeClock() });
    const host = document.createElement('div');
    document.body.append(host);
    w = mount(LessonEditor, { props: { run, sources, lesson: LESSONS[0]! }, attachTo: host });
    await flushPromises();
    expect(w.get('[data-testid="lesson-diag-count"]').text()).toBe('No problems: the program assembles.');
    await w.get('[data-testid="lesson-run"]').trigger('click');
    await flushPromises();
    expect(run.report.value?.notes.length).toBe(1);
    expect(w.findAll('[data-testid="lesson-diag"]').map((d) => d.text())).toEqual([expect.stringMatching(/^Warning\s*Line 3\s*Line 3 points HL at \$0000, inside the ROM's space, and line 6 copies/)]);
    expect(w.get('[data-testid="lesson-diag-count"]').text()).toBe('1 warning');
    run.stop();
    window.removeEventListener('selectionchange', stop, true);
  });
});
