# Emu Phase 7, the Model I half (Differential Harness against MAME and xtrs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compare `@fugloy/emu`'s Model I, instruction by instruction, against two independent Model I references, xtrs and MAME, and report the first divergence no documented class explains — zero unexplained divergence on the Model I sessions, as the Model III already has against trsjs (emu spec §10 Differential row, §11 phase 7).

**Architecture:** The Model III harness (`packages/emu/test/diff/`, plan `docs/superpowers/plans/2026-10-18-emu-phase7-differential.md`) drives an in-process reference through a `Reference` interface (`step`, `regs`, `writes`, `syncFrom`, `setKeyBit`, …) and a lockstep comparator (`compareRun`) with known classes (`known.js`). The Model I half adds two out-of-process references behind the same interface. **xtrs** (open source C) is built locally from a pinned commit with a small instrumentation patch that turns it into a headless stepping server over a pipe (step, read registers and writes, poke state, set a key bit), so it supports full lockstep and `syncFrom` like trsjs. **MAME** (`trs80l2` driver) is run headless with a Lua script that logs every instruction (registers, T-state count, memory writes, interrupts, keyboard reads) to a trace file; a `TraceReference` replays that file through the same interface, and our machine is driven to follow it (the reference's keyboard bytes and interrupt boundaries, Ruling 4). Nothing either tool needs is committed; both are fetched or built on demand into the gitignored `tools/`, pinned, opt-in, like zmac, ZEX and trsjs.

**Tech Stack:** plain JavaScript ESM, Node ≥ 22 (`node:child_process`), Vitest; C (xtrs, built with the system compiler); MAME 0.289 (Homebrew) with its Lua engine.

**Spec:** `docs/fugloy-emu-spec.md` §10 (Differential row), §11 row 7, §12 (the open "Model I differential run" item: the `$37E0` latch, port `$FF`, the bit-6 video gate, the 20 cps keyboard question), §13 story 5.

## Global Constraints

- The user approved both references on 2026-10-19 ("can I do both mame and xtrs?" — yes). Installing them is still a change to the user's machine: the execution session asks once before the first `brew install mame` and before the first xtrs build, and records the answer.
- Neither tool, nor any ROM, is committed, bundled or redistributed. `pnpm xtrs:install` and `pnpm mame:install` put them under `tools/xtrs/` and `tools/mame/` (gitignored), pinned (xtrs: a git commit SHA and the patched source's SHA-256; MAME: the Homebrew version and the binary's `-version` string), and refuse anything else with a sentence naming the command. Our instrumentation patch is committed only if xtrs's licence allows distributing modifications; otherwise the install script applies the edits itself (Task 1 decides and records which).
- Tests that need a reference run only with `FUGLOY_XTRS=1` or `FUGLOY_MAME=1` and skip without; CI is unchanged.
- The ROM is the user's `roms.model1` (`fixtures/real/level2-model1.rom`, Level II 1.2 or 1.3 as `models.js` recognises); MAME's ROM set is assembled from it locally into `tools/mame/roms/trs80l2/` with the file names and CRCs the driver expects, or the run refuses with a sentence.
- The harness stays test and tooling code (`packages/emu/test/diff/`, `packages/emu/scripts/`, root `scripts/`); `packages/emu/src/` gains nothing that depends on either tool.
- The Model III harness and its tests are unchanged in behaviour (`FUGLOY_TRSJS=1` still passes).
- Determinism: every run repeats byte for byte (MAME with `-nothrottle`, no sound, no video, fixed RAM fill).
- Commit messages: imperative, one line, prefix `e7:`, no AI co-author trailer.
- Keep `docs/fugloy-emu-spec.md` (§10, §11, §12), `CLAUDE.md`, `CHANGELOG.md` and the emu README current.

## Rulings made while planning

1. **Feasibility first (Task 1).** Neither tool has been run here. Task 1 is a spike with a written result: each tool built or installed, booting the Model I ROM headless to `MEMORY SIZE?`, with a per-instruction record of PC, registers and T-states for the first 100,000 instructions. If neither can be made to do that, the execution stops and asks the user; if one can, the plan continues with it and records the other as open.
2. **xtrs is the lockstep reference, MAME the trace reference.** xtrs can be patched to step on command, so it gets `syncFrom` and keys at exact T-states, as trsjs does. MAME's debugger and Lua engine can log every instruction but are awkward to drive one step at a time from Node, so it is compared from a recorded trace. Task 1 may swap or merge these if the spike shows otherwise (record why).
3. **The interface is the Model III's.** Both new references implement `Reference` from `test/diff/trsjs-adapter.js` (moved to `test/diff/reference.js` as a shared typedef), so `compareRun`, `known.js` and the report are reused. Model I differences in the comparator are passed in, not branched on a tool's name.
4. **Following a trace.** With MAME there is no `syncFrom`: both machines start from power-on with the same RAM fill (Task 1 measures MAME's; our Model I is filled to match for the run). Our machine takes its interrupts at the instruction boundaries the trace records, and its keyboard matrix returns, at each read of `$3800`–`$38FF`, the byte the trace recorded — so input and interrupt timing come from the reference. Every other field is compared as in lockstep. A divergence in when an interrupt was requested (the 40 Hz timer's T-state) is reported as its own field, `irqTime`, never excused.
5. **The Model I's devices in the comparison** (§12's list): the interrupt latch at `$37E0` (timer and disk bits, read-to-clear) is synced and compared after every read of it; port `$FF` is the Model I's mode and cassette port; video RAM is compared through the bit-6 gate (no lowercase: a stored byte reads `b & 0xBF` when bit 5 or 7 is set, else `b | 0x40`), so the gate is not reported as a divergence. With the lowercase option the gate is off on both.
6. **Known classes are found, not assumed.** Each class a reference needs (as trsjs needed flag bits 3/5 and five more) is added to `known.js` only with its evidence (ZEXALL, Young's "The Undocumented Z80 Documented", Zilog UM0080, the reference's source line), a predicate naming the exact fields, a count in the report, and a test. A class that explains a difference between the two references and us must say which side is right; where our core is wrong, it is fixed in `src/` with a test (as phase 7 found R while halted and port `FF` bits 5–1).
7. **Sessions.** The Model I programs that reach their titles in `model1-programs.test.js` — the four in `examples/` (Eliminator `elimin8a`, `elimin8c`; Sea Dragon `seadrg01`; Rear Guard `reargrd5`) and, where present, the eight in `fixtures/real/` and Super Nova — each for 10 million instructions with a scripted session past the title, against each available reference. `examples/` sessions are the required set; `fixtures/real/` ones skip when absent.

