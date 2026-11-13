/**
 * @fugloy/runtime, M2 Task 9: the player's parts that need no browser. The clock that paces a port
 * (frame.js): a wait when the port is ahead of real time, none when it is behind, after a stall (or two)
 * no running fast to catch up, a backwards clock moving the origin, and no wait past MAX_WAIT_MS. The
 * sound (sound.js): the cassette port's writes as a square wave at absolute sample positions, and when
 * each frame's samples play. The keys (keys.js): emu's browser mapping, the workbench's Shift rule, and a
 * key pressed and released at once held in the worker's copies for MIN_HOLD_FRAMES frames. The worker's
 * loop (worker.js's `play`, its posting and waiting injected) over a small synthetic port; Sea Dragon's
 * port through the same loop, against emu, is @fugloy/recomp's test/player.test.ts (controller Ruling 3).
 */
import { readFileSync } from 'node:fs';
import { Machine } from '@fugloy/emu';
import { describe, expect, it } from 'vitest';
import { platformHits } from '../../emu/test/platform-scan.js';
import { BEHIND_LIMIT_MS, MAX_WAIT_MS, createClock, frameHook, frameLength } from '../src/player/frame.js';
import { BROWSER_KEYS, KeyTracker, MIN_HOLD_FRAMES } from '../src/player/keys.js';
import { createAudioSchedule, samples } from '../src/player/sound.js';
import { START, begin, play } from '../src/player/worker.js';
import { createZ } from '../src/index.js';
import { KeyMatrix } from '../src/keys.js';

const MODEL3_HZ = 2027520;
/** One second of the Model III's clock, in T-states. */
const SECOND = MODEL3_HZ;

/** A clock whose real time the test sets. */
function testClock(clockHz = MODEL3_HZ) {
  const time = { ms: 1000 };
  const clock = createClock({ clockHz, now: () => time.ms });
  return { time, clock };
}

