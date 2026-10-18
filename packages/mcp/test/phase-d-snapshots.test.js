/**
 * MCP phase D, part 1 (docs/fugloy-mcp-spec.md §3, §5 Snapshots, §13 story 2) on a synthetic ROM
 * and synthetic programs, so CI runs them: snapshot, restore, snapshots, diff, and story 2
 * ("locate game variables") byte-compared with test/golden/story-02.txt; then the screen's
 * snapshot diff, the screen baseline after restore, and diff naming a sized label over a run.
 *
 * To rewrite the transcript after a deliberate change to a tool's output, run
 * `FUGLOY_UPDATE_GOLDEN=1 pnpm vitest run packages/mcp/test/phase-d-snapshots.test.js` and review the diff.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RAIDERS, buildCmd, connect, syntheticRom, testConfig } from './helpers.js';

const NO_MACHINE = 'No program loaded; call load first.';
const GOLDEN = fileURLToPath(new URL('./golden/story-02.txt', import.meta.url));

/**
 * SCORER, the story 2 program: waits for A (keyboard row 0, 3801h bit 1), adds 100 to the
 * little-endian SCORE word at 7E10h, counts the press in the byte at 7E20h, waits for A to be
 * let go, and goes round again. No calls, so the stack never shows in a diff.
 */
const SCORER = buildCmd(
  [
    { name: 'SCORER' },
    {
      addr: 0x7000,
      data: [
        0x31, 0x00, 0x7f, //  7000  LD SP,7F00H
        0x3a, 0x01, 0x38, //  7003  LD A,(3801H)
        0xe6, 0x02, //        7006  AND 02H
        0x28, 0xf9, //        7008  JR Z,7003H
        0x2a, 0x10, 0x7e, //  700A  LD HL,(7E10H)
        0x11, 0x64, 0x00, //  700D  LD DE,0064H
        0x19, //              7010  ADD HL,DE
        0x22, 0x10, 0x7e, //  7011  LD (7E10H),HL
        0x21, 0x20, 0x7e, //  7014  LD HL,7E20H
        0x34, //              7017  INC (HL)
        0x3a, 0x01, 0x38, //  7018  LD A,(3801H)
        0xe6, 0x02, //        701B  AND 02H
        0x20, 0xf9, //        701D  JR NZ,7018H
        0x18, 0xe2, //        701F  JR 7003H
      ],
    },
  ],
  0x7000,
);

let dir;
const at = (name) => join(dir, name);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fugloy-mcp-phase-d-'));
  writeFileSync(at('synthetic.rom'), syntheticRom());
  writeFileSync(at('raiders.cmd'), RAIDERS);
  writeFileSync(at('scorer.cmd'), SCORER);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function server(limits = {}) {
  const config = testConfig({ roms: { model3: at('synthetic.rom') } });
  config.limits = { ...config.limits, ...limits };
  return connect({ config });
}

async function ok(call, name, args) {
  const r = await call(name, args);
  if (r.isError) throw new Error(`${name} failed: ${r.text}`);
  return r.text;
}

async function loaded(file, limits) {
  const s = await server(limits);
  await ok(s.call, 'load', { path: at(file) });
  return s;
}

