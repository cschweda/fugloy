/**
 * The MCP server (docs/fugloy-mcp-spec.md §2): the official SDK's McpServer with every tool
 * module registered. A tool module is `{ name, description, inputSchema?, handler(session, args) }`;
 * the handler returns text or `{ text, isError }`.
 *
 * Declaring arguments (the pattern for every tool): `inputSchema` is a zod raw shape with a
 * `.describe()` on each field. It is registered as a strict object (plus `offset`), so
 * `tools/list` shows real types, required fields, and `additionalProperties: false`. The SDK would answer a bad argument with its own
 * `MCP error -32602` text, so `FugloyMcpServer` overrides the SDK's `validateToolInput` (an
 * internal; test/server.test.js pins it so an SDK upgrade that moves it fails loudly) to
 * validate with the same shape and throw a plain sentence naming the argument; the SDK turns a
 * thrown Error into an `isError` result. A string given for a number says numbers are decimal
 * (`len: "400"` is never 0400h), so declare lengths and counts as `z.number().int()`. Put finer rules (addresses, decimal counts) in `args.js`,
 * which throws sentences too. Anything a handler throws becomes an `isError` sentence, never a stack.
 *
 * Arguments are strict: a name the tool does not declare (a typo such as `untill`) is refused
 * with the names it does take, never silently dropped. The SDK's `maxToolInputElements` ceiling,
 * when the server is built with one, is checked first, as the SDK's own validateToolInput does.
 *
 * Paging: `offset` is reserved (a tool may not declare it). The server keeps the last full
 * result (and whether it was an error) in `session.lastOutput`, keyed by tool name and arguments
 * without `offset`; a call with `offset` > 0 pages from that cache and never runs the handler, so
 * side effects happen once.
 * Output is `cap`ped to `limits.outputBytes`, ending `… (N more lines; use offset=K)`. A tool
 * that declares `page: { lines, heading? }` is also cut at that many lines a page (after its
 * heading lines); `trace` shows at most 100 trace lines a page (spec §7).
 *
 * Resources and prompts (spec §6): `resources.js` and `prompts.js` hold them; they are registered
 * here with the SDK's `registerResource` and `registerPrompt`. The prompt texts are read from
 * `prompts/*.md` once, when the server is built. The SDK would answer a bad prompt argument with
 * its own `Invalid arguments for prompt …` text, so after registering, `createServer` replaces
 * the SDK's `prompts/get` handler (through the public `server.server.setRequestHandler`; the SDK
 * installs its own once, guarded, so it is not put back) with one that parses the arguments
 * strictly and answers in the same sentences as a tool argument (test/phase-e.test.js pins it).
 */
import { readFileSync } from 'node:fs';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GetPromptRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { decimalFor, parseCount } from './args.js';
import { cap } from './format/cap.js';
import { fillTemplate, PROMPTS, PROMPTS_DIR, readPromptTexts } from './prompts.js';
import { RESOURCES, ROM_SYMBOLS } from './resources.js';
import { Session } from './session.js';
import breakTool from './tools/break.js';
import callees from './tools/callees.js';
import callers from './tools/callers.js';
import coverage from './tools/coverage.js';
import diff from './tools/diff.js';
import disasm from './tools/disasm.js';
import hits from './tools/hits.js';
import key from './tools/key.js';
import label from './tools/label.js';
import labels from './tools/labels.js';
import load from './tools/load.js';
import peek from './tools/peek.js';
import poke from './tools/poke.js';
import regs from './tools/regs.js';
import reset from './tools/reset.js';
import restore from './tools/restore.js';
import run from './tools/run.js';
import screen from './tools/screen.js';
import search from './tools/search.js';
import snapshot from './tools/snapshot.js';
import snapshots from './tools/snapshots.js';
import status from './tools/status.js';
import step from './tools/step.js';
import suggest from './tools/suggest.js';
import trace from './tools/trace.js';
import unbreak from './tools/unbreak.js';
import unlabel from './tools/unlabel.js';
import unwatch from './tools/unwatch.js';
import watch from './tools/watch.js';

/** Every tool the server offers, in listing order (the spec §5 tables). */
export const TOOLS = [load, reset, status, run, step, key, regs, peek, poke, disasm, screen, search, breakTool, unbreak, watch, unwatch, hits, trace, callers, callees, label, unlabel, labels, coverage, suggest, snapshot, restore, snapshots, diff];

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/**
 * @typedef {{
 *   name: string,
 *   description: string,
 *   inputSchema?: import('zod').ZodRawShape,
 *   page?: { lines: number, heading?: number },
 *   handler: (session: Session, args: any) => string | { text: string, isError?: boolean } | Promise<string | { text: string, isError?: boolean }>,
 * }} Tool
 */

