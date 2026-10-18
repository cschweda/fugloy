/**
 * Running the machine for the tools (docs/fugloy-mcp-spec.md §2, §7): booting a ROM to READY
 * before a load, and the one run loop `run` and `key` share. The loop runs in slices of
 * 2,000 T-states so it can check the wall clock and, for `until: "screen"`, video RAM between
 * slices (Ruling 5). Slice ends are fixed by T-states from the start of the call, never by the
 * clock, so the same calls give the same cycles; only a tripped wall-clock cap differs.
 */
import { hex4 } from './args.js';

/** T-states between the run loop's checks of the clock and the screen (Ruling 5). */
export const SLICE = 2000;

/**
 * The machine's CPU clock in Hz: 2,027,520 on the Model III, 1,774,080 on the Model I. Every
 * emulated second the tools count or report is seconds of this clock.
 */
export const clockOf = (/** @type {import('@fugloy/emu').Machine} */ m) => m.clockHz;

/** T-states video RAM must stay unchanged for `until: "settled"`: 0.5 s emulated. */
export const settleCycles = (/** @type {import('@fugloy/emu').Machine} */ m) => Math.round(0.5 * clockOf(m));

/** How long `load` lets a ROM take to reach READY before it loads the program anyway. */
export const BOOT_SECONDS = 5;

/** Emulated seconds on `m`'s clock as text, three decimals. */
export const seconds = (/** @type {number} */ cycles, /** @type {import('@fugloy/emu').Machine} */ m) => `${(cycles / clockOf(m)).toFixed(3)} s`;

/** The screen as one string. */
const screenOf = (/** @type {import('@fugloy/emu').Machine} */ m) => m.video.text().join('\n');

/**
 * Boot a fresh machine to READY as the emu integration tests do (boot-helpers.js,
 * model1-boot.test.js): in quarter-second slices, ENTER at the ROM's questions (the Model III's
 * Cass?, at 1,500 baud, then Memory Size?; the Model 4 ROM's Cass ? and Memory Size? in Model III
 * mode; the Model I's MEMORY SIZE?, MEM SIZE? in Level II 1.3),
 * then a quarter second more once READY shows, so the cursor settles. A ROM that never shows
 * READY (a synthetic test ROM, or not a BASIC ROM) is run for `limit` seconds and left there.
 * @param {import('@fugloy/emu').Machine} m
 * @param {number} [limit] emulated seconds
 * @returns {{ ready: boolean, cycles: number }}
 */
export function bootToReady(m, limit = BOOT_SECONDS) {
  const quarter = clockOf(m) / 4;
  const questions = m.model === 1 ? ['SIZE?'] : m.model === 4 ? ['Cass ?', 'Memory Size?'] : ['Cass?', 'Memory Size?'];
  let answered = 0;
  for (let t = 0; t < limit * 4; t++) {
    const text = screenOf(m);
    if (text.includes('READY')) {
      m.run({ cycles: quarter });
      return { ready: true, cycles: m.cycles };
    }
    const next = questions[answered];
    if (next !== undefined && text.includes(next)) {
      answered++;
      m.keyboard.type('\n');
    }
    m.run({ cycles: quarter });
  }
  return { ready: false, cycles: m.cycles };
}

/**
 * @typedef {'halt' | 'drained' | { pc: number }} Until
 * @typedef {{ reason: 'break', id: number, addr: number, cycles: number }
 *   | { reason: 'watch', id: number, cycles: number }
 *   | { reason: 'settled', how: 'cycle' | 'quiet', cycles: number }
 *   | { reason: 'halt' | 'screen' | 'pc' | 'drained' | 'cycles' | 'wallclock', cycles: number }} Stop
 */

/**
 * Run the session's machine for at most `budget` T-states, or until `until` holds, video RAM
 * differs from `screenFrom` (checked at slice ends), a breakpoint or stop watch fires, or the
 * wall-clock cap passes. With `settle`, `screenFrom` is where a wait starts instead: after video
 * RAM first differs from it, the run stops when video RAM returns to a state already seen since
 * that first change (an animation or blink cycle has closed: `how: 'cycle'`), or once it has
 * stayed the same for 0.5 s emulated (`settleCycles`; `how: 'quiet'`), as seen at slice ends. States are kept
 * by a hash of the 1,024 bytes and compared exactly on a hash match, so a collision cannot stop
 * the run. When the budget and a condition are met at the same point
 * the condition wins; the wall clock is checked last.
 * @param {import('./session.js').Session} session
 * @param {{ budget: number, until?: Until, screenFrom?: Uint8Array, settle?: boolean, deadline?: number }} opts
 *   `deadline` is a `performance.now()` time, by default `limits.runSecondsWall` from now; a tool
 *   that runs more than once passes one deadline to all its runs
 * @returns {Stop}
 */
