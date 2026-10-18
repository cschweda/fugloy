/**
 * MCP phase D, part 1 (docs/fugloy-mcp-spec.md §3, §5 Snapshots, §13 story 2) on a synthetic ROM
 * and synthetic programs, so CI runs them: snapshot, restore, snapshots, diff, and story 2
 * ("locate game variables") byte-compared with test/golden/story-02.txt; then the screen's
 * snapshot diff, the screen baseline after restore, and diff naming a sized label over a run.
 *
 * To rewrite the transcript after a deliberate change to a tool's output, run
 * `FUGLOY_UPDATE_GOLDEN=1 pnpm vitest run packages/mcp/test/phase-d-snapshots.test.js` and review the diff
 * (the script and SCORER are in test/stories.js).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RAIDERS, buildCmd, connect, syntheticRom, testConfig } from './helpers.js';
import { SCORER, golden, replay, story } from './stories.js';

const NO_MACHINE = 'No program loaded; call load first.';

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
    const s = story('02');
    const { transcript, out } = await replay(s);

    // The score byte is found: 7E10h goes 00 → 64 (100; the high byte stays 00), and the press count at 7E20h.
    expect(out[3].split('\n')).toEqual(['diff before → now over 4000h–7FFFh: 2 runs, 2 bytes changed', '7E10h (1 byte)  00 → 64', '7E20h (1 byte)  00 → 01']);
    expect(out[4]).toMatch(/^7E10  64 00 /);
    expect(out[7]).toMatch(/^7E10  C8 00 /);
    expect(out[9].split('\n')).toContain('7E10h (1 byte)  00 → C8  ; SCORE');

    expect(transcript).toBe(golden(s, transcript));
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

  it('screen diff against a snapshot of another program gives the note diff gives', async () => {
    const { call, close } = await loaded('raiders.cmd');
    await ok(call, 'run', { until: 'screen' });
    await ok(call, 'snapshot', { name: 'title' });
    await ok(call, 'load', { path: at('scorer.cmd') });
    const note = 'Note: title belongs to RAIDERS and now to SCORER.';
    const screen = (await ok(call, 'screen', { diff: 'title' })).split('\n');
    expect(screen[0]).toMatch(/^\d+ cells? changed$/);
    expect(screen[1]).toBe(note);
    const diff = (await ok(call, 'diff', { a: 'title', b: 'now' })).split('\n');
    expect(diff[1]).toBe(note);
    // The same program: no note.
    await ok(call, 'snapshot', { name: 'mine' });
    expect(await ok(call, 'screen', { diff: 'mine' })).not.toContain('Note:');
    await close();
  });

  it('screen diff against a snapshot taken in the other width shows both screens', async () => {
    // NARROW: LD A,04H / OUT (0ECH),A (the mode register's 32-column bit) / LD A,'N' / LD (3C00H),A / JR $.
    writeFileSync(at('narrow.cmd'), buildCmd([{ name: 'NARROW' }, { addr: 0x7000, data: [0x3e, 0x04, 0xd3, 0xec, 0x3e, 0x4e, 0x32, 0x00, 0x3c, 0x18, 0xfe] }], 0x7000));
    const { call, close } = await loaded('narrow.cmd');
    await ok(call, 'snapshot', { name: 'wide' });
    await ok(call, 'run', { cycles: 1000 });
    const out = (await ok(call, 'screen', { diff: 'wide' })).split('\n');
    expect(out[0]).toBe('The widths differ: snapshot "wide" was taken at 64 columns and the screen is now 32 columns, so cells cannot be compared one by one. The two screens, each in its own width:');
    expect(out[1]).toBe('Snapshot "wide" (64 columns):');
    expect(out[4]).toBe('0123456789'.repeat(7).slice(0, 64)); // the 64-column ruler
    const now = out.indexOf('Now (32 columns):');
    expect(out[now + 3]).toBe('0123456789'.repeat(4).slice(0, 32)); // the 32-column ruler
    expect(out[now + 4]).toBe(`N${' '.repeat(31)}`);
    // Back in the same width, the cells are compared again.
    await ok(call, 'snapshot', { name: 'narrow' });
    expect(await ok(call, 'screen', { diff: 'narrow' })).toBe('0 cells changed');
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
