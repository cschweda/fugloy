/**
 * The Model I sweep against xtrs (emu phase 7, the Model I sweep, Task 3): every program the
 * thirteen sessions do not play (model1-session.js, sweepPrograms: the Model III sweep's list less
 * the sessions' own), each loaded on the Level II ROM as the sessions load theirs (ENTER at MEM
 * SIZE?, the program at 4 s) and run under one generic script, the Model III sweep's (GENERIC:
 * ENTER, a 1, ENTER again, then a few play keys), for 10 million instructions past the load in
 * lockstep with xtrs, checking only that nothing diverges that xtrs's known classes (known.js,
 * XTRS_CLASSES) do not explain. No screens are listed and no counts pinned: what each program does
 * on the Model I is whatever the two machines agree it does. A program that does not work on a
 * Model I (a Model III build that writes port $EC or $FE, one that ends at BASIC or reboots, an
 * Infocom interpreter without its story disk) is compared for all 10 million instructions all the
 * same; "it does not run" is never a reason to leave one out.
 *
 * A divergence fails that program's test with formatReport's report (the step, both sides, ten
 * instructions before and after), and the sweep goes on to the next. The programs that stand Open
 * (emu spec §11, phase 7; OPEN below: Eliminator b, d, f, g and h, which take the 40 Hz interrupt
 * in IM 0, where xtrs has no response) are tested for the divergence that limitation gives, as
 * recorded, so the sweep passes while they stay as they are and fails, loud, when one of them
 * changes; they are not in the totals.
 *
 * Each program's class counts and the maskable interrupts our machine took are logged as it
 * finishes, and the counts' sums over the programs that passed, with how many of them took an
 * interrupt, at the end: the numbers emu spec §11 (phase 7) and the CHANGELOG report come from
 * these lines. Vitest hides a passing test's console output, so run with --silent=false to see them.
 *
 * Opt-in: FUGLOY_XTRS=1 and FUGLOY_XTRS_SWEEP=1. On an Apple M4 a program takes about 4 minutes
 * (median 251 s; up to 8.5 beside other runs), so the 50 here (21 in examples/, 29 in
 * fixtures/real/) take about 3.6 hours one after another; `-t` splits them across processes (five
 * took 92 minutes). On a roms.model1 that is not Level II 1.3 it skips, as the sessions do
 * (sessionSkip). One program alone: `-t elimin8d`.
 */
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { xtrsSkip } from './gate.js';
import { explain, GENERIC, INSTRUCTIONS, sessionSkip, sweepPrograms, xtrsSession } from './model1-session.js';

const SWEEP = xtrsSkip === null && sessionSkip === null && process.env.FUGLOY_XTRS_SWEEP === '1';
const skipped = xtrsSkip !== null || process.env.FUGLOY_XTRS_SWEEP !== '1' ? 'set FUGLOY_XTRS=1 and FUGLOY_XTRS_SWEEP=1 to run' : sessionSkip;

/**
 * The programs that stand Open against xtrs (emu spec §11, phase 7), each with the divergence its
 * run stops at, as the sweep recorded it. Each runs `RST 38H` into the Level II ROM's `EI / RET` at
 * $4012, and the 40 Hz request pending since the boot is then taken in IM 0 (the ROM has no IM
 * instruction): ours responds with RST 38H and runs $0038's `JP 4012H` in the same step (PC $4012,
 * 23 T-states); xtrs pushes the same return address and clears IFF1 and IFF2 but does not jump
 * (z80.c do_int, "interrupt in im0 not supported"; known.js, reference limitations), and runs the
 * next instruction where it was. The step, its PC (ours, $0038) and its fields are pinned, nothing
 * counted before it; no divergence, or another, fails the test.
 * @type {Record<string, { index: number, pc: number, fields: string[] }>}
 */
const OPEN = Object.fromEntries(['elimin8b.cmd', 'elimin8d.cmd', 'elimin8f.cmd', 'elimin8g.cmd', 'elimin8h.cmd']
  .map((name) => [name, { index: 46_711, pc: 0x0038, fields: ['cycles', 'pc'] }]));

describe.skipIf(!SWEEP)(`every other Model I .CMD against xtrs${SWEEP ? '' : ` (skipped: ${skipped})`}`, { timeout: 1_200_000 }, () => {
  /** @type {Record<string, number>} */
  const totals = {};
  let programs = 0;
  let interrupted = 0;
  let interrupts = 0;
  afterAll(() => {
    if (programs > 0) console.log(`sweep totals over ${programs} programs: ${JSON.stringify(Object.fromEntries(Object.entries(totals).sort()))}; ${interrupted} of them took an interrupt, ${interrupts} in all`);
  });
  for (const { name, path } of sweepPrograms()) {
    const open = OPEN[name];
    if (open !== undefined) {
      it(`${name}: Open (emu spec §11), xtrs has no IM 0 response: the run stops at the first IM 0 interrupt, instruction ${open.index.toLocaleString('en-US')}, as recorded`, () => {
        const { result } = xtrsSession({ name, program: new Uint8Array(readFileSync(path)), keys: GENERIC, screens: [], known: {} });
        console.log(`sweep ${name}: Open, ${result.divergence === null ? 'no divergence' : `divergence at instruction ${result.divergence.index}`}`);
        expect(result.divergence, explain(result) || 'no divergence: the program no longer meets xtrs\'s IM 0 limitation, so it is not Open').toMatchObject({ index: open.index, pc: open.pc, fields: open.fields, known: null, ours: { regs: { im: 0, pc: 0x4012 } } });
        expect(result.known).toEqual({});
      });
      continue;
    }
    it(`${name}: 10 million instructions in lockstep under the generic script, no unexplained divergence`, () => {
      const run = xtrsSession({ name, program: new Uint8Array(readFileSync(path)), keys: GENERIC, screens: [], known: {} });
      const { result } = run;
      console.log(`sweep ${name}: ${JSON.stringify(result.known)}, ${run.interrupts} interrupts taken`);
      expect(explain(result)).toBe('');
      expect(result.instructions).toBe(INSTRUCTIONS);
      programs++;
      if (run.interrupts > 0) interrupted++;
      interrupts += run.interrupts;
      for (const [c, n] of Object.entries(result.known)) totals[c] = (totals[c] ?? 0) + n;
    });
  }
});
