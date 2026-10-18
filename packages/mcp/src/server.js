/**
 * The MCP server (docs/fugloy-mcp-spec.md §2): the official SDK's McpServer with every tool
 * module registered. A tool module is `{ name, description, inputSchema?, handler(session, args) }`;
 * the handler returns text or `{ text, isError }`.
 *
 * Declaring arguments (the pattern for every tool): `inputSchema` is a zod raw shape, with a
 * `.describe()` on each field. The server does NOT hand it to the SDK, because the SDK validates
 * before the handler runs and answers a bad argument with its own JSON-ish text. Instead it
 * registers a permissive shape (every field `z.any()`, its description carrying the type and
 * "(required)") and validates with the tool's real shape itself, so a wrong-typed or missing
 * argument comes back as a plain `isError` sentence naming the argument. The handler gets the
 * parsed object. Put the finer rules (addresses, decimal counts) in `args.js`, which throws
 * sentences too. Anything a handler throws becomes an `isError` sentence, never a stack.
 *
 * Paging: every tool also accepts `offset` (a line number). The server runs the handler, then
 * `cap`s the text to `limits.outputBytes` starting at that line, ending with
 * `… (N more lines; use offset=K)`. The handler runs again on each page, so only tools that are
 * safe to repeat (peek, trace, disasm, ...) should be paged; `offset` is not passed to handlers.
 */
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { parseCount } from './args.js';
import { cap } from './format/cap.js';
import { Session } from './session.js';
import status from './tools/status.js';

/** Every tool the server offers, in listing order. */
export const TOOLS = [status];

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/**
 * @typedef {{
 *   name: string,
 *   description: string,
 *   inputSchema?: import('zod').ZodRawShape,
 *   handler: (session: Session, args: any) => string | { text: string, isError?: boolean } | Promise<string | { text: string, isError?: boolean }>,
 * }} Tool
 */

/** A short type for a field's description, from its JSON schema (`integer`, `string | number`, `"a" | "b"`). */
function typeHint(/** @type {import('zod').ZodType} */ field) {
  try {
    const js = /** @type {any} */ (z.toJSONSchema(field, { unrepresentable: 'any' }));
    const one = (/** @type {any} */ s) => (s.enum ? s.enum.map((/** @type {unknown} */ v) => JSON.stringify(v)).join(' | ') : s.const !== undefined ? JSON.stringify(s.const) : s.type === 'array' ? 'array' : (s.type ?? 'any'));
    return (js.anyOf ?? js.oneOf ?? [js]).map(one).join(' | ');
  } catch {
    return 'any';
  }
}

/** The shape the SDK sees: permissive, with the real type and requiredness in each description. */
function permissiveShape(/** @type {import('zod').ZodRawShape} */ shape) {
  /** @type {Record<string, import('zod').ZodType>} */
  const out = {};
  for (const [key, field] of Object.entries(shape)) {
    const required = !field.safeParse(undefined).success;
    const text = [field.description, `${typeHint(field)}${required ? ', required' : ''}`].filter(Boolean).join(' ');
    out[key] = z.any().optional().describe(text);
  }
  out.offset = z.any().optional().describe('Line to resume at when the last output ended with "use offset=K"; integer');
  return out;
}

/** One plain sentence for the first problem in `error`. */
function argumentSentence(/** @type {import('zod').ZodError} */ error, /** @type {Record<string, unknown>} */ args) {
  const issue = error.issues[0];
  const name = issue.path.length > 0 ? String(issue.path[0]) : 'arguments';
  const given = issue.path.length > 0 ? args[name] : args;
  if (given === undefined) return `The argument "${name}" is required.`;
  const where = issue.path.length > 1 ? ` (at ${issue.path.join('.')})` : '';
  return `The argument "${name}" is not valid${where}: ${issue.message.replace(/^Invalid input: /, '')}; you gave ${JSON.stringify(given)}.`;
}

/**
 * @param {{ config: import('./config.js').Config, session?: Session, tools?: Tool[] }} opts
 * @returns {McpServer}
 */
export function createServer({ config, session = new Session(config), tools = TOOLS }) {
  const server = new McpServer({ name: 'fugloy-mcp', version });
  for (const tool of tools) {
    const real = z.object(tool.inputSchema ?? {});
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: permissiveShape(tool.inputSchema ?? {}) },
      async (/** @type {any} */ raw) => {
        let text;
        let isError = false;
        let offset = 0;
        try {
          const { offset: rawOffset, ...rest } = raw ?? {};
          if (rawOffset !== undefined) offset = parseCount(rawOffset, { name: 'offset', min: 0 });
          const parsed = real.safeParse(rest);
          if (!parsed.success) {
            text = argumentSentence(parsed.error, rest);
            isError = true;
          } else {
            const out = await tool.handler(session, parsed.data);
            if (typeof out === 'string') text = out;
            else ({ text, isError = false } = out);
          }
        } catch (err) {
          text = err instanceof Error ? err.message : String(err);
          isError = true;
        }
        const shown = cap(text ?? '', { limit: config.limits.outputBytes, offset });
        return { content: [{ type: /** @type {const} */ ('text'), text: shown }], ...(isError ? { isError: true } : {}) };
      },
    );
  }
  return server;
}
