/**
 * The guardrails of MCP spec §7, one test per limit that trips it through the protocol and
 * checks the text, on the synthetic ROM and synthetic programs: the output cap and paging, the
 * emulated and wall-clock caps on run, the trace depth and its page size, step, peek, the
 * snapshot cap, poke into ROM, load outside the fixtures folder, and the filesystem rule (the
 * server writes the sidecar and explicit export paths, nothing else). Then MCP spec §10's
 * round trip with a real restart: two child processes of the bin, one after the other.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOOLS } from '../src/server.js';
import { RAIDERS, connect, syntheticRom, testConfig } from './helpers.js';

let dir;
const at = (/** @type {string} */ name) => join(dir, name);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fugloy-mcp-guardrails-'));
  writeFileSync(at('synthetic.rom'), syntheticRom());
  writeFileSync(at('raiders.cmd'), RAIDERS);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A server on the synthetic ROM with `limits` over the defaults, and `over` over the config. */
function server(limits = {}, over = {}) {
  const config = testConfig({ roms: { model3: at('synthetic.rom') }, ...over });
  config.limits = { ...config.limits, ...limits };
  return connect({ config });
}

async function ok(call, name, args = {}) {
  const r = await call(name, args);
  if (r.isError) throw new Error(`${name} failed: ${r.text}`);
  return r.text;
}

/** A server with RAIDERS (or `file`) loaded. */
async function loaded(limits = {}, file = 'raiders.cmd') {
  const s = await server(limits);
  await ok(s.call, 'load', { path: at(file) });
  return s;
}

const refused = (text) => ({ text, isError: true });

