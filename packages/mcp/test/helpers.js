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

/** A .CMD from records in order: `{ name }` → 05, `{ addr, data }` → 01; then the 02 entry record. */
export function buildCmd(records, entry) {
  const out = [];
  for (const r of records) {
    if (r.name !== undefined) out.push(0x05, r.name.length, ...[...r.name].map((c) => c.charCodeAt(0)));
    else out.push(0x01, (r.data.length + 2) & 0xff, r.addr & 0xff, r.addr >> 8, ...r.data);
  }
  out.push(0x02, 0x02, entry & 0xff, entry >> 8);
  return new Uint8Array(out);
}

/** A SYSTEM .CAS: leader, A5 sync, 55 and a six-byte name, one 3C block per `{ addr, data }`, then the 78 entry. */
export function buildCas(name, blocks, entry) {
  const out = [...new Array(16).fill(0), 0xa5, 0x55, ...[...name.padEnd(6)].map((c) => c.charCodeAt(0))];
  for (const { addr, data } of blocks) {
    const sum = data.reduce((s, b) => s + b, (addr & 0xff) + (addr >> 8));
    out.push(0x3c, data.length & 0xff, addr & 0xff, addr >> 8, ...data, sum & 0xff);
  }
  out.push(0x78, entry & 0xff, entry >> 8);
  return new Uint8Array(out);
}