describe('the clock', () => {
  it('asks for a wait as long as the port is ahead of real time', () => {
    const { time, clock } = testClock();
    // Half a second of emulated time at once: 500 ms ahead
    expect(clock.due(SECOND / 2)).toBeCloseTo(500, 9);
    time.ms += 200;
    expect(clock.due(SECOND / 2)).toBeCloseTo(300, 9);
    // A frame's worth
    expect(clock.due(SECOND / 2 + frameLength(MODEL3_HZ))).toBeCloseTo(300 + 1000 / 60, 9);
  });

  it('asks for none when the port is behind, and lets it catch up a little lag by running on', () => {
    const { time, clock } = testClock();
    time.ms += 100;
    // 100 ms of real time, 50 ms of emulated: behind, no wait
    expect(clock.due(SECOND / 20)).toBe(0);
    // Under the limit the origin stays: the port must run the 50 ms it lost before it waits again
    expect(clock.due(SECOND / 10)).toBe(0);
    expect(clock.due(SECOND / 10 + SECOND / 100)).toBeCloseTo(10, 9);
  });

  it('after a two-second stall runs no more than a quarter of a second of emulated time before it waits again', () => {
    const { time, clock } = testClock();
    expect(clock.due(0)).toBe(0);
    time.ms += 2000; // the tab was in the background, or the machine stalled
    const stalled = frameLength(MODEL3_HZ);
    expect(clock.due(stalled)).toBe(0);
    // From here, at the same real time, every bit of emulated time is ahead: at most a quarter of a
    // second of it runs before the clock asks for a wait (here none at all runs unwaited)
    expect(clock.due(stalled + SECOND / 4)).toBeCloseTo(250, 9);
    expect(clock.due(stalled + 1)).toBeGreaterThan(0);
    // and from then on the game runs at normal speed: real time and emulated time advance together
    time.ms += 1000;
    expect(clock.due(stalled + SECOND)).toBeCloseTo(0, 9);
  });

  it('keeps catching up a lag of exactly the limit, and gives it up only past it', () => {
    const at = testClock();
    at.time.ms += BEHIND_LIMIT_MS;
    expect(at.clock.due(0)).toBe(0);
    // The origin stayed: the quarter of a second is still owed, so 251 ms of emulated time is 1 ms ahead
    expect(at.clock.due(SECOND / 4 + SECOND / 1000)).toBeCloseTo(1, 9);
    const past = testClock();
    past.time.ms += BEHIND_LIMIT_MS + 1;
    expect(past.clock.due(0)).toBe(0);
    // The origin moved here: 1 ms of emulated time is 1 ms ahead
    expect(past.clock.due(SECOND / 1000)).toBeCloseTo(1, 9);
  });
  it('moves its origin when now goes backwards, rather than ask for a wait of seconds', () => {
    const { time, clock } = testClock();
    expect(clock.due(0)).toBe(0);
    time.ms = -5000; // a clock that is not monotonic
    const t = frameLength(MODEL3_HZ);
    expect(clock.due(t)).toBe(0);
    expect(clock.due(t + frameLength(MODEL3_HZ))).toBeCloseTo(1000 / 60, 9);
  });

  it('never asks for a wait longer than MAX_WAIT_MS', () => {
    const { clock } = testClock();
    expect(MAX_WAIT_MS).toBe(2000);
    // The longest block, a $DELAY of BC = 0 (1,966,095 T-states), plus a frame: under a second, all of it
    expect(clock.due(1966095 + frameLength(MODEL3_HZ))).toBeCloseTo(((1966095 + 33792) * 1000) / MODEL3_HZ, 9);
    expect(clock.due(10 * SECOND)).toBe(MAX_WAIT_MS);
  });

  it('after two stalls in a row runs at normal speed from each, with no catching up', () => {
    const { time, clock } = testClock();
    expect(clock.due(0)).toBe(0);
    time.ms += 2000;
    const first = frameLength(MODEL3_HZ);
    expect(clock.due(first)).toBe(0);
    // A quarter of a second runs at normal speed
    time.ms += 250;
    expect(clock.due(first + SECOND / 4)).toBeCloseTo(0, 9);
    // and the second stall, three seconds
    time.ms += 3000;
    const second = first + SECOND / 4 + frameLength(MODEL3_HZ);
    expect(clock.due(second)).toBe(0);
    expect(clock.due(second + SECOND / 4)).toBeCloseTo(250, 9);
    time.ms += 1000;
    expect(clock.due(second + SECOND)).toBeCloseTo(0, 9);
  });
});

describe('the sound', () => {
  // 2,027,520 / 48,000 = 42.24 T-states a sample, so 42,240 T-states are 1,000 samples exactly
  const RATE = 48000;

  it('turns two writes a known number of T-states apart into a square wave of that length at 48,000 Hz', () => {
    const records = [{ t: 0, v: 0x01 }, { t: 42240, v: 0x02 }];
    const out = samples(records, 0, 84480, MODEL3_HZ, RATE);
    expect(out).toHaveLength(2000);
    expect(out.slice(0, 1000).every((s) => s === 1)).toBe(true);
    expect(out.slice(1000).every((s) => s === -1)).toBe(true);
  });

  it('is silent for no writes', () => {
    const out = samples([], 0, 33792, MODEL3_HZ, RATE);
    expect(out).toHaveLength(800);
    expect(out.every((s) => s === 0)).toBe(true);
  });

  it('takes the levels of bits 0-1 only: 0 the middle, 1 high, 2 low, 3 the middle', () => {
    const at = (v) => samples([{ t: 0, v }], 0, 4224, MODEL3_HZ, RATE)[50];
    expect([0x00, 0x01, 0x02, 0x03, 0xfd, 0xfe, 0x31].map(at)).toEqual([0, 1, -1, 0, 1, -1, 1]);
  });

  it('starts a frame at the level of the last write before it, and frames tile with no rounding carried', () => {
    const records = [{ t: 100, v: 1 }, { t: 30000, v: 2 }, { t: 40000, v: 1 }, { t: 70001, v: 0 }];
    const whole = samples(records, 0, 101376, MODEL3_HZ, 44100);
    // Three frames whose ends fall between samples at 44,100 Hz (a frame posts at the first block start
    // at or after its boundary), each given the writes before its end, as the page keeps them
    const frames = [0, 33001, 67003, 101376];
    const parts = [];
    for (let k = 0; k < 3; k++) parts.push(...samples(records.filter((r) => r.t < frames[k + 1]), frames[k], frames[k + 1], MODEL3_HZ, 44100));
    expect(parts).toEqual([...whole]);
    expect(whole).toHaveLength(Math.floor((101376 * 44100) / MODEL3_HZ));
  });

  it('schedules each frame right after the one before, restarts after running dry, and drops a frame rather than let latency grow', () => {
    const s = createAudioSchedule({ lead: 0.05, maxLatency: 0.21 });
    const f = 1 / 60;
    expect(s.next(10, f)).toBeCloseTo(10.05, 9);
    expect(s.next(10.01, f)).toBeCloseTo(10.05 + f, 9);
    // The audio ran dry: the next frame starts a lead from now
    expect(s.next(11, f)).toBeCloseTo(11.05, 9);
    // The game's clock outran the audio's: frames pile up to the limit, then are dropped
    let queued = 0;
    for (let k = 0; k < 20; k++) if (s.next(11, f) !== -1) queued++;
    // 11.05 + k/60 up to 11.21: nine more frames
    expect(queued).toBe(9);
    expect(s.next(11, f)).toBe(-1);
  });
});