## Review Focus

1. **A missing, tampered or wrong-version tool, or a ROM MAME does not accept**, refuses with a sentence naming the install command and what was expected (Task 2 for xtrs, Task 3 for MAME).
2. **A planted bug in our Model I path** (a test-only patch to the `$37E0` latch's read-to-clear, or to the bit-6 gate) is caught at the right instruction against each reference — the harness can fail on Model I devices, not only on the CPU (Task 4).
3. **A trace that ends early or is truncated** (MAME exits, disk full) is reported as such, never as "no divergence" (Task 3).
4. **Typing at 20 characters a second under Level II** — §5's dropped-key question — is run against both references; the result (both drop keys too, or only we do) is recorded with the cause, and fixed in `src/` if it is ours (Task 5).
5. **Speed**: a 10-million-instruction session finishes in minutes, not hours, on each reference; report the rate (Tasks 2–3), and fail clearly rather than hang if a reference stops responding (a step timeout in the xtrs pipe).

---

### Task 1: Spike — build xtrs, install MAME, boot the Model I ROM headless with a per-instruction record

**Files:**
- Create: `docs/superpowers/notes/2026-10-19-model1-references-spike.md` (the result, committed); scratch code stays in the gitignored `tools/` or the scratchpad.

**Interfaces:**
- Produces, in the note: for each tool — the pinned version (xtrs commit SHA from its canonical repository, which the spike identifies; MAME `0.289`), the exact build or install commands, how it runs headless (no display; xtrs with a null video driver or `SDL_VIDEODRIVER=dummy` if the SDL port is used), the licence and whether a patch may be committed, MAME's `trs80l2` ROM file names and CRCs and whether `level2-model1.rom` splits into them, each tool's RAM fill at power-on, how T-states are counted (cumulative or per instruction), how memory writes and keyboard reads can be logged, the measured instructions per second, and the first 1,000 instructions' agreement with our Model I (PC and T-states) after the obvious syncing. Ends with a recommendation that confirms or revises Rulings 2 and 4.

- [ ] **Step 1:** Ask the user before installing (Global Constraints); record the answer in the note.
- [ ] **Step 2:** xtrs: clone the canonical repository at a fixed commit into `tools/xtrs/src`, build headless, boot the ROM to `MEMORY SIZE?`, and get a per-instruction register dump (a debugger trace mode if xtrs has one, else a minimal print in its Z80 step loop).
- [ ] **Step 3:** MAME: install with Homebrew (or confirm the installed version), assemble the ROM set from the user's ROM, run `trs80l2` with `-video none -sound none -nothrottle` and a Lua script that logs each instruction's PC, registers and total cycles, booting to `MEMORY SIZE?`.
- [ ] **Step 4:** Compare the first 1,000 instructions of each against our Model I by a scratch script; write the note.
- [ ] **Step 5:** Commit `e7: record the Model I reference spike`.

### Task 2: xtrs as a lockstep reference

**Files:**
- Create: `scripts/install-xtrs.sh` (root; `xtrs:install` in package.json), `packages/emu/test/diff/xtrs-adapter.js`, `packages/emu/test/diff/xtrs-adapter.test.js`, `packages/emu/test/diff/reference.js` (the shared `Reference`, `Write` typedefs moved from `trsjs-adapter.js`, which re-exports them)
- Modify: `packages/emu/test/diff/gate.js` (`XTRS_ON`, `xtrsSkip`, `requireRom(model)`)

**Interfaces:**
- Produces: `loadXtrs({ path, rom }) → Reference` over a child process speaking a line protocol on stdin/stdout (`step`, `regs`, `writes`, `poke <addr> <hex>`, `setregs …`, `key <row> <bit> <0|1>`, `latch <byte>`, `quit`), every reply within `XTRS_STEP_TIMEOUT_MS = 5000` or the adapter throws `'xtrs stopped answering after <n> instructions. Run it again; if it repeats, rebuild with pnpm xtrs:install.'`. `syncFrom(machine)` carries RAM, video RAM, registers, IFF/IM, the `$37E0` latch and the timer phase (Ruling 5).
- The patch adds only the server loop and the hooks it needs (a write log, a step entry, a key and latch setter); no change to xtrs's emulation.

- [ ] **Step 1: Write the failing tests:** refuses a missing binary or a source tree whose hash differs (Review Focus 1); boots the ROM 100,000 instructions in lockstep with our Model I, PC and T-states equal at every step with only the classes Task 1 named; `syncFrom` then one step equals our step; a reference that stops answering throws the sentence within the timeout (Review Focus 5, via a fake child).
- [ ] **Step 2: Run** `FUGLOY_XTRS=1 pnpm vitest run packages/emu/test/diff/xtrs-adapter.test.js` — expect FAIL.
- [ ] **Step 3: Implement** the install script (clone at the pinned commit, apply the instrumentation, build, check the hash), the adapter and the gate.
- [ ] **Step 4: Run** the adapter tests — expect PASS; `pnpm --filter @fugloy/emu test` without the flag skips them and stays green; `FUGLOY_TRSJS=1` diff tests still pass.
- [ ] **Step 5: Commit** `e7: build xtrs on demand and drive its Model I in lockstep`

### Task 3: MAME as a trace reference

**Files:**
- Create: `scripts/install-mame.sh` (`mame:install`: checks the version, assembles `tools/mame/roms/trs80l2/` from the user's ROM), `packages/emu/scripts/mame-trace.lua`, `packages/emu/test/diff/mame-trace.js` (`recordMameTrace`, `TraceReference`), `packages/emu/test/diff/mame-trace.test.js`
- Modify: `packages/emu/test/diff/gate.js` (`MAME_ON`, `mameSkip`)

**Interfaces:**
- Produces: `recordMameTrace({ instructions, keys, out }) → Promise<{ path, instructions }>` (runs MAME with the Lua script; the trace is a compact binary or line format the note fixes, one record per instruction: PC, registers, total cycles, writes, interrupt taken, keyboard bytes read); `openTrace(path) → TraceReference implements Reference` (no `syncFrom`: Ruling 4), with `follow` data the comparator uses to drive our machine (`irqAt(index)`, `keyRead(index, addr)`).
- A trace shorter than asked ends the comparison with `'MAME's trace ends after <n> of <N> instructions (<reason>), so the run proves nothing past that point.'` (Review Focus 3).
- Modify `compare.js` minimally so a reference may supply `follow` (the interrupts and keyboard bytes our machine takes from it) instead of `syncFrom`; the trsjs path is unchanged.

- [ ] **Step 1: Write the failing tests:** refuses a wrong MAME version or a ROM whose CRCs do not match the driver's (Review Focus 1); a recorded boot of 100,000 instructions replays against our Model I with only Task 1's classes; a truncated trace reports the sentence and a non-zero exit from the CLI (Review Focus 3); keyboard bytes from the trace reach our matrix at the recorded reads.
- [ ] **Step 2: Run** with `FUGLOY_MAME=1` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expect PASS; the trsjs and xtrs tests unchanged.
- [ ] **Step 5: Commit** `e7: record MAME's Model I as a trace and compare against it`

### Task 4: The Model I's devices in the comparison, and the CLI

**Files:**
- Modify: `packages/emu/test/diff/compare.js` (Model I device comparison passed in: the `$37E0` latch after each read, port `$FF`, video RAM through the bit-6 gate unless lowercase), `packages/emu/test/diff/known.js` (each class found, with evidence: Ruling 6), `packages/emu/scripts/diff.mjs` (`--model 1`, `--reference xtrs|mame|trsjs`)
- Test: `packages/emu/test/diff/compare.test.js` (Model I cases), `packages/emu/test/diff/model1-devices.test.js`

**Interfaces:**
- Produces: `compareRun({ …, model: 1 | 3, lowercase?: boolean })`; the report names the reference and model.
- Planted bugs (Review Focus 2): test-only patches making `$37E0` not clear on read, and the bit-6 gate inverted, each caught at the first instruction it matters, against each available reference.

- [ ] **Step 1: Write the failing tests** (above; plus: a video byte with bit 5 set compares equal through the gate on both; with `lowercase: true` it compares raw).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.** Any divergence found in our `src/` is fixed there with its own unit test (Ruling 6), each as its own commit `e7: <fix>`.
- [ ] **Step 4: Run** the diff suite with each flag, and the full emu suite.
- [ ] **Step 5: Commit** `e7: compare the Model I's latch, mode port and video gate`

### Task 5: The Model I sessions, the 20 cps question, and the records

**Files:**
- Create: `packages/emu/test/diff/model1-fixtures.test.js` (Ruling 7's sessions, each reference behind its flag)
- Modify: `docs/fugloy-emu-spec.md` (§10's row: met or not for the Model I, with each reference's class counts; §11 phase 7; §12's Model I item closed with what was found; §5 on the keyboard), `CHANGELOG.md`, `CLAUDE.md`, `packages/emu/README.md`

**Interfaces:**
- Consumes: Tasks 2–4.
- The 20 cps run (Review Focus 4): Level II's line editor typed `PRINT 1` at 20 characters a second through the matrix, on each reference and on ours; record whether each drops keys and why (the ROM's debounce against the matrix timing), and fix ours if only ours drops.
- Also settle §11's open note: Eliminator `elimin8c` and Rear Guard `reargrd5` on the Model I take the 1 at "1 or 2 Players?" (their DCB points at the Model I keyboard driver); a session plays past it.

- [ ] **Step 1: Write** the session tests; run each reference over the required set; add known classes or fix `src/` as found (Ruling 6).
- [ ] **Step 2: Run** the 20 cps experiment and record it.
- [ ] **Step 3: Write** the records with the counts and speeds.
- [ ] **Step 4: Run** `pnpm typecheck`, `pnpm test` (the flags off: everything new skips), and each flag's diff suite — all pass.
- [ ] **Step 5: Commit** `e7: run the Model I sessions against xtrs and MAME, and record phase 7`
