/**
 * The MCP server (docs/fugloy-mcp-spec.md §2): the official SDK's McpServer with every tool
 * module registered. A tool module is `{ name, description, inputSchema?, handler(session, args) }`;
 * the handler returns text or `{ text, isError }`. The server caps the text at
 * `limits.outputBytes` and turns anything a handler throws into an `isError` sentence.
 */
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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

/**
 * @param {{ config: import('./config.js').Config, session?: Session, tools?: Tool[] }} opts
 * @returns {McpServer}
 */
export function createServer({ config, session = new Session(config), tools = TOOLS }) {
  const server = new McpServer({ name: 'fugloy-mcp', version });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}) },
      async (/** @type {any} */ args) => {
        let text;
        let isError = false;
        try {
          const out = await tool.handler(session, tool.inputSchema ? args : {});
          if (typeof out === 'string') text = out;
          else ({ text, isError = false } = out);
        } catch (err) {
          text = err instanceof Error ? err.message : String(err);
          isError = true;
        }
        return { content: [{ type: /** @type {const} */ ('text'), text: capOutput(text, config.limits.outputBytes) }], ...(isError ? { isError: true } : {}) };
      },
    );
  }
  return server;
}

/**
 * The backstop output cap: keep whole lines up to `limit` bytes, then say how many were cut.
 * Tools that can run long page with their own `offset` before this ever trips.
 * @param {string} text
 * @param {number} limit
 */
export function capOutput(text, limit) {
  if (Buffer.byteLength(text) <= limit) return text;
  const lines = text.split('\n');
  let used = 0;
  let kept = 0;
  for (const line of lines) {
    const size = Buffer.byteLength(line) + (kept > 0 ? 1 : 0);
    if (used + size > limit) break;
    used += size;
    kept++;
  }
  const notice = `… (output cut at ${limit} bytes; ${lines.length - kept} more lines)`;
  return kept === 0 ? notice : `${lines.slice(0, kept).join('\n')}\n${notice}`;
}
