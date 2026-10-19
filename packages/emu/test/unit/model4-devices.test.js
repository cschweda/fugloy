/**
 * Emu phase 6b, Task 2: the Model 4's video (80×24 through port $84 bit 2, the 32/40-column halving
 * through port $EC bit 2, inverse video through port $84 bit 3), its clock switch (port $EC bit 6:
 * 4,055,040 Hz and a 60 Hz timer, or 2,027,520 Hz and 30 Hz), and what follows the clock
 * (`m.clockHz`, the timer, the disk controller's times, typing, save states). Synthetic ROMs
 * throughout; models.js, io.js, and devices/video.js cite the sources. Review Focus 4: the switch
 * changes the CPU's rate without changing what an interrupt-timed loop counts between ticks; per
 * emulated second the ticks double, as xtrs has the hardware do.
 */
import { describe, expect, it } from 'vitest';
import { Machine, restoreState, serializeState } from '../../src/index.js';
import { fdcTimes } from '../../src/devices/fdc-wd1793.js';

/** A 14K ROM with `bytes` at $0000 and `isr` at $0038; every other byte $C9. */
function rom14(bytes = [0x76], isr = []) {
  const rom = new Uint8Array(0x3800).fill(0xc9);
  rom.set(bytes, 0);
  rom.set(isr, 0x38);
  return rom;
}

const model4 = (opts = {}) => new Machine({ model: 4, roms: { level2: rom14(opts.bytes, opts.isr) }, ...opts, bytes: undefined, isr: undefined });
const model3 = () => new Machine({ model: 3, roms: { level2: rom14() } });

/** Write `text` into video RAM at offset `at` (map 2 puts all 2K at $F800). */
function writeVideo(m, at, text) {
  const v = m.system.memory.videoRam;
  for (let k = 0; k < text.length; k++) v[at + k] = text.charCodeAt(k);
}

describe('the Model 4 video', () => {
  it('reads 64×16 from the start of the 2K at power-on, as the Model III does', () => {
    const m = model4();
    expect(m.video.columns).toBe(64);
    expect(m.video.rows).toBe(16);
    expect(m.video.raw.length).toBe(0x800);
    writeVideo(m, 64 * 3 + 5, 'MODEL III MODE');
    const t = m.video.text();
    expect(t).toHaveLength(16);
    expect(t[3].slice(5, 19)).toBe('MODEL III MODE');
    expect(t.every((line) => line.length === 64)).toBe(true);
  });

  it('shows 80×24 with port $84 bit 2, rows of 80 bytes through all 2K at $F800 in map 2', () => {
    const m = model4();
    m.io.out(0x84, 0x06); // map 2, 80 columns
    expect(m.video.columns).toBe(80);
    expect(m.video.rows).toBe(24);
    const line0 = 'X'.repeat(79) + 'Y';
    m.mem.write(0xf800, Array.from(line0, (c) => c.charCodeAt(0)));
    m.mem.write(0xf800 + 23 * 80 + 70, Array.from('LAST LINE!', (c) => c.charCodeAt(0)));
    const t = m.video.text();
    expect(t).toHaveLength(24);
    expect(t.every((line) => line.length === 80)).toBe(true);
    expect(t[0]).toBe(line0);
    expect(t[1]).toBe(' '.repeat(80));
    expect(t[23].slice(70)).toBe('LAST LINE!');
    // The bytes past 24 × 80 (1920-2047) are off screen.
    m.mem.write(0xf800 + 1920, [0x23]);
    expect(m.video.text().join('')).not.toContain('#');
  });

  it('reads the screen from the 2K\'s first byte whichever page port $84 bit 7 puts at $3C00', () => {
    const m = model4();
    m.io.out(0x84, 0x84); // map 0, 80 columns, page 1 at $3C00
    m.mem.write(0x3c00, Array.from('PAGE ONE', (c) => c.charCodeAt(0))); // video RAM offset $400 = 1024
    const t = m.video.text();
    // 1024 = row 12, column 64 in 80-column rows
    expect(t[12].slice(64, 72)).toBe('PAGE ONE');
    expect(t[0].startsWith('PAGE ONE')).toBe(false);
  });

  it('halves to 40 columns (and 32 in 64-column mode) with port $EC bit 2, showing even bytes', () => {
    const m = model4();
    m.io.out(0x84, 0x06);
    m.io.out(0xec, 0x04);
    expect(m.video.columns).toBe(40);
    writeVideo(m, 80, 'AxBxCx');
    expect(m.video.text()[1].startsWith('ABC')).toBe(true);
    expect(m.video.text()[1]).toHaveLength(40);
    m.io.out(0x84, 0x02);
    expect(m.video.columns).toBe(32);
    expect(m.video.text()).toHaveLength(16);
  });

  it('shows a byte with bit 7 set as its character with inverse video (port $84 bit 3), else as a block', () => {
    const m = model4();
    writeVideo(m, 0, 'OK');
    m.system.memory.videoRam[2] = 0xc8; // 'H' | $80
    m.system.memory.videoRam[3] = 0x89; // 'I' & $1F | $80: folds to 'I'
    expect(m.video.text()[0].slice(0, 4)).toBe('OK..');
    m.io.out(0x84, 0x08);
    expect(m.video.text()[0].slice(0, 4)).toBe('OKHI');
  });

  it('reports the layout and inverse video through video.wide and video.inverse, read-only', () => {
    const m = model4();
    expect([m.video.wide, m.video.inverse]).toEqual([false, false]);
    m.io.out(0x84, 0x04);
    expect([m.video.wide, m.video.inverse, m.video.rows]).toEqual([true, false, 24]);
    m.io.out(0xec, 0x04);
    expect([m.video.wide, m.video.columns]).toEqual([true, 40]);
    m.io.out(0x84, 0x08);
    expect([m.video.wide, m.video.inverse]).toEqual([false, true]);
    expect(() => {
      'use strict';
      /** @type {any} */ (m.video).inverse = false;
    }).toThrow(TypeError);
    expect(m.video.inverse).toBe(true);
    // The Model III and Model I have neither.
    const m3 = model3();
    m3.io.out(0x84, 0x0c);
    expect([m3.video.wide, m3.video.inverse]).toEqual([false, false]);
  });

  it('diffs over rows of 80 bytes in 80-column mode', () => {
    const m = model4();
    m.io.out(0x84, 0x06);
    const snap = m.debug.snapshot();
    m.mem.write(0xf800 + 2 * 80 + 7, [0x41]);
    expect(m.video.diff(snap)).toEqual([{ row: 2, col: 7, was: 0x20, now: 0x41 }]);
  });

  it('leaves the Model III at 64×16, whatever is written to port $84', () => {
    const m = model3();
    m.io.out(0x84, 0x0c);
    expect(m.video.columns).toBe(64);
    expect(m.video.rows).toBe(16);
    expect(m.video.text()).toHaveLength(16);
    m.io.out(0xec, 0x04);
    expect(m.video.columns).toBe(32);
  });
});