describe('phase D snapshots', () => {
  it('every snapshot tool before load explains itself', async () => {
    const { call, close } = await server();
    for (const [name, args] of [
      ['snapshot', { name: 'a' }],
      ['restore', { name: 'a' }],
      ['diff', { a: 'now', b: 'now' }],
    ]) expect(await call(name, args), name).toEqual({ text: NO_MACHINE, isError: true });
    expect(await ok(call, 'snapshots', {})).toBe('No snapshots yet (at most 16 are kept; call snapshot name=…).');
    await close();
  });

  it('snapshot names the cycle and size, and status counts it', async () => {
    const { call, session, close } = await loaded('raiders.cmd');
    const cycles = session.machine.cycles.toLocaleString('en-US');
    expect(await ok(call, 'snapshot', { name: 'start' })).toMatch(new RegExp(`^snapshot "start" at cycle ${cycles} \\(\\d+ KB\\)$`));
    expect(await ok(call, 'status', {})).toContain('Labels: 0  Snapshots: 1');
    const again = await ok(call, 'snapshot', { name: 'start' });
    expect(again.split('\n')[1]).toBe('Replaced the earlier snapshot of that name.');
    for (const bad of ['', 'now', 'NOW', 'a\tb', 'x'.repeat(65)]) {
      const r = await call('snapshot', { name: bad });
      expect(r.isError, JSON.stringify(bad)).toBe(true);
    }
    expect((await call('snapshot', { name: 'now' })).text).toBe('"now" means the running machine in diff, so it cannot name a snapshot; choose another name.');
    await close();
  });

  it('restore rewinds the machine and keeps coverage, callers, and hits unless clearDebug', async () => {
    const { call, session, close } = await loaded('raiders.cmd');
    await ok(call, 'snapshot', { name: 'start' });
    const before = await ok(call, 'regs', {});
    await ok(call, 'watch', { addr: '3C00', len: 1024 });
    await ok(call, 'run', { until: 'screen' });
    const m = session.machine;
    const hits = m.debug.hits().length;
    expect(hits).toBeGreaterThan(0);
    const callers = m.debug.callers(0x7030).length;
    expect(callers).toBeGreaterThan(0);

    const kept = (await ok(call, 'restore', { name: 'start' })).split('\n');
    expect(kept[0]).toMatch(/^Restored "start" \(cycle [\d,]+, RAIDERS\)\.$/);
    expect(kept[1]).toBe('Kept coverage, callers, the hit log, and the trace (clearDebug: true clears all but the trace).');
    expect(kept.slice(2).join('\n')).toBe(before);
    expect(m.video.raw[0]).toBe(0x20); // the title is gone again
    expect(m.debug.hits().length).toBe(hits);
    expect(m.debug.callers(0x7030).length).toBe(callers);

    await ok(call, 'run', { until: 'screen' });
    const cleared = (await ok(call, 'restore', { name: 'start', clearDebug: true })).split('\n');
    expect(cleared[1]).toBe('Cleared coverage, callers, and the hit log; kept the trace.');
    expect(m.debug.hits().length).toBe(0);
    expect(m.debug.callers(0x7030).length).toBe(0);
    expect(m.debug.coverage.bits.some((b) => b !== 0)).toBe(false);
    expect(m.debug.coverage.enabled).toBe(true);
    expect(session.facts.some((b) => b !== 0)).toBe(false);

    const missing = await call('restore', { name: 'nope' });
    expect(missing).toEqual({ text: 'There is no snapshot named "nope"; the snapshots are start.', isError: true });
    await close();
  });

  it('restore across programs refuses and names the program to load', async () => {
    const { call, close } = await loaded('raiders.cmd');
    await ok(call, 'snapshot', { name: 'title' });
    await ok(call, 'load', { path: at('scorer.cmd') });
    const r = await call('restore', { name: 'title' });
    expect(r.isError).toBe(true);
    expect(r.text).toBe(
      `Snapshot "title" belongs to RAIDERS (${at('raiders.cmd')}), and the loaded program is SCORER; restoring it would mix one program's memory with the other's labels and sidecar. Load ${at('raiders.cmd')} first, then restore.`,
    );
    expect(await ok(call, 'snapshots', {})).toContain('RAIDERS');
    // Back on the same program (a fresh machine), the snapshot restores.
    await ok(call, 'load', { path: at('raiders.cmd') });
    expect(await ok(call, 'restore', { name: 'title' })).toMatch(/^Restored "title"/);
    await close();
  });

  it('a snapshot taken before any load does not restore over a program', async () => {
    const { call, close } = await server();
    await ok(call, 'reset', {});
    await ok(call, 'snapshot', { name: 'bare' });
    expect(await ok(call, 'restore', { name: 'bare' })).toMatch(/^Restored "bare" \(cycle [\d,]+, no program\)\./);
    await ok(call, 'load', { path: at('raiders.cmd') });
    const r = await call('restore', { name: 'bare' });
    expect(r).toEqual({
      text: 'Snapshot "bare" was taken before any program was loaded, and the loaded program is RAIDERS; restoring it would mix one program\'s memory with the other\'s labels and sidecar.',
      isError: true,
    });
    await close();
  });

  it('LRU evicts the oldest untouched', async () => {
    const { call, close } = await loaded('raiders.cmd', { snapshots: 3 });
    await ok(call, 'snapshot', { name: 'a' });
    await ok(call, 'snapshot', { name: 'b' });
    await ok(call, 'snapshot', { name: 'c' });
    await ok(call, 'restore', { name: 'a' }); // touched: b is now the oldest
    const d = (await ok(call, 'snapshot', { name: 'd' })).split('\n');
    expect(d[1]).toBe('Evicted "b", the least recently used snapshot (at most 3 are kept).');
    await ok(call, 'diff', { a: 'c', b: 'now' }); // c, then a, d, c: a is now the oldest
    const e = (await ok(call, 'snapshot', { name: 'e' })).split('\n');
    expect(e[1]).toBe('Evicted "a", the least recently used snapshot (at most 3 are kept).');
    const list = (await ok(call, 'snapshots', {})).split('\n');
    expect(list[0]).toBe('3 of 3 snapshots, least recently used first (the first goes when a new one would pass the cap):');
    expect(list.slice(2).map((l) => l.split(/\s+/)[0])).toEqual(['d', 'c', 'e']);
    await close();
  });

  it('snapshots lists name, cycle, and program', async () => {
    const { call, session, close } = await loaded('raiders.cmd');
    await ok(call, 'snapshot', { name: 'start' });
    const cycles = session.machine.cycles.toLocaleString('en-US');
    const list = (await ok(call, 'snapshots', {})).split('\n');
    expect(list).toEqual([
      '1 of 16 snapshots, least recently used first (the first goes when a new one would pass the cap):',
      expect.stringMatching(/^name\s+cycle\s+program$/),
      expect.stringMatching(new RegExp(`^start\\s+${cycles}\\s+RAIDERS$`)),
    ]);
    await close();
  });

  it('diff groups changed bytes into runs, by default over video RAM and RAM', async () => {
    const { call, close } = await loaded('raiders.cmd');
    await ok(call, 'snapshot', { name: 'start' });
    await ok(call, 'run', { until: 'screen' });
    const out = (await ok(call, 'diff', { a: 'start', b: 'now' })).split('\n');
    expect(out[0]).toMatch(/^diff start → now over 3C00h–FFFFh: \d+ runs?, \d+ bytes? changed$/);
    // The title's first word (the run stops at the first check after video RAM changed), as one run.
    expect(out).toContain('3C00h–3C04h (5 bytes)  20 20 20 20 20 → 53 50 41 43 45');
    // A run longer than eight bytes: a header, then eight bytes a line.
    await ok(call, 'poke', { addr: '7E00', bytes: '0102030405060708090A' });
    const long = (await ok(call, 'diff', { a: 'start', b: 'now', range: '7E00-7E7F' })).split('\n');
    expect(long).toEqual([
      'diff start → now over 7E00h–7E7Fh: 1 run, 10 bytes changed',
      '7E00h–7E09h (10 bytes)',
      '  7E00h  00 00 00 00 00 00 00 00 → 01 02 03 04 05 06 07 08',
      '  7E08h  00 00 → 09 0A',
    ]);

    const narrowed = (await ok(call, 'diff', { a: 'start', b: 'now', range: '4000-FFFF' })).split('\n');
    expect(narrowed[0]).toMatch(/^diff start → now over 4000h–FFFFh: /);
    expect(narrowed.some((l) => l.startsWith('3C'))).toBe(false);

    expect(await ok(call, 'diff', { a: 'now', b: 'now' })).toBe('diff now → now over 3C00h–FFFFh: no bytes changed');
    expect((await call('diff', { a: 'start', b: 'later' })).text).toBe('There is no snapshot named "later"; the snapshots are start (or say "now" for the running machine).');
    expect((await call('diff', { a: 'start', b: 'now', range: '0000-00FF' })).text).toBe(
      'diff compares video RAM and RAM (3C00h–FFFFh); the range 0000h–00FFh reaches below 3C00h (ROM and the keyboard never change in a snapshot).',
    );
    await close();
  });

  it('story 2 on a synthetic program', async () => {
    const { call, close } = await loaded('scorer.cmd');
    const script = [
      ['snapshot', { name: 'before' }],
      ['key', { text: 'A' }],
      ['run', { seconds: 1 }],
      ['diff', { a: 'before', b: 'now', range: '4000-7FFF' }],
      ['peek', { addr: '7E10', len: 2 }],
      ['key', { text: 'A' }],
      ['run', { seconds: 1 }],
      ['peek', { addr: '7E10', len: 2 }],
      ['label', { addr: '7E10', name: 'SCORE', kind: 'data', size: 2, note: 'increments by 100 per press of A; little-endian' }],
      ['diff', { a: 'before', b: 'now', range: '4000-7FFF' }],
      ['snapshots', {}],
    ];
    const parts = [];
    const out = [];
    for (const [name, args] of script) {
      const r = await call(name, args);
      if (r.isError) throw new Error(`${name} failed: ${r.text}`);
      out.push(r.text);
      parts.push(`> ${name} ${JSON.stringify(args)}\n${r.text}\n`);
    }
    await close();
    const transcript = parts.join('\n').replaceAll(dir, '<dir>');

    // The score byte is found: 7E10h goes 00 → 64 (100; the high byte stays 00), and the press count at 7E20h.
    expect(out[3].split('\n')).toEqual(['diff before → now over 4000h–7FFFh: 2 runs, 2 bytes changed', '7E10h (1 byte)  00 → 64', '7E20h (1 byte)  00 → 01']);
    expect(out[4]).toMatch(/^7E10  64 00 /);
    expect(out[7]).toMatch(/^7E10  C8 00 /);
    expect(out[9].split('\n')).toContain('7E10h (1 byte)  00 → C8  ; SCORE');

    if (process.env.FUGLOY_UPDATE_GOLDEN === '1') {
      mkdirSync(join(GOLDEN, '..'), { recursive: true });
      writeFileSync(GOLDEN, transcript);
    }
    if (!existsSync(GOLDEN)) throw new Error(`${GOLDEN} is missing; run with FUGLOY_UPDATE_GOLDEN=1 to write it, then review it.`);
    expect(transcript).toBe(readFileSync(GOLDEN, 'utf8'));
  });
});

