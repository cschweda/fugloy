/**
 * Running the machine for the tools (docs/fugloy-mcp-spec.md §2, §7): booting a ROM to READY
 * before a load, and the one run loop `run` and `key` share. The loop runs in slices of
 * 2,000 T-states so it can check the wall clock and, for `until: "screen"`, video RAM between
 * slices (Ruling 5). Slice ends are fixed by T-states from the start of the call, never by the
 * clock, so the same calls give the same cycles; only a tripped wall-clock cap differs.
 */
import { CPU_CLOCK_HZ } from '@fugloy/emu';
import { hex4 } from './args.js';

/** T-states between the run loop's checks of the clock and the screen (Ruling 5). */
export const SLICE = 2000;

/** How long `load` lets a ROM take to reach READY before it loads the program anyway. */
export const BOOT_SECONDS = 5;

/** Emulated seconds as text, three decimals. */
export const seconds = (/** @type {number} */ cycles) => `${(cycles / CPU_CLOCK_HZ).toFixed(3)} s`;

/** The screen as one string. */
const screenOf = (/** @type {import('@fugloy/emu').Machine} */ m) => m.video.text().join('\n');

/**
 * Boot a fresh Model III to READY as the emu integration tests do (boot-helpers.js): in
 * quarter-second slices, ENTER at Cass? (1,500 baud) and at Memory Size?, then a quarter second
 * more once READY shows, so the cursor settles. A ROM that never shows READY (a synthetic test
 * ROM, or not a BASIC ROM) is run for `limit` seconds and left there.
 * @param {import('@fugloy/emu').Machine} m
 * @param {number} [limit] emulated seconds
 * @returns {{ ready: boolean, cycles: number }}
 */
export function bootToReady(m, limit = BOOT_SECONDS) {
  const quarter = CPU_CLOCK_HZ / 4;
  let cass = false;
  let memory = false;
  for (let t = 0; t < limit * 4; t++) {
    const text = screenOf(m);
    if (text.includes('READY')) {
      m.run({ cycles: quarter });
      return { ready: true, cycles: m.cycles };
    }
    if (!cass && text.includes('Cass?')) {
      cass = true;
      m.keyboard.type('\n');
    } else if (cass && !memory && text.includes('Memory Size?')) {
      memory = true;
      m.keyboard.type('\n');
    }
    m.run({ cycles: quarter });
  }
  return { ready: false, cycles: m.cycles };
}

/**
 * @typedef {'halt' | 'drained' | { pc: number }} Until
 * @typedef {{ reason: 'break' | 'watch', id: number, cycles: number }
 *   | { reason: 'halt' | 'screen' | 'pc' | 'drained' | 'cycles' | 'wallclock', cycles: number }} Stop
 */

/**
 * Run the session's machine for at most `budget` T-states, or until `until` holds, video RAM
 * differs from `screenFrom` (checked at slice ends), a breakpoint or stop watch fires, or the
 * wall-clock cap (`limits.runSecondsWall`) passes. When the budget and a condition are met at
 * the same point the condition wins; the wall clock is checked last.
 * @param {import('./session.js').Session} session
 * @param {{ budget: number, until?: Until, screenFrom?: Uint8Array }} opts
 * @returns {Stop}
 */
export function runMachine(session, { budget, until, screenFrom }) {
  const m = session.requireMachine();
  const start = m.cycles;
  const target = start + budget;
  const deadline = performance.now() + session.config.limits.runSecondsWall * 1000;
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
  for (;;) {
    const done = m.cycles - start;
    const next = Math.min(target, start + SLICE * (Math.floor(done / SLICE) + 1));
    const r = m.run({ cycles: Math.max(0, next - m.cycles), ...(emuUntil ? { until: emuUntil } : {}) });
    const ran = m.cycles - start;
    if (r.reason === 'break' || r.reason === 'watch') return { reason: r.reason, id: /** @type {any} */ (r).id, cycles: ran };
    if (r.reason === 'halt') return { reason: 'halt', cycles: ran };
    if (r.reason === 'predicate') return { reason: until === 'drained' ? 'drained' : 'pc', cycles: ran };
    if (screenFrom && differs(video, screenFrom)) return { reason: 'screen', cycles: ran };
    if (m.cycles >= target) return { reason: 'cycles', cycles: ran };
    if (performance.now() > deadline) return { reason: 'wallclock', cycles: ran };
  }
}

/** True when two copies of video RAM differ anywhere. */
function differs(/** @type {Uint8Array} */ a, /** @type {Uint8Array} */ b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
  return false;
}

/** The emulated-time cap in T-states (`limits.runSecondsEmulated`). */
export const capCycles = (/** @type {import('./config.js').Config} */ config) => Math.round(config.limits.runSecondsEmulated * CPU_CLOCK_HZ);

/**
 * The `stopped:` line for a stop.
 * @param {Stop} stop
 * @param {import('./session.js').Session} session
 * @param {{ capped: boolean, asked?: string, pc?: number }} why `capped` when the budget was the emulated cap; `asked` names the budget otherwise
 */
export function stoppedLine(stop, session, why) {
  const { limits } = session.config;
  switch (stop.reason) {
    case 'break': {
      const b = session.machine?.debug.breaks.find((x) => x.id === stop.id);
      return `stopped: break (breakpoint ${stop.id}${b ? ` at ${hex4(b.addr)}` : ''})`;
    }
    case 'watch':
      return `stopped: watch (watch ${stop.id}, after the instruction that touched it)`;
    case 'halt':
      return 'stopped: halt (the CPU ran HALT and waits for an interrupt)';
    case 'screen':
      return 'stopped: screen (video RAM changed)';
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
 * Turn the instruction trace on for `fn` when `on`, at `limits.traceDepth`, then off again
 * (Ruling 3: trace is on only during a run or step that asks for it). What it recorded stays
 * readable after.
 * @template T
 * @param {import('./session.js').Session} session
 * @param {boolean} on
 * @param {() => T} fn
 * @returns {T}
 */
export function withTrace(session, on, fn) {
  const m = session.requireMachine();
  if (!on) return fn();
  m.debug.trace.enable({ depth: Math.min(1_000_000, Math.max(1, Math.round(session.config.limits.traceDepth))) });
  try {
    return fn();
  } finally {
    m.debug.trace.disable();
  }
}