describe('the Model 4 clock switch, port $EC bit 6', () => {
  it('runs at 2,027,520 Hz with a 30 Hz timer until bit 6 is set, then at 4,055,040 Hz with 60 Hz', () => {
    const m = model4();
    const sys = m.system;
    expect(m.clockHz).toBe(2027520);
    expect(sys.rtcInterval).toBe(67584);
    m.io.out(0xec, 0x40);
    expect(m.clockHz).toBe(4055040);
    expect(sys.fast).toBe(true);
    // 60 ticks a second of the fast clock: still one every 67,584 T-states
    expect(sys.rtcInterval).toBe(67584);
    expect(m.clockHz / sys.rtcInterval).toBe(60);
    // the other mode bits do not touch the clock
    m.io.out(0xec, 0x44);
    expect(m.clockHz).toBe(4055040);
    m.io.out(0xec, 0x04);
    expect(m.clockHz).toBe(2027520);
    expect(m.clockHz / sys.rtcInterval).toBe(30);
    for (const port of [0xed, 0xee, 0xef]) {
      m.io.out(port, 0x40);
      expect(m.clockHz).toBe(4055040);
      m.io.out(port, 0x00);
    }
  });

  it('goes back to 2 MHz on a reset', () => {
    const m = model4();
    m.io.out(0xec, 0x40);
    m.reset();
    expect(m.clockHz).toBe(2027520);
    expect(m.system.fast).toBe(false);
    expect(m.system.io.fdc.cpuHz).toBe(2027520);
  });

  it('leaves the Model III at 2,027,520 Hz with bit 6 set', () => {
    const m = model3();
    m.io.out(0xec, 0x40);
    expect(m.clockHz).toBe(2027520);
    expect(m.system.rtcInterval).toBe(67584);
    expect(m.system.io.fdc.cpuHz).toBe(2027520);
  });

  it('retimes the disk controller, so a revolution takes the same real time at either clock', () => {
    const m = model4();
    const fdc = m.system.io.fdc;
    expect(fdc.indexPeriod).toBe(fdcTimes(2027520).indexPeriod);
    fdc.indexClock = 100_000;
    fdc.pending = { kind: 'seek', phase: 'step', delay: 1000, rate: 12_000 };
    m.io.out(0xec, 0x40);
    expect(fdc.cpuHz).toBe(4055040);
    expect(fdc.indexPeriod).toBe(fdcTimes(4055040).indexPeriod);
    expect(fdc.indexPeriod / 4055040).toBeCloseTo(0.2, 6);
    expect(fdc.byteTStatesMfm).toBe(fdcTimes(4055040).byteMfm);
    expect(fdc.stepTStates).toEqual(fdcTimes(4055040).step);
    // the disk's angle and the command in flight keep their real time
    expect(fdc.indexClock).toBe(200_000);
    expect(fdc.pending.delay).toBe(2000);
    expect(fdc.pending.rate).toBe(24_000);
    m.io.out(0xec, 0x00);
    expect(fdc.indexClock).toBe(100_000);
    expect(fdc.pending.delay).toBe(1000);
  });

  it('times typing in the clock it is queued at', () => {
    const m = model4();
    m.io.out(0xec, 0x40);
    m.keyboard.type('A'); // 10 cps: held half of 0.1 s, 202,752 T-states at 4 MHz
    m.run({ cycles: 1 });
    const down = () => m.system.keyboard.read(0x01) !== 0; // row 0, 'A' is bit 1
    expect(down()).toBe(true);
    m.run({ cycles: 150_000 }); // past the 101,376 a 2 MHz hold would take
    expect(down()).toBe(true);
    m.run({ cycles: 60_000 });
    expect(down()).toBe(false);
  });

  it('restores a save state taken at 4 MHz at 4 MHz, and one taken at 2 MHz at 2 MHz', () => {
    const fast = model4();
    fast.io.out(0xec, 0x40);
    fast.system.io.fdc.indexClock = 300_000;
    const state = serializeState(fast.system);
    const m = model4();
    restoreState(m.system, state);
    expect(m.clockHz).toBe(4055040);
    expect(m.system.io.fdc.cpuHz).toBe(4055040);
    expect(m.system.io.fdc.indexClock).toBe(300_000); // saved in the fast clock's T-states, not rescaled
    restoreState(m.system, serializeState(model4().system));
    expect(m.clockHz).toBe(2027520);
    expect(m.system.io.fdc.cpuHz).toBe(2027520);
  });
});

