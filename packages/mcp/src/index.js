/**
 * @fugloy/mcp: a stdio MCP server over @fugloy/emu (docs/fugloy-mcp-spec.md). The bin,
 * `fugloy-mcp`, connects `createServer` to stdio; these exports serve tests and embedders.
 */
export { createServer, TOOLS } from './server.js';
export { loadConfig, DEFAULT_LIMITS } from './config.js';
export { Session, NO_MACHINE, makeMachine } from './session.js';
export { guardStdout } from './guard.js';
