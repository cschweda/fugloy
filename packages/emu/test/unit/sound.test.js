/** The Machine's sound device: a ring of every port $FF write, stamped in T-states. */
import { describe, expect, it } from 'vitest';
import { Machine, serializeState, restoreState } from '../../src/index.js';

const machine = () => new Machine({ roms: { level2: new Uint8Array(0x3800) } });
// ROM is all zeros (NOP), so each step advances the cycle count.
const out = (m, v) => {
  m.step();
  m.io.out(0xff, v);
};

describe('m.sound', () => {
  it('records every port $FF write raw, including a repeat the old log drops', () => {
    const m = machine();
    out(m, 1);
    out(m, 1);
    out(m, 2);
    const ev = m.sound.events();
    expect(ev.map((e) => e.value)).toEqual([1, 1, 2]);
    expect(ev[0].cycle).toBeLessThan(ev[1].cycle);
    expect(ev[1].cycle).toBeLessThan(ev[2].cycle);
    expect(ev[2].cycle).toBeLessThanOrEqual(m.cycles);
    expect(m.system.io.soundLog.map((e) => e.level)).toEqual([1, 2]);
  });

  it('keeps raw values above bits 0-1', () => {
    const m = machine();
    out(m, 0xa5);
    expect(m.sound.events()[0].value).toBe(0xa5);
  });

  it('events(since) returns only events after that cycle', () => {
    const m = machine();
    out(m, 1);
    out(m, 2);
    out(m, 3);
    const all = m.sound.events();
    expect(m.sound.events(all[0].cycle)).toEqual(all.slice(1));
    expect(m.sound.events(all[2].cycle)).toEqual([]);
  });

  it('ring-wrap: 70,000 writes keep the newest 65,536 in order', () => {
    const m = machine();
    for (let i = 0; i < 70000; i++) {
      m.step();
      m.io.out(0xff, i & 0xff);
    }
    const ev = m.sound.events();
    expect(ev).toHaveLength(65536);
    expect(m.sound.overflowed).toBe(4464);
    expect(ev[0].value).toBe(4464 & 0xff);
    expect(ev[65535].value).toBe(69999 & 0xff);
    for (let i = 1; i < ev.length; i++) expect(ev[i].cycle).toBeGreaterThan(ev[i - 1].cycle);
    const mid = ev[30000].cycle;
    expect(m.sound.events(mid)).toEqual(ev.slice(30001));
  });

  it('clear() empties the ring', () => {
    const m = machine();
    out(m, 1);
    m.sound.clear();
    expect(m.sound.events()).toEqual([]);
    expect(m.sound.overflowed).toBe(0);
    out(m, 2);
    expect(m.sound.events().map((e) => e.value)).toEqual([2]);
  });

  it('events() returns a write stamped at cycle 0', () => {
    const m = machine();
    m.io.out(0xff, 3);
    expect(m.sound.events()).toEqual([{ cycle: 0, value: 3 }]);
  });

  it('reset() clears the ring', () => {
    const m = machine();
    out(m, 1);
    m.reset();
    expect(m.sound.events()).toEqual([]);
    out(m, 2);
    expect(m.sound.events().map((e) => e.value)).toEqual([2]);
  });

  it('restoreState clears the ring', () => {
    const m = machine();
    const state = serializeState(m.system);
    out(m, 1);
    restoreState(m.system, state);
    expect(m.sound.events()).toEqual([]);
  });
});
