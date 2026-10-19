// The Learn page's lesson format (phase 6B Task 1). A lesson is a folder under content/learn/,
// `NN-slug`, with lesson.md (front matter and a small Markdown subset), program.z, and check.json
// (packages/asm/test/lessons.test.ts runs it). This parser is strict: anything outside the subset
// is an error naming the lesson and the line, so a lesson cannot drift into markup the page does
// not draw. No DOM, no Node APIs: the page and the CI checks both use it.
//
// Front matter, between `---` lines, `key: value`:
//   title   the lesson's name
//   idea    one line: the Z80 idea it shows
//   models  `3` or `3, 1` (the first is the lesson's own model)
//   game    optional: `sea-dragon <run address hex> <NAME>`, with a `## In a real game` section
//   cite    repeatable: `<source id> <page> <what it supports>` (ids from disasm's sources.json)
// Body: `## ` headings, paragraphs, `- ` lists, fenced code in `z80` or `js`, and inline `code`,
// *em*, **strong**, and [text](href). `## Try it` is required.

export type Inline = { kind: 'text' | 'code' | 'em' | 'strong'; text: string } | { kind: 'link'; text: string; href: string };

export type LessonBlock =
  | { kind: 'h2'; id: string; text: string }
  | { kind: 'p'; inlines: Inline[] }
  | { kind: 'ul'; items: Inline[][] }
  | { kind: 'code'; lang: 'z80' | 'js'; text: string };

export interface Cite {
  source: string;
  page: string;
  about: string;
}

export interface GameBox {
  example: 'sea-dragon';
  addr: number;
  name: string;
  blocks: LessonBlock[];
}

export interface Lesson {
  slug: string;
  number: number;
  title: string;
  idea: string;
  /** The models the lesson runs on; the first is the lesson's own model. */
  models: (1 | 3)[];
  /** The lesson's text, without the two sections below. */
  body: LessonBlock[];
  /** The "## Try it" section: one change to make, and what Run will show. */
  tryIt: LessonBlock[];
  /** The "## In a real game" section, present exactly when the front matter names a `game`. */
  game: GameBox | null;
  cites: Cite[];
  program: string;
}

/** What the Learn page's index keeps of a lesson or chapter (learn-index.generated.ts): enough for the lists, ◀ ▶, the kicker and the SEO. */
export type LessonEntry = Pick<Lesson, 'slug' | 'number' | 'title' | 'idea' | 'models'>;

const TRY_IT = 'Try it';
const REAL_GAME = 'In a real game';
const KEYS: ReadonlySet<string> = new Set(['title', 'idea', 'models', 'game', 'cite']);

/** A heading's id: its words, in lower case, joined by `-`. */
export const headingId = (text: string): string => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join('-');

interface Placed {
  block: LessonBlock;
  line: number;
}

