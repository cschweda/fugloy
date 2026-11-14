/**
 * The player's frames and its clock (M2): what a port running in a Web Worker does at each frame, and how
 * it keeps the original's speed. No DOM: the worker (worker.js) injects how to post and how to wait.
 *
 * A port is ordinary nested functions that never yield, so the worker that runs it cannot take messages
 * while the game runs. The page writes the keyboard matrix into shared memory the worker reads; the worker
 * posts the screen and the sound out (posting works from synchronous code); and it keeps time by blocking
 * (`Atomics.wait`) whenever emulated time is ahead of real time. The place it does all three is `z.at`,
 * which a port calls at the start of every block, as the referee's does.
 */

/** Frames a second: a frame is `clockHz / FRAME_RATE` T-states of the model's clock (the referee's frame). */
export const FRAME_RATE = 60;

/**
 * One frame in T-states, `clockHz / 60`: 33,792 on the Model III, 29,568 on the Model I. Each boundary is
 * computed from the T-state count (a frame's multiple), never by adding up frames, so frames cannot drift
 * whatever the clock.
 * @param {number} clockHz
 */
export const frameLength = (clockHz) => clockHz / FRAME_RATE;

/**
 * How far emulated time may fall behind real time, in milliseconds, before the clock gives up catching
 * up: a quarter of a second.
 */
export const BEHIND_LIMIT_MS = 250;

/**
 * The longest single wait the clock asks for, in milliseconds: 2,000. Between two of its checks a port runs
 * one frame and at most one block, and its longest block, a `$DELAY` of BC = 0 (rom.js), is under a second
 * (1,966,095 T-states on the Model III), so a wait past a second more than that is a fault of the clock's
 * input, not time the port is owed.
 */
export const MAX_WAIT_MS = 2000;

/**
 * @typedef {object} Clock
 * @property {(cycles: number) => number} due The milliseconds the port is ahead of real time at emulated
 *   T-state `cycles`, which the worker waits; 0 when it is behind. More than a quarter of a second behind
 *   (a background tab, a stalled machine), the clock moves its origin to now and `cycles`, so the game
 *   goes on at normal speed from there and never runs fast to catch up the time it lost. A `now` earlier
 *   than the last one seen (a clock that is not monotonic, which `performance.now` is) moves the origin
 *   too, and no wait is longer than `MAX_WAIT_MS`.
 */

/**
 * The clock that paces a port: emulated time (T-states of `clockHz`) against real time (`now()`, in
 * milliseconds). Behind by less than a quarter of a second, it asks for no wait, so the port runs on
 * until it has caught up; that is how a slow frame is made good.
 * @param {{ clockHz: number, now: () => number, cycles?: number }} opts `cycles` is the T-state at which
 *   real time is `now()` as the clock is made (0 by default)
 * @returns {Clock}
 */
export function createClock({ clockHz, now, cycles = 0 }) {
  let originMs = now();
  let originT = cycles;
  let last = originMs;
  return {
    due(t) {
      const real = now();
      if (real < last) {
        originMs = real;
        originT = t;
      }
      last = real;
      const ahead = ((t - originT) * 1000) / clockHz - (real - originMs);
      if (ahead > 0) return Math.min(ahead, MAX_WAIT_MS);
      if (ahead < -BEHIND_LIMIT_MS) {
        originMs = real;
        originT = t;
      }
      return 0;
    },
  };
}

/** Video RAM, the 1K a frame posts: $3C00-$3FFF on the Model I and III. */
const VIDEO = 0x3c00;
const VIDEO_END = 0x4000;

/**
 * What the worker posts at each frame. `video` is a copy of the 1K of video RAM (its buffer is
 * transferred); `sound` the port's writes to port $FF since the frame before, as `z.sound` holds them
 * (`{ t, v }`, `t` in T-states); `from` and `to` the T-states the frame covers (the last frame's post to
 * this one's), for sound.js's `samples`; `mode` the mode register, for `screenOf`'s 32 columns and the
 * alternate set; `cycles` the T-state of the post (`to`).
 * @typedef {{
 *   type: 'frame', frame: number, from: number, to: number, cycles: number,
 *   video: Uint8Array, sound: { t: number, v: number }[], mode: number,
 * }} FrameMessage
 */

/**
 * The `z.at` a player runs a port with. It keeps `z.block` as the runtime's own does; then, at the first
 * block start at or after each frame boundary (a running value in T-states, `frameLength(z.clockHz)` apart,
 * so frames do not drift; one post when a long block passes several, as the referee compares once):
 *   1. copies the shared key rows into the port's matrix (`z.keys`), and stores the frame's number in the
 *      shared counter (`counter[0]`), which the page's KeyTracker reads to know the worker has seen a key;
 *   2. posts the frame (`FrameMessage`), transferring the video copy, and empties `z.sound`;
 *   3. waits the clock's `due(z.cycles)`, when it is more than 0.
 * Keys are copied before the post so that the counter the page reads with the post is already bumped.
 * @param {{
 *   z: import('../z.js').Z,
 *   clock: Clock,
 *   keys: Uint8Array,
 *   counter?: Int32Array | null,
 *   post: (message: FrameMessage, transfer: ArrayBuffer[]) => void,
 *   wait: (ms: number) => void,
 * }} opts `keys` the eight matrix rows the page writes (a view of shared memory in a browser); `counter`
 *   the shared frame counter (`Int32Array`, element 0)
 * @returns {(addr: number) => void}
 */
export function frameHook({ z, clock, keys, counter = null, post, wait }) {
  const length = frameLength(z.clockHz);
  let next = (Math.floor(z.cycles / length) + 1) * length;
  let from = z.cycles;
  let frame = 0;
  return (addr) => {
    z.block = addr;
    if (z.cycles < next) return;
    frame++;
    z.keys.set(keys);
    if (counter !== null) Atomics.store(counter, 0, frame);
    const video = z.mem.slice(VIDEO, VIDEO_END);
    const sound = z.sound.splice(0);
    post({ type: 'frame', frame, from, to: z.cycles, cycles: z.cycles, video, sound, mode: z.modeRegister }, [video.buffer]);
    from = z.cycles;
    next = (Math.floor(z.cycles / length) + 1) * length;
    const ms = clock.due(z.cycles);
    if (ms > 0) wait(ms);
  };
}
