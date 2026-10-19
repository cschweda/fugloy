// The lesson format (phase 6B Task 1): a lesson's front matter and its Markdown subset, parsed to a
// Lesson, and each rule's error a sentence naming the lesson and the line. The lessons under
// content/learn/ load through LESSONS, in order, each numbered by its folder.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLesson } from '../app/utils/learn/lesson-format';
import type { Lesson } from '../app/utils/learn/lesson-format';
import { CHAPTER_INDEX, entryBefore, entryOf, LESSON_INDEX, loadItem, loadPageItem, loadProgram } from '../app/utils/learn/lessons';
import { CHAPTERS, LESSONS } from './learn-items';
import { learnIndexSource } from '../scripts/build-learn-index';

const PROGRAM = '\tORG 7000H\nSTART:\tJR START\n\tEND START\n';

const MINIMAL = [
  '---',
  'title: White out the screen',
  'idea: LD, a 16-bit pointer and counter, a loop',
  'models: 3, 1',
  'game: sea-dragon 4B9E CLEAR_SCREEN',
  'cite: m3-trm 14 the screen is memory at 3C00H',
  'cite: m1-trh 12 the screen is memory at 3C00H, 16 lines of 64',
  '---',
  'The screen is **memory**: write a byte at `3C00H` and it *shows*.',
  'See [the manual](https://example.com/m3).',
  '',
  '```z80',
  '        LD      HL,3C00H',
  '```',
  '',
  '## What HL is',
  '',
  '- a pointer',
  '- a `16-bit` register',
  '',
  '```js',
  'const screen = new Uint8Array(1024);',
  '```',
  '',
  '## Try it',
  '',
  'Change `0BFH` to `2AH` and press Run.',
  '',
  '## In a real game',
  '',
  'Sea Dragon clears with `80H`.',
  '',
].join('\n');

/** MINIMAL with `edit` applied to its lines (a line index and its replacement, or null to delete). */
function variant(edits: [number, string | null][]): string {
  const lines = MINIMAL.split('\n');
  for (const [i, text] of edits) lines[i] = text ?? '\u0000';
  return lines.filter((l) => l !== '\u0000').join('\n');
}