/** Parses a lesson's lesson.md; throws an Error whose message names the lesson and the line. */
export function parseLesson(slug: string, md: string, program: string): Lesson {
  const fail = (line: number | null, why: string): never => {
    throw new Error(line === null ? `Lesson ${slug}: ${why}` : `Lesson ${slug}, line ${line}: ${why}`);
  };

  const named = /^(\d\d)-[a-z0-9]+(?:-[a-z0-9]+)*$/.exec(slug);
  if (named === null) fail(null, 'its folder name must be its two-digit number and a slug, as 01-white-out.');
  const number = Number(named![1]);

  const lines = md.replace(/\r\n?/g, '\n').split('\n');

  // Front matter.
  if (lines[0] !== '---') fail(1, 'a lesson starts with its front matter, between two --- lines.');
  const close = lines.indexOf('---', 1);
  if (close < 0) fail(1, 'the front matter is never closed with a --- line.');
  const seen = new Map<string, number>();
  let title = '';
  let idea = '';
  let models: (1 | 3)[] = [];
  let game: { addr: number; name: string; line: number } | null = null;
  const cites: Cite[] = [];
  for (let i = 1; i < close; i++) {
    const n = i + 1;
    const line = lines[i]!;
    if (line.trim() === '') continue;
    const kv = /^([A-Za-z]+):(.*)$/.exec(line);
    if (kv === null) fail(n, `"${line}" is not a front-matter line, written key: value.`);
    const key = kv![1]!;
    const value = kv![2]!.trim();
    if (!KEYS.has(key)) fail(n, `"${key}" is not a front-matter key; the keys are title, idea, models, game, and cite.`);
    if (key !== 'cite' && seen.has(key)) fail(n, `"${key}" is given twice; the first is on line ${seen.get(key)}.`);
    seen.set(key, n);
    if (value === '') fail(n, `"${key}" has no value.`);
    if (key === 'title') title = value;
    else if (key === 'idea') idea = value;
    else if (key === 'models') {
      const compact = value.replace(/\s+/g, '');
      if (compact === '3') models = [3];
      else if (compact === '3,1') models = [3, 1];
      else fail(n, `models must be "3" or "3, 1" (the Model III, then the Model I where the lesson allows it), not "${value}".`);
    } else if (key === 'game') {
      const g = /^sea-dragon ([0-9A-Fa-f]{4}) ([A-Za-z_][A-Za-z0-9_]*)$/.exec(value);
      if (g === null) fail(n, `game must be sea-dragon, a run address in hex, and a name, as "game: sea-dragon 4B9E CLEAR_SCREEN", not "${value}".`);
      game = { addr: parseInt(g![1]!, 16), name: g![2]!, line: n };
    } else {
      const c = /^([a-z0-9-]+) (\S+) (.+)$/.exec(value);
      if (c === null) fail(n, `cite must be a source id, a page, and what it supports, as "cite: m3-trm 14 the screen is memory at 3C00H", not "${value}".`);
      cites.push({ source: c![1]!, page: c![2]!, about: c![3]!.trim() });
    }
  }
  for (const key of ['title', 'idea', 'models']) if (!seen.has(key)) fail(1, `the front matter has no ${key}.`);

  // Body: blocks, each with the line it starts on.
  const placed = blocksOf(lines, close + 1, fail);

  // Sections: the lesson's own, then "## Try it" and "## In a real game", in either order, last.
  const body: LessonBlock[] = [];
  let tryIt: LessonBlock[] | null = null;
  let tryLine = 0;
  let gameBlocks: LessonBlock[] | null = null;
  let gameLine = 0;
  let into: LessonBlock[] = body;
  for (const { block, line } of placed) {
    if (block.kind === 'h2') {
      if (block.text === TRY_IT) {
        if (tryIt !== null) fail(line, `"## ${TRY_IT}" is given twice; the first is on line ${tryLine}.`);
        tryIt = into = [];
        tryLine = line;
        continue;
      }
      if (block.text === REAL_GAME) {
        if (gameBlocks !== null) fail(line, `"## ${REAL_GAME}" is given twice; the first is on line ${gameLine}.`);
        if (game === null) fail(line, `the "## ${REAL_GAME}" section needs a game line in the front matter, as "game: sea-dragon 4B9E CLEAR_SCREEN".`);
        gameBlocks = into = [];
        gameLine = line;
        continue;
      }
      if (into !== body) fail(line, `"## ${block.text}" comes after "## ${into === tryIt ? TRY_IT : REAL_GAME}"; the lesson's own sections come first, then ## ${TRY_IT} and ## ${REAL_GAME}.`);
    }
    into.push(block);
  }
  if (tryIt === null) fail(lines.length, `the lesson has no "## ${TRY_IT}" section: one change to make, and what Run will show.`);
  if (tryIt!.length === 0) fail(tryLine, `the "## ${TRY_IT}" section is empty.`);
  if (game !== null && gameBlocks === null) fail(game.line, `game is set, so the lesson needs an "## ${REAL_GAME}" section.`);
  if (gameBlocks !== null && gameBlocks.length === 0) fail(gameLine, `the "## ${REAL_GAME}" section is empty.`);

  return {
    slug,
    number,
    title,
    idea,
    models,
    body,
    tryIt: tryIt!,
    game: game === null ? null : { example: 'sea-dragon', addr: game.addr, name: game.name, blocks: gameBlocks! },
    cites,
    program,
  };
}

type Fail = (line: number | null, why: string) => never;