describe('the keys', () => {
  /** A tracker over its own rows, and a worker that copies them once a frame and counts the frames. */
  function tracked() {
    const rows = new Uint8Array(8);
    const worker = { frame: 0, seen: new Uint8Array(8) };
    const tracker = new KeyTracker(rows, () => worker.frame);
    const copy = () => {
      worker.seen = rows.slice();
      worker.frame++;
      tracker.update();
      return worker.seen;
    };
    /** `n` of the worker's copies; the rows each saw. */
    const copies = (n) => Array.from({ length: n }, () => copy());
    const ev = (key, code, mods = {}) => ({ key, code, ...mods });
    return { rows, tracker, copy, copies, worker, ev };
  }

  it("maps every browser key as emu's own browser mapping does", () => {
    const m = new Machine({ roms: { level2: new Uint8Array(0x3800) } });
    const k = m.system.keyboard;
    const candidates = [
      ...Array.from({ length: 256 }, (_, c) => String.fromCharCode(c)),
      'Enter', 'Clear', 'Home', 'Escape', 'Pause', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'Backspace', 'ArrowRight', 'Shift',
      'Tab', 'F1', 'Space', 'ENTER', 'UP', 'Delete',
    ];
    let mapped = 0;
    for (const key of candidates) {
      k.reset();
      const known = k.keyDown(key, 'Test');
      const ours = BROWSER_KEYS.get(key);
      expect(ours !== undefined, JSON.stringify(key)).toBe(known);
      if (!known) continue;
      mapped++;
      const rows = new Uint8Array(8);
      for (const { row, bit } of ours) rows[row] |= 1 << bit;
      expect([...rows], JSON.stringify(key)).toEqual([...k.rows]);
    }
    expect(mapped).toBe(BROWSER_KEYS.size);
    // a lowercase letter is the bare key, a capital the key with SHIFT
    expect(BROWSER_KEYS.get('a')).toEqual([{ row: 0, bit: 1 }]);
    expect(BROWSER_KEYS.get('A')).toEqual([{ row: 0, bit: 1 }, { row: 7, bit: 0 }]);
  });

  it("gives : without SHIFT for Shift+; and keeps the TRS-80's SHIFT for Shift alone and with the arrows and space bar", () => {
    const { rows, tracker, copies, ev } = tracked();
    expect(tracker.down(ev('Shift', 'ShiftLeft'))).toBe(true);
    expect(rows[7]).toBe(0x01);
    expect(tracker.down(ev(':', 'Semicolon'))).toBe(true);
    expect(rows[5]).toBe(0x04); // the : key
    expect(rows[7]).toBe(0x00); // unshifted, so not *
    copies(MIN_HOLD_FRAMES);
    tracker.up(ev(':', 'Semicolon'));
    expect(rows[5]).toBe(0x00);
    expect(rows[7]).toBe(0x01); // Shift is still held
    tracker.down(ev('"', 'Quote'));
    expect(rows[4]).toBe(0x04); // the 2 key
    expect(rows[7]).toBe(0x01); // SHIFT+2, the character's own
    copies(MIN_HOLD_FRAMES);
    tracker.up(ev('Shift', 'ShiftLeft'));
    expect(rows[4]).toBe(0x04);
    expect(rows[7]).toBe(0x01);
    tracker.up(ev("'", 'Quote'));
    expect([...rows]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);

    tracker.down(ev('Shift', 'ShiftRight'));
    tracker.down(ev(' ', 'Space'));
    tracker.down(ev('ArrowLeft', 'ArrowLeft'));
    expect(rows[7]).toBe(0x01);
    expect(rows[6]).toBe(0xa0);
    tracker.blur();
    expect([...rows]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('takes no Tab and no key with Ctrl, Cmd or Alt, and no key the TRS-80 lacks', () => {
    const { rows, tracker, ev } = tracked();
    expect(tracker.down(ev('Tab', 'Tab'))).toBe(false);
    expect(tracker.down(ev('r', 'KeyR', { ctrlKey: true }))).toBe(false);
    expect(tracker.down(ev('r', 'KeyR', { metaKey: true }))).toBe(false);
    expect(tracker.down(ev('x', 'KeyX', { altKey: true }))).toBe(false);
    expect(tracker.down(ev('F7', 'F7'))).toBe(false);
    expect(tracker.up(ev('F7', 'F7'))).toBe(false);
    expect([...rows]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('holds a key pressed and released at once in the rows the worker copies for MIN_HOLD_FRAMES frames (150 ms)', () => {
    expect(MIN_HOLD_FRAMES).toBe(9);
    const { rows, tracker, copy, copies, ev } = tracked();
    copy();
    tracker.down(ev(' ', 'Space'));
    tracker.up(ev(' ', 'Space'));
    // Not yet seen by the worker: still down
    expect(rows[6]).toBe(0x80);
    // The worker's next nine copies have it down, and the one after has it up
    expect(copies(MIN_HOLD_FRAMES).map((r) => r[6])).toEqual(Array(MIN_HOLD_FRAMES).fill(0x80));
    expect(rows[6]).toBe(0x00);
    expect(copy()[6]).toBe(0x00);
  });

  it('holds it for MIN_HOLD_FRAMES - 1 copies at the least when the page reads the counter between a copy and its store', () => {
    const { rows, tracker, copies, worker, ev } = tracked();
    copies(3);
    // The worker copies the rows (without the key) but has not yet stored its count: the page reads 3
    const missed = rows.slice();
    tracker.down(ev('ArrowRight', 'ArrowRight'));
    tracker.up(ev('ArrowRight', 'ArrowRight'));
    worker.frame++; // the store
    tracker.update();
    expect(missed[6]).toBe(0x00);
    const seen = copies(MIN_HOLD_FRAMES).map((r) => r[6]);
    expect(seen).toEqual([...Array(MIN_HOLD_FRAMES - 1).fill(0x40), 0x00]);
  });

  it('lets go at once of a key held MIN_HOLD_FRAMES frames, and a blur lets go of a held-over key too', () => {
    const { rows, tracker, copies, ev } = tracked();
    tracker.down(ev('ArrowUp', 'ArrowUp'));
    copies(MIN_HOLD_FRAMES - 1);
    tracker.up(ev('ArrowUp', 'ArrowUp'));
    expect(rows[6]).toBe(0x08); // eight frames: held over
    tracker.down(ev('ArrowUp', 'ArrowUp'));
    copies(MIN_HOLD_FRAMES);
    tracker.up(ev('ArrowUp', 'ArrowUp'));
    expect(rows[6]).toBe(0x00); // nine frames: let go at once
    tracker.down(ev('Enter', 'Enter'));
    tracker.up(ev('Enter', 'Enter'));
    expect(rows[6]).toBe(0x01);
    tracker.blur();
    expect(rows[6]).toBe(0x00);
  });

  it("lets go at once of a key held past the hold with the browser's repeating key-downs", () => {
    const { rows, tracker, copy, ev } = tracked();
    tracker.down(ev('ArrowRight', 'ArrowRight'));
    // Held for a second: the browser repeats its keydown every other frame
    for (let k = 0; k < 60; k++) {
      copy();
      if (k % 2 === 1) expect(tracker.down(ev('ArrowRight', 'ArrowRight'))).toBe(true);
    }
    expect(rows[6]).toBe(0x40);
    tracker.up(ev('ArrowRight', 'ArrowRight'));
    // Out of the rows at once, and out of the worker's next copy
    expect(rows[6]).toBe(0x00);
    expect(copy()[6]).toBe(0x00);
  });

  it('says which keys it holds (for a repeat the page passes over), and starts a new hold for a key pressed again while held over', () => {
    const { rows, tracker, copies, ev } = tracked();
    expect(tracker.holds(ev('ArrowUp', 'ArrowUp'))).toBe(false);
    tracker.down(ev('ArrowUp', 'ArrowUp'));
    tracker.down(ev('Shift', 'ShiftLeft'));
    expect(tracker.holds(ev('ArrowUp', 'ArrowUp'))).toBe(true);
    expect(tracker.holds(ev('Shift', 'ShiftLeft'))).toBe(true);
    tracker.up(ev('ArrowUp', 'ArrowUp')); // held over
    copies(4);
    tracker.down(ev('ArrowUp', 'ArrowUp')); // a new press, four frames into the hold
    tracker.up(ev('ArrowUp', 'ArrowUp'));
    // The new press is held its own nine frames, counted from it
    expect(copies(MIN_HOLD_FRAMES).map((r) => r[6])).toEqual(Array(MIN_HOLD_FRAMES).fill(0x08));
    expect(rows[6]).toBe(0x00);
  });

  it('takes another hold from its options', () => {
    const rows = new Uint8Array(8);
    let frame = 0;
    const tracker = new KeyTracker(rows, () => frame, { minHold: 1 });
    tracker.down({ key: ' ', code: 'Space' });
    tracker.up({ key: ' ', code: 'Space' });
    expect(rows[6]).toBe(0x80);
    frame = 1;
    tracker.update();
    expect(rows[6]).toBe(0x00);
  });
});

describe("the worker's loop", () => {
  /** A port of one routine: a block of `t` T-states that writes port $FF and a byte of video RAM, for ever. */
  const looping = (t = 1000) => ({
    MODEL: /** @type {3} */ (3),
    DATA: [],
    ENTRY(z) {
      for (let n = 0; ; n++) {
        z.at(0x5000);
        z.write(0x3c00, n & 0xff);
        z.write(0x3c01, z.read(0x3840)); // the arrow and space row, as Sea Dragon reads it
        z.out(0xff, n & 1 ? 1 : 2);
        z.tick(t, 1);
      }
    },
  });
  const STOP = { stop: true };

  /** Runs `play` until `frames` posts, with real time from `now`; returns the posts and the waits. */
  function run(mod, frames, { now = () => 0, keys = new Uint8Array(8), counter = new Int32Array(1), onPost = () => {} } = {}) {
    const posts = [];
    const waits = [];
    try {
      play({
        mod,
        keys,
        counter,
        post: (m, transfer) => {
          expect(transfer).toEqual([m.video.buffer]);
          posts.push(m);
          onPost(m);
          if (posts.length === frames) throw STOP;
        },
        wait: (ms) => waits.push(ms),
        now,
      });
    } catch (e) {
      if (e !== STOP) throw e;
    }
    return { posts, waits };
  }

  it('posts at the first block start at or after each frame, video RAM and the sound since the frame before', () => {
    const { posts } = run(looping(), 10);
    const length = frameLength(MODEL3_HZ);
    posts.forEach((p, k) => {
      expect(p.frame).toBe(k + 1);
      expect(p.to).toBe(Math.ceil(((k + 1) * length) / 1000) * 1000);
      expect(p.from).toBe(k === 0 ? 0 : posts[k - 1].to);
      expect(p.video).toHaveLength(1024);
      expect(p.video[0]).toBe((p.to / 1000 - 1) & 0xff);
      // one write a block, each stamped with the block's T-state
      expect(p.sound.map((s) => s.t)).toEqual(Array.from({ length: (p.to - p.from) / 1000 }, (_, i) => p.from + i * 1000));
    });
  });

  it('keeps the frame boundary as a running value, so frames never drift', () => {
    const { posts } = run(looping(1), 600);
    expect(posts[599].to).toBe(MODEL3_HZ * 10);
    expect(posts.map((p) => p.to)).toEqual(Array.from({ length: 600 }, (_, k) => Math.ceil(((k + 1) * MODEL3_HZ) / 60)));
  });

  it('copies the shared key rows into the machine at each frame and bumps the shared counter before it posts', () => {
    const keys = new Uint8Array(8);
    const counter = new Int32Array(1);
    const matrix = new KeyMatrix();
    const seen = [];
    const { posts } = run(looping(), 4, {
      keys,
      counter,
      onPost: (m) => {
        seen.push(counter[0]);
        if (m.frame === 1) {
          matrix.press('SPACE');
          keys.set(matrix.rows);
        }
      },
    });
    expect(seen).toEqual([1, 2, 3, 4]);
    // SPACE, written after post 1, is copied in at frame 2: the blocks after it read it
    expect(posts.map((p) => p.video[1])).toEqual([0x00, 0x00, 0x80, 0x80]);
  });

  it('waits what the clock asks: nothing when behind, the lead when ahead', () => {
    const time = { ms: 0 };
    // Real time stands still: each frame is 1/60 s ahead more
    const { waits } = run(looping(), 3, { now: () => time.ms });
    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeCloseTo((Math.ceil(frameLength(MODEL3_HZ) / 1000) * 1000 * 1000) / MODEL3_HZ, 6);
    // Real time races ahead: no waits
    const fast = run(looping(), 5, { now: () => (time.ms += 100) });
    expect(fast.waits).toEqual([]);
  });

  it('starts as the stub ROM hands over: SP $FFFE with the return address on it, and the registers it is given', () => {
    const z = createZ({ model: 3 });
    begin(z);
    expect(z.sp).toBe(0xfffe);
    expect(z.read16(0xfffe)).toBe(START.ret);
    begin(z, { r: 0x45, a: 0x12, ix: 0x1234, sp: 0x8000, ret: 0x4321 });
    expect([z.r, z.a, z.ix, z.sp, z.read16(0x8000)]).toEqual([0x45, 0x12, 0x1234, 0x8000, 0x4321]);
  });

  it("says when the port's entry returns", () => {
    const mod = { MODEL: /** @type {3} */ (3), DATA: [], ENTRY: (z, ret) => { z.at(0x5000); z.tick(10, 1); z.wz = ret; } };
    const posts = [];
    expect(play({ mod, keys: new Uint8Array(8), post: (m) => posts.push(m), wait: () => {}, now: () => 0 })).toEqual({ reason: 'returned' });
    expect(posts).toEqual([]);
  });
});

describe('the player has no DOM where it needs none', () => {
  it('names no browser or Node global in frame.js, sound.js, keys.js and the index', () => {
    const hits = ['frame.js', 'sound.js', 'keys.js', 'index.js'].flatMap((f) =>
      platformHits(readFileSync(new URL(`../src/player/${f}`, import.meta.url), 'utf8')).map((hit) => `${f}:${hit}`),
    );
    expect(hits).toEqual([]);
  });

  it("is the package's ./player export", () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(pkg.exports['./player']).toBe('./src/player/index.js');
  });
});
