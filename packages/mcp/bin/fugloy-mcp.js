#!/usr/bin/env node
/**
 * fugloy-mcp: the stdio MCP server over @fugloy/emu (docs/fugloy-mcp-spec.md). stdout carries
 * JSON-RPC and nothing else, so the console guard goes in before any other module loads.
 */
import { guardStdout } from '../src/guard.js';

guardStdout();

const { homedir } = await import('node:os');
const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
const { loadConfig } = await import('../src/config.js');
const { createServer } = await import('../src/server.js');

let config;
try {
  config = loadConfig({ cwd: process.cwd(), env: process.env, home: homedir() });
} catch (err) {
  process.stderr.write(`fugloy-mcp: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

await createServer({ config }).connect(new StdioServerTransport());