/**
 * Review Focus 4. A program that counts the timer's ticks and the passes of a loop between them:
 *   0000  DI / LD SP,8000H / IM 1 / LD A,04H / OUT (E0H),A   the RTC alone unmasked
 *         LD A,<ec> / OUT (ECH),A                            the clock: 40H fast, 00H slow
 *         LD HL,0 / EI
 *   loop  INC HL / JR loop                                   18 T-states a pass
 *   0038  IN A,(ECH)                                         acknowledge the tick
 *         LD A,(9000H) / INC A / LD (9000H),A                ticks
 *         LD (9002H),HL / LD HL,0                            passes since the last tick
 *         EI / RETI
 */
function tickCounter(ec) {
  const bytes = [0xf3, 0x31, 0x00, 0x80, 0xed, 0x56, 0x3e, 0x04, 0xd3, 0xe0, 0x3e, ec, 0xd3, 0xec, 0x21, 0x00, 0x00, 0xfb, 0x23, 0x18, 0xfd];
  const isr = [0xdb, 0xec, 0x3a, 0x00, 0x90, 0x3c, 0x32, 0x00, 0x90, 0x22, 0x02, 0x90, 0x21, 0x00, 0x00, 0xfb, 0xed, 0x4d];
  return model4({ bytes, isr });
}

describe('the Model 4 timer, 30 Hz at 2 MHz and 60 Hz at 4 MHz (Review Focus 4)', () => {
  const ticksAndPasses = (/** @type {Machine} */ m) => {
    m.run({ cycles: 200 }); // through the setup, so the clock is chosen
    m.run({ cycles: 67584 * 2 }); // two ticks, so the pass count covers a whole period
    m.mem.write(0x9000, [0]);
    const start = m.cycles;
    m.run({ cycles: m.clockHz }); // one emulated second of the clock now in force
    const ticks = m.mem.read(0x9000, 1)[0];
    const [lo, hi] = m.mem.read(0x9002, 2);
    return { ticks, passes: lo | (hi << 8), cycles: m.cycles - start };
  };

  it('ticks 30 times in an emulated second at 2 MHz and 60 at 4 MHz', () => {
    const slow = ticksAndPasses(tickCounter(0x00));
    const fast = ticksAndPasses(tickCounter(0x40));
    expect(slow.ticks).toBe(30);
    expect(fast.ticks).toBe(60);
    expect(fast.cycles).toBeGreaterThanOrEqual(4055040);
  });

  it('counts the same loop passes between ticks at either clock', () => {
    const slow = ticksAndPasses(tickCounter(0x00));
    const fast = ticksAndPasses(tickCounter(0x40));
    expect(slow.passes).toBeGreaterThan(3600);
    // 67,584 T-states is 3,754.7 passes of 18 less the response and the handler, so a period
    // holds one pass more or less by where the tick falls in a pass, at either clock.
    expect(Math.abs(fast.passes - slow.passes)).toBeLessThanOrEqual(1);
  });

  it('switches mid-run with the timer\'s schedule unbroken', () => {
    const m = tickCounter(0x00);
    m.run({ cycles: 200 });
    const next = m.system.nextRtcAt;
    m.io.out(0xec, 0x40);
    expect(m.system.nextRtcAt).toBe(next);
  });
});