describe('guardrails (MCP spec §7)', () => {
  it('output per call: capped at limits.outputBytes on a line, paged with offset', async () => {
    const { call, close } = await loaded({ outputBytes: 512 });
    const full = await loaded();
    const whole = await ok(full.call, 'peek', { addr: '7000', len: 1024 });
    await full.close();
    const first = await ok(call, 'peek', { addr: '7000', len: 1024 });
    expect(Buffer.byteLength(first)).toBeLessThanOrEqual(512);
    expect(first.split('\n').at(-1)).toBe('… (58 more lines; use offset=6)');
    // Paging through every offset gives back the whole dump, each page within the cap.
    const pages = [first];
    for (let m = /use offset=(\d+)\)$/.exec(first); m !== null; m = /use offset=(\d+)\)$/.exec(pages.at(-1))) {
      const page = await ok(call, 'peek', { addr: '7000', len: 1024, offset: Number(m[1]) });
      expect(Buffer.byteLength(page)).toBeLessThanOrEqual(512);
      pages.push(page);
    }
    expect(pages.map((p) => p.replace(/\n… \(\d+ more lines?; use offset=\d+\)$/, '')).join('\n')).toBe(whole);
    expect(await call('peek', { addr: '7000', len: 1024, offset: 99 })).toEqual({ text: '… (no lines at offset=99; the output has 64 lines)', isError: false });
    await close();
  });

  it('output per call: the 8,192-byte default holds for the longest tool output', async () => {
    const { call, close } = await loaded();
    const out = await ok(call, 'disasm', { addr: '7000', n: 512 });
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(8192);
    expect(out.split('\n').at(-1)).toMatch(/^… \(\d+ more lines; use offset=\d+\)$/);
    await close();
  });

  it('run: stops at the emulated cap, and refuses a longer budget', async () => {
    const { call, close } = await loaded({ runSecondsEmulated: 0.5 });
    const lines = (await ok(call, 'run', {})).split('\n');
    expect(lines[0]).toBe('stopped: cycles (the 0.5 s emulated cap, limits.runSecondsEmulated)');
    // 0.5 s is 1,013,760 T-states; the run ends at the first instruction boundary past it.
    expect(lines[1]).toMatch(/^Ran 1,013,7(6\d|7\d) cycles \(0\.500 s emulated\)$/);
    expect(await call('run', { seconds: 1 })).toEqual(refused('seconds must be more than 0 and at most 0.5 (limits.runSecondsEmulated), not 1.'));
    expect(await call('run', { cycles: 1_013_761 })).toEqual(refused('cycles must be between 1 and 1013760, not 1013761.'));
    await close();
  });

  it('run: stops at the wall-clock cap', async () => {
    const { call, close } = await loaded({ runSecondsWall: 0.05 });
    const lines = (await ok(call, 'run', { trace: true })).split('\n');
    expect(lines[0]).toBe("stopped: wallclock (the 0.05 s wall-clock cap, limits.runSecondsWall: emulation ran slow, often because of trace; the result depends on the host's speed)");
    await close();
  });

  it('trace depth: keeps the newest limits.traceDepth instructions and refuses more', async () => {
    const { call, close } = await loaded({ traceDepth: 50 });
    await ok(call, 'step', { n: 100 });
    expect((await ok(call, 'trace', { n: 50, regs: true })).split('\n')[0]).toMatch(/^The newest 50 of 50 instructions recorded, oldest first/);
    expect(await call('trace', { n: 51 })).toEqual(refused('n must be between 1 and 50, not 51.'));
    await close();
    // The default depth, 2,000.
    const d = await loaded();
    await ok(d.call, 'run', { cycles: 100_000, trace: true });
    expect((await ok(d.call, 'trace', { n: 2000 })).split('\n')[0]).toMatch(/^The newest [\d,]+ of 2,000 instructions recorded/);
    expect(await d.call('trace', { n: 2001 })).toEqual(refused('n must be between 1 and 2000, not 2001.'));
    await d.close();
  });

  it('trace page size: at most 100 trace lines a page, after the heading', async () => {
    // A cap high enough that only the page size cuts.
    const { call, close } = await loaded({ outputBytes: 1 << 20 });
    await ok(call, 'run', { cycles: 20_000, trace: true });
    const first = (await ok(call, 'trace', { n: 250, regs: true })).split('\n');
    expect(first).toHaveLength(102);
    expect(first[0]).toMatch(/^The newest 250 of [\d,]+ instructions recorded/);
    expect(first.at(-1)).toBe('… (150 more lines; use offset=101)');
    const second = (await ok(call, 'trace', { n: 250, regs: true, offset: 101 })).split('\n');
    expect(second).toHaveLength(101);
    expect(second.at(-1)).toBe('… (50 more lines; use offset=201)');
    expect((await ok(call, 'trace', { n: 250, regs: true, offset: 201 })).split('\n')).toHaveLength(50);
    // The default, 100, fits one page.
    expect((await ok(call, 'trace', { regs: true })).split('\n')).toHaveLength(101);
    await close();
  });

  it('step: at most limits.stepMax instructions', async () => {
    const { call, close } = await loaded();
    expect(await call('step', { n: 101 })).toEqual(refused('n must be between 1 and 100, not 101.'));
    expect(await call('step', { n: 0 })).toEqual(refused('n must be between 1 and 100, not 0.'));
    await close();
    const small = await loaded({ stepMax: 5 });
    expect(await small.call('step', { n: 6 })).toEqual(refused('n must be between 1 and 5, not 6.'));
    await small.close();
  });

  it('peek: at most limits.peekMax bytes', async () => {
    const { call, close } = await loaded();
    expect(await call('peek', { addr: '7000', len: 1025 })).toEqual(refused('len must be between 1 and 1024, not 1025.'));
    await close();
  });

  it('snapshots: at most limits.snapshots (16), the least recently used evicted and named', async () => {
    const { call, close } = await loaded();
    for (let k = 0; k < 16; k++) expect(await ok(call, 'snapshot', { name: `s${k}` })).not.toContain('Evicted');
    expect((await ok(call, 'snapshot', { name: 's16' })).split('\n')[1]).toBe('Evicted "s0", the least recently used snapshot (at most 16 are kept).');
    expect(await call('restore', { name: 's0' })).toEqual(refused(`There is no snapshot named "s0"; the snapshots are ${Array.from({ length: 16 }, (_, k) => `s${k + 1}`).join(', ')}.`));
    await close();
  });

  it('poke into ROM: refused unless force is true, and nothing is written', async () => {
    const { call, close } = await loaded();
    expect(await call('poke', { addr: '0000', bytes: 'C9C9' })).toEqual(refused('0000h-0001h is in ROM (0000h-37FFh); nothing was written. Pass force: true to patch the ROM image anyway.'));
    expect(await call('poke', { addr: '37FF', bytes: '00' })).toEqual(refused('37FFh-37FFh is in ROM (0000h-37FFh); nothing was written. Pass force: true to patch the ROM image anyway.'));
    expect(await ok(call, 'peek', { addr: '0000', len: 2 })).toMatch(/^0000 {2}31 00 /);
    expect(await ok(call, 'poke', { addr: '0000', bytes: 'C9', force: true })).toBe('Wrote 1 byte at 0000h (into ROM, forced):\n0000h  31 → C9');
    await close();
  });

  it('load outside the fixtures folder: allowed, and the path is echoed back', async () => {
    mkdirSync(at('fixtures'), { recursive: true });
    writeFileSync(at('fixtures/inside.cmd'), RAIDERS);
    const { call, close } = await server({}, { fixtures: at('fixtures') });
    expect((await ok(call, 'load', { path: at('raiders.cmd') })).split('\n').at(-1)).toBe(`Path: ${at('raiders.cmd')} (outside the fixtures folder)`);
    expect((await ok(call, 'load', { path: 'inside.cmd' })).split('\n').at(-1)).toBe(`Path: ${at('fixtures/inside.cmd')}`);
    await close();
  });

  it('filesystem writes: only the sidecar and an explicit export path, after every tool', async () => {
    const work = mkdtempSync(join(tmpdir(), 'fugloy-mcp-writes-'));
    const files = (/** @type {string} */ root) => {
      /** @type {string[]} */
      const out = [];
      const walk = (/** @type {string} */ d) => {
        for (const name of readdirSync(d)) {
          const p = join(d, name);
          if (statSync(p).isDirectory()) walk(p);
          else out.push(relative(root, p));
        }
      };
      walk(root);
      return out.sort();
    };
    const cwdBefore = readdirSync(process.cwd()).sort();
    try {
      writeFileSync(join(work, 'synthetic.rom'), syntheticRom());
      writeFileSync(join(work, 'raiders.cmd'), RAIDERS);
      writeFileSync(join(work, 'notes.txt'), 'mine');
      const config = testConfig({ roms: { model3: join(work, 'synthetic.rom') } });
      const { call, close } = await connect({ config });
      /** @type {[string, object][]} */
      const script = [
        ['status', {}], ['load', { path: join(work, 'raiders.cmd') }], ['run', { until: 'screen', trace: true }], ['step', { n: 3 }],
        ['key', { keys: ['ENTER'] }], ['regs', {}], ['peek', { addr: '7000' }], ['poke', { addr: '7E00', bytes: '01' }],
        ['disasm', { addr: '7000', n: 4 }], ['screen', {}], ['search', { text: 'PLAYER' }], ['break', { addr: '7025' }],
        ['unbreak', { all: true }], ['watch', { addr: '3C00', len: 16 }], ['unwatch', { all: true }], ['hits', {}],
        ['trace', { n: 5 }], ['callers', { addr: '7030' }], ['callees', { addr: '7000' }], ['label', { addr: '7030', name: 'PRINT' }],
        ['unlabel', { name: 'PRINT' }], ['labels', {}], ['coverage', {}], ['suggest', { minCalls: 1 }],
        ['snapshot', { name: 'a' }], ['restore', { name: 'a' }], ['snapshots', {}], ['diff', { a: 'a', b: 'now' }],
        ['coverage', { mode: 'export', path: join(work, 'out.json') }], ['reset', {}],
      ];
      expect(new Set(script.map(([name]) => name))).toEqual(new Set(TOOLS.map((t) => t.name)));
      for (const [name, args] of script) await ok(call, name, args);
      // A file there that is not a label file is not replaced without overwrite.
      expect(await call('load', { path: join(work, 'raiders.cmd') })).toMatchObject({ isError: false });
      expect((await call('coverage', { mode: 'export', path: join(work, 'notes.txt') })).text).toBe(
        `${join(work, 'notes.txt')} exists and it is not JSON, so it is not overwritten; give another path, or pass overwrite: true to replace it.`,
      );
      await close();
      expect(files(work)).toEqual(['notes.txt', 'out.json', 'raiders.cmd', 'raiders.fugloy.json', 'synthetic.rom']);
      expect(readFileSync(join(work, 'notes.txt'), 'utf8')).toBe('mine');
      expect(readdirSync(process.cwd()).sort()).toEqual(cwdBefore);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});

describe('round trip with a real restart (MCP spec §10)', () => {
  it('label, then a second server process shows the label from the sidecar', async () => {
    // The real path, as the child sees its working folder (macOS's tmpdir is a link into /private).
    const work = realpathSync(mkdtempSync(join(tmpdir(), 'fugloy-mcp-restart-')));
    const bin = fileURLToPath(new URL('../bin/fugloy-mcp.js', import.meta.url));
    writeFileSync(join(work, 'synthetic.rom'), syntheticRom());
    writeFileSync(join(work, 'raiders.cmd'), RAIDERS);
    writeFileSync(join(work, 'fugloy.mcp.json'), JSON.stringify({ roms: { model3: './synthetic.rom' } }));
    /** Start the bin as a child process in `work` and connect a client to it over stdio. */
    const start = async () => {
      const transport = new StdioClientTransport({ command: process.execPath, args: [bin], cwd: work, env: { PATH: process.env.PATH ?? '', FUGLOY_CONFIG: join(work, 'fugloy.mcp.json') }, stderr: 'pipe' });
      const client = new Client({ name: 'fugloy-mcp-restart', version: '0.0.0' });
      await client.connect(transport);
      const call = async (/** @type {string} */ name, /** @type {object} */ args = {}) => {
        const r = await client.callTool({ name, arguments: /** @type {any} */ (args) });
        const text = /** @type {{ text: string }[]} */ (r.content).map((c) => c.text).join('');
        if (r.isError) throw new Error(`${name} failed: ${text}`);
        return text;
      };
      return { call, pid: transport.pid, close: () => client.close() };
    };
    try {
      const note = 'copies a zero-ended string from DE to video RAM at HL';
      const first = await start();
      expect(first.pid).toEqual(expect.any(Number));
      await first.call('load', { path: 'raiders.cmd' });
      await first.call('run', { until: 'screen' });
      expect(await first.call('label', { addr: '7030', name: 'PRINT', note })).toBe(`Labelled 7030h PRINT (code).\nWrote ${join(work, 'raiders.fugloy.json')}.`);
      await first.call('coverage', { mode: 'export' });
      await first.close();

      const second = await start();
      expect(second.pid).not.toBe(first.pid);
      const loadText = await second.call('load', { path: 'raiders.cmd' });
      expect(loadText).toMatch(new RegExp(`^Sidecar: ${join(work, 'raiders.fugloy.json').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: \\d+ labels?, 1 recorded session`, 'm'));
      expect(await second.call('labels', { source: 'user' })).toBe(['Labels (1 of 2, source user):', 'addr   kind  size   source    name', `7030h  code         user      PRINT  ; ${note}`].join('\n'));
      expect((await second.call('disasm', { addr: '7009', n: 1 })).split('\n')[0]).toMatch(/CALL 7030H +; PRINT$/);
      await second.close();
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 30_000);
});
