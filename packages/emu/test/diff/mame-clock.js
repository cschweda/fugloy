/**
 * MAME's 40 Hz on our machine, for a run that follows a MAME trace (emu phase 7, Task 5; the
 * controller's ruling on the clock). Test-only: nothing in src/ changes.
 *
 * MAME 0.289's trs80l2 runs its Z80 at 10.6445 MHz / 6 = 1,774,083 Hz (`trs80.cpp:443`) and raises
 * the 40 Hz with `set_periodic_int(…, attotime::from_hz(40))`, so its tick n falls at n/40 s, about
 * 44,352.075 T-states apart; ours ticks every 44,352 (1,774,080 / 40). About fifteen ticks in, our
 * request falls one instruction before MAME's, and a session with interrupts on stops on `irqTime`
 * (model1-devices.test.js pins that). MAME times its CPU in whole attoseconds a cycle
 * (1e18 / clock, rounded down) and runs it to the first instruction boundary at or past the cycle
 * a timer falls on (the scheduler's timeslice), so tick n is raised at the first boundary at or
 * after cycle floor((n/40 s) / attoseconds-per-cycle).
 *
 * `mameTimer(m)` schedules our machine's 40 Hz at those cycles for the run: ours still raises it
 * at the first boundary at or after the cycle (trs80-system.js, stepInstruction), with its own
 * latch and its own read-to-clear, so `irqTime` stays unexcused (Ruling 4) and still catches a
 * timer or latch bug of ours; only the period is MAME's.
 */

const ATTOS_PER_SECOND = 10n ** 18n;
/** trs80l2's CPU clock (mame-trace.js, MAME_CLOCK_HZ). */
const MAME_CLOCK = 1_774_083n;
const ATTOS_PER_CYCLE = ATTOS_PER_SECOND / MAME_CLOCK;
const ATTOS_PER_TICK = ATTOS_PER_SECOND / 40n;

/** The cycle MAME raises its 40 Hz tick `n` on (n from 1, the first at 1/40 s). @param {number} n */
export function mameTick(n) {
  return Number((BigInt(n) * ATTOS_PER_TICK) / ATTOS_PER_CYCLE);
}

/**
 * Put our Model I's 40 Hz on MAME's schedule from power-on. The machine must not have run (MAME
 * traces start at power-on). Our timer advances `nextRtcAt` by one period at each tick; here
 * each advance moves to MAME's next tick instead. Only that advance is taken: any other write
 * (`reset()`, a restored save state, a debugger's) would put the timer off MAME's schedule in the
 * middle of a run that follows it, so it throws, and the run fails loud rather than drifting.
 * @param {import('../../src/machine/machine.js').Machine} m
 */
export function mameTimer(m) {
  const sys = m.system;
  if (m.model !== 1) throw new Error('mameTimer: MAME\'s trs80l2 is a Model I');
  if (m.cycles !== 0) throw new Error('mameTimer: the 40 Hz is put on MAME\'s schedule at power-on; this machine has already run');
  let n = 1;
  Object.defineProperty(sys, 'nextRtcAt', {
    configurable: true,
    get: () => mameTick(n),
    // stepInstruction's `nextRtcAt += rtcInterval` after a tick: on to MAME's next.
    set: (/** @type {number} */ v) => {
      const want = mameTick(n) + sys.rtcInterval;
      if (v !== want) throw new Error(`mameTimer: the 40 Hz was set to T-state ${v}, where only its tick's own advance (${want}, after MAME's tick ${n}) keeps it on MAME's schedule; a reset or a restored state during a run that follows MAME is not supported`);
      n++;
    },
  });
  return m;
}
