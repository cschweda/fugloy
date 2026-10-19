# Phase 5D: the TRS-80 on screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run ▶ looks and acts like a TRS-80: the real character generator glyphs on a black tube, a machine that powers on to `Cass?` and waits for the user, typing straight to it, Programs to try, and the debugger tucked into a disclosure.

**Architecture:** The glyph table is regenerated from xtrs's `trs_chars.c`; the renderer picks a set per model and gains the Model III/4 alternate set through a new `m.video.altCharset`. The runner gains a programless mode, and `useRun` gains a machine session (power on, reset, run a bundled `.CMD`) beside its Run. `RunTab` is rearranged around the screen.

**Tech Stack:** Vue 3 / Nuxt 4 (static), TypeScript strict, `@fugloy/emu` (plain JS), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-19-phase5d-real-machine-design.md`

## Global Constraints

- xtrs pinned at commit `3a2180c063811a715faa28d39a94739c33e0abd0`, file `trs_chars.c`; its licence notice is kept verbatim in the generated file and `NOTICE.md`.
- `glyphs.generated.ts` is written only by `scripts/build-glyphs.ts`, never hand-edited.
- Sets: Model I CG 1 (6×12), Model I lowercase CG 2 (6×12), Model III CG 4 (8×12), Model 4 CG 8 (8×12; first 10 rows at 80×24).
- Tube colours: background `#000000`, phosphor `#f2f2f2`.
- ROM bytes are never bundled, fetched, or committed.
- Everything new loads in the lazy Run chunk; `pnpm --filter @fugloy/web size:first-screen` stays within its 252,775 B budget, and `check:prefetch` passes.
- emu stays plain JavaScript ESM with no DOM; web code imports emu only through `app/utils/emulator/`.
- Commit messages: `p5: …`, imperative, one line, no AI trailer.
- NVDA/VoiceOver hand checks are not part of this phase; axe checks stay.

## Review Focus

1. Power-on with a ROM that is not a TRS-80 ROM (any bytes the user added): the screen shows whatever it shows and Power/Reset/Stop still work; nothing hangs the page (no synchronous boot loop on the live path). Test in Task 3.
2. Switching the model while the machine is on: the old machine stops and the new model powers on; with no ROM for the new one, the no-ROM notice shows. Test in Task 4.
3. Run ▶ pressed while the machine is on, and Power pressed while a program runs: each replaces the other cleanly (one runner, the old one stopped). Test in Task 3.
4. Keys typed to the screen while the machine is off or booting: they go nowhere and throw nothing. Test in Task 4 (e2e, no ROM).
5. A Program to try with no ROM for its model: a sentence, no runner. Test in Task 3.

---

### Task 1: `m.video.altCharset` in emu

**Files:**
- Modify: `packages/emu/src/devices/video.js` (a getter after `inverse`)
- Modify: `packages/emu/index.d.ts` or the package's type declarations for `Video` (wherever `inverse` is declared)
- Test: `packages/emu/test/video-altcharset.test.js`
- Modify: `packages/emu/CHANGELOG.md` (Unreleased), `docs/fugloy-emu-spec.md` (the video section listing `wide`/`inverse`)

**Interfaces:**
- Produces: `m.video.altCharset: boolean` — true on the Model III and 4 when port `$EC` bit 3 (ENALTSET) is set in the mode register; always false on the Model I.

