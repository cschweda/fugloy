/**
 * MCP phase A tools (docs/fugloy-mcp-spec.md §5, §11) on a synthetic ROM and synthetic programs,
 * so CI runs them: load, reset, run, step, key, regs, peek, poke, screen, through the protocol.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { formatOf, isCas } from '../src/tools/load.js';
import { buildCas, buildCmd, connect, syntheticRom, testConfig } from './helpers.js';

const NO_MACHINE = 'No program loaded; call load first.';

/** HELLO: writes "HI" at the top left of the screen, waits, and halts; a two-byte data block at 7040h. */
const HELLO = buildCmd(
  [
    { name: 'HELLO' },
    {
      addr: 0x7000,
      data: [
        0x31, 0x00, 0x7f, //  7000  LD SP,7F00H
        0x21, 0x00, 0x3c, //  7003  LD HL,3C00H
        0x36, 0x48, //        7006  LD (HL),'H'
        0x23, //              7008  INC HL
        0x36, 0x49, //        7009  LD (HL),'I'
        0x06, 0x00, //        700B  LD B,0
        0x10, 0xfe, //        700D  DJNZ 700DH
        0x76, //              700F  HALT
      ],
    },
    { addr: 0x7040, data: [0x12, 0x34] },
  ],
  0x7000,
);

/** KEYS: forever ORs keyboard row 0 (@ A B C D E F G) into 3C40h, so a key typed through the matrix stays seen. */
const KEYS = buildCmd(
  [
    {
      addr: 0x7000,
      data: [
        0x21, 0x40, 0x3c, //  7000  LD HL,3C40H
        0x3a, 0x01, 0x38, //  7003  LD A,(3801H)
        0xb6, //              7006  OR (HL)
        0x77, //              7007  LD (HL),A
        0x18, 0xf9, //        7008  JR 7003H
      ],
    },
  ],
  0x7000,
);

/** FED: forever calls the ROM's wait-for-key (0049h) and prints what it returns from 3C80h on. */
const FED = buildCmd(
  [
    {
      addr: 0x7000,
      data: [
        0x31, 0x00, 0x7f, //  7000  LD SP,7F00H
        0x21, 0x80, 0x3c, //  7003  LD HL,3C80H
        0xcd, 0x49, 0x00, //  7006  CALL 0049H
        0x77, //              7009  LD (HL),A
        0x23, //              700A  INC HL
        0x18, 0xf9, //        700B  JR 7006H
      ],
    },
  ],
  0x7000,
);

/** PIECES: draws A, B, and C at the top left a tenth of a second apart, then loops without drawing. */
const PIECES = (() => {
  const code = new Array(0x29).fill(0);
  const place = (addr, bytes) => code.splice(addr - 0x7000, bytes.length, ...bytes);
  place(0x7000, [0x31, 0x00, 0x7f]); //  7000  LD SP,7F00H
  place(0x7003, [0x21, 0x00, 0x3c]); //  7003  LD HL,3C00H
  place(0x7006, [0x36, 0x41, 0x23]); //  7006  LD (HL),'A' / INC HL
  place(0x7009, [0xcd, 0x20, 0x70]); //  7009  CALL 7020H
  place(0x700c, [0x36, 0x42, 0x23]); //  700C  LD (HL),'B' / INC HL
  place(0x700f, [0xcd, 0x20, 0x70]); //  700F  CALL 7020H
  place(0x7012, [0x36, 0x43]); //        7012  LD (HL),'C'
  place(0x7014, [0x18, 0xfe]); //        7014  JR 7014H
  place(0x7020, [0x01, 0x78, 0x1e]); //  7020  LD BC,1E78H   about 0.1 s of
  place(0x7023, [0x0b, 0x78, 0xb1]); //  7023  DEC BC / LD A,B / OR C
  place(0x7026, [0x20, 0xfb, 0xc9]); //  7026  JR NZ,7023H / RET
  return buildCmd([{ addr: 0x7000, data: code }], 0x7000);
})();

