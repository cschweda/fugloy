/**
 * MCP phase B tools (docs/fugloy-mcp-spec.md §5, §11) on a synthetic ROM and the synthetic
 * RAIDERS program, so CI runs them: break, unbreak, watch, unwatch, hits, trace, callers, disasm.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RAIDERS, buildCmd, connect, syntheticRom, testConfig } from './helpers.js';

const NO_MACHINE = 'No program loaded; call load first.';

/** COUNT: counts B down from 3 in a loop, then halts; for the trace's loop collapsing. */
const COUNT = buildCmd(
  [
    {
      addr: 0x7000,
      data: [
        0x06, 0x03, //  7000  LD B,3
        0x00, //        7002  NOP
        0x10, 0xfd, //  7003  DJNZ 7002H
        0x76, //        7005  HALT
      ],
    },
  ],
  0x7000,
);

let dir;
const at = (name) => join(dir, name);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fugloy-mcp-phase-b-'));
  writeFileSync(at('synthetic.rom'), syntheticRom());
  writeFileSync(at('raiders.cmd'), RAIDERS);
  writeFileSync(at('count.cmd'), COUNT);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function server() {
  return connect({ config: testConfig({ roms: { model3: at('synthetic.rom') } }) });
}

async function ok(call, name, args) {
  const r = await call(name, args);
  if (r.isError) throw new Error(`${name} failed: ${r.text}`);
  return r.text;
}

/** A server with RAIDERS loaded. */
async function raiders() {
  const s = await server();
  await ok(s.call, 'load', { path: at('raiders.cmd') });
  return s;
}