/** The body's blocks from line index `from`, each with its 1-based starting line. */
function blocksOf(lines: string[], from: number, fail: Fail): Placed[] {
  const out: Placed[] = [];
  // An open paragraph or list: its text lines, each with its line number.
  let para: { line: number; text: string }[] | null = null;
  let list: { line: number; text: string }[][] | null = null;
  let listLine = 0;

  const flush = (): void => {
    if (para !== null) out.push({ block: { kind: 'p', inlines: inlinesOf(para, fail) }, line: para[0]!.line });
    if (list !== null) out.push({ block: { kind: 'ul', items: list.map((item) => inlinesOf(item, fail)) }, line: listLine });
    para = null;
    list = null;
  };

  for (let i = from; i < lines.length; i++) {
    const n = i + 1;
    const line = lines[i]!;
    if (line.trim() === '') {
      flush();
      continue;
    }
    const fence = /^```(.*)$/.exec(line);
    if (fence !== null) {
      flush();
      const lang = fence[1]!.trim();
      if (lang !== 'z80' && lang !== 'js') {
        fail(n, lang === '' ? 'a code fence names its language: ```z80 or ```js.' : `the code fence's language "${lang}" is not z80 or js.`);
      }
      const end = lines.findIndex((l, j) => j > i && l === '```');
      if (end < 0) fail(n, 'this code fence is never closed with a ``` line.');
      out.push({ block: { kind: 'code', lang: lang as 'z80' | 'js', text: lines.slice(i + 1, end).join('\n') }, line: n });
      i = end;
      continue;
    }
    const heading = /^(#+)(?:\s+(.*))?$/.exec(line);
    if (heading !== null) {
      if (heading[1] !== '##') fail(n, `"${heading[1]}" headings are not part of the lesson format; a section starts with ##.`);
      const text = (heading[2] ?? '').trim();
      const id = headingId(text);
      if (id === '') fail(n, 'this heading has no words.');
      if (/[<>`*[\]]/.test(text)) fail(n, 'a heading is plain text, with no markup or HTML.');
      flush();
      out.push({ block: { kind: 'h2', id, text }, line: n });
      continue;
    }
    if (/^\s*\|/.test(line)) fail(n, 'tables are not part of the lesson format; use a list or a code block.');
    if (/^\s*>/.test(line)) fail(n, 'block quotes are not part of the lesson format.');
    if (/^\s*\d+[.)]\s/.test(line)) fail(n, 'numbered lists are not part of the lesson format; use - items.');
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) fail(n, 'horizontal rules are not part of the lesson format; start a ## section instead.');
    if (/^\s*[*+]\s/.test(line)) fail(n, 'list items start with "- ".');
    const item = /^- (.*)$/.exec(line);
    if (item !== null) {
      if (para !== null) flush();
      if (list === null) {
        list = [];
        listLine = n;
      }
      list.push([{ line: n, text: item[1]! }]);
      continue;
    }
    if (list !== null) {
      // A continuation of the last item.
      list.at(-1)!.push({ line: n, text: line.trim() });
      continue;
    }
    if (para === null) {
      if (/^( {4}|\t)/.test(line)) fail(n, 'indented code is not part of the lesson format; use a ```z80 or ```js fence.');
      para = [];
    }
    para.push({ line: n, text: line.trim() });
  }
  flush();
  return out;
}

/** The inline spans of a paragraph or list item, its lines joined by spaces; errors name the line. */
function inlinesOf(parts: { line: number; text: string }[], fail: Fail): Inline[] {
  let s = '';
  const starts: { at: number; line: number }[] = [];
  for (const p of parts) {
    if (s !== '') s += ' ';
    starts.push({ at: s.length, line: p.line });
    s += p.text;
  }
  const lineAt = (at: number): number => {
    let line = starts[0]!.line;
    for (const st of starts) if (st.at <= at) line = st.line;
    return line;
  };

  const out: Inline[] = [];
  let text = '';
  const push = (span: Inline): void => {
    if (text !== '') out.push({ kind: 'text', text });
    text = '';
    out.push(span);
  };
  const closing = (at: number, mark: string, what: string): number => {
    const end = s.indexOf(mark, at + mark.length);
    if (end < 0) fail(lineAt(at), `this ${mark} opens ${what} that is never closed.`);
    if (end === at + mark.length) fail(lineAt(at), `this ${mark}${mark} holds nothing.`);
    return end;
  };

  for (let i = 0; i < s.length; ) {
    const c = s[i]!;
    if (c === '`') {
      const end = closing(i, '`', 'inline code');
      push({ kind: 'code', text: s.slice(i + 1, end) });
      i = end + 1;
    } else if (s.startsWith('**', i)) {
      const end = closing(i, '**', 'strong text');
      push({ kind: 'strong', text: s.slice(i + 2, end) });
      i = end + 2;
    } else if (c === '*') {
      const end = closing(i, '*', 'emphasis');
      push({ kind: 'em', text: s.slice(i + 1, end) });
      i = end + 1;
    } else if (c === '!' && s[i + 1] === '[') {
      fail(lineAt(i), 'images are not part of the lesson format.');
    } else if (c === '[') {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(s.slice(i));
      if (link === null) fail(lineAt(i), 'this [ does not start a link written [text](address); put brackets in code as `[...]`.');
      push({ kind: 'link', text: link![1]!, href: link![2]! });
      i += link![0].length;
    } else if (c === '<' && /[A-Za-z!/?]/.test(s[i + 1] ?? '')) {
      fail(lineAt(i), 'raw HTML is not part of the lesson format.');
    } else {
      text += c;
      i++;
    }
  }
  if (text !== '') out.push({ kind: 'text', text });
  return out;
}
