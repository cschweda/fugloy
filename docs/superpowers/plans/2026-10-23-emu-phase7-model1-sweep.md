# Emu Phase 7, the Model I Sweep (Every Other Program against xtrs and MAME) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run every other `.CMD` in `examples/` and `fixtures/real/` (50 programs here: 21 builds in `examples/`, 29 in `fixtures/real/`) for 10 million instructions on the Model I against xtrs in lockstep and against MAME by trace, under one generic script, with no divergence the references' declared classes do not explain — the Model III's sweep against trsjs, done for the Model I, so that §11 row 7's "Zero divergence on all fixtures" holds for both models — and close the four residuals the Model I half's final review handed on.

**Architecture:** The thirteen sessions' runners (`xtrsSession`, `mameSession` and their helpers) move out of `model1-fixtures.test.js` into a module, `test/diff/model1-session.js`, which the sessions, two sweep files (one per reference, so Vitest runs them in parallel workers) and `pnpm diff` share; `pnpm diff <program> --model 1 --reference mame` records its own trace of the program. No new design: the sweep is the Model III's (`packages/emu/test/diff/fixtures.test.js`, `FUGLOY_TRSJS_SWEEP=1`) — the same generic script, every program listed whether or not the sweep runs, per-program counts and totals logged — on the Model I's runners. `packages/emu/src/` changes only if the sweep finds a core bug.

**Tech Stack:** plain JavaScript ESM, Node ≥ 22, Vitest; xtrs (pinned, patched, `pnpm xtrs:install`) and MAME 0.289 (Homebrew, `pnpm mame:install`), both already installed and approved.

**Spec:** `docs/fugloy-emu-spec.md` §10 (Differential row; "The Model I's references"), §11 row 7 ("Zero divergence on all fixtures"), §12. The Model I plan, `docs/superpowers/plans/2026-10-19-emu-phase7-model1-differential.md`: its Global Constraints and Rulings 3–7 still bind. Written 2026-10-23 while the user was away, on their instruction to "make recommendations and act on them"; the execution ledger records every ruling.

## Global Constraints

