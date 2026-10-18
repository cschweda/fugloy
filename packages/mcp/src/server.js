/**
 * The MCP server (docs/fugloy-mcp-spec.md §2): the official SDK's McpServer with every tool
 * module registered. A tool module is `{ name, description, inputSchema?, handler(session, args) }`;
 * the handler returns text or `{ text, isError }`.
 *
 * Declaring arguments (the pattern for every tool): `inputSchema` is a zod raw shape with a
 * `.describe()` on each field. It is registered as is (plus `offset`), so `tools/list` shows
 * real types and required fields. The SDK would answer a bad argument with its own
 * `MCP error -32602` text, so `FugloyMcpServer` overrides the SDK's `validateToolInput` (an
 * internal; test/server.test.js pins it so an SDK upgrade that moves it fails loudly) to
 * validate with the same shape and throw a plain sentence naming the argument; the SDK turns a
 * thrown Error into an `isError` result. A string given for a number says numbers are decimal
 * (`len: "400"` is never 0400h), so declare lengths and counts as `z.number().int()`. Put finer rules (addresses, decimal counts) in `args.js`,
 * which throws sentences too. Anything a handler throws becomes an `isError` sentence, never a stack.
 *
 * Paging: `offset` is reserved (a tool may not declare it). The server keeps the last full
 * result in `session.lastOutput`, keyed by tool name and arguments without `offset`; a call with
 * `offset` > 0 pages from that cache and never runs the handler, so side effects happen once.
 * Output is `cap`ped to `limits.outputBytes`, ending `… (N more lines; use offset=K)`.
 */
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { parseCount } from './args.js';
import { cap } from './format/cap.js';
import { Session } from './session.js';
import breakTool from './tools/break.js';
import callers from './tools/callers.js';
import disasm from './tools/disasm.js';
import hits from './tools/hits.js';
import key from './tools/key.js';
import load from './tools/load.js';
import peek from './tools/peek.js';
import poke from './tools/poke.js';
import regs from './tools/regs.js';
import reset from './tools/reset.js';
import run from './tools/run.js';
import screen from './tools/screen.js';
import status from './tools/status.js';
import step from './tools/step.js';
import trace from './tools/trace.js';
import unbreak from './tools/unbreak.js';
import unwatch from './tools/unwatch.js';
import watch from './tools/watch.js';

/** Every tool the server offers, in listing order (the spec §5 tables). */
export const TOOLS = [load, reset, status, run, step, key, regs, peek, poke, disasm, screen, breakTool, unbreak, watch, unwatch, hits, trace, callers];

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/**
 * @typedef {{
 *   name: string,
 *   description: string,
 *   inputSchema?: import('zod').ZodRawShape,
 *   handler: (session: Session, args: any) => string | { text: string, isError?: boolean } | Promise<string | { text: string, isError?: boolean }>,
 * }} Tool
 */

/** One plain sentence for the first problem in `error`. */
function argumentSentence(/** @type {import('zod').ZodError} */ error, /** @type {Record<string, unknown>} */ args) {
  const issue = error.issues[0];
  const name = issue.path.length > 0 ? String(issue.path[0]) : 'arguments';
  const given = issue.path.length > 0 ? args[name] : args;
  if (given === undefined) return `The argument "${name}" is required.`;
  // Review focus 1: "400" where a length belongs means 400, never 0400h, so say lengths are decimal.
  if (issue.path.length === 1 && issue.code === 'invalid_type' && issue.expected === 'number' && typeof given === 'string') {
    return `The argument "${name}" is a decimal number; write 1024, not ${JSON.stringify(given)} (lengths and counts are never hex or strings).`;
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

/** The SDK server with plain-sentence argument errors (see the comment at the top of this file). */
class FugloyMcpServer extends McpServer {
  /** @type {Map<string, z.ZodType>} */
  schemas = new Map();

  // @ts-ignore validateToolInput is private in the SDK's .d.ts
  async validateToolInput(/** @type {any} */ _tool, /** @type {any} */ args, /** @type {string} */ toolName) {
    const raw = args ?? {};
    if (raw.offset !== undefined) parseCount(raw.offset, { name: 'offset', min: 0 });
    const schema = this.schemas.get(toolName);
    if (!schema) throw new Error(`There is no tool named ${toolName}.`);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new Error(argumentSentence(parsed.error, raw));
    return parsed.data;
  }
}

/**
 * @param {{ config: import('./config.js').Config, session?: Session, tools?: Tool[] }} opts
 * @returns {McpServer}
 */
export function createServer({ config, session = new Session(config), tools = TOOLS }) {
  const server = new FugloyMcpServer({ name: 'fugloy-mcp', version });
  for (const tool of tools) {
    if (tool.inputSchema && Object.hasOwn(tool.inputSchema, 'offset')) {
      throw new Error(`Tool ${tool.name} declares an offset argument; offset is reserved for the server's paging.`);
    }
    const shape = { ...tool.inputSchema, offset: z.number().int().min(0).optional().describe('Line to continue at, from the last output\'s "use offset=K"') };
    server.schemas.set(tool.name, z.object(shape));
    server.registerTool(tool.name, { description: tool.description, inputSchema: shape }, async (/** @type {any} */ parsed) => {
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
        } else text = session.lastOutput.text;
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
        session.lastOutput = { key, text };
      }
      const shown = cap(text, { limit: config.limits.outputBytes, offset: start });
      return { content: [{ type: /** @type {const} */ ('text'), text: shown }], ...(isError ? { isError: true } : {}) };
    });
  }
  return server;
}
