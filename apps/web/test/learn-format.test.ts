// The lesson format (phase 6B Task 1): a lesson's front matter and its Markdown subset, parsed to a
// Lesson, and each rule's error a sentence naming the lesson and the line. The lessons under
// content/learn/ load through LESSONS, in order, each numbered by its folder.
import { describe, expect, it } from 'vitest';
import { parseLesson } from '../app/utils/learn/lesson-format';
import type { Lesson } from '../app/utils/learn/lesson-format';
import { LESSONS, lessonBySlug } from '../app/utils/learn/lessons';

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
  it('starts with lesson 1, White out the screen', () => {
    expect(LESSONS[0]?.slug).toBe('01-white-out');
    expect(LESSONS[0]?.title).toBe('White out the screen');
    expect(lessonBySlug('01-white-out')).toBe(LESSONS[0]);
    expect(lessonBySlug('99-none')).toBeNull();
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
});