- [ ] **Step 1: Write the failing test** `video-altcharset.test.js`: on a synthetic-ROM Model III (the suite's existing synthetic ROM helper), `m.video.altCharset` is false; after `OUT ($EC),A` with A = `08H` (run a two-instruction program) it is true; after A = `00H` false again. On a Model I, an `OUT ($EC),08H` leaves it false.
- [ ] **Step 2: Run** `pnpm --filter @fugloy/emu exec vitest run test/video-altcharset.test.js` — expect FAIL (`undefined`).
- [ ] **Step 3: Implement** the getter: `(this.#system.io.modeRegister & 0x08) !== 0` when the model is not the Model I; add a named `MODE_ALTSET_BIT = 0x08` beside `MODE_32COL_BIT` in `io.js` and use it. Doc comment cites the mode register's ENALTSET (io.js already names it).
- [ ] **Step 4: Run** the test and `pnpm --filter @fugloy/emu test` — expect PASS.
- [ ] **Step 5: Commit** `p5: add m.video.altCharset, the Model III's alternate character set`

### Task 2: The character generators, from xtrs, on a black tube

**Files:**
- Rewrite: `apps/web/scripts/build-glyphs.ts`
- Regenerate: `apps/web/app/utils/emulator/glyphs.generated.ts`
- Rewrite: `apps/web/test/glyphs.test.ts`
- Modify: `NOTICE.md` (xtrs notice), `CLAUDE.md` (the `apps/web` bullet's glyph sentence)

**Interfaces:**
- Produces, from `glyphs.generated.ts`:
  - `export interface GlyphSet { width: 6 | 8; height: 12; rows: Uint8Array /* 256 × 12 bytes, leftmost pixel in bit (width-1)… see below */ }`
  - `export const CG_MODEL1: GlyphSet; CG_MODEL1_LOWERCASE: GlyphSet; CG_MODEL3: GlyphSet; CG_MODEL4: GlyphSet;`
  - `export const GLYPH_SOURCE: { url: string; sha256: string; commit: string; sets: Record<string, number> }`
  - Rows are stored normalised so **bit 7 is the leftmost pixel** for both widths (xtrs's bytes have the leftmost pixel in bit 0 for the 8-wide sets and in bit 0 of a 6-wide field for the Model I sets; the converter reverses and left-aligns them). Entries the source has fewer than 256 of (the Model I sets cover 128) are zero.
- Exported from the script for the test: `parseTrsChars(text: string): number[][][]` (charset → char → 12 row bytes as in the file) and `toGlyphSet(raw: number[][], width: 6 | 8): GlyphSet`.

- [ ] **Step 1: Write the failing tests** in `glyphs.test.ts`:
  - `parseTrsChars` on a two-charset snippet in the file's syntax (`{ { 0x00,… }, … }`, with `/* */` comments) returns two charsets with the right bytes.
  - `toGlyphSet` reverses bits: an 8-wide row `0x01` becomes `0x80`; a 6-wide row `0x01` becomes `0x80`, and `0x20` becomes `0x04`.
  - The generated table: `CG_MODEL3.width === 8`, `CG_MODEL1.width === 6`, each `rows.length === 256 * 12`; `GLYPH_SOURCE.commit === '3a2180c063811a715faa28d39a94739c33e0abd0'`; `GLYPH_SOURCE.sets` is `{ model1: 1, model1Lowercase: 2, model3: 4, model4: 8 }`.
  - Shape checks that pin the right sets: in `CG_MODEL3`, `'A'` (`41H`) is non-empty and its row 0 is non-zero (Model III letters start at the cell's top); `CG_MODEL1` `'A'` is non-empty; `CG_MODEL1` has no pixels at `80H`–`FFH`; `CG_MODEL3` `C0H` is non-empty (katakana).
- [ ] **Step 2: Run** `pnpm --filter @fugloy/web exec vitest run test/glyphs.test.ts` — expect FAIL.
- [ ] **Step 3: Implement the converter.** Usage line in its header: `curl -fLO https://raw.githubusercontent.com/TimothyPMann/xtrs/<COMMIT>/trs_chars.c` then `pnpm --filter @fugloy/web exec tsx scripts/build-glyphs.ts <dir>`. It checks the file's SHA-256 against the constant it records (compute it once from the pinned file and write it into the script), refuses a file without the `Copyright (c) 1996-2020, Timothy P. Mann` notice, and writes the four sets plus the notice (as a comment) and `GLYPH_SOURCE`. The X.Org code and constants go.
- [ ] **Step 4: Fetch the pinned file to the scratchpad and run the converter**; confirm `git diff --stat` shows only the generated file and the script.
- [ ] **Step 5: Run** the glyph tests — expect PASS. Do not commit yet: `screen.ts` still imports the X.Org tables; Steps 7–12 below finish the task.
- [ ] **Step 6: Update** `NOTICE.md` (xtrs's licence text, which file, what it is used for) and `CLAUDE.md`'s `apps/web` bullet: "The screen's glyphs come from xtrs's `trs_chars.c` (the TRS-80 character generators; `scripts/build-glyphs.ts` writes `glyphs.generated.ts`, never hand-edited)."

**The renderer per model, and the tube (same task)**

**Files (continued):**
- Modify: `apps/web/app/utils/emulator/screen.ts`
- Rewrite affected cases: `apps/web/test/screen.test.ts`
- Modify: `apps/web/app/components/run/TrsScreen.vue` (colours and sizing only; layout changes are Task 5)

**Interfaces:**
- Consumes: Task 1's `m.video.altCharset`.
- Produces:
  - `ScreenView` gains `font: 'model1' | 'model1-lowercase' | 'model3' | 'model4'` and `altCharset: boolean`.
  - `screenView(m: Machine): ScreenView` — `font` from `m.model` and, on the Model I, `m.system.lowercase`.
  - `screenSize(view): { width; height }` — cell width 6 (Model I) or 8 (III/4); 64 cells across (80 when wide); height 12 per row (10 when wide).
  - `SCREEN_FG = [0xf2,0xf2,0xf2,0xff]`, `SCREEN_BG = [0,0,0,0xff]`.
  - `renderScreen(raw, view, out, width)` keeps its signature and its unchanged-screen shortcut (the key now includes `font` and `altCharset`).
  - `renderNotice(lines: readonly string[], view: ScreenView, out: Uint8ClampedArray, width: number): void` — draws text lines (uppercase ASCII) into the buffer as video RAM would show them, for the no-ROM notice (Task 5).

- [ ] **Step 7: Write the failing renderer tests** (replace the old glyph-specific expectations):
  - sizes: Model I 384×192; Model III 512×192; Model 4 64×16 512×192 and 80×24 640×240.
  - `'A'` on the Model III is drawn from `CG_MODEL3` (pixel-exact over its 8×12 cell); on the Model I from `CG_MODEL1` (6×12); on a Model I with lowercase, `'a'` (`61H`) from `CG_MODEL1_LOWERCASE`.
  - `00H`–`1FH` fold to `40H`–`5FH` (unchanged rule).
  - `7FH` draws the generator's glyph (no hollow box): pixel-exact against the set.
  - `BFH` fills its cell and `81H` lights the top-left block only, at 8 wide (left block columns 0–3) and at 6 wide (columns 0–2).
  - `C0H` on the Model III: the block of its low six bits with `altCharset` false; `CG_MODEL3`'s glyph `C0H` with it true. On the Model I always the block.
  - 32-column mode doubles cells (unchanged rule, at the new widths); 80×24 inverse video (unchanged rule, 8×10 cells from `CG_MODEL4`'s first 10 rows).
  - `renderNotice(['NO ROM'], …)` lights exactly the pixels `'N','O',' ','R','O','M'` would in row 0.
- [ ] **Step 8: Run** `pnpm --filter @fugloy/web exec vitest run test/screen.test.ts` — expect FAIL.
- [ ] **Step 9: Implement** in `screen.ts`; update its header comment (the glyph source, the per-model sets, the alternate set). Keep the 2×3 band rows (`[0,4,8,12]` at 12 high, `[0,3,7,10]` at 10); block columns are the cell's halves.
- [ ] **Step 10: Update `TrsScreen.vue`**: the canvas default size and the blank-tube fill follow `screenSize`/`SCREEN_BG`; the frame background `#000`, no radius, a 1px `#222` border. The displayed size: the largest width that fits the host where width = k × (raster width ÷ 2) for whole k when it fits at least 1×, else 100%; height from 4:3. (A `ResizeObserver` on the host sets a CSS width.)
- [ ] **Step 11: Run** `pnpm test:web` — expect PASS; fix any other test that pinned 384×192 for a Model III (`emulator-runtime.test.ts`, `e2e/run.spec.ts` canvas checks) to the new sizes.
- [ ] **Step 12: Commit** `p5: draw the TRS-80's own character generators on a black tube`

### Task 3: The machine session: a programless runner, power, reset, programs to try

**Files:**
- Modify: `apps/web/app/utils/emulator/runner.ts` (`result: AsmResult | null`)
- Modify: `apps/web/app/utils/emulator/boot.ts` (`powerOnMachine`, `prepareMachine` without `result` when `cmd` is given)
- Modify: `apps/web/app/utils/emulator/kit.ts` (export the new functions)
- Modify: `apps/web/app/composables/useRun.ts`
- Test: `apps/web/test/run-machine.test.ts` (new), plus `test/emulator-run.test.ts` for the runner

**Interfaces:**
- Consumes: the existing `RunKit`, `Roms`, `createRunner`.
- Produces:
  - `RunnerOptions.result: AsmResult | null` — null is a programless runner: `stub` must be false (throw a plain Error otherwise), no trap checks; `Runner.result` is null.
  - `powerOnMachine(model: Model, rom: Uint8Array): Machine` — a fresh `Machine({ model, roms: { level2: rom } })`, nothing run, nothing typed.
  - `prepareMachine(opts: { model; rom; result?: AsmResult; cmd?: Uint8Array; before? })` — requires `result` or `cmd`.
  - On `Run` (useRun):
    - `power: ComputedRef<'off' | 'on' | 'program'>` — `'on'` while a programless runner is running or paused, `'program'` while a Run's or a Program to try's runner is, else `'off'`.
    - `powerOn(): Promise<void>` — stops anything running, then boots the current source's model (or model 3 with no source) live from its stored ROM; with no ROM, says `NO_ROM_POWER(model)` (not a problem) and starts nothing.
    - `reset(): Promise<void>` — the same as `powerOn()` for the machine's model.
    - `powerOff(): void` — the same as `stop()`.
    - `runExample(id: ExampleId): Promise<void>` — fetches `/examples/<id>/<mainBuild>`, needs the example's model's ROM (else says `EXAMPLE_NEEDS_ROM(title, model)` as a problem and starts nothing), loads it onto the booted snapshot with `prepareMachine({ model, rom, cmd })`, and runs it programless (no running line, no debug attach). Message: `` `${title} is running on your ${MODEL_NAMES[model]} ROM.` ``
    - `machineModel: Ref<Model | null>` — the model the current machine (any kind) runs.
    - Constants exported: `NO_ROM_POWER = (m) => \`There is no ${MODEL_NAMES[m]} ROM in this browser, so the ${MODEL_NAMES[m]} cannot be turned on. Add your ROM below.\``, `EXAMPLE_NEEDS_ROM = (title, m) => \`${title} needs the ${MODEL_NAMES[m]} ROM, which is not in this browser yet. Add your ROM below, then press Run again.\``, `POWERED_ON = (m) => \`The ${MODEL_NAMES[m]} is on. Type to it on the screen.\``
  - The source/model watcher: when the model changes while `power === 'on'`, it powers on the new model (`powerOn()`), instead of the `STOPPED_MODEL` halt; a program run keeps today's halt.
  - `run()` and `powerOn()`/`runExample()` all share the generation counter, so any one cancels another still loading.

- [ ] **Step 1: Write the failing tests** in `run-machine.test.ts` (use `source-run-support.ts`'s fake roms/kit and the injected `runner` clock, as `run.test.ts` does; a "ROM" here can be the stub bytes for model 3 stored as the user's ROM, since the live path never waits for READY):
  - `powerOn()` with a stored ROM: one runner, `runner.result === null`, `power === 'on'`, message `POWERED_ON(3)`, and after ticking frames the machine's `cycles` advance; nothing was typed (`m.keyboard` queue empty).
  - `powerOn()` with no ROM: no runner, `power === 'off'`, message `NO_ROM_POWER(3)`, `problem === false`.
  - `reset()` replaces the runner (a different object, the old one `stopped`).
  - `run()` while on: the programless runner stops, a program runner starts, `power === 'program'`; `powerOn()` while a program runs: the reverse.
  - Review Focus 1: `powerOn()` with 16K of `0x76` (HALT) as the ROM does not throw and leaves `power === 'on'`.
  - Changing the source's model while on powers on the new model (with a ROM for it) or says `NO_ROM_POWER` (without).
  - `runExample('sea-dragon')` with no Model III ROM: `EXAMPLE_NEEDS_ROM('Sea Dragon', 3)`, `problem === true`, no runner. With a ROM (fake `fetch` returning `examples/sea-dragon/seadrg01.cmd` read from disk): a programless runner whose machine's PC is the `.CMD`'s transfer address before the first frame.
  - In `emulator-run.test.ts`: `createRunner({ machine, result: null, stub: true })` throws; with `stub: false` it runs and never calls `onStop` on its own.
- [ ] **Step 2: Run** `pnpm --filter @fugloy/web exec vitest run test/run-machine.test.ts test/emulator-run.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the runner change, `powerOnMachine`, the `prepareMachine` change, the kit exports, and the `useRun` additions (the example's model and main build come from `data/examples.ts`; Armored Patrol is not offered — `runExample` refuses it with a plain Error).
- [ ] **Step 4: Run** `pnpm test:web` — expect PASS (the existing `run.test.ts` cases unchanged).
- [ ] **Step 5: Commit** `p5: turn the TRS-80 on without a program, reset it, and run the bundled games`

### Task 4: Run ▶ around the screen

**Files:**
- Modify: `apps/web/app/components/run/RunTab.vue`, `TrsScreen.vue`, `ScreenText.vue` (moves, not rewrites)
- Create: `apps/web/app/components/run/ProgramsToTry.vue`
- Modify: `apps/web/app/pages/index.vue` (pass `shown` to RunTab: `rightTab === 'run'`, or however the Run tab's visibility is held there)
- Modify tests: `apps/web/test/e2e/run.spec.ts`, `running.spec.ts` (only where the layout moved a control)
- Create: `apps/web/test/e2e/machine.spec.ts`

**Interfaces:**
- Consumes: Task 2's `renderNotice`, Task 3's `power`, `powerOn`, `reset`, `powerOff`, `runExample`, `machineModel`, the constants.
- Produces (test ids the specs use): `machine-power` (button; text `Power on` / `Power off`), `machine-reset`, `run-pause` (moved into the machine row, unchanged behaviour), `programs` (the list), `program-run-<id>` (each Run button), `debugger` (the `<details>`), `trs-notice` (a `data-` attribute on the screen box while the no-ROM notice shows: `data-notice="no-rom"`).

Layout (top to bottom): bar (Model, Run ▶, Stop, Show in Listing); run message; screen; machine row (`Power on/off`, `Reset`, `Pause/Continue`); Programs to try (`ProgramsToTry.vue`: title, year, a Run button each, for Sea Dragon, Rear Guard, Eliminator); `<details data-testid="debugger">` with summary `Debugger`, holding Step, Step Over, Run to Here, Follow, the registers, the breakpoint list and Screen text; the ROM section.

- [ ] **Step 1: Write the failing e2e** `machine.spec.ts` (CI has no ROM, so these use none; a ROM-backed case runs only when `fugloy.mcp.json` names a Model III ROM, via the same skip helper the other ROM specs use, and adds it through `run-rom-input`):
  - No ROM: opening Run ▶ shows `data-notice="no-rom"` on the screen and the message `NO_ROM_POWER(3)`'s text; `machine-power` reads `Power on`; pressing it says the same; typing `A` into the focused screen throws no page error (Review Focus 4: listen on `page.on('pageerror')`).
  - No ROM: `program-run-sea-dragon` says `EXAMPLE_NEEDS_ROM('Sea Dragon', 3)`'s text.
  - Debugger: closed when the tab opens; after a Run of the starter it is open (a source program runs); a Program to try's run leaves it as it was.
  - With a ROM (skipped without): opening Run ▶ powers on; within 3 s the screen text (Screen text mirror, opened inside Debugger) shows `Cass?`; the screen has focus; typing `Enter`, `Enter` reaches `READY`; typing `PRINT 2+2` and `Enter` shows ` 4`; `machine-reset` brings back `Cass?`; changing Model to Model I without a Model I ROM shows the no-ROM notice (Review Focus 2).
  - axe finds nothing on the tab with the notice showing and with Debugger open.
- [ ] **Step 2: Run** `pnpm --filter @fugloy/web exec playwright test test/e2e/machine.spec.ts` (after `pnpm build`) — expect FAIL.
- [ ] **Step 3: Implement the layout** in `RunTab.vue` and `ProgramsToTry.vue`. The Debugger `<details>`: `open` is set true when a source Run attaches the debugger (`debug.live` turning true) and when a run pauses; the user's toggle otherwise stands. The debug keys keep working with it closed. Move `ScreenText` from `TrsScreen.vue` into the Debugger.
- [ ] **Step 4: Power-on and focus.** RunTab calls `run.powerOn()` when it is first shown with nothing running and a ROM for the model (and on model change, which Task 3's watcher handles). It focuses the screen after `powerOn`/`reset` while `shown`, and after its own Run ▶ button and each Program to try start a program; Ctrl/⌘+Enter elsewhere does not move focus. `TrsScreen` takes a `notice: string[] | null` prop and draws it with `renderNotice` when there is no machine: `['NO ROM FOR THE ' + MODEL_NAMES[model].toUpperCase(), '', 'ADD YOUR ROM BELOW TO TURN IT ON.']`.
- [ ] **Step 5: Update `run.spec.ts`/`running.spec.ts`** where a control moved (the Screen text disclosure now inside Debugger; step buttons inside Debugger, which a source Run opens). Do not weaken an assertion; only change how a control is reached.
- [ ] **Step 6: Run** `pnpm test:web`, `pnpm --filter @fugloy/web test:e2e`, `pnpm --filter @fugloy/web check:prefetch`, and `pnpm --filter @fugloy/web size:first-screen` on a plain `generate` — expect all pass and the size within budget.
- [ ] **Step 7: Commit** `p5: put the TRS-80 first in Run ▶, with Power, Reset, and Programs to try`

### Task 5: Record the phase

**Files:**
- Modify: `docs/Fugloy-Project-Plan.md` (phase 5's paragraph: a **5D** sentence group after 5C's, naming the spec and this plan, the glyph source, power-on, Programs to try, the Debugger disclosure, and the first-screen size measured in Task 4)
- Modify: `CLAUDE.md` (Current phase; the `apps/web` bullet's Run sentence)
- Modify: `CHANGELOG.md` (Unreleased)

- [ ] **Step 1: Write** the three updates; the CHANGELOG names the CodeMirror scroll-flush fix (225cabe) too if Unreleased lacks it.
- [ ] **Step 2: Run** `pnpm typecheck && pnpm test && pnpm test:web` — expect PASS.
- [ ] **Step 3: Commit** `p5: record phase 5D`