describe('phase B tools', () => {
  it('lists every tool in the spec §5 order', async () => {
    const { client, close } = await server();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'load', 'reset', 'status', 'run', 'step', 'key', 'regs', 'peek', 'poke', 'disasm', 'screen', 'search',
      'break', 'unbreak', 'watch', 'unwatch', 'hits', 'trace', 'callers', 'callees',
      'label', 'unlabel', 'labels', 'coverage', 'suggest',
      'snapshot', 'restore', 'snapshots', 'diff',
    ]);
    await close();
  });

  it('every phase B tool before load explains itself', async () => {
    const { call, close } = await server();
    const calls = [
      ['break', { addr: '7030' }],
      ['unbreak', { all: true }],
      ['watch', { addr: '3C00' }],
      ['unwatch', { all: true }],
      ['hits', {}],
      ['trace', {}],
      ['callers', { addr: '7030' }],
      ['disasm', { addr: '7030' }],
    ];
    for (const [name, args] of calls) expect(await call(name, args), name).toEqual({ text: NO_MACHINE, isError: true });
    await close();
  });

  it('break stops run before the instruction, and a resumed run goes on to the next hit', async () => {
    const { call, close } = await raiders();
    expect(await ok(call, 'break', { addr: '7030' })).toBe('breakpoint #1 at 7030h');
    const first = (await ok(call, 'run', {})).split('\n');
    expect(first[0]).toBe('stopped: break (breakpoint 1 at 7030h)');
    expect(first[2]).toMatch(/^PC 7030  .* DE 7040  HL 3C00  /);
    // PRINT loops back to 7030h through its JR, so the next stop is the second character.
    expect((await ok(call, 'run', {})).split('\n')[2]).toMatch(/^PC 7030  .* DE 7041  HL 3C01  /);
    expect(await ok(call, 'status', {})).toContain('Breaks: 1  Watches: 0');
    await close();
  });

  it('break takes once and a condition, and echoes the condition as it was read', async () => {
    const { call, close } = await raiders();
    expect(await ok(call, 'break', { addr: 0x7030, once: true })).toBe('breakpoint #1 at 7030h (once)');
    expect((await ok(call, 'run', {})).split('\n')[0]).toBe('stopped: break (breakpoint 1 at 7030h)');
    expect(await ok(call, 'status', {})).toContain('Breaks: 0');
    expect(await ok(call, 'break', { addr: '$7033', condition: 'A == 41 && HL >= 3C00' })).toBe('breakpoint #2 at 7033h when A == 41h && HL >= 3C00h');
    const stop = (await ok(call, 'run', {})).split('\n');
    // 'A' is the third character of SPACE RAIDERS.
    expect(stop[0]).toBe('stopped: break (breakpoint 2 at 7033h)');
    expect(stop[2]).toMatch(/^PC 7033  .* AF 41.. .* HL 3C02  /);
    expect((await call('break', { addr: '7030', condition: 'A = 41' })).text).toMatch(/^The condition "A = 41" is not understood: /);
    expect((await call('break', { addr: '10000' })).text).toBe('Address 10000 is outside 0000h-FFFFh.');
    await close();
  });

  it('unbreak removes by id, by address, or all, and says what it removed', async () => {
    const { call, close } = await raiders();
    await ok(call, 'break', { addr: '7030' });
    await ok(call, 'break', { addr: '7030', once: true });
    await ok(call, 'watch', { addr: '3C00' });
    await ok(call, 'break', { addr: '7033' });
    expect(await call('unbreak', {})).toEqual({ text: 'Give id, addr, or all.', isError: true });
    expect((await call('unbreak', { id: 1, all: true })).text).toBe('Give one of id, addr, or all, not several.');
    expect((await call('unbreak', { id: 3 })).text).toBe('#3 is a watch, not a breakpoint; use unwatch.');
    expect((await call('unbreak', { id: 9 })).text).toBe('There is no breakpoint #9; the breakpoints are #1 at 7030h, #2 at 7030h, #4 at 7033h.');
    expect((await call('unbreak', { addr: '7031' })).text).toBe('No breakpoint is set at 7031h; the breakpoints are #1 at 7030h, #2 at 7030h, #4 at 7033h.');
    expect(await ok(call, 'unbreak', { addr: '7030' })).toBe('Removed breakpoints #1, #2 at 7030h.');
    expect(await ok(call, 'unbreak', { id: 4 })).toBe('Removed breakpoint #4 at 7033h.');
    expect((await call('unbreak', { id: 4 })).text).toBe('There is no breakpoint #4; no breakpoints are set.');
    await ok(call, 'break', { addr: '7030' });
    await ok(call, 'break', { addr: '7036' });
    expect(await ok(call, 'unbreak', { all: true })).toBe('Removed 2 breakpoints.');
    expect(await ok(call, 'unbreak', { all: true })).toBe('No breakpoints were set.');
    expect(await ok(call, 'status', {})).toContain('Breaks: 0  Watches: 1');
    await close();
  });

  it('watch logs writes; hits shows them newest last with the routine they came from', async () => {
    const { call, close } = await raiders();
    expect(await ok(call, 'watch', { addr: '3C00', len: 1024 })).toBe('watch #1 on 3C00h–3FFFh (write)');
    await ok(call, 'run', { until: 'screen' });
    const lines = (await ok(call, 'hits', { n: 3 })).split('\n');
    expect(lines.slice(0, 2)).toEqual(['Hits (all watches): the newest 3 of 13, newest last', 'By pc: 7033h ×13 (in the routine called at 7030h)']);
    expect(lines[2]).toMatch(/^ +cycle  pc     addr   value  prev  watch$/);
    expect(lines[3]).toHaveLength(lines[2].length - 'watch'.length + '#1 write'.length);
    expect(lines.slice(3).map((l) => l.replace(/^ *[\d,]+/, 'C'))).toEqual([
      'C  7033h  3C0Ah  45     20    #1 write',
      'C  7033h  3C0Bh  52     20    #1 write',
      'C  7033h  3C0Ch  53     20    #1 write',
    ]);
    expect(lines).toHaveLength(6);
    const json = JSON.parse(await ok(call, 'hits', { id: 1, format: 'json' }));
    expect(json.total).toBe(13);
    expect(json.shown).toBe(13);
    expect(json.overflowed).toBe(false);
    expect(json.hits[0]).toMatchObject({ id: 1, kind: 'write', pc: 0x7033, addr: 0x3c00, value: 0x53, prev: 0x20 });
    expect((await call('hits', { id: 7 })).text).toBe('There is no watch #7; the watches are #1 on 3C00h–3FFFh.');
    expect((await call('hits', { n: '5' })).text).toBe('The argument "n" is a decimal number; write 5, not "5" (lengths and counts are never hex or strings).');
    // The By-pc attribution the text shows is in the JSON too, every PC of it.
    expect(json.byPc).toEqual([{ pc: 0x7033, count: 13, routine: 0x7030 }]);
    // The emulator's log is one for every watch, so clearing one watch's hits is refused.
    expect(await call('hits', { id: 1, clear: true })).toEqual({ text: "clear empties every watch's hits; call hits with clear and no id.", isError: true });
    expect(JSON.parse(await ok(call, 'hits', { format: 'json' })).total).toBe(13);
    const cleared = (await ok(call, 'hits', { n: 1, clear: true })).split('\n');
    expect(cleared.at(-1)).toBe('Cleared the hit log (every watch\'s hits).');
    expect(await ok(call, 'hits', {})).toBe('No hits are logged.');
    await close();
  });

  it('watch reads, both, a single byte, and stop; unwatch keeps the hits', async () => {
    const { call, close } = await raiders();
    expect(await ok(call, 'watch', { addr: '7040', len: 13, on: 'read' })).toBe('watch #1 on 7040h–704Ch (read)');
    expect(await ok(call, 'watch', { addr: '3C05', on: 'both', stop: true })).toBe('watch #2 on 3C05h (read and write, stops run)');
    const stop = (await ok(call, 'run', {})).split('\n');
    expect(stop[0]).toBe('stopped: watch (watch 2, after the instruction that touched it)');
    expect(stop[2]).toMatch(/^PC 7034  .* HL 3C05  /);
    const hits = (await ok(call, 'hits', { id: 1 })).split('\n');
    expect(hits[0]).toBe('Hits (watch #1): the newest 6 of 6, newest last');
    expect(hits[1]).toBe('By pc: 7030h ×6 (in the routine called at 7030h)');
    expect(hits.at(-1)).toMatch(/  7030h  7045h  20     20    #1 read$/);
    expect(await call('unwatch', {})).toEqual({ text: 'Give id or all.', isError: true });
    expect((await call('unwatch', { id: 1, all: true })).text).toBe('Give id or all, not both.');
    expect(await ok(call, 'unwatch', { id: 1 })).toBe('Removed watch #1 on 7040h–704Ch; its hits stay in the log.');
    expect((await call('unwatch', { id: 1 })).text).toBe('There is no watch #1; the watches are #2 on 3C05h.');
    await ok(call, 'break', { addr: '7030' });
    expect((await call('unwatch', { id: 3 })).text).toBe('#3 is a breakpoint, not a watch; use unbreak.');
    expect((await ok(call, 'hits', { id: 1 })).split('\n')[0]).toBe('Hits (watch #1): the newest 6 of 6, newest last');
    expect(await ok(call, 'unwatch', { all: true })).toBe('Removed 1 watch; its hits stay in the log.');
    expect(await ok(call, 'unwatch', { all: true })).toBe('No watches were set.');
    await close();
  });

  it('callers shows who reached an address, and points from inside a routine to its start', async () => {
    const { call, close } = await raiders();
    await ok(call, 'run', { until: 'screen' });
    expect(await ok(call, 'callers', { addr: '7030' })).toBe(
      ['Control reached 7030h from 2 places, 14 times:', 'from   kind  count', '7009h  call  1', '7036h  jr    13'].join('\n'),
    );
    expect(await ok(call, 'callers', { addr: '7033' })).toBe(
      'Nothing has transferred control to 7033h since load (coverage records calls, jumps, RSTs, and returns as they run). The nearest call target at or below it is 7030h, 3 bytes before; try callers with addr 7030h.',
    );
    expect(await ok(call, 'callers', { addr: '6000' })).toBe('Nothing has transferred control to 6000h since load (coverage records calls, jumps, RSTs, and returns as they run).');
    const json = JSON.parse(await ok(call, 'callers', { addr: '7030', format: 'json' }));
    expect(json).toEqual({ addr: 0x7030, callers: [{ from: 0x7009, kind: 'call', count: 1 }, { from: 0x7036, kind: 'jr', count: 13 }] });
    await close();
  });

  it('disasm lists from an address with coverage marks and names from the Model III tables', async () => {
    const { call, close } = await raiders();
    await ok(call, 'run', { until: 'screen' });
    expect(await ok(call, 'disasm', { addr: '7003', n: 6 })).toBe(
      [
        '* 7003  21 00 3C     LD HL,3C00H       ; VIDEO',
        '* 7006  11 40 70     LD DE,7040H',
        '* 7009  CD 30 70     CALL 7030H',
        '* 700C  3A 40 38     LD A,(3840H)      ; KEYBOARD+40h',
        '* 700F  E6 01        AND 01H',
        '* 7011  28 F9        JR Z,700CH',
        'Marks: * executed, d read or written as data, ? never seen (coverage since load)',
      ].join('\n'),
    );
    // Started mid-instruction: the operand bytes were executed (as LD HL,3C00H's), not never seen.
    expect(await ok(call, 'disasm', { addr: '7004', n: 2 })).toBe(
      [
        '* 7004  00           NOP',
        '* 7005  3C           INC A',
        'Marks: * executed, d read or written as data, ? never seen (coverage since load)',
        '(7004h was executed as an operand of an instruction that starts before it, so this listing is out of step with the code there; start disasm at an address marked * by its own instruction)',
      ].join('\n'),
    );
    const tail = (await ok(call, 'disasm', { addr: '7036', n: 4 })).split('\n');
    expect(tail).toEqual([
      '* 7036  18 F8        JR 7030H',
      '? 7038  00           NOP',
      '? 7039  00           NOP',
      '? 703A  00           NOP',
      tail[4],
    ]);
    expect((await ok(call, 'disasm', { addr: '7040', n: 1 })).split('\n')[0]).toBe('d 7040  53           LD D,E');
    // ROM addresses carry the table's names, on their own line and as targets.
    const rom = (await ok(call, 'disasm', { addr: '0000', n: 2 })).split('\n');
    expect(rom[0]).toBe('$RESET:');
    expect(rom[1]).toBe('? 0000  31 00 80     LD SP,8000H');
    expect((await ok(call, 'disasm', { addr: '7003', n: 1, labels: false })).split('\n')[0]).toBe('* 7003  21 00 3C     LD HL,3C00H');
    expect((await call('disasm', { addr: '7000', n: 0 })).text).toBe('n must be between 1 and 512, not 0.');
    await close();
  });

  it('disasm names a 16-bit constant only with a data name, never a routine', async () => {
    const { call, close } = await server();
    const prog = buildCmd([{ addr: 0x7000, data: [0x01, 0x08, 0x00, 0x21, 0x00, 0x3c, 0xcd, 0x08, 0x00, 0x2a, 0x08, 0x00] }], 0x7000);
    writeFileSync(at('consts.cmd'), prog);
    await ok(call, 'load', { path: at('consts.cmd') });
    expect((await ok(call, 'disasm', { addr: '7000', n: 4 })).split('\n').slice(0, 4)).toEqual([
      '? 7000  01 08 00     LD BC,0008H',
      '? 7003  21 00 3C     LD HL,3C00H       ; VIDEO',
      '? 7006  CD 08 00     CALL 0008H        ; SYNCHK',
      '? 7009  2A 08 00     LD HL,(0008H)     ; SYNCHK',
    ]);
    await close();
  });

  it('disasm wraps from FFFFh to 0000h', async () => {
    const { call, close } = await raiders();
    expect((await ok(call, 'disasm', { addr: 'FFFE', n: 3 })).split('\n').slice(0, 4)).toEqual([
      '? FFFE  00           NOP',
      '? FFFF  00           NOP',
      '$RESET:',
      '? 0000  31 00 80     LD SP,8000H',
    ]);
    await close();
  });

  it('disasm names call targets and labels with session labels before the ROM tables', async () => {
    const { call, session, close } = await raiders();
    session.labels.set(0x7030, { addr: 0x7030, name: 'PRINT' });
    session.labels.set(0x3c00, { addr: 0x3c00, name: 'TITLE' });
    expect((await ok(call, 'disasm', { addr: '7003', n: 3 })).split('\n').slice(0, 3)).toEqual([
      '? 7003  21 00 3C     LD HL,3C00H       ; TITLE',
      '? 7006  11 40 70     LD DE,7040H',
      '? 7009  CD 30 70     CALL 7030H        ; PRINT',
    ]);
    expect((await ok(call, 'disasm', { addr: 'print', n: 1 })).split('\n').slice(0, 2)).toEqual(['PRINT:', '? 7030  1A           LD A,(DE)']);
    await close();
  });

  it('trace shows what run trace:true and step recorded; a step never erases it', async () => {
    const { call, close } = await server();
    await ok(call, 'load', { path: at('count.cmd') });
    expect((await call('trace', {})).text).toBe('Nothing has been traced yet: run with trace: true, or step, records instructions; then call trace.');
    await ok(call, 'run', { until: 'pc:7005', trace: true });
    await ok(call, 'step', { n: 1 });
    expect(await ok(call, 'trace', {})).toBe(
      [
        'The newest 8 of 8 instructions recorded, oldest first (run with trace: true and step record them; nothing else does):',
        '7000  06 03        LD B,03H          [7]',
        '7002  00           NOP               [4]',
        '7003  10 FD        DJNZ 7002H        [13]',
        '  ×3 (7002h–7003h)',
        '7005  76           HALT              [4]',
      ].join('\n'),
    );
    const regs = (await ok(call, 'trace', { n: 2, regs: true })).split('\n');
    expect(regs[0]).toBe('The newest 2 of 8 instructions recorded, oldest first (run with trace: true and step record them; nothing else does):');
    expect(regs[1]).toMatch(/\[8\]  A=.. F=.. BC=01.. DE=.... HL=.... SP=....$/);
    expect((await call('trace', { n: 0 })).text).toBe('n must be between 1 and 2000, not 0.');
    await close();
  });

  it('trace marks execution it did not record between two recorded stretches', async () => {
    const { call, close } = await raiders();
    await ok(call, 'step', { n: 2 });
    await ok(call, 'run', { cycles: 100 });
    await ok(call, 'step', { n: 1 });
    const lines = (await ok(call, 'trace', {})).split('\n');
    expect(lines[0]).toBe('The newest 3 of 3 instructions recorded, oldest first (run with trace: true and step record them; nothing else does):');
    expect(lines[1]).toMatch(/^7000  31 00 7F/);
    expect(lines[2]).toMatch(/^7003  21 00 3C/);
    expect(lines[3]).toMatch(/^  … \(\d+ cycles ran untraced\)$/);
    expect(lines).toHaveLength(5);
    // load and reset start a fresh trace.
    await ok(call, 'reset', {});
    expect((await call('trace', {})).isError).toBe(true);
    await close();
  });
});
