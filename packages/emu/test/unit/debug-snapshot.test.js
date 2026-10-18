/** Snapshots, restore, and the screen diff (spec §7), on synthetic ROMs. */
import { describe, expect, it } from 'vitest';
import { Machine } from '../../src/index.js';
import { serializeState } from '../../src/debug/state.js';

function machine(code) {
  const rom = new Uint8Array(0x3800);
  rom.set(code, 0);
  return new Machine({ roms: { level2: rom } });
}

// LD HL,3C00H / loop: INC (HL) / INC HL (wraps through RAM) is overkill; a counter loop is enough:
// LD HL,3C00H / INC (HL) / JR -3 (to the INC)
const COUNTER = [0x21, 0x00, 0x3c, 0x34, 0x18, 0xfd];

describe('snapshot', () => {
  it('restore is exact', () => {
    const m = machine(COUNTER);
    m.run({ cycles: 1000 });
    const snap = m.debug.snapshot();
    const cycles0 = m.cycles;
    m.run({ cycles: 1e5 });
    const a = JSON.stringify(serializeState(m.system));
    const aCycles = m.cycles;
    m.debug.restore(snap);
    expect(m.cycles).toBe(cycles0);
    m.run({ cycles: 1e5 });
    expect(JSON.stringify(serializeState(m.system))).toBe(a);
    expect(m.cycles).toBe(aCycles);
  });

  it('restore clears the key queue and sound, keeps debugger state', () => {
    const m = machine(COUNTER);
    const snap = m.debug.snapshot();
    const bp = m.debug.break(0x1234);
    const wid = m.debug.watch(0x3c00, 1);
    m.debug.coverage.enable();
    m.debug.trace.enable({ depth: 16 });
    m.run({ cycles: 200 });
    m.keyboard.type('A');
    m.io.out(0xff, 1);
    expect(m.sound.events().length).toBeGreaterThan(0);
    const hits = m.debug.hits().length;
    const traced = m.debug.trace.last(16).length;
    const exec = m.debug.coverage.bits[3];
    m.debug.restore(snap);
    expect(m.keyboard.pending).toBe(0);
    expect(m.keyboard.hasFeed).toBe(false);
    expect(m.sound.events().length).toBe(0);
    expect(m.debug.breaks.map((b) => b.id)).toEqual([bp]);
    expect(m.debug.watches.map((w) => w.id)).toEqual([wid]);
    expect(m.debug.hits().length).toBe(hits);
    expect(m.debug.trace.last(16).length).toBe(traced);
    expect(m.debug.coverage.bits[3]).toBe(exec);
    expect(m.debug.coverage.enabled).toBe(true);
  });

  it('restore forgets the breakpoint resume point and a pending watch stop', () => {
    const m = machine(COUNTER);
    const snap = m.debug.snapshot();
    m.debug.break(3);
    expect(m.run({ cycles: 100 }).reason).toBe('break');
    m.debug.restore(snap);
    // Back at $0000, the run reaches the breakpoint again and stops there (the resume memory is gone).
    expect(m.run({ cycles: 100 }).reason).toBe('break');
    expect(m.cpu.regs.pc).toBe(3);
  });

  it('snapshot survives JSON.stringify and parse', () => {
    const m = machine(COUNTER);
    m.run({ cycles: 500 });
    const snap = m.debug.snapshot();
    const copy = JSON.parse(JSON.stringify(snap));
    expect(copy).toEqual(snap);
    m.run({ cycles: 1e4 });
    m.debug.restore(copy);
    expect(JSON.stringify(serializeState(m.system))).toBe(JSON.stringify(snap));
  });
});

describe('video.diff', () => {
  it('video.diff lists changed cells', () => {
    const m = machine(COUNTER);
    const snap = m.debug.snapshot();
    m.mem.write(0x3c00, [0x41]);
    m.mem.write(0x3c00 + 64 * 2 + 5, [0x42]);
    m.mem.write(0x3fff, [0x43]);
    const was = m.mem.read(0x3c00 + 64 * 2 + 5, 1)[0];
    expect(was).toBe(0x42);
    expect(m.video.diff(snap)).toEqual([
      { row: 0, col: 0, was: 0x20, now: 0x41 },
      { row: 2, col: 5, was: 0x20, now: 0x42 },
      { row: 15, col: 63, was: 0x20, now: 0x43 },
    ]);
    expect(() => m.video.diff({})).toThrow(/snapshot/);
  });
});
