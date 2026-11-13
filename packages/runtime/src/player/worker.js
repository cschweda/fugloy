/**
 * The player's worker (M2): runs a port in a Web Worker at the original's speed. `play` is the whole of
 * it, with the worker's posting, waiting and clock passed in, so a test runs it headlessly; the lines at
 * the end wire it to the worker's own `postMessage`, `Atomics.wait` and `performance.now` when this file
 * runs as a module worker (page.js starts it).
 *
 * The page sends one message, `{ module, keys, counter }`: the port module's URL, the shared memory the
 * page's KeyTracker writes the matrix rows into (8 bytes), and the shared frame counter (one Int32). The
 * worker then posts a `FrameMessage` (frame.js) at every frame, and at the end `{ type: 'returned' }` if
 * the port's entry returns, or `{ type: 'error', message }` with the port's sentence if it refuses
 * something (a sentence naming the address, as everywhere in the runtime).
 */
import { createZ } from '../z.js';
import { load, runPort } from '../run.js';
import { createClock, frameHook } from './frame.js';

/**
 * Where a standalone port starts, as Fugløy's stub ROM leaves the machine when it hands over to a program
 * (apps/web/app/utils/emulator/stub-rom.z): the stack at the top of memory with one return address on it
 * (the stub's `LD SP,0` and `PUSH HL`), so SP is $FFFE and the word there is the address `runPort` returns
 * at, the stub's RETURNED, $0016. Every other register is as `createZ` makes it (emu's reset), but those a
 * `Start` names.
 */
export const START = Object.freeze({ sp: 0xfffe, ret: 0x0016 });

/**
 * @typedef {{
 *   sp?: number, ret?: number,
 *   a?: number, f?: number, b?: number, c?: number, d?: number, e?: number, h?: number, l?: number,
 *   i?: number, r?: number, ix?: number, iy?: number, wz?: number, q?: number,
 *   af_?: number, bc_?: number, de_?: number, hl_?: number,
 * }} Start the start state: SP, the return address pushed at it, and the registers set before the entry.
 *   A program may read a register before it writes it (Sea Dragon's LD A,R reads R, which it never sets,
 *   for its random numbers), so a player gives the registers the original has at its entry: @fugloy/recomp's
 *   `pnpm play` takes them from emu at the entry on Fugløy's game stub ROM, the start the referee proves the
 *   port from. The interrupt state is not here: a port takes no interrupts.
 */

/** The registers `Start` may set besides SP and the return address. */
const REGISTERS = /** @type {const} */ (['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l', 'i', 'r', 'ix', 'iy', 'wz', 'q', 'af_', 'bc_', 'de_', 'hl_']);

/**
 * Put a loaded port's machine in its start state: `start`'s registers, SP, and the return address written
 * at SP (through memory, as the stub's PUSH writes it).
 * @param {import('../z.js').Z} z
 * @param {Start} [start]
 */
export function begin(z, start = START) {
  const s = { ...START, ...start };
  for (const name of REGISTERS) {
    const v = s[name];
    if (v !== undefined) z[name] = v;
  }
  z.sp = s.sp & 0xffff;
  z.write16(z.sp, s.ret);
}

/**
 * Run a port as the player does: a fresh machine for the port's model, `load`, the start state (`begin`),
 * `z.at` replaced by the frame hook (frame.js: at each frame the shared key rows copied in, the counter
 * bumped, the frame posted, and the clock's wait), and `runPort`. Returns when the port's entry returns;
 * throws what the port throws.
 * @param {{
 *   mod: import('../run.js').PortModule,
 *   keys: Uint8Array,
 *   counter?: Int32Array | null,
 *   post: (message: import('./frame.js').FrameMessage, transfer: ArrayBuffer[]) => void,
 *   wait: (ms: number) => void,
 *   now: () => number,
 *   start?: Start,
 * }} opts
 * @returns {{ reason: 'returned' }}
 */
export function play({ mod, keys, counter = null, post, wait, now, start }) {
  const z = createZ({ model: mod.MODEL });
  load(z, mod);
  begin(z, start);
  const clock = createClock({ clockHz: z.clockHz, now, cycles: z.cycles });
  z.at = frameHook({ z, clock, keys, counter, post, wait });
  return runPort(z, mod);
}

// ---- the worker: started by page.js as a module worker. In any other context (a test importing `play`)
// nothing below runs.

/** @type {any} */
const scope = typeof globalThis === 'object' ? globalThis : {};

if (typeof scope.WorkerGlobalScope === 'function' && scope instanceof scope.WorkerGlobalScope) {
  /** The shared Int32 `Atomics.wait` sleeps on: nothing ever notifies it, so each wait runs its time. */
  const sleep = new Int32Array(new SharedArrayBuffer(4));
  scope.onmessage = async (/** @type {MessageEvent} */ event) => {
    const { module, keys, counter, start } = event.data;
    try {
      const mod = await import(module);
      play({
        mod,
        keys: new Uint8Array(keys),
        counter: new Int32Array(counter),
        post: (message, transfer) => scope.postMessage(message, transfer),
        wait: (ms) => Atomics.wait(sleep, 0, 0, ms),
        now: () => scope.performance.now(),
        start,
      });
      scope.postMessage({ type: 'returned' });
    } catch (e) {
      scope.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };
}