/** `a`, `a and b`, `a, b, and c`. */
const andList = (/** @type {string[]} */ items) =>
  items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;

/**
 * One plain sentence for the first problem in `error`; an argument the tool does not take comes
 * first, since a misspelled name is also the reason a required one looks missing.
 * @param {import('zod').ZodError} error
 * @param {Record<string, unknown>} args
 * @param {string} toolName
 * @param {string[]} takes the tool's own argument names, in declaration order (not offset)
 */
function argumentSentence(error, args, toolName, takes) {
  const unknown = error.issues.find((i) => i.code === 'unrecognized_keys' && i.path.length === 0);
  if (unknown !== undefined) {
    const keys = /** @type {string[]} */ (/** @type {any} */ (unknown).keys);
    const named = andList(keys.map((k) => JSON.stringify(k)));
    const which = keys.length === 1 ? `The argument ${named} is not one ${toolName} takes` : `The arguments ${named} are not ones ${toolName} takes`;
    return `${which}; ${takes.length === 0 ? 'it takes no arguments' : `it takes ${takes.join(', ')}`}.`;
  }
  const issue = /** @type {any} */ (error.issues[0]);
  const name = issue.path.length > 0 ? String(issue.path[0]) : 'arguments';
  const given = issue.path.length > 0 ? args[name] : args;
  if (given === undefined) return `The argument "${name}" is required.`;
  // Review focus 1: "400" where a length belongs means 400, never 0400h, so say lengths are decimal.
  if (issue.path.length === 1 && issue.code === 'invalid_type' && issue.expected === 'number' && typeof given === 'string') {
    return `The argument "${name}" is a decimal number; write ${decimalFor(given)}, not ${JSON.stringify(given)} (lengths and counts are never hex or strings).`;
  }
  const where = issue.path.length > 1 ? ` (at ${issue.path.join('.')})` : '';
  return `The argument "${name}" is not valid${where}: ${issue.message.replace(/^Invalid input: /, '')}; you gave ${JSON.stringify(given)}.`;
}

/** Arguments as a stable string, for the paging cache key. */
function stable(/** @type {any} */ v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
}

/** Array elements and object members in `value`, stopping once the count passes `max` (as the SDK counts them). */
function elementCount(/** @type {unknown} */ value, /** @type {number} */ max) {
  let count = 0;
  const stack = [value];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    for (const child of Array.isArray(node) ? node : Object.values(node)) {
      if (++count > max) return count;
      if (child !== null && typeof child === 'object') stack.push(child);
    }
  }
  return count;
}

/** The SDK server with plain-sentence argument errors (see the comment at the top of this file). */
class FugloyMcpServer extends McpServer {
  /** @type {Map<string, { schema: z.ZodType, takes: string[] }>} */
  schemas = new Map();

  // @ts-ignore validateToolInput is private in the SDK's .d.ts
  async validateToolInput(/** @type {any} */ _tool, /** @type {any} */ args, /** @type {string} */ toolName) {
    // The SDK's own ceiling (an internal too, pinned by test/server.test.js), kept when overriding.
    const max = /** @type {any} */ (this)._maxToolInputElements;
    if (max !== undefined && elementCount(args, max) > max) {
      throw new Error(`The arguments to ${toolName} hold more than ${max.toLocaleString('en-US')} values (array elements and object members, counted together); send fewer.`);
    }
    const raw = args ?? {};
    if (raw.offset !== undefined) parseCount(raw.offset, { name: 'offset', min: 0 });
    const entry = this.schemas.get(toolName);
    if (!entry) throw new Error(`There is no tool named ${toolName}.`);
    const parsed = entry.schema.safeParse(raw);
    if (!parsed.success) throw new Error(argumentSentence(parsed.error, raw, toolName, entry.takes));
    return parsed.data;
  }
}

/** A resource read's one text block. */
const textResource = (/** @type {URL} */ uri, /** @type {string} */ text) => ({ contents: [{ uri: uri.href, mimeType: 'text/plain', text }] });

/**
 * Register the resources and prompts of spec §6 on `server`.
 * @param {FugloyMcpServer} server
 * @param {Session} session
 * @param {URL | string} promptsDir
 */
