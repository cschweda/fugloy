/**
 * Test helpers: a real server and client joined by the SDK's in-memory transport, so every test
 * goes through the protocol path, and a synthetic ROM for tests that need a Machine.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DEFAULT_LIMITS } from '../src/config.js';
import { createServer } from '../src/server.js';
import { Session } from '../src/session.js';

/** A config with no file behind it: the defaults, plus whatever `over` sets. */
export function testConfig(over = {}) {
  return { roms: {}, defaultModel: 3, limits: { ...DEFAULT_LIMITS }, source: null, ...over };
}

/**
 * Connect a client to a fresh server.
 * @param {{ config?: object, session?: Session, tools?: object[] }} [opts]
 */
export async function connect({ config = testConfig(), session = new Session(config), tools } = {}) {
  const server = createServer({ config, session, ...(tools ? { tools } : {}) });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'fugloy-mcp-test', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  /** Call a tool; its one text block and whether it was an error. */
  async function call(name, args = {}) {
    const result = await client.callTool({ name, arguments: args });
    const content = /** @type {{ type: string, text: string }[]} */ (result.content);
    return { text: content.map((c) => c.text).join(''), isError: result.isError === true };
  }
  return { client, server, session, call, close: () => client.close() };
}

/** A synthetic 14K ROM: LD SP,8000H, then a JR to itself. Enough to build a Machine on. */
export function syntheticRom() {
  const rom = new Uint8Array(0x3800);
  rom.set([0x31, 0x00, 0x80, 0x18, 0xfe]);
  return rom;
}
