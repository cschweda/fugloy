import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Session } from '../src/session.js';
import { connect, syntheticRom, testConfig } from './helpers.js';

describe('server', () => {
  it('lists the status tool and answers it before any load', async () => {
    const { client, call, close } = await connect({ config: testConfig({ source: '/x/fugloy.mcp.json', roms: { model3: '/x/model3.rom' } }) });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('status');
    const status = await call('status');
    expect(status.isError).toBe(false);
    expect(status.text).toBe(
      [
        'Model: III',
        'Program: none (call load)',
        'Cycles: 0',
        'PC: none (no machine yet)',
        'Breaks: 0  Watches: 0  Labels: 0',
        'Trace: off',
        'ROM: /x/model3.rom',
        'Config: /x/fugloy.mcp.json',
      ].join('\n'),
    );
    await close();
  });

  it('status names the defaults when no config file was found', async () => {
    const { call, close } = await connect();
    const { text } = await call('status');
    expect(text).toContain('ROM: none configured (set roms.model3 in fugloy.mcp.json)');
    expect(text).toContain('Config: defaults (no fugloy.mcp.json found)');
    await close();
  });

  it('status reports a running machine', async () => {
    const config = testConfig();
    const session = new Session(config);
    session.machine = session.createMachine(syntheticRom());
    session.program = { path: '/x/GAME.CMD', name: 'GAME', bytes: 5, manifest: null, sha256: '0'.repeat(64) };
    session.labels.set(0x5200, { addr: 0x5200, name: 'CLS' });
    session.machine.step(2);
    session.machine.debug.break(0x0003);
    const { call, close } = await connect({ config, session });
    const { text } = await call('status');
    expect(text).toContain('Program: GAME (/x/GAME.CMD)');
    expect(text).toContain('Cycles: 22');
    expect(text).toContain('PC: 0003h');
    expect(text).toContain('Breaks: 1  Watches: 0  Labels: 1');
    await close();
  });

  it('turns a thrown error into isError text, never a stack', async () => {
    const tools = [
      { name: 'needs', description: 'needs a machine', handler: (session) => session.requireMachine() },
      { name: 'boom', description: 'throws a non-Error', handler: () => { throw 'plain words'; } },
    ];
    const { call, close } = await connect({ tools });
    expect(await call('needs')).toEqual({ text: 'No program loaded; call load first.', isError: true });
    expect(await call('boom')).toEqual({ text: 'plain words', isError: true });
    await close();
  });

  it('caps output at limits.outputBytes on a line boundary', async () => {
    const tools = [{ name: 'long', description: 'long output', handler: () => Array.from({ length: 100 }, (_, k) => `line ${k}`).join('\n') }];
    const { call, close } = await connect({ config: testConfig({ limits: { ...testConfig().limits, outputBytes: 64 } }), tools });
    const { text, isError } = await call('long');
    expect(isError).toBe(false);
    const lines = text.split('\n');
    expect(lines.at(-1)).toMatch(/^… \(output cut at 64 bytes; \d+ more lines\)$/);
    expect(Buffer.byteLength(lines.slice(0, -1).join('\n'))).toBeLessThanOrEqual(64);
    expect(lines[0]).toBe('line 0');
    await close();
  });
});

describe('stdio', () => {
  it('nothing but JSON-RPC reaches stdout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fugloy-mcp-stdio-'));
    try {
      writeFileSync(join(dir, 'synthetic.rom'), syntheticRom());
      writeFileSync(join(dir, 'fugloy.mcp.json'), JSON.stringify({ roms: { model3: './synthetic.rom' } }));
      const bin = fileURLToPath(new URL('../bin/fugloy-mcp.js', import.meta.url));
      const noisy = fileURLToPath(new URL('./fixtures/noisy.mjs', import.meta.url));
      // noisy.mjs makes the process print through every console method and makes a Machine
      // built by the session's own factory log, once the server has answered initialize.
      const child = spawn(process.execPath, ['--import', noisy, bin], {
        cwd: dir,
        env: { ...process.env, FUGLOY_CONFIG: join(dir, 'fugloy.mcp.json') },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (s) => (stdout += s));
      child.stderr.setEncoding('utf8').on('data', (s) => (stderr += s));
      const exited = new Promise((resolve) => child.on('exit', resolve));

      /** Wait until stdout holds a response with this id. */
      const response = (id) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`no response ${id}; stdout: ${stdout}; stderr: ${stderr}`)), 5000);
          const check = () => {
            const line = stdout.split('\n').find((l) => l.includes(`"id":${id}`));
            if (line) {
              clearTimeout(timer);
              child.stdout.off('data', check);
              resolve(JSON.parse(line));
            }
          };
          child.stdout.on('data', check);
          check();
        });
      const send = (msg) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

      send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
      expect((await response(1)).result.serverInfo.name).toBe('fugloy-mcp');
      send({ method: 'notifications/initialized' });
      send({ id: 2, method: 'tools/list' });
      expect((await response(2)).result.tools.map((t) => t.name)).toContain('status');
      send({ id: 3, method: 'tools/call', params: { name: 'status', arguments: {} } });
      expect((await response(3)).result.content[0].text).toContain(`Config: ${join(dir, 'fugloy.mcp.json')}`);
      child.stdin.end();
      await exited;

      // The noise happened, and it went to stderr.
      for (const word of ['noisy-log', 'noisy-info', 'noisy-debug', 'noisy-dir', 'Cassette loaded: 3 bytes']) expect(stderr).toContain(word);
      // Every stdout line is a JSON-RPC message.
      const lines = stdout.split('\n').filter((l) => l !== '');
      expect(lines.length).toBe(3);
      for (const line of lines) expect(JSON.parse(line).jsonrpc).toBe('2.0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);
});