describe('phase D screen and diff follow-ups', () => {
  it('screen diff against a snapshot name', async () => {
    const { call, close } = await loaded('raiders.cmd');
    await ok(call, 'snapshot', { name: 'blank' });
    await ok(call, 'run', { until: 'screen' });
    await ok(call, 'screen', {});
    const since = (await ok(call, 'screen', { diff: 'blank' })).split('\n');
    expect(since[0]).toBe('12 cells changed'); // SPACE RAIDERS, less the space
    expect(since[1]).toBe("(0,0) ' '→'S'");
    expect(await ok(call, 'screen', { diff: true })).toBe('0 cells changed');
    expect(await call('screen', { diff: 'nope' })).toEqual({ text: 'There is no snapshot named "nope"; the snapshots are blank.', isError: true });
    await close();
  });

  it('restore makes the restored screen the baseline for screen diff', async () => {
    const { call, close } = await loaded('raiders.cmd');
    await ok(call, 'snapshot', { name: 'blank' });
    await ok(call, 'run', { until: 'screen' });
    await ok(call, 'screen', {});
    await ok(call, 'restore', { name: 'blank' });
    expect(await ok(call, 'screen', { diff: true })).toBe('0 cells changed');
    await close();
  });

  it('diff names a sized label that starts before a run and covers it', async () => {
    writeFileSync(at('raiders-diff.cmd'), RAIDERS); // its own sidecar, so these labels stay out of the other tests
    const { call, close } = await loaded('raiders-diff.cmd');
    await ok(call, 'snapshot', { name: 'a' });
    await ok(call, 'poke', { addr: '7E12', bytes: '01' });
    await ok(call, 'poke', { addr: '7E20', bytes: '01' });
    await ok(call, 'label', { addr: '7E10', name: 'BUFFER', kind: 'data', size: 4 });
    await ok(call, 'label', { addr: '7E1F', name: 'FLAG', kind: 'data' });
    expect(await ok(call, 'diff', { a: 'a', b: 'now', range: '7E00-7EFF' })).toBe(
      ['diff a → now over 7E00h–7EFFh: 2 runs, 2 bytes changed', '7E12h (1 byte)  00 → 01  ; BUFFER', '7E20h (1 byte)  00 → 01'].join('\n'),
    );
    await close();
  });
});