export function runMachine(session, { budget, until, screenFrom, settle = false, deadline = wallDeadline(session) }) {
  const m = session.requireMachine();
  const start = m.cycles;
  const target = start + budget;
  const cpu = m.system.cpu;
  /** @type {'halt' | ((m: any) => boolean) | undefined} */
  let emuUntil;
  if (until === 'halt') emuUntil = 'halt';
  else if (until === 'drained') emuUntil = () => m.keyboard.pending === 0;
  else if (until !== undefined) {
    const pc = until.pc;
    emuUntil = () => cpu.registers.PC === pc;
  }
  const video = m.video.raw;
  const settleFor = settleCycles(m);
  /** @type {Uint8Array | null} Video RAM as last seen while settling, once it first changed. */
  let seen = null;
  let quietSince = 0;
  /** @type {Map<number, Uint8Array[]>} Every video RAM state seen since the first change, by hash. */
  const states = new Map();
  /** Record the state video RAM holds now; true when it was already recorded. */
  const recur = () => {
    const h = hash(video);
    const same = states.get(h);
    if (same?.some((s) => !differs(video, s))) return true;
    const copy = Uint8Array.from(video);
    if (same) same.push(copy);
    else states.set(h, [copy]);
    return false;
  };
  for (;;) {
    const done = m.cycles - start;
    const next = Math.min(target, start + SLICE * (Math.floor(done / SLICE) + 1));
    const r = m.run({ cycles: Math.max(0, next - m.cycles), ...(emuUntil ? { until: emuUntil } : {}) });
    const ran = m.cycles - start;
    // A breakpoint stops before its instruction, so the PC is its address (kept here: a once breakpoint is gone already).
    if (r.reason === 'break') return { reason: 'break', id: /** @type {any} */ (r).id, addr: cpu.registers.PC, cycles: ran };
    if (r.reason === 'watch') return { reason: 'watch', id: /** @type {any} */ (r).id, cycles: ran };
    if (r.reason === 'halt') return { reason: 'halt', cycles: ran };
    if (r.reason === 'predicate') return { reason: until === 'drained' ? 'drained' : 'pc', cycles: ran };
    if (screenFrom && settle) {
      if (seen === null) {
        if (differs(video, screenFrom)) {
          seen = Uint8Array.from(video);
          quietSince = m.cycles;
          recur();
        }
      } else if (differs(video, seen)) {
        seen.set(video);
        quietSince = m.cycles;
        if (recur()) return { reason: 'settled', how: 'cycle', cycles: ran };
      } else if (m.cycles - quietSince >= settleFor) return { reason: 'settled', how: 'quiet', cycles: ran };
    } else if (screenFrom && differs(video, screenFrom)) return { reason: 'screen', cycles: ran };
    if (m.cycles >= target) return { reason: 'cycles', cycles: ran };
    if (performance.now() > deadline) return { reason: 'wallclock', cycles: ran };
  }
}

/** The default wall-clock deadline: `limits.runSecondsWall` from now. */
export const wallDeadline = (/** @type {import('./session.js').Session} */ session) => performance.now() + session.config.limits.runSecondsWall * 1000;

/** FNV-1a over video RAM: a cheap key for the states `settled` has seen. */
function hash(/** @type {Uint8Array} */ bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return h >>> 0;
}

/** True when two copies of video RAM differ anywhere. */
function differs(/** @type {Uint8Array} */ a, /** @type {Uint8Array} */ b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
  return false;
}

/** The emulated-time cap in T-states of `m`'s clock (`limits.runSecondsEmulated`). */
export const capCycles = (/** @type {import('./config.js').Config} */ config, /** @type {import('@fugloy/emu').Machine} */ m) =>
  Math.round(config.limits.runSecondsEmulated * clockOf(m));

/**
 * The `stopped:` line for a stop.
 * @param {Stop} stop
 * @param {import('./session.js').Session} session
 * @param {{ capped: boolean, asked?: string, pc?: number }} why `capped` when the budget was the emulated cap; `asked` names the budget otherwise
 */
export function stoppedLine(stop, session, why) {
  const { limits } = session.config;
  switch (stop.reason) {
    case 'break':
      return `stopped: break (breakpoint ${stop.id} at ${hex4(stop.addr)})`;
    case 'watch':
      return `stopped: watch (watch ${stop.id}, after the instruction that touched it)`;
    case 'halt':
      return 'stopped: halt (the CPU ran HALT and waits for an interrupt)';
    case 'screen':
      return 'stopped: screen (video RAM changed)';
    case 'settled':
      return stop.how === 'cycle'
        ? 'stopped: settled (video RAM returned to a state it held since it first changed: an animation or blink cycle closed)'
        : 'stopped: settled (video RAM changed, then stayed the same for 0.5 s emulated)';
    case 'pc':
      return `stopped: pc (reached ${hex4(/** @type {number} */ (why.pc))})`;
    case 'drained':
      return 'stopped: drained (every key was delivered)';
    case 'cycles':
      return why.capped
        ? `stopped: cycles (the ${limits.runSecondsEmulated} s emulated cap, limits.runSecondsEmulated)`
        : `stopped: cycles (the ${why.asked} asked for)`;
    case 'wallclock':
      return `stopped: wallclock (the ${limits.runSecondsWall} s wall-clock cap, limits.runSecondsWall: emulation ran slow, often because of trace; the result depends on the host's speed)`;
  }
}

/**
 * Turn the instruction trace on for `fn` when `on`, then off again (Ruling 3: trace is on only
 * during a run or step that asks for it), and hand what it recorded, registers included, to the
 * session's trace log, which keeps it across later runs and steps (src/trace-log.js).
 * @template T
 * @param {import('./session.js').Session} session
 * @param {boolean} on
 * @param {() => T} fn
 * @returns {T}
 */
export function withTrace(session, on, fn) {
  const m = session.requireMachine();
  if (!on) return fn();
  const depth = session.trace.depth;
  m.debug.trace.enable({ depth, regs: true });
  const from = m.cycles;
  try {
    return fn();
  } finally {
    session.trace.add(from, m.cycles, m.debug.trace.last(depth));
    m.debug.trace.disable();
  }
}