/** BLINK: prints A, then blinks a star beside it, on and off every tenth of a second, forever. */
const BLINK = (() => {
  const code = new Array(0x29).fill(0);
  const place = (addr, bytes) => code.splice(addr - 0x7000, bytes.length, ...bytes);
  place(0x7000, [0x31, 0x00, 0x7f]); //              7000  LD SP,7F00H
  place(0x7003, [0x3e, 0x41, 0x32, 0x00, 0x3c]); //  7003  LD A,'A' / LD (3C00H),A
  place(0x7008, [0x3e, 0x2a, 0x32, 0x01, 0x3c]); //  7008  LD A,'*' / LD (3C01H),A
  place(0x700d, [0xcd, 0x20, 0x70]); //              700D  CALL 7020H
  place(0x7010, [0x3e, 0x20, 0x32, 0x01, 0x3c]); //  7010  LD A,' ' / LD (3C01H),A
  place(0x7015, [0xcd, 0x20, 0x70]); //              7015  CALL 7020H
  place(0x7018, [0x18, 0xee]); //                    7018  JR 7008H
  place(0x7020, [0x01, 0x78, 0x1e]); //              7020  LD BC,1E78H   about 0.1 s of
  place(0x7023, [0x0b, 0x78, 0xb1]); //              7023  DEC BC / LD A,B / OR C
  place(0x7026, [0x20, 0xfb, 0xc9]); //              7026  JR NZ,7023H / RET
  return buildCmd([{ addr: 0x7000, data: code }], 0x7000);
})();

/** The synthetic ROM with a wait loop at 0049h for the keyboard hook to return from. */
function hookRom() {
  const rom = syntheticRom();
  rom.set([0x18, 0xfe], 0x0049); // 0049  JR 0049H
  return rom;
}

let dir;
const at = (name) => join(dir, name);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fugloy-mcp-phase-a-'));
  writeFileSync(at('synthetic.rom'), syntheticRom());
  writeFileSync(at('hook.rom'), hookRom());
  writeFileSync(at('hello.cmd'), HELLO);
  writeFileSync(at('keys.cmd'), KEYS);
  writeFileSync(at('fed.cmd'), FED);
  writeFileSync(at('pieces.cmd'), PIECES);
  writeFileSync(at('blink.cmd'), BLINK);
  writeFileSync(at('bad.cas'), new Uint8Array([0x00, 0xa5, 0x55, 0x42, 0x41, 0x44, 0x20, 0x20, 0x20, 0x99]));
  writeFileSync(at('hello.cas'), buildCas('HELLO', [{ addr: 0x7000, data: [0x76] }], 0x7000));
  writeFileSync(at('notes.txt'), 'just some words\n');
  writeFileSync(at('prog.bas'), '10 PRINT "HI"\r\n20 GOTO 10\r\n');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A server on the synthetic ROM (or `rom`), with `limits` over the defaults. */
function server({ rom = 'synthetic.rom', limits = {} } = {}) {
  const config = testConfig({ roms: { model3: at(rom) } });
  config.limits = { ...config.limits, ...limits };
  return connect({ config });
}

/** Call a tool and expect success. */
async function ok(call, name, args) {
  const r = await call(name, args);
  if (r.isError) throw new Error(`${name} failed: ${r.text}`);
  return r.text;
}

