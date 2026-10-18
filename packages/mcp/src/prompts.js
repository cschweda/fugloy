/**
 * The MCP prompts (docs/fugloy-mcp-spec.md §6): text templates whose wording lives in the
 * package's `prompts/<name>.md`, so the protocol's prompts and the texts a person pastes into
 * Claude Code are one copy. The server reads each file's `## Prompt` section at startup (a
 * Markdown blockquote; the `> ` markers are dropped and the lines of a paragraph joined) and
 * fills in `{name}` placeholders from the prompt's arguments. A file that is missing or has no
 * `## Prompt` section does not stop the server: the prompt is still listed, and getting it
 * answers with a sentence saying what is wrong.
 *
 * Prompt arguments are strings (the protocol's rule). They are checked here, after the server's
 * strict parse (server.js), so a bad one is refused with a sentence: `range` and `addr` as the
 * tools read them, `minCalls` as a decimal count. `path` is echoed as given; `load` resolves it.
 * A `path`, `range`, or `addr` holding a control character is refused, since it would be pasted
 * into the prompt's text unchanged.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { CONTROL, hex4, parseAddr, parseRange } from './args.js';

/** Where the prompt texts ship: `packages/mcp/prompts/`. */
export const PROMPTS_DIR = new URL('../prompts/', import.meta.url);

/**
 * @typedef {{
 *   name: string,
 *   description: string,
 *   argsSchema: import('zod').ZodRawShape,
 *   fill: (args: Record<string, string | undefined>, session: import('./session.js').Session) => Record<string, string>,
 * }} PromptDef
 */

const path = z.string().describe('The program file, as load takes it: relative to the server\'s working folder, then the config\'s fixtures folder');

/**
 * `value`, or a sentence when it holds a control character (a newline or escape would be
 * pasted into the prompt's text as it is, where it could end the sentence and start another).
 * @param {string} name
 * @param {string} value
 */
function plain(name, value) {
  if (CONTROL.test(value)) throw new Error(`${name} ${JSON.stringify(value)} holds a control character (such as a newline or a tab); give it on one line, without one.`);
  return value;
}

/** `path` echoed, trimmed, or a sentence when it is empty or holds a control character. */
function given(/** @type {string | undefined} */ p) {
  const t = plain('path', p ?? '').trim();
  if (t === '') throw new Error('path is empty; give the program file to load.');
  return t;
}

/** @type {PromptDef[]} */
export const PROMPTS = [
  {
    name: 'orient',
    description: 'The standard opening move: load a program, run it to its first screen, and report the ROM routines it called and the routines of its own worth naming first (suggest). Labels nothing.',
    argsSchema: { path },
    fill: (a) => ({ path: given(a.path) }),
  },
  {
    name: 'find-writer',
    description: 'Find the routine that writes an address range: a write watch on the range, one input if needed, then hits, callers, and disasm on the writing routine, which is labelled with evidence.',
    argsSchema: {
      path,
      range: z.string().describe('The range to watch: "3C00-3FFF" (both ends included; addresses are hex, as the tools read them)'),
    },
    fill: (a, session) => {
      const { addr, len } = parseRange(plain('range', a.range ?? ''), session.labels);
      return { path: given(a.path), range: `${hex4(addr)}–${hex4(addr + len - 1)}`, addr: hex4(addr), len: String(len) };
    },
  },
  {
    name: 'label-pass',
    description: 'Story 7: play the program for a minute, then go down suggest\'s list, investigate each routine, and label every one whose name can be justified, with a note of the evidence; stop when none can be; export the label file.',
    argsSchema: {
      path,
      minCalls: z.string().optional().describe('The fewest calls a routine needs to be considered, a decimal count (default 5)'),
    },
    fill: (a) => {
      const raw = (a.minCalls ?? '5').trim();
      if (!/^\d+$/.test(raw)) throw new Error(`minCalls is a decimal count such as 5, not ${JSON.stringify(a.minCalls)}.`);
      return { path: given(a.path), minCalls: String(Number(raw)) };
    },
  },
  {
    name: 'explain',
    description: 'Explain the code at an address in the loaded program: break there, step through it, watch what it writes, and answer in prose with the trace as evidence.',
    argsSchema: {
      addr: z.string().describe('The address: 5200, 0x5200, $5200, 5200h, or a label name'),
    },
    fill: (a, session) => ({ addr: hex4(parseAddr(plain('addr', a.addr ?? ''), session.labels)) }),
  },
];

/**
 * The `## Prompt` section of a prompt file: its blockquote, markers dropped, each paragraph's
 * lines joined with spaces, paragraphs separated by a blank line. Undefined when there is none.
 * @param {string} markdown
 */
export function promptSection(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Prompt\s*$/.test(l));
  if (start < 0) return undefined;
  const end = lines.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l));
  /** @type {string[][]} */
  const paragraphs = [[]];
  for (const line of lines.slice(start + 1, end < 0 ? undefined : end)) {
    const m = /^>\s?(.*)$/.exec(line);
    const text = m ? m[1].trim() : '';
    if (text === '') {
      if (paragraphs.at(-1).length > 0) paragraphs.push([]);
    } else paragraphs.at(-1).push(text);
  }
  const text = paragraphs.filter((p) => p.length > 0).map((p) => p.join(' ')).join('\n\n');
  return text === '' ? undefined : text;
}

/**
 * Each prompt's template, or the sentence to answer with when its file cannot be used.
 * @param {URL | string} dir
 * @returns {Map<string, { text: string } | { problem: string }>}
 */
export function readPromptTexts(dir = PROMPTS_DIR) {
  const base = typeof dir === 'string' ? pathToFileURL(dir.endsWith('/') ? dir : `${dir}/`) : dir;
  const texts = new Map();
  for (const { name } of PROMPTS) {
    const file = new URL(`${name}.md`, base);
    let markdown;
    try {
      markdown = readFileSync(file, 'utf8');
    } catch {
      texts.set(name, { problem: `The text of the ${name} prompt is missing: there is no file at ${fileURLToPath(file)}; reinstall @fugloy/mcp.` });
      continue;
    }
    const text = promptSection(markdown);
    texts.set(name, text === undefined
      ? { problem: `The text of the ${name} prompt is missing: ${fileURLToPath(file)} has no "## Prompt" section with a blockquote; reinstall @fugloy/mcp.` }
      : { text });
  }
  return texts;
}

/**
 * `template` with each `{name}` that `values` has replaced; other braces are left alone.
 * @param {string} template
 * @param {Record<string, string>} values
 */
export function fillTemplate(template, values) {
  return template.replace(/\{([A-Za-z]+)\}/g, (whole, key) => (Object.hasOwn(values, key) ? values[key] : whole));
}