const errorOf = (md: string, slug = '09-test'): string => {
  try {
    parseLesson(slug, md, PROGRAM);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('expected parseLesson to throw');
};

describe('parseLesson', () => {
  it('parses a minimal lesson: front matter, blocks, Try it, the game box, and the cites', () => {
    const lesson: Lesson = parseLesson('09-test', MINIMAL, PROGRAM);
    expect(lesson).toEqual({
      slug: '09-test',
      number: 9,
      title: 'White out the screen',
      idea: 'LD, a 16-bit pointer and counter, a loop',
      models: [3, 1],
      body: [
        {
          kind: 'p',
          inlines: [
            { kind: 'text', text: 'The screen is ' },
            { kind: 'strong', text: 'memory' },
            { kind: 'text', text: ': write a byte at ' },
            { kind: 'code', text: '3C00H' },
            { kind: 'text', text: ' and it ' },
            { kind: 'em', text: 'shows' },
            { kind: 'text', text: '. See ' },
            { kind: 'link', text: 'the manual', href: 'https://example.com/m3' },
            { kind: 'text', text: '.' },
          ],
        },
        { kind: 'code', lang: 'z80', text: '        LD      HL,3C00H' },
        { kind: 'h2', id: 'what-hl-is', text: 'What HL is' },
        {
          kind: 'ul',
          items: [
            [{ kind: 'text', text: 'a pointer' }],
            [
              { kind: 'text', text: 'a ' },
              { kind: 'code', text: '16-bit' },
              { kind: 'text', text: ' register' },
            ],
          ],
        },
        { kind: 'code', lang: 'js', text: 'const screen = new Uint8Array(1024);' },
      ],
      tryIt: [
        {
          kind: 'p',
          inlines: [
            { kind: 'text', text: 'Change ' },
            { kind: 'code', text: '0BFH' },
            { kind: 'text', text: ' to ' },
            { kind: 'code', text: '2AH' },
            { kind: 'text', text: ' and press Run.' },
          ],
        },
      ],
      game: {
        example: 'sea-dragon',
        addr: 0x4b9e,
        name: 'CLEAR_SCREEN',
        blocks: [
          {
            kind: 'p',
            inlines: [
              { kind: 'text', text: 'Sea Dragon clears with ' },
              { kind: 'code', text: '80H' },
              { kind: 'text', text: '.' },
            ],
          },
        ],
      },
      cites: [
        { source: 'm3-trm', page: '14', about: 'the screen is memory at 3C00H' },
        { source: 'm1-trh', page: '12', about: 'the screen is memory at 3C00H, 16 lines of 64' },
      ],
      program: PROGRAM,
    });
  });

  it('has no game box and models [3] when the front matter says so', () => {
    const md = variant([
      [3, 'models: 3'],
      [4, null],
      [28, null],
      [29, null],
      [30, null],
    ]);
    const lesson = parseLesson('01-white-out', md, PROGRAM);
    expect(lesson.number).toBe(1);
    expect(lesson.models).toEqual([3]);
    expect(lesson.game).toBeNull();
  });

  it('makes heading ids from the words, in lower case, joined by -', () => {
    const md = variant([[15, '## Why HL, and not BE?']]);
    expect(parseLesson('09-test', md, PROGRAM).body[2]).toEqual({ kind: 'h2', id: 'why-hl-and-not-be', text: 'Why HL, and not BE?' });
  });

  describe('errors name the lesson and the line', () => {
    it('a lesson without "## Try it"', () => {
      expect(errorOf(variant([[24, '## Try this']]))).toMatch(/^Lesson 09-test.*Try it/);
    });

    it('game without its "## In a real game" section', () => {
      expect(
        errorOf(
          variant([
            [28, null],
            [29, null],
            [30, null],
          ]),
        ),
      ).toMatch(/^Lesson 09-test, line 5: .*In a real game/);
    });

    it("a section of the lesson's own after Try it", () => {
      expect(errorOf(variant([[28, '## Elsewhere']]))).toMatch(/^Lesson 09-test, line 29: .*comes after "## Try it"/);
    });

    it('the "## In a real game" section without game', () => {
      expect(errorOf(variant([[4, null]]))).toMatch(/^Lesson 09-test, line 28: .*game/);
    });

    it('an unknown front-matter key', () => {
      expect(errorOf(variant([[2, 'idear: a typo']]))).toMatch(/^Lesson 09-test, line 3: .*idear/);
    });

    it('models: 4', () => {
      expect(errorOf(variant([[3, 'models: 4']]))).toMatch(/^Lesson 09-test, line 4: .*models/);
    });

    it('a ### heading', () => {
      expect(errorOf(variant([[15, '### What HL is']]))).toMatch(/^Lesson 09-test, line 16: .*###/);
    });

    it('a # heading', () => {
      expect(errorOf(variant([[15, '# What HL is']]))).toMatch(/^Lesson 09-test, line 16: /);
    });

    it('raw HTML', () => {
      expect(errorOf(variant([[9, 'See <b>the manual</b>.']]))).toMatch(/^Lesson 09-test, line 10: .*HTML/);
    });

    it('an unclosed fence', () => {
      expect(errorOf(variant([[22, 'still code']]))).toMatch(/^Lesson 09-test, line 21: .*fence/);
    });

    it('a fence language other than z80 or js', () => {
      expect(errorOf(variant([[11, '```python']]))).toMatch(/^Lesson 09-test, line 12: .*python/);
    });

    it('an image', () => {
      expect(errorOf(variant([[9, '![a screen](screen.png)']]))).toMatch(/^Lesson 09-test, line 10: .*image/);
    });

    it('a table', () => {
      expect(errorOf(variant([[9, '| a | b |']]))).toMatch(/^Lesson 09-test, line 10: .*table/);
    });

    it('a game line that is not sea-dragon, an address, and a name', () => {
      expect(errorOf(variant([[4, 'game: rear-guard 5000 START']]))).toMatch(/^Lesson 09-test, line 5: .*game/);
    });

    it('a slug without its number', () => {
      expect(errorOf(MINIMAL, 'white-out')).toMatch(/^Lesson white-out.*number/);
    });

    it('a missing front matter', () => {
      expect(errorOf('Just text.\n\n## Try it\n\nRun it.\n')).toMatch(/^Lesson 09-test, line 1: .*front matter/);
    });

    it('an unclosed emphasis', () => {
      expect(errorOf(variant([[8, 'The screen is **memory.']]))).toMatch(/^Lesson 09-test, line 9: /);
    });
  });
});

describe('LESSONS', () => {
  it('starts with lesson 1, White out the screen', async () => {
    expect(LESSON_INDEX[0]?.slug).toBe('01-white-out');
    expect(LESSONS[0]?.title).toBe('White out the screen');
    expect(entryOf('lessons', '01-white-out')).toBe(LESSON_INDEX[0]);
    expect(entryOf('lessons', '99-none')).toBeNull();
    expect(await loadItem('lessons', '99-none')).toBeNull();
  });

  it("numbers every lesson by its folder's NN, in order", () => {
    LESSONS.forEach((lesson, i) => {
      expect(lesson.number).toBe(Number(lesson.slug.slice(0, 2)));
      if (i > 0) expect(lesson.number).toBeGreaterThan(LESSONS[i - 1]!.number);
    });
  });

  it('carries each lesson its program', () => {
    for (const lesson of LESSONS) expect(lesson.program).toMatch(/\bEND\b/);
  });

  it('reads only the NN-slug folders, so the invaders course is not a lesson', async () => {
    expect(LESSON_INDEX.map((l) => l.slug).filter((s) => !/^\d\d-/.test(s))).toEqual([]);
    expect(entryOf('lessons', 'invaders')).toBeNull();
    expect(await loadItem('lessons', 'invaders')).toBeNull();
  });
});

describe('CHAPTERS', () => {
  it('starts with chapter 1, A blank screen and a game loop that does nothing yet', async () => {
    expect(CHAPTER_INDEX[0]?.slug).toBe('01-blank-loop');
    expect(CHAPTERS[0]?.title).toBe('A blank screen and a game loop that does nothing yet');
    expect(entryOf('invaders', '01-blank-loop')).toBe(CHAPTER_INDEX[0]);
    expect(entryOf('invaders', '01-white-out')).toBeNull();
    expect(entryOf('lessons', '01-blank-loop')).toBeNull();
    expect(await loadItem('invaders', '01-white-out')).toBeNull();
  });

  it("numbers every chapter by its folder's NN, in order from 1, and runs each on the Model III first", () => {
    CHAPTERS.forEach((chapter, i) => {
      expect(chapter.number).toBe(i + 1);
      expect(chapter.number).toBe(Number(chapter.slug.slice(0, 2)));
      expect(chapter.models[0]).toBe(3);
      expect(chapter.program).toMatch(/\bEND\b/);
    });
  });

  it("names what changed in each chapter's text", () => {
    for (const chapter of CHAPTERS) expect(chapter.body.some((b) => b.kind === 'h2' && b.text === 'What changed'), chapter.slug).toBe(true);
  });
});

describe('the Learn index and the page loader', () => {
  it('is current with the content: run `pnpm --filter @fugloy/web learn-index` after changing a lesson or chapter', () => {
    const generated = readFileSync(join(__dirname, '..', 'app', 'utils', 'learn', 'learn-index.generated.ts'), 'utf8');
    expect(generated, 'learn-index.generated.ts is not current: run `pnpm --filter @fugloy/web learn-index`').toBe(learnIndexSource());
  });

  it("matches each item's own front matter", () => {
    const strip = (l: { slug: string; number: number; title: string; idea: string; models: readonly number[] }) => ({ slug: l.slug, number: l.number, title: l.title, idea: l.idea, models: [...l.models] });
    expect(LESSON_INDEX.map(strip)).toEqual(LESSONS.map(strip));
    expect(CHAPTER_INDEX.map(strip)).toEqual(CHAPTERS.map(strip));
  });

  it("loads a lesson with no marks, and a chapter with the previous chapter's program (the blank page for chapter 1)", async () => {
    expect(await loadPageItem('lessons', '01-white-out')).toEqual({ item: LESSONS[0], marksAgainst: null });
    expect(await loadPageItem('invaders', '01-blank-loop')).toEqual({ item: CHAPTERS[0], marksAgainst: '' });
    expect(entryBefore('invaders', '01-blank-loop')).toBeNull();
    for (let i = 1; i < CHAPTERS.length; i++) {
      expect((await loadPageItem('invaders', CHAPTERS[i]!.slug))?.marksAgainst).toBe(CHAPTERS[i - 1]!.program);
    }
    expect(await loadProgram('invaders', '01-blank-loop')).toBe(CHAPTERS[0]!.program);
    expect(await loadPageItem('invaders', '99-none')).toBeNull();
  });
});

// A lesson's z80 snippets are quoted from its program.z, so they cannot drift from the program that runs.
// Each fenced z80 block is checked on its own: every code line of it must appear in program.z, in the
// block's order (other program lines may lie between, since a snippet may skip some). A line is compared
// by its code alone: the comment after ';' (outside quotes) is dropped, runs of blanks collapse to one, and
// leading and trailing blanks go. Blank lines, comment-only lines, and a line that is only `...` are
// skipped, so a snippet may elide with `...` or `; ...` and may reword a comment. Blocks under a
// `## Try it` heading are exercises: they add to the program, so they are not quoted from it and are not checked.
describe('the lessons\' z80 snippets', () => {
  const codeOf = (line: string): string => {
    let quote = '';
    let end = line.length;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (quote !== '') {
        if (c === quote) quote = '';
      } else if (c === "'" || c === '"') quote = c;
      else if (c === ';') {
        end = i;
        break;
      }
    }
    return line.slice(0, end).replace(/\s+/g, ' ').trim();
  };
  const lines = (text: string): string[] => text.split(/\r\n|\r|\n/).map(codeOf).filter((l) => l !== '' && l !== '...');
  const dir = join(__dirname, '..', 'content', 'learn');
  const snippets = (md: string): string[][] => {
    const out: string[][] = [];
    let cur: string[] | null = null;
    let exercise = false;
    for (const l of md.split(/\r\n|\r|\n/)) {
      if (cur === null) {
        if (/^## /.test(l)) exercise = /^## Try it\s*$/.test(l);
        else if (/^```z80\s*$/.test(l)) cur = [];
      } else if (/^```\s*$/.test(l)) {
        if (!exercise) out.push(cur);
        cur = null;
      } else cur.push(l);
    }
    return out;
  };
  /** The snippet lines that are not in `program` in order (empty when it matches). */
  const missing = (snippet: string, program: string): string[] => {
    const prog = lines(program);
    let at = 0;
    const gone: string[] = [];
    for (const l of lines(snippet)) {
      const i = prog.indexOf(l, at);
      if (i < 0) gone.push(l);
      else at = i + 1;
    }
    return gone;
  };

  it('tells a snippet that matches from one that drifted', () => {
    const program = 'START:  LD  HL,3C00H ; top\n        LD  BC,400H\n\nFILL:   LD  (HL),0BFH\n        DEC BC\n';
    expect(missing('START:  LD HL,3C00H  ; reworded\n...\n        DEC     BC', program)).toEqual([]);
    expect(missing('        LD  BC,401H\n        DEC BC', program)).toEqual(['LD BC,401H']);
    expect(missing('        DEC BC\n        LD  BC,400H', program)).toEqual(['LD BC,400H']);
    expect(codeOf("        DB 'A;B' ; x")).toBe("DB 'A;B'");
  });

  // The lessons' folders (NN-slug) and the chapters' (invaders/NN-slug).
  const items = (sub: string): string[] =>
    readdirSync(join(dir, sub), { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d\d-/.test(d.name))
      .map((d) => (sub === '' ? d.name : `${sub}/${d.name}`))
      .sort();
  const folders = [...items(''), ...items('invaders')];

  it('checks the chapters too', () => {
    expect(folders).toContain('invaders/01-blank-loop');
    expect(folders).not.toContain('invaders');
  });

  for (const slug of folders) {
    it(`${slug}: every z80 snippet is lines of program.z`, () => {
      const program = readFileSync(join(dir, slug, 'program.z'), 'utf8');
      const blocks = snippets(readFileSync(join(dir, slug, 'lesson.md'), 'utf8'));
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) expect(missing(block.join('\n'), program)).toEqual([]);
    });
  }
});