describe('phase A tools', () => {
  it('lists the phase A tools', async () => {
    const { client, close } = await server();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['load', 'reset', 'status', 'run', 'step', 'key', 'regs', 'peek', 'poke', 'screen']);
    await close();
  });

  it('every tool before load explains itself', async () => {
    const { call, close } = await server();
    const calls = [
      ['run', {}],
      ['step', {}],
      ['key', { text: 'A' }],
      ['regs', {}],
      ['peek', { addr: '7000' }],
      ['poke', { addr: '7000', bytes: '00' }],
      ['screen', {}],
    ];
    for (const [name, args] of calls) expect(await call(name, args), name).toEqual({ text: NO_MACHINE, isError: true });
    await close();
  });

  it('reset before load powers on a machine with no program', async () => {
    const { call, close } = await server();
    const text = await ok(call, 'reset', {});
    expect(text.split('\n')[0]).toMatch(/^PC 0000  /);
    expect(text).toContain('Cycles: 0');
    expect(await ok(call, 'status', {})).toContain('Program: none (call load)');
    await close();
  });

  it('load returns the manifest', async () => {
    const { call, close } = await server();
    const lines = (await ok(call, 'load', { path: at('hello.cmd') })).split('\n');
    expect(lines[6]).toMatch(/^ROM: unrecognised \(SHA-256 [0-9a-f]{16}…\)$/);
    expect(lines).toEqual([
      `Loaded HELLO from ${at('hello.cmd')}`,
      'Format: .CMD (load module)',
      'Blocks (2):',
      '  7000h–700Fh (16 bytes)  record 01',
      '  7040h–7041h (2 bytes)  record 01',
      'Entry: 7000h (the PC is there now)',
      lines[6],
      'Boot: the ROM showed no READY within 5 s emulated, so the program was loaded where the ROM had got to',
      'Sidecar: no sidecar',
      `Path: ${at('hello.cmd')}`,
    ]);
    expect(await ok(call, 'status', {})).toContain(`Program: HELLO (${at('hello.cmd')})`);
    expect((await ok(call, 'regs', {})).split('\n')[0]).toMatch(/^PC 7000  /);
    await close();
  });

  it('load detects a .CAS from its content and loads it at once', async () => {
    const { call, close } = await server();
    const text = await ok(call, 'load', { path: at('hello.cas') });
    expect(text).toContain('Loaded HELLO from');
    expect(text).toContain('Format: .CAS (system, loaded at once)');
    expect(text).toContain('  7000h–7000h (1 byte)  block 3C');
    expect(text).toContain('Entry: 7000h');
    await close();
  });

  it('load refuses model 1 naming emu phase 6', async () => {
    const { call, close } = await server();
    const r = await call('load', { path: at('hello.cmd'), model: 1 });
    expect(r).toEqual({
      text: 'There is no Model I yet: only the Model III exists until emu phase 6 adds the Model I and the Model 4; call load with model 3 or without model.',
      isError: true,
    });
    expect((await call('load', { path: at('hello.cmd'), model: 4 })).text).toContain('There is no Model 4 yet');
    expect((await call('load', { path: at('hello.cmd'), model: 3 })).isError).toBe(false);
    await close();
  });

  it('a load that fails leaves the session as it was', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('hello.cmd') });
    await ok(call, 'step', { n: 2 });
    const before = [await ok(call, 'status', {}), await ok(call, 'regs', {}), await ok(call, 'peek', { addr: '7000', len: 16 })];
    const failed = await call('load', { path: at('bad.cas') });
    expect(failed).toEqual({ text: `${at('bad.cas')} could not be loaded as a .CAS: Unexpected SYSTEM block marker 0x99 at 9.`, isError: true });
    expect([await ok(call, 'status', {}), await ok(call, 'regs', {}), await ok(call, 'peek', { addr: '7000', len: 16 })]).toEqual(before);
    expect(before[0]).toContain('Program: HELLO');
    await close();
  });

  it('load refuses what it cannot load, in sentences', async () => {
    const { call, close } = await server();
    expect(await call('load', { path: at('missing.cmd') })).toEqual({ text: `There is no file at ${at('missing.cmd')}.`, isError: true });
    expect(await call('load', { path: dir })).toEqual({ text: `${dir} is a folder, not a program file.`, isError: true });
    expect((await call('load', { path: at('notes.txt') })).text).toBe(
      `${at('notes.txt')} is not a .CMD, .BAS, or .CAS program as far as its content shows (the extension is not consulted); raw memory images cannot be loaded.`,
    );
    const none = await connect();
    expect(await none.call('load', { path: at('hello.cmd') })).toEqual({
      text: 'No Model III ROM is configured; set roms.model3 in fugloy.mcp.json (see the MCP spec §3).',
      isError: true,
    });
    await none.close();
    await close();
  });

  it('detects formats from content, never the extension', async () => {
    expect(formatOf(HELLO)).toBe('cmd');
    expect(formatOf(buildCas('X', [{ addr: 0x7000, data: [0] }], 0x7000))).toBe('cas');
    expect(isCas(new Uint8Array([0xa5, 0xd3, 0xd3, 0xd3, 0x41]))).toBe(true);
    expect(isCas(new Uint8Array([0x55, 0x55, 0x7f, 0x55]))).toBe(true);
    expect(isCas(new Uint8Array([0x00, 0x00, 0x41]))).toBe(false);
    expect(formatOf(new TextEncoder().encode('10 PRINT "HI"\r\n'))).toBe('bas');
    expect(formatOf(new Uint8Array([0xff, 0x00, 0x00]))).toBe(null);
    expect(formatOf(new TextEncoder().encode('just some words\n'))).toBe(null);
  });

  it('run stops at the screen, at a PC, at HALT, and after the cycles asked for', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('hello.cmd') });
    const screen = await ok(call, 'run', { until: 'screen' });
    const lines = screen.split('\n');
    expect(lines[0]).toBe('stopped: screen (video RAM changed)');
    expect(lines[1]).toBe('Ran 2,003 cycles (0.001 s emulated)');
    expect(lines.slice(-3)).toEqual(['2 cells changed', "(0,0) ' '→'H'", "(0,1) ' '→'I'"]);

    await ok(call, 'load', { path: at('hello.cmd') });
    expect((await ok(call, 'run', { cycles: 30 })).split('\n').slice(0, 2)).toEqual(['stopped: cycles (the 30 cycles asked for)', 'Ran 30 cycles (0.000 s emulated)']);
    const pc = await ok(call, 'run', { until: 'pc:700F' });
    expect(pc.split('\n')[0]).toBe('stopped: pc (reached 700Fh)');
    expect(pc).toMatch(/\nPC 700F  /);
    const halt = await ok(call, 'run', { until: 'halt' });
    expect(halt.split('\n')[0]).toBe('stopped: halt (the CPU ran HALT and waits for an interrupt)');
    expect(halt.split('\n')[1]).toBe('Ran 4 cycles (0.000 s emulated)');
    expect((await ok(call, 'run', { seconds: 0.001 })).split('\n')[0]).toBe('stopped: cycles (the 0.001 s asked for)');
    await close();
  });

  it('run until settled waits for a static screen to go quiet, where until screen stops at its first change', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('pieces.cmd') });
    const first = (await ok(call, 'run', { until: 'screen' })).split('\n');
    expect(first[0]).toBe('stopped: screen (video RAM changed)');
    expect(first.slice(-2)).toEqual(['1 cell changed', "(0,0) ' '→'A'"]);
    await ok(call, 'load', { path: at('pieces.cmd') });
    const settled = (await ok(call, 'run', { until: 'settled' })).split('\n');
    expect(settled[0]).toBe('stopped: settled (video RAM changed, then stayed the same for 0.5 s emulated)');
    // C lands about 0.2 s in; 0.5 s without a change follows.
    expect(settled[1]).toMatch(/^Ran 1,4\d\d,\d{3} cycles \(0\.7\d\d s emulated\)$/);
    expect(settled.slice(-4)).toEqual(['3 cells changed', "(0,0) ' '→'A'", "(0,1) ' '→'B'", "(0,2) ' '→'C'"]);
    // A screen that never changes runs to the cap.
    await ok(call, 'load', { path: at('keys.cmd') });
    expect((await ok(call, 'run', { until: 'settled', seconds: 1 })).split('\n')[0]).toBe('stopped: cycles (the 1 s asked for)');
    await close();
  });

  it('run until settled stops when a blink cycle closes', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('blink.cmd') });
    // The first change shows "A*"; the star goes off at 0.1 s ("A "), and back on at 0.2 s
    // returns to "A*", a state already seen, so the blink cycle has closed.
    const lines = (await ok(call, 'run', { until: 'settled' })).split('\n');
    expect(lines[0]).toBe('stopped: settled (video RAM returned to a state it held since it first changed: an animation or blink cycle closed)');
    expect(lines[1]).toMatch(/^Ran 4\d\d,\d{3} cycles \(0\.2\d\d s emulated\)$/);
    expect(lines.slice(-3)).toEqual(['2 cells changed', "(0,0) ' '→'A'", "(0,1) ' '→'*'"]);
    await close();
  });

  it('run refuses bad arguments in sentences', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('hello.cmd') });
    expect((await call('run', { until: 'forever' })).text).toBe('until must be "break", "halt", "screen", "settled", or "pc:<addr>" (such as "pc:5200"), not "forever".');
    expect((await call('run', { cycles: 10, seconds: 1 })).text).toBe('Give cycles or seconds, not both.');
    expect((await call('run', { seconds: 11 })).text).toBe('seconds must be more than 0 and at most 10 (limits.runSecondsEmulated), not 11.');
    expect((await call('run', { cycles: 30_000_000 })).text).toBe('cycles must be between 1 and 20275200, not 30000000.');
    expect((await call('run', { cycles: '400' })).text).toBe('The argument "cycles" is a decimal number; write 1024, not "400" (lengths and counts are never hex or strings).');
    await close();
  });

  it('run stops at the emulated cap', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('keys.cmd') });
    const text = await ok(call, 'run', { until: 'break' });
    const lines = text.split('\n');
    expect(lines[0]).toBe('stopped: cycles (the 10 s emulated cap, limits.runSecondsEmulated)');
    expect(lines[1]).toMatch(/^Ran 20,275,2\d\d cycles \(10\.000 s emulated\)$/);
    expect(lines[2]).toBe('(no breakpoints are set, so only a stop watch or a cap could stop it)');
    await close();
  });

  it('run stops at the wall-clock cap', async () => {
    const { call, close } = await server({ limits: { runSecondsWall: 0.05 } });
    await ok(call, 'load', { path: at('keys.cmd') });
    const text = await ok(call, 'run', { trace: true });
    expect(text.split('\n')[0]).toBe(
      'stopped: wallclock (the 0.05 s wall-clock cap, limits.runSecondsWall: emulation ran slow, often because of trace; the result depends on the host\'s speed)',
    );
    expect(text).toContain('Trace: recorded while running (the last 2,000 instructions are kept)');
    await close();
  });

  it('step shows each instruction and the registers', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('hello.cmd') });
    const text = await ok(call, 'step', { n: 3 });
    const lines = text.split('\n');
    expect(lines.slice(0, 3)).toEqual([
      '7000  31 00 7F     LD SP,7F00H       [10]',
      '7003  21 00 3C     LD HL,3C00H       [10]',
      '7006  36 48        LD (HL),48H       [10]',
    ]);
    expect(lines[3]).toMatch(/^PC 7008  SP 7F00  .* HL 3C00  /);
    expect((await call('step', { n: 101 })).text).toBe('n must be between 1 and 100, not 101.');
    expect((await call('step', { n: 0 })).text).toBe('n must be between 1 and 100, not 0.');
    await ok(call, 'run', { until: 'halt' });
    expect((await ok(call, 'step', { n: 2 })).split('\n')[0]).toBe('(2 of the 2 steps found the CPU halted, waiting for an interrupt)');
    await close();
  });

  it('key types through the matrix and runs until the keys are delivered', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('keys.cmd') });
    const text = await ok(call, 'key', { text: 'A' });
    // One key at 20 cps is held 0.025 s, then the run goes 0.2 s more.
    const lines = text.split('\n');
    expect(lines[1]).toMatch(/^Ran 456,\d{3} cycles \(0\.225 s emulated\)$/);
    expect(lines).toEqual(['Typed 1 key (matrix, 20 cps)', lines[1], '1 cell changed', `(1,0) ' '→'"'`]);
    const named = await ok(call, 'key', { keys: ['enter'], cps: 10 });
    expect(named.split('\n')[0]).toBe('Typed 1 key (matrix, 10 cps)');
    expect(await call('key', { keys: ['ESCAPE'] })).toEqual({ text: '"ESCAPE" is not a key name; use ENTER, BREAK, CLEAR, UP, DOWN, LEFT, RIGHT, SHIFT, SPACE, or put characters in text.', isError: true });
    expect(await call('key', {})).toEqual({ text: 'Give text or keys to type.', isError: true });
    expect(await ok(call, 'key', { text: 'B', run: false })).toBe('Queued 1 key (matrix, 20 cps); nothing ran yet (call run to deliver them).');
    await close();
  });

  it('key keeps both of its runs within one wall-clock cap', async () => {
    // A clock that moves 1 ms each time it is read: typing one key at 20 cps takes about 27
    // slices to deliver and 203 more for the 0.2 s after, so a 0.22 s cap holds each run alone
    // but not the two together.
    const { call, close } = await server({ limits: { runSecondsWall: 0.22 } });
    await ok(call, 'load', { path: at('keys.cmd') });
    let t = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => ++t);
    try {
      const text = await ok(call, 'key', { text: 'A' });
      expect(text.split('\n')[2]).toBe(
        'stopped: wallclock (the 0.22 s wall-clock cap, limits.runSecondsWall: emulation ran slow, often because of trace; the result depends on the host\'s speed)',
      );
    } finally {
      clock.mockRestore();
    }
    await close();
  });

  it('key feeds the ROM keyboard hook in hook mode', async () => {
    const { call, close } = await server({ rom: 'hook.rom' });
    await ok(call, 'load', { path: at('fed.cmd') });
    const text = await ok(call, 'key', { text: 'HI', keys: ['ENTER'], mode: 'hook' });
    expect(text.split('\n')[0]).toBe('Typed 3 keys (fed to the ROM keyboard hook)');
    expect(text.split('\n').slice(-4)).toEqual(['3 cells changed', "(2,0) ' '→'H'", "(2,1) ' '→'I'", "(2,2) ' '→$0D"]);
    expect((await call('key', { keys: ['BREAK'], mode: 'hook' })).text).toBe('BREAK cannot be fed to the ROM keyboard hook (only ENTER and SPACE can); use mode "matrix".');
    await close();
  });

  it('regs shows the register block, or JSON', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('hello.cmd') });
    await ok(call, 'step', { n: 2 });
    const text = await ok(call, 'regs', {});
    expect(text.split('\n')).toHaveLength(3);
    expect(text).toMatch(/^PC 7006  SP 7F00  /);
    const json = JSON.parse(await ok(call, 'regs', { format: 'json' }));
    expect(json).toMatchObject({ pc: 0x7006, sp: 0x7f00, hl: 0x3c00 });
    expect((await call('regs', { format: 'xml' })).isError).toBe(true);
    await close();
  });

  it('peek dumps memory and refuses a string length with the decimal hint', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('hello.cmd') });
    expect(await ok(call, 'peek', { addr: '$7000', len: 16 })).toBe('7000  31 00 7F 21 00 3C 36 48  23 36 49 06 00 10 FE 76  1..!.<6H#6I....v');
    expect(await ok(call, 'peek', { addr: '7040h', len: 2 })).toBe('7040  12 34                                             .4');
    expect((await ok(call, 'peek', { addr: 0x7000 })).split('\n')).toHaveLength(4);
    expect(await call('peek', { addr: '7000', len: '400' })).toEqual({
      text: 'The argument "len" is a decimal number; write 1024, not "400" (lengths and counts are never hex or strings).',
      isError: true,
    });
    expect((await call('peek', { addr: '7000', len: 1025 })).text).toBe('len must be between 1 and 1024, not 1025.');
    expect((await call('peek', { addr: 'FFF0', len: 32 })).text).toBe('FFF0h + 32 bytes runs past FFFFh; ask for at most 16.');
    expect((await call('peek', { addr: 'nowhere' })).text).toContain('"nowhere" is not an address');
    await close();
  });

  it('poke writes bytes and shows old → new', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('hello.cmd') });
    expect(await ok(call, 'poke', { addr: '7040', bytes: 'AABB' })).toBe('Wrote 2 bytes at 7040h:\n7040h  12 34 → AA BB');
    expect(await ok(call, 'poke', { addr: '7040', bytes: [1] })).toBe('Wrote 1 byte at 7040h:\n7040h  AA → 01');
    expect((await call('poke', { addr: '7040', bytes: 'ABC' })).text).toBe('bytes "ABC" is not hex pairs; write "21003C" (two hex digits a byte) or an array such as [33, 0, 60].');
    expect((await call('poke', { addr: '7040', bytes: [256] })).text).toBe('bytes holds 256, and every byte must be a whole number from 0 to 255.');
    await close();
  });

  it('poke into ROM needs force', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('hello.cmd') });
    expect(await call('poke', { addr: '0003', bytes: '00' })).toEqual({
      text: '0003h-0003h is in ROM (0000h-37FFh); nothing was written. Pass force: true to patch the ROM image anyway.',
      isError: true,
    });
    expect(await ok(call, 'peek', { addr: '0003', len: 1 })).toMatch(/^0003  18 /);
    expect(await ok(call, 'poke', { addr: '0003', bytes: '00', force: true })).toBe('Wrote 1 byte at 0003h (into ROM, forced):\n0003h  18 → 00');
    expect(await call('poke', { addr: '3800', bytes: '00' })).toEqual({ text: '3800h is in the keyboard matrix (3800h-3BFFh), which cannot be written; nothing was written.', isError: true });
    await close();
  });

  it('screen shows the screen, then the cells changed since the previous call', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('hello.cmd') });
    await ok(call, 'run', { until: 'halt' });
    const full = (await ok(call, 'screen', {})).split('\n');
    expect(full).toHaveLength(20);
    expect(full[0]).toBe('```');
    expect(full[3]).toBe(`HI${' '.repeat(62)}`);
    expect(await ok(call, 'screen', { diff: true })).toBe('0 cells changed');
    await ok(call, 'poke', { addr: '3C02', bytes: '21' });
    expect(await ok(call, 'screen', { diff: true })).toBe("1 cell changed\n(0,2) ' '→'!'");
    await close();
  });

  it('reset keeps or clears RAM and restarts at 0000h', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('hello.cmd') });
    expect((await ok(call, 'reset', {})).split('\n')[0]).toMatch(/^PC 0000  /);
    expect(await ok(call, 'peek', { addr: '7040', len: 2 })).toMatch(/^7040  12 34 /);
    await ok(call, 'reset', { keepRam: false, clear: true });
    expect(await ok(call, 'peek', { addr: '7040', len: 2 })).toMatch(/^7040  00 00 /);
    await close();
  });

  it('the same session twice gives identical text', async () => {
    const script = [
      ['load', { path: at('hello.cmd') }],
      ['run', { until: 'screen' }],
      ['load', { path: at('pieces.cmd') }],
      ['run', { until: 'settled' }],
      ['load', { path: at('blink.cmd') }],
      ['run', { until: 'settled' }],
      ['load', { path: at('hello.cmd') }],
      ['step', { n: 5 }],
      ['screen', {}],
      ['run', { until: 'halt', trace: true }],
      ['regs', { format: 'json' }],
      ['peek', { addr: '7000', len: 32 }],
      ['poke', { addr: '7040', bytes: '5678' }],
      ['load', { path: at('keys.cmd') }],
      ['key', { text: 'AB', keys: ['ENTER'] }],
      ['run', { seconds: 0.5 }],
      ['screen', { diff: true }],
      ['reset', { clear: true }],
      ['status', {}],
    ];
    const once = async () => {
      const { call, close } = await server();
      const out = [];
      for (const [name, args] of script) out.push(await ok(call, name, args));
      await close();
      return out;
    };
    const a = await once();
    const b = await once();
    expect(b).toEqual(a);
  });
});