function registerContext(server, session, promptsDir) {
  for (const r of RESOURCES) {
    server.registerResource(r.name, r.uri, { description: r.description, mimeType: 'text/plain' }, (uri) => textResource(uri, r.read(session)));
  }
  const template = new ResourceTemplate(ROM_SYMBOLS.uriTemplate, {
    list: () => ({ resources: [{ uri: 'fugloy://rom/3/symbols', name: 'rom-3-symbols', description: 'The Model III ROM and hardware symbols.', mimeType: 'text/plain' }] }),
  });
  server.registerResource(ROM_SYMBOLS.name, template, { description: ROM_SYMBOLS.description, mimeType: 'text/plain' }, (uri, vars) =>
    textResource(uri, ROM_SYMBOLS.read(String(Array.isArray(vars.model) ? vars.model[0] : vars.model))));

  const texts = readPromptTexts(promptsDir);
  /** @type {Map<string, { def: import('./prompts.js').PromptDef, schema: z.ZodType, takes: string[] }>} */
  const prompts = new Map();
  for (const def of PROMPTS) {
    prompts.set(def.name, { def, schema: z.strictObject(def.argsSchema), takes: Object.keys(def.argsSchema) });
    // The callback never runs: prompts/get is answered by the handler below.
    server.registerPrompt(def.name, { description: def.description, argsSchema: def.argsSchema }, () => ({ messages: [] }));
  }
  server.server.setRequestHandler(GetPromptRequestSchema, (request) => {
    const { name, arguments: raw = {} } = request.params;
    const entry = prompts.get(name);
    if (entry === undefined) throw new Error(`There is no prompt named ${name}; the prompts are ${andList(PROMPTS.map((p) => p.name))}.`);
    const parsed = entry.schema.safeParse(raw);
    if (!parsed.success) throw new Error(argumentSentence(parsed.error, raw, `the ${name} prompt`, entry.takes));
    const text = /** @type {{ text?: string, problem?: string }} */ (texts.get(name));
    if (text.text === undefined) throw new Error(text.problem);
    const filled = fillTemplate(text.text, entry.def.fill(/** @type {any} */ (parsed.data), session));
    return { description: entry.def.description, messages: [{ role: 'user', content: { type: 'text', text: filled } }] };
  });
}

/**
 * @param {{ config: import('./config.js').Config, session?: Session, tools?: Tool[], maxToolInputElements?: number, promptsDir?: URL | string }} opts
 *   `maxToolInputElements` is passed to the SDK (no ceiling when left out); `promptsDir` is where
 *   the prompt texts are read from (default: the package's `prompts/`)
 * @returns {McpServer}
 */
export function createServer({ config, session = new Session(config), tools = TOOLS, maxToolInputElements, promptsDir = PROMPTS_DIR }) {
  const server = new FugloyMcpServer({ name: 'fugloy-mcp', version }, maxToolInputElements === undefined ? undefined : { maxToolInputElements });
  for (const tool of tools) {
    if (tool.inputSchema && Object.hasOwn(tool.inputSchema, 'offset')) {
      throw new Error(`Tool ${tool.name} declares an offset argument; offset is reserved for the server's paging.`);
    }
    const shape = { ...tool.inputSchema, offset: z.number().int().min(0).optional().describe('Line to continue at, from the last output\'s "use offset=K"') };
    const schema = z.strictObject(shape);
    server.schemas.set(tool.name, { schema, takes: Object.keys(tool.inputSchema ?? {}) });
    server.registerTool(tool.name, { description: tool.description, inputSchema: schema }, async (/** @type {any} */ parsed) => {
      const { offset = 0, ...rest } = parsed ?? {};
      const key = `${tool.name} ${stable(rest)}`;
      let text;
      let isError = false;
      let start = offset;
      if (offset > 0) {
        if (session.lastOutput?.key !== key) {
          text = `offset continues the last output of ${tool.name}; call ${tool.name} again without offset first.`;
          isError = true;
          start = 0;
        } else ({ text, isError } = session.lastOutput);
      } else {
        try {
          const out = await tool.handler(session, rest);
          if (typeof out === 'string') text = out;
          else ({ text, isError = false } = out);
        } catch (err) {
          text = err instanceof Error ? err.message : String(err);
          isError = true;
        }
        text ??= '';
        session.lastOutput = { key, text, isError };
      }
      const shown = cap(text, { limit: config.limits.outputBytes, offset: start, ...(tool.page && !isError ? { page: tool.page } : {}) });
      return { content: [{ type: /** @type {const} */ ('text'), text: shown }], ...(isError ? { isError: true } : {}) };
    });
  }
  registerContext(server, session, promptsDir);
  return server;
}
