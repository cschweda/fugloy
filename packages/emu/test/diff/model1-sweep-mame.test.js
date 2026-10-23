/**
 * The Model I sweep against MAME (emu phase 7, the Model I sweep, Task 3): the programs of the xtrs
 * sweep (model1-sweep-xtrs.test.js; model1-session.js, sweepPrograms), each recorded on MAME 0.289's
 * trs80l2 from power-on under the same timeline and generic script (ENTER at MEM SIZE?, the
 * program loaded at 4 s by MAME's debugger, GENERIC's keys on MAME's matrix) and followed by ours
 * from power-on on MAME's 40 Hz schedule, the boot and 10 million instructions past the load,
 * checking only that nothing diverges that MAME's known classes (mame-trace.js, MAME_CLASSES) do
 * not explain, and that the trace is whole (complete, its end memory verified, no early end). As
 * against xtrs, a program that does not work on a Model I is compared all the same.
 *
 * A program MAME's loader cannot take (mame-trace.js, loadRuns: a byte below $3C00, which
 * m.load.cmd drops and MAME's debugger would write into the ROM) is skipped here with loadRuns's
 * sentence in its title, never counted as passed; it still runs against xtrs. Open, and failing
 * here until MAME can be followed through them (emu spec §11, phase 7): Eliminator b, d, f, g and h,
 * and Asylum 1d (on its lowercase path), which take the 40 Hz interrupt in IM 0 and never read the
 * latch; the recorder decodes only IM 1, and past it MAME's request is gone after one response
 * (known.js, reference limitations).
 *
 * A divergence fails that program's test with formatReport's report and the sweep goes on; each
 * program's class counts and the maskable interrupts our machine took are logged as it finishes,
 * and the counts' sums over the programs that passed, with how many took an interrupt, at the end
 * (run with --silent=false to see them).
 *
 * The programs run five at a time (`concurrent`), as the sessions do: recording is MAME's speed,
 * about 70,000 instructions a second, and following a trace about a million. Each trace (about
 * 95 MB) is recorded into a temporary folder and deleted after its comparison, in mameSession's
 * `finally`, so at most five exist at once. Opt-in: FUGLOY_MAME=1 and FUGLOY_MAME_SWEEP=1 (on an
 * Apple M4, 37.5 minutes for the 50 programs here, beside the xtrs sweep: 3 to 4.5 minutes a
 * program, less for one whose trace ends early). On a roms.model1 that is not Level II 1.3 it
 * skips, as the sessions do (sessionSkip). One program alone: `-t elimin8d`.
 */
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { mameSkip } from './gate.js';
import { loadRuns } from './mame-trace.js';
import { explain, GENERIC, INSTRUCTIONS, mameSession, sessionSkip, sweepPrograms } from './model1-session.js';

const SWEEP = mameSkip === null && sessionSkip === null && process.env.FUGLOY_MAME_SWEEP === '1';
const skipped = mameSkip !== null || process.env.FUGLOY_MAME_SWEEP !== '1' ? 'set FUGLOY_MAME=1 and FUGLOY_MAME_SWEEP=1 to run' : sessionSkip;

/** Each program with its bytes and, when MAME's loader cannot take it, loadRuns's sentence. */
const programs = sweepPrograms().map(({ name, path }) => {
  const program = new Uint8Array(readFileSync(path));
  /** @type {string | null} */
  let refused = null;
  try {
    loadRuns(program);
  } catch (e) {
    refused = /** @type {Error} */ (e).message;
  }
  return { name, program, refused };
});

describe.skipIf(!SWEEP)(`every other Model I .CMD against MAME${SWEEP ? '' : ` (skipped: ${skipped})`}`, { timeout: 1_800_000, concurrent: true }, () => {
  /** @type {Record<string, number>} */
  const totals = {};
  let passed = 0;
  let interrupted = 0;
  let interrupts = 0;
  afterAll(() => {
    if (passed > 0) console.log(`sweep totals over ${passed} programs: ${JSON.stringify(Object.fromEntries(Object.entries(totals).sort()))}; ${interrupted} of them took an interrupt, ${interrupts} in all`);
  });
  for (const { name, program, refused } of programs) {
    if (refused !== null) {
      it.skip(`${name}: not loaded on MAME: ${refused}`, () => {});
      continue;
    }
    it(`${name}: the boot and 10 million instructions past the load under the generic script, following MAME, no unexplained divergence`, async () => {
      const run = await mameSession({ name, program, keys: GENERIC, screens: [], known: {} });
      const { result, header } = run;
      console.log(`sweep ${name}: ${JSON.stringify(result.known)}, ${run.interrupts} interrupts taken`);
      expect(explain(result)).toBe('');
      expect(result.ended).toBeUndefined();
      expect(header).toMatchObject({ complete: true, verified: true });
      expect(result.instructions).toBe(header.requested);
      expect(header.requested - /** @type {import('./mame-trace.js').TraceLoad} */ (header.load).at).toBe(INSTRUCTIONS);
      passed++;
      if (run.interrupts > 0) interrupted++;
      interrupts += run.interrupts;
      for (const [c, n] of Object.entries(result.known)) totals[c] = (totals[c] ?? 0) + n;
    });
  }
});