- Tests that need a reference run only with `FUGLOY_XTRS=1` or `FUGLOY_MAME=1`, and the sweeps only with `FUGLOY_XTRS_SWEEP=1` or `FUGLOY_MAME_SWEEP=1` as well; they skip without, and CI is unchanged. No describe is ever empty: `examples/` alone keeps each sweep's list non-empty (Vitest fails a suite with no tests).
- Neither tool nor any ROM is committed; `packages/emu/src/` gains nothing that depends on either tool.
- Known classes are per reference (`Reference.classes`, `known.js`'s `declaredClasses`). No class is widened or declared without the Model I plan's Ruling 6 evidence (a cited source, a predicate naming the exact fields, a count, a test); where our core is wrong it is fixed in `src/` with a unit test, and ZEXDOC and ZEXALL (`FUGLOY_ZEX=1`) still pass.
- The Model III harness's behaviour is unchanged: `FUGLOY_TRSJS=1`'s six sessions and its sweep count exactly what they do now.
- The thirteen Model I sessions' pinned counts change only through a `src/` fix, and the report says why.
- Determinism: every run repeats byte for byte.
- MAME traces are recorded into a temporary folder and deleted after each comparison, in a `finally`, whatever the result.
- Commit messages: one line, imperative, prefix `e7:`, no trailers of any kind.
- Keep `docs/fugloy-emu-spec.md` (§10, §11, §12), `CLAUDE.md`, `CHANGELOG.md` (`[Unreleased]`) and `packages/emu/README.md` current.

## Review Focus

1. **A program that does not work on a Model I** (a Model III build that writes port `$EC` or `$FE`, one that ends at BASIC or reboots, an Infocom interpreter without its story disk) is still compared for all 10 million instructions; "it does not run" is never a reason to skip it (Task 3).
2. **A program MAME's loader cannot take** (`loadRuns` refuses bytes below `$3C00`) is skipped against MAME with that sentence as its reason, listed in the records, never counted as passed; it still runs against xtrs (Task 3).
3. **Many MAME recordings at once**: the silence watchdog stops only a MAME that wrote nothing, never a healthy recording whose recorder was starved by another session's synchronous `compareRun` (Task 1).
4. **A divergence in the sweep** fails that program's test with `formatReport`'s report (program, step, both sides, ten instructions each) and the sweep goes on; totals are summed over the programs that passed (Task 3).
5. **Disk**: only the concurrent MAME sessions' traces (about 92 MB each) exist at once, and a comparison that throws still deletes its folder (Tasks 2–3).

---

### Task 1: The final review's four residuals

**Files:**
- Modify: `packages/emu/test/diff/mame-trace.js` (the silence watchdog, about lines 629–646, and where its interval is cleared, about line 710)
- Modify: `packages/emu/test/diff/known.js` (`block-xy`, about line 175)
- Modify: `packages/emu/scripts/mame-trace.mjs` (`lines`, about line 79)
- Modify: `docs/fugloy-emu-spec.md` (§10's "reference limitations no session meets", about line 517)
- Test: `packages/emu/test/diff/mame-trace.test.js`, `packages/emu/test/diff/compare.test.js`

**Interfaces:**
- Consumes: `recordMameTrace`'s `silenceMs` option and its fake-MAME tests (`mame-trace.test.js`, about line 316); the class shape in `known.js`; each reference's `classes`.
- Produces: nothing new; Task 3's concurrent MAME sweep relies on the watchdog fix.

- [ ] **Step 1: Write the failing tests.**
  - `mame-trace.test.js`, "a busy recorder does not take MAME for silent": the fake MAME 0.289 that writes to the trace without pause, `silenceMs: 1000`, and a 2,500 ms busy-wait inside a `setImmediate` while it records; the trace must end with the fake's own ending (as the control run without the busy-wait does), never with "MAME wrote nothing to the trace for 1 s, so the recorder stopped it". The failure is shown by the re-reviewer's probe, `/private/tmp/claude-501/-Volumes-satechi-webdev-fugloy/cb9ca9e0-1941-4ff1-a6cb-34907acaa829/scratchpad/rereview-watchdog/probe.mjs`.
  - `mame-trace.test.js`, "the watchdog ends with the stream": a stall after the trace's last record (while the recorder awaits MAME's exit) does not mark a complete trace incomplete.
  - `compare.test.js`, "block-xy holds the reference to its own rule": a repeating LDIR step whose our-side bits are PC's 13 and 11 is explained for xtrs only when xtrs's bits are the finished iteration's (Young §4.2, xtrs's `do_ldir` taking `do_ldi`'s flags: cite the line in `tools/xtrs/src/z80.c`), for trsjs only when its bits are F's before the step (`oped_b0`); a reference value that matches neither is a divergence.
  - `mame-trace.test.js`, "`lines` reads a trace that loaded a program": `pnpm mame:trace lines <file> --program <cmd>` prints its records; without `--program` it refuses with a sentence naming the option.
- [ ] **Step 2: Run them** (`pnpm --filter @fugloy/emu exec vitest run test/diff/mame-trace.test.js test/diff/compare.test.js`): the four fail as described.
- [ ] **Step 3: Implement.** The watchdog takes a tick that fires more than one interval late as a stall of the recorder itself (it restarts its count instead of stopping MAME), and its interval is cleared when the trace stream ends. `block-xy`'s predicate adds the reference-side check, chosen by the rule the reference declares (passed in with its classes, the Model I plan's Ruling 3; never by the tool's name). `lines` takes `--program <file>` and passes it to `openTrace`.
- [ ] **Step 4: Spec.** §10's list of reference limitations no session meets gains xtrs's missing prefix check: `xtrs-fugloy.patch`'s `z80_fugloy_interrupt` takes a pending interrupt after a lone DD or FD, which the Z80 does not, and the comparator no longer holds it back for xtrs, so it would show as a divergence.
- [ ] **Step 5: Run** the two test files, `pnpm --filter @fugloy/emu test`, `FUGLOY_TRSJS=1` on `test/diff/fixtures.test.js` (its six sessions' counts unchanged), and `FUGLOY_XTRS=1` on Space Warp 1's session alone (`-t "Space Warp 1"`: `block-xy` 3,148, unchanged). All pass.
- [ ] **Step 6: Commit** `e7: keep the MAME watchdog from mistaking a busy recorder for silence, hold block-xy's reference to its rule, and let mame:trace lines read a program's trace`

### Task 2: The shared Model I runners, and `pnpm diff <program> --reference mame`

**Files:**
- Create: `packages/emu/test/diff/model1-session.js`
- Modify: `packages/emu/test/diff/model1-fixtures.test.js` (imports the runners instead of defining them)
- Modify: `packages/emu/scripts/diff.mjs` (the MAME branch records a trace when given a program and no `--trace`; usage and header comment)
- Modify: `packages/emu/README.md`, `docs/fugloy-emu-spec.md` §11 (the Open sentence "recording one from the command line is not supported yet" closes), `CLAUDE.md` (the emu paragraph's `pnpm diff` clause)
- Test: `packages/emu/test/diff/mame-trace.test.js` (where `diff.mjs`'s MAME cases already live)

**Interfaces:**
- Consumes: `compareRun`, `formatReport`, `videoGate` (`compare.js`); `recordMameTrace({ instructions, matrix, load, out })`, `openTrace(path, { program })` (`mame-trace.js`); `mameTimer` (`mame-clock.js`); `loadXtrs` (`xtrs-adapter.js`); `requireRom` (`gate.js`).
- Produces, from `model1-session.js`, moved from `model1-fixtures.test.js` with their names, signatures and behaviour unchanged: `INSTRUCTIONS` (10,000,000), `CHECK_EVERY` (100,000), `LOAD_AT` (4 s of the Model I's clock), `BOOT` (ENTER at MEM SIZE?, 0.5 s, held 0.1 s), `press`, `sessionKeys`, `toLoad`, `screenOf`, `checkpoints`, `explain`, `xtrsSession(s)` and `mameSession(s)`, where `s` is the existing `Session` typedef (`{ name, program, keys, screens, known }`; the sweep passes `known: {}` and checks none). New in it: `GENERIC`, the Model III sweep's script as `press` entries: ENTER at 6 s, `1` at 9, ENTER at 12, SPACE at 14 held 1 s, LEFT at 16 held 1, RIGHT at 18 held 1, UP at 20, SPACE at 22 held 1. `mameSession` gains an optional second argument `{ instructions }` (default `INSTRUCTIONS`), which the CLI uses.

- [ ] **Step 1: Move the runners** into `model1-session.js` as they are, add `GENERIC` and `mameSession`'s option, and import them in `model1-fixtures.test.js`. Run `pnpm --filter @fugloy/emu exec vitest run test/diff/model1-fixtures.test.js` (the ours-only typing tests run wherever `roms.model1` is configured), then Sea Dragon's session against each reference alone (`FUGLOY_XTRS=1 … -t "seadrg01"`, `FUGLOY_MAME=1 … -t "seadrg01"`): the same pinned counts as before.
- [ ] **Step 2: Write the failing CLI tests** in `mame-trace.test.js`, behind `FUGLOY_MAME=1`: `pnpm diff examples/sea-dragon/seadrg01.cmd --model 1 --reference mame --instructions 200000` exits 0, its report names MAME's 40 Hz schedule and no divergence, and no trace is left in the system temporary folder; with `--keys <script.json>` (`[{ "at": <T-states after the load>, "key": "ENTER", "hold": <T-states> }]`, the format lockstep runs use) the keys arrive (Sea Dragon's ENTER at its title reaches "1 OR 2 PLAYERS?" on the reference's screen). Without the flag, a test that runs the same command with `--rom` naming a file that is not the Level II ROM exits 2 with a sentence (no MAME needed).
- [ ] **Step 3: Implement** in `diff.mjs`: with `--model 1 --reference mame`, a program and no `--trace`, record through `mameSession`'s recording path (the program loaded at `LOAD_AT`, `BOOT` then the `--keys` as matrix events, `--instructions` past the load, default 1,000,000), follow it on MAME's schedule, print the report, and remove the trace in a `finally`. Keep `--trace <file>` as it is. Update the usage lines and the header comment.
- [ ] **Step 4: Run** `pnpm --filter @fugloy/emu exec vitest run test/diff/mame-trace.test.js` with and without `FUGLOY_MAME=1`, and `pnpm typecheck`. All pass.
- [ ] **Step 5: Records**: emu README's `pnpm diff` section, spec §11's Open sentence about command-line recording (now done: say how), CLAUDE.md's `pnpm diff` clause.
- [ ] **Step 6: Commit** `e7: share the Model I runners, and let pnpm diff record a MAME trace of a program`

### Task 3: The sweep against xtrs and MAME, and the records

**Files:**
- Create: `packages/emu/test/diff/model1-sweep-xtrs.test.js`, `packages/emu/test/diff/model1-sweep-mame.test.js`
- Modify, only as the sweep finds: `packages/emu/src/**` (a core fix, with a unit test), `packages/emu/test/diff/known.js` (a declared class, with Ruling 6's evidence)
- Modify: `docs/fugloy-emu-spec.md` (§10; §11 row 7's Model I part; §12 if an item opens or narrows), `CHANGELOG.md`, `packages/emu/README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: Task 2's `model1-session.js` (`GENERIC`, `xtrsSession`, `mameSession`, `INSTRUCTIONS`); `configuredFixtures` (`test/rom.js`); `xtrsSkip`, `mameSkip` (`gate.js`); the sessions' Level II 1.3 gate (`model1-fixtures.test.js`'s `sessionSkip`, moved into `model1-session.js` if both need it).
- Produces: the records.

- [ ] **Step 1: Write the two sweep files.** The list: every `.cmd` or `.iii` in `examples/` (recursive, sorted) but the four session builds (`eliminator/elimin8a.cmd`, `eliminator/elimin8c.cmd`, `sea-dragon/seadrg01.cmd`, `rear-guard/reargrd5.cmd`), then `configuredFixtures(/\.cmd$/i)` but the nine session programs (by file name: `spcwarp1.cmd`, `spcwarp3.cmd`, `asylum16.cmd`, `asylum32.cmd`, `crzpnt01.cmd`, `dthmz5k1.cmd`, `pirate.cmd`, `volcano.cmd`, `supnov3a.cmd`), listed whether or not the sweep runs. Each program is one test: `xtrsSession({ name, program, keys: GENERIC, screens: [], known: {} })` (or `mameSession`), then `expect(explain(result)).toBe('')` and the full count (xtrs: `result.instructions === INSTRUCTIONS`; MAME: the header complete and verified, `requested − load.at === INSTRUCTIONS`, `result.ended` undefined). Each logs `sweep <name>: <known as JSON>, <n> interrupts taken` (count the maskable interrupt responses our machine took), and an `afterAll` logs the totals over the programs that passed and how many took an interrupt. Against MAME, a program `loadRuns` refuses is an `it.skip` whose title carries the refusal's sentence. Gates: `describe.skipIf(!SWEEP)` with `SWEEP = xtrsSkip === null && sessionSkip === null && process.env.FUGLOY_XTRS_SWEEP === '1'` (MAME: `mameSkip`, `FUGLOY_MAME_SWEEP`); the MAME describe is `concurrent`, as the sessions' is; timeouts as the sessions'.
- [ ] **Step 2: Run** `pnpm --filter @fugloy/emu test` with the flags off: both files list their programs and skip, nothing fails.
- [ ] **Step 3: Run both sweeps**, at the same time if you like: `FUGLOY_XTRS=1 FUGLOY_XTRS_SWEEP=1 pnpm --filter @fugloy/emu exec vitest run test/diff/model1-sweep-xtrs.test.js --silent=false` (about 2 hours: 50 programs at about 2.3 minutes) and `FUGLOY_MAME=1 FUGLOY_MAME_SWEEP=1 … model1-sweep-mame.test.js --silent=false` (about half an hour). Run them in the background and keep the logs; the totals come from them.
- [ ] **Step 4: Settle each divergence** by Ruling 6: read both references' sources and the Z80 literature (Banks's Z80Decoder wiki, Young, UM0080) and either fix our core in `src/` with a unit test — then rerun ZEXDOC and ZEXALL, `pnpm test`, the thirteen sessions against the affected reference, and the trsjs sessions — or declare a class for the reference that is wrong, with its evidence and a test. Rerun the program alone (`-t`) until it passes. A divergence with no supportable explanation is recorded as **Open** in §11 and the report, never hidden.
- [ ] **Step 5: Records.** §11 row 7's Model I part: the sweep (programs per reference, the totals per class, how many took an interrupt and whether that narrows §12's interrupt-driven-session item, the programs MAME could not load and why, the time), and §10 if a class was added; `CHANGELOG.md` `[Unreleased]` (Added: the sweep; Fixed: any core fix); the emu README's harness section; `CLAUDE.md`'s emu paragraph (one clause on the sweep).
- [ ] **Step 6: Run** `pnpm typecheck` and `pnpm test` (flags off), then **commit** `e7: sweep every other Model I program against xtrs and MAME, and record it`

### Task 4: The Model I HALT's consequences outside emu, and Programs to try's Model I Eliminator

Added during execution (2026-10-23, controller's ruling; the ledger records why): Task 3 found that a Model I answers a HALT with an NMI (Handbook Figure 29: HALT* drives the reset switch's NMI) and fixed `@fugloy/emu`, which the web workbench and `@fugloy/mcp` run; and that the workbench's Programs to try runs Eliminator's `elimin8d.cmd` on Fugløy's Model I (48K, with the Expansion Interface), where it never draws its title. Both reach users when this branch merges (app.fugloy.dev deploys from `main`), so they are fixed here.

**Files:**
- Modify: `apps/web/app/utils/emulator/runner.ts` (the stub-ROM run on the Model I stops at a program's HALT; the trap's advice per model)
- Modify: `apps/web/app/utils/emulator/stepping.ts` (`HALTED_INTERRUPTS_OFF`, `HALTED_WAITING` and `stuck` per model) and `apps/web/app/composables/useDebug.ts` (about line 473, where `HALTED_WAITING` is added)
- Modify: `apps/web/app/data/examples.ts` (a `tryBuild` for Eliminator) and `apps/web/app/composables/useRun.ts` (`runExample` fetches `tryBuild ?? mainBuild`)
- Modify: `packages/mcp/src/execute.js` (about line 225, `stopped: halt`) and `packages/mcp/src/tools/step.js` (about line 29)
- Modify: `CHANGELOG.md` (`[Unreleased]`), and any README or spec sentence that says a HALT waits for an interrupt on every model
- Test: `apps/web/test/` (the runner's stub trap tests, `stepping.test.ts`, `debug.test.ts`, `run-machine.test.ts`), `packages/mcp/test/phase-a.test.js`

**Interfaces:**
- Consumes: Task 3's core behaviour: on a Model I a halted CPU takes an NMI at the next instruction boundary (PC `$0066`, HALT+1 pushed); `m.run({ until: 'halt' })` stops when the CPU halts, before that NMI; `m.model`.
- Produces: `ExampleInfo.tryBuild?: string` (the build Programs to try runs; `mainBuild` stays the workbench's).

- [ ] **Step 1: Write the failing tests.**
  - Runner, Model I, stub ROM: a program `ORG 5200H / DI / LD A,1 / HALT` run for one frame stops at its HALT with a sentence naming the HALT's line and saying that a Model I answers a HALT with a reset to BASIC (its HALT line drives the reset switch's NMI), which needs a ROM, and none is loaded; PC is not inside the ROM, SP is where the program left it (no NMI was taken), and the trap's "inside the Model I ROM" sentence is never given. The same program on the Model III stops as it does today (its existing tests unchanged).
  - Runner, Model I, the user's ROM (or a synthetic ROM whose `$0066` is a known loop, as the existing runner tests build ROMs): the same program takes the NMI to `$0066` and is not stopped.
  - The trap's advice for a RET to the stub's return address ends "…such as WAIT: JR WAIT." on the Model I and keeps "…, or with HALT." on the Model III.
  - `stepping.test.ts`: on a Model I, a halted CPU is never `stuck` (stepping takes the NMI), and neither `HALTED_INTERRUPTS_OFF` nor `HALTED_WAITING` is returned; the Model III cases unchanged.
  - `run-machine.test.ts`: `runExample('eliminator')` fetches `/examples/eliminator/elimin8a.cmd` and runs it on the Model I; the workbench's Eliminator example still opens `elimin8d.cmd`.
  - `phase-a.test.js`: on a Model I session, `run { until: 'halt' }` stops with a sentence saying the HALT raises an NMI at the next instruction (to `$0066`, the ROM's reset); the Model III sentence stays `stopped: halt (the CPU ran HALT and waits for an interrupt)`.
- [ ] **Step 2: Run them**: they fail for those reasons.
- [ ] **Step 3: Implement.** In the runner, a stub-ROM run on the Model I stops at a program's HALT (for example, its slices run with `until: 'halt'` on that model) and reports it with the sentence; the user's ROM and the other models are untouched. `stepping.ts` and `useDebug.ts` take the model into account. `examples.ts` gives Eliminator `tryBuild: 'elimin8a.cmd'`, with a comment saying why: `elimin8d` runs `RST 38H` into the Level II ROM's `EI / RET` at `$4012`, after which the 40 Hz is taken in IM 0 after every return and the latch at `$37E0` is never read, so on Fugløy's Model I (48K, with the Expansion Interface) it never draws its title (emu spec §11's sweep, where it stands Open: neither reference can follow those interrupts); `elimin8a`, the Model I cassette build, reaches its title and plays (`model1-programs.test.js`, the Model I sessions). Check that `elimin8a.cmd` is served under `/examples/eliminator/`. The MCP sentences take the machine's model.
- [ ] **Step 4: Run** the web unit tests (`pnpm test:web`), `pnpm --filter @fugloy/web typecheck`, `pnpm --filter @fugloy/web size:first-screen` (under its 252,775-byte budget) and `check:prefetch`, the MCP tests (`pnpm --filter @fugloy/mcp test`), and `pnpm test`. All pass.
- [ ] **Step 5: Records**: `CHANGELOG.md` `[Unreleased]` (Fixed: Programs to try's Model I Eliminator; Changed: a Model I HALT stops a stub-ROM run with its sentence, and the workbench and MCP say what a Model I HALT does), and any README or spec sentence found saying a HALT waits for an interrupt on every model.
- [ ] **Step 6: Commit** `e7: stop a Model I stub run at its HALT, say what a Model I HALT does, and run Eliminator's cassette build in Programs to try`
