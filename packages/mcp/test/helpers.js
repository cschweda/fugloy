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
 * @param {{ config?: object, session?: Session, tools?: object[], maxToolInputElements?: number, promptsDir?: string }} [opts]
 */
export async function connect({ config = testConfig(), session = new Session(config), tools, maxToolInputElements, promptsDir } = {}) {
  const server = createServer({ config, session, ...(tools ? { tools } : {}), ...(maxToolInputElements === undefined ? {} : { maxToolInputElements }), ...(promptsDir === undefined ? {} : { promptsDir }) });
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

/**
 * RAIDERS, the story 1 program: PRINT (7030h) copies a zero-ended string from DE to video RAM at
 * HL. The title is printed from 7009h; the program then waits for ENTER (keyboard row 6, 3840h
 * bit 0) and prints two more lines from 7019h and 7022h, then loops forever.
 */
export const RAIDERS = (() => {
  const code = new Array(0x70).fill(0);
  const place = (addr, bytes) => code.splice(addr - 0x7000, bytes.length, ...bytes);
  const text = (addr, s) => place(addr, [...[...s].map((c) => c.charCodeAt(0)), 0]);
  place(0x7000, [0x31, 0x00, 0x7f]); //  7000  LD SP,7F00H
  place(0x7003, [0x21, 0x00, 0x3c]); //  7003  LD HL,3C00H
  place(0x7006, [0x11, 0x40, 0x70]); //  7006  LD DE,7040H
  place(0x7009, [0xcd, 0x30, 0x70]); //  7009  CALL 7030H
  place(0x700c, [0x3a, 0x40, 0x38]); //  700C  LD A,(3840H)
  place(0x700f, [0xe6, 0x01]); //        700F  AND 01H
  place(0x7011, [0x28, 0xf9]); //        7011  JR Z,700CH
  place(0x7013, [0x21, 0xc0, 0x3c]); //  7013  LD HL,3CC0H
  place(0x7016, [0x11, 0x50, 0x70]); //  7016  LD DE,7050H
  place(0x7019, [0xcd, 0x30, 0x70]); //  7019  CALL 7030H
  place(0x701c, [0x21, 0x00, 0x3d]); //  701C  LD HL,3D00H
  place(0x701f, [0x11, 0x60, 0x70]); //  701F  LD DE,7060H
  place(0x7022, [0xcd, 0x30, 0x70]); //  7022  CALL 7030H
  place(0x7025, [0x18, 0xfe]); //        7025  JR 7025H
  place(0x7030, [0x1a, 0xb7, 0xc8]); //  7030  LD A,(DE) / OR A / RET Z
  place(0x7033, [0x77, 0x23, 0x13]); //  7033  LD (HL),A / INC HL / INC DE
  place(0x7036, [0x18, 0xf8]); //        7036  JR 7030H
  text(0x7040, 'SPACE RAIDERS');
  text(0x7050, 'PLAYER 1');
  text(0x7060, 'GOOD LUCK');
  return buildCmd([{ name: 'RAIDERS' }, { addr: 0x7000, data: code }], 0x7000);
})();

/**
 * A 14K ROM that boots from disk the way the Model III ROM does (ROM $3492-$3516), as the emu's
 * fdc-api test has it: with no controller (status FFh) it halts; otherwise it selects drive 0,
 * lets INTRQ raise the NMI, reads track 0 sector 1 into 4300h with INI as DRQ rises, and the NMI
 * that ends the read jumps to 4300h when the status shows no error.
 */
export function diskBootRom() {
  const rom = new Uint8Array(0x3800);
  rom.set([
    0xf3, //                          0000  DI
    0x31, 0x00, 0x50, //              0001  LD SP,5000H
    0xdb, 0xf0, //                    0004  IN A,(F0H)
    0x3c, //                          0006  INC A
    0x28, 0x20, //                    0007  JR Z,0029H: no controller
    0x3e, 0x81, 0xd3, 0xf4, //        0009  LD A,81H / OUT (F4H),A: drive 0
    0x3e, 0x80, 0xd3, 0xe4, //        000D  LD A,80H / OUT (E4H),A: INTRQ raises NMI
    0x01, 0xf3, 0x00, //              0011  LD BC,00F3H
    0x21, 0x00, 0x43, //              0014  LD HL,4300H
    0x3e, 0x01, 0xd3, 0xf2, //        0017  sector 1
    0x3e, 0x80, 0xd3, 0xf0, //        001B  READ SECTOR
    0xdb, 0xf0, //                    001F  IN A,(F0H)
    0xe6, 0x02, //                    0021  AND 02H: DRQ
    0x28, 0xfa, //                    0023  JR Z,001FH
    0xed, 0xa2, //                    0025  INI
    0x18, 0xf6, //                    0027  JR 001FH
    0x76, //                          0029  HALT
  ]);
  rom.set([
    0xaf, 0xd3, 0xe4, //              0066  XOR A / OUT (E4H),A
    0xe1, //                          0069  POP HL
    0xdb, 0xf0, 0xe6, 0x1c, //        006A  IN A,(F0H) / AND 1CH
    0xca, 0x00, 0x43, //              006E  JP Z,4300H
    0x76, //                          0071  HALT
  ], 0x66);
  return rom;
}

/**
 * A 40-track, 18-sector JV1 (a headerless dump, sectors numbered from 1) whose track 0 sector 1
 * copies `message` to the top line of the screen at 4300h and spins.
 * @param {string} message
 */
export function bootJv1(message) {
  const bytes = new Uint8Array(40 * 18 * 256);
  bytes.set([
    0x21, 0x20, 0x43, //              4300  LD HL,4320H
    0x11, 0x00, 0x3c, //              4303  LD DE,3C00H
    0x01, message.length, 0x00, //    4306  LD BC,length
    0xed, 0xb0, //                    4309  LDIR
    0x18, 0xfe, //                    430B  JR 430BH
  ]);
  bytes.set([...message].map((c) => c.charCodeAt(0)), 0x20);
  return bytes;
}
