# Phase 5C (the running line) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a program runs, the line it is on is lit live, with a fading trail of the lines just before it. This happens both in source written in **Source ✎** and in a disassembled listing that shows the same program. When paused, the line holds a solid highlight, and the user has:

- Continue, Step, Step Over, and Run to Here;
- breakpoints set by clicking the gutter or pressing F9;
- the registers and flags beside the code, with changed values marked.

A screen-reader text mirror of the TRS-80 screen comes with it. 5C completes phase 5's deliverable.

**Architecture:**

- **DOM-free logic** in `apps/web/app/utils/emulator/`, which is already lazy:
  - `running.ts`: PC to line, and the trail from the trace;
  - `stepping.ts`: breakpoints, Step Over, Run to Here, and Continue over `m.debug.break`;
  - `registers.ts`;
  - `screen-text.ts`.
- **`runner.ts`** learns to pause at breakpoints.
- **One reactive coordinator**, `composables/useDebug.ts`, created by `createRun`, so it lives in Run's chunk.
- **DOM helpers** in a new lazy root, `app/utils/running/`: `listing-style.ts` (the listing's `<style>` rules), `debug-keys.ts`, and `announce.ts`.
- **UI** in `components/source/` (gutter, decorations) and `components/run/` (controls, `RegistersPanel.vue`, `BreakpointList.vue`, `ScreenText.vue`).
- No Web Worker, and no per-instruction JavaScript callbacks.

**Tech Stack:** Nuxt 4, Vue 3, CodeMirror 6 (`gutter`, `GutterMarker`, `RangeSet`, `StateField`), `@fugloy/asm` (`sourceMap`), `@fugloy/emu` (`m.debug.break`/`unbreak`/`trace`), `@fugloy/z80` (`decode`, through the kit), Vitest (happy-dom), and Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-phase5-assembler-ide-design.md` (Goal 4; sub-project 5C). The screen-reader mirror was deferred here by the 5B review.

**APIs:**

- `packages/asm/README.md`: `sourceMap.lineOf`, `linesOf` (pick the candidate whose bytes match), and `addressesOf` (every byte's address; the first is the instruction's).
- `packages/emu/README.md` and `src/debug/debugger.js`:
  - `break(addr, { once, when })` and `unbreak`;
  - `trace.enable` and `trace.last`;
  - `run()` returns `{ reason: 'break', id }`, and the next run's first instruction boundary skips only the PC that stopped it;
  - `step()` ignores breakpoints;
  - breakpoints alone cost one `Map.get` per instruction.

**Precedents:**

- `runner.ts` `lastProgramStep`, with its escalating trace windows;
- 5B Ruling 8's `anywhere`;
- `lazy-chunks.ts` and `preload-deps.ts`;
- `test/e2e/listing-perf.spec.ts`, whose timings are enforced only with `FUGLOY_PERF=1`.

## Global Constraints

- **First-screen bundle.** First-screen JavaScript stays at or under **252,775 B** gzip (main a6b7831's 247,655 + 5,120). It is now 252,232, so 5C may add at most **543 B**; the target is under 200.
  - Nothing new is imported by `pages/index.vue`, `ListingView.vue`, `ListingRow.vue`, the layout, or any first-screen composable. The one exception is a `:scroll-listing` prop on `RunTab`.
  - Lazy modules do not import small first-screen modules (`utils/keys`, `utils/row-classes`, `utils/lazy`), because that splits the shared chunks (see the 5B CHANGELOG). Copy the few lines needed instead.
  - `check:prefetch` passes with `utils/running/` in `LAZY_ROOTS`.
- **Per-frame work** is one `trace.last(256)` read, Map lookups, and one string compare. A CodeMirror dispatch or `<style>` write happens only when the set changes. Perf e2e target: under 1 ms mean per frame for the running-line update.
- `apps/web` reaches emu only through `utils/emulator/`.
- Keys reach the TRS-80 only while its screen has focus (5B Ruling 9). The debug keys are F5–F11 and Ctrl/⌘+F10, which the TRS-80 keyboard map does not use.
- Every message is a sentence that names the problem and the next step.
- Commit messages are imperative, one line, prefixed `p5:`, with no `Co-Authored-By` or any AI trailer.
- Keep `CLAUDE.md`, `docs/Fugloy-Project-Plan.md` (phase 5 status), `CHANGELOG.md` ([Unreleased]), `README.md`, and the About page current.

## Rulings made while planning

1. **The trace is on for every run** (`TRACE_DEPTH` 65,536), with a real ROM too.
   - Why: a PC sample per frame gives one random point per frame, so a 5-line loop would flicker between samples instead of showing the loop. The trace gives the actual recent lines.
   - Cost: about 7% of emulation, which runs at about 40× real time, so about 0.03 ms per 16.7 ms frame.
   - A deeper trace also lets a pause inside the ROM name the program's last line.
   - No zero-allocation `trace.pcs()` is added to emu. 256 small objects a frame are cheap, and an emu change would add release coupling. Revisit if the Task 5 perf check fails.
2. **The trail, per frame:**
   - `now` is the line at PC, found through `linesOf(pc)` and the candidate that matches current memory.
   - `trail` holds up to 5 more distinct program lines, newest first, from `trace.last(256)`. Each entry's line is the `linesOf` candidate that matches the entry's own `bytes`.
   - Classes: `fg-run-now`, then `fg-run-trail-1` to `-5`, fading in steps.
   - When PC is outside the program's code (in the ROM) and the window holds no program line, search once with the escalating windows (64, 4096, 65,536). The line found is marked `fg-run-out` ("in the ROM, called from here") and stays until program lines reappear, with no repeated deep search.
3. **Throttling and motion:**
   - A decoration set is sent only when its key (`line:class,…`) changes, and at most 30 times a second.
   - Nothing is sent while the Source panel is hidden; the latest set is sent when it shows again.
   - With `prefers-reduced-motion: reduce` there is no trail, and `now` updates at most 4 times a second.
   - The registers update 4 times a second while running, and fully on every pause.
4. **The paused highlight:**
   - `fg-run-paused` is a solid band with a 3 px left bar, plus a ▶ marker in the breakpoint gutter. The faint trail stays, to show how the program got there.
   - On stop, `runner.stopLine` (if any) gets `fg-run-stopped` until the next edit or Run.
   - Once the text differs from what Run assembled (`report.text`), the editor shows no running marks, and Source says: "The source has changed since this Run, so the running line is not shown. Press Run to see it again." The listing keeps its marks, since it is the running program.
5. **The listing is highlighted through CSS, not through the listing components.**
   - `utils/running/listing-style.ts` owns one `<style id="fg-running-line">` in `document.head`.
   - Its rules use `.fg-listing :is(.fg-row-code,.fg-row-data)[data-addr="A"]` for now, the trail, paused, and the breakpoint dots (`.fg-col-line::before`).
   - The text is rewritten only when the set changes.
   - Why: this adds no first-screen code, and it needs nothing from virtualisation, because the rules apply to whichever rows are drawn.
   - Stated gap: rows that share a run address all light.
6. **When the listing follows a run.** It follows only when the open session is the running source's own listing (`origin.sourceId`), or when its loaded bytes equal `result.image`'s on every byte asm loaded (the Open-as-source case).
   - The check is a 64K compare, run once per (session, Run) pair.
   - Otherwise the listing shows no marks, and F9 in the listing says: "This listing is not the program that is running. Set breakpoints in Source ✎."
   - F9 in the listing says something else in four cases around that one (Task 4, recorded in its fix round):
     - before any program from Source ✎ has run, or after a Run that made none: "No program from Source ✎ is running, so this listing has no source lines to stop at. Press Run, or set breakpoints in Source ✎."
     - after the program has stopped (switching source stops it too). The listing then shows no marks, so a toggle there would not be seen, and F9 refuses: "The program has stopped, so the listing no longer shows its breakpoints. Set breakpoints in Source ✎, or press Run first."
     - after the source was edited since the Run: "The source has changed since this Run, so the listing's lines no longer match it. Set breakpoints in Source ✎, or press Run first."
     - with the cursor on no instruction of the program: "The listing's cursor is not on an instruction of the running program. Move it to one, then press F9 again."
7. **Following the line on screen:**
   - On a pause, a breakpoint, or a step, the editor brings the line into view with `showLine`, which scrolls without moving the selection. A following listing does the same with `scrollToAddr`, through the `:scroll-listing` prop.
   - While running, this happens only with **Follow** on: a checkbox in the Run bar, off by default and kept for the session. It scrolls at most 4 times a second, and only once the line leaves view.
   - Focus never moves.
8. **Breakpoints are emu breakpoints.**
   - A line's address is `addressesOf(line)[0]`, so each line has at most one breakpoint.
   - Where lines share a run address, `when` compares memory with that line's bytes, so a relocated block stops only on the right line.
   - They are applied when a Run starts. A toggle while running applies at once, except after the source has changed (Ruling 4), when it waits for the next Run.
   - A line with no code shows a hollow mark, titled "Line N has no instruction to stop at.", and so does a data line (DB, DW, DS, and their DEF spellings), titled "Line N holds data, not an instruction to stop at." Neither gets an emu breakpoint (`inactiveReason`; Task 1 fix round 1).
   - Breakpoints are saved on the source as `breakpoints?: number[]`, carried through CodeMirror's change mapping, autosaved with the text, and included in the backup. The backup stays `fugloyBackup: 1`; `isSource` accepts the optional array.
   - In the listing they are shown only (Ruling 5), since a click target there would cost first-screen code. F9 in the listing toggles the source line `lineOf(cursor)`.
9. **Stepping:**
   - **Step** is `runner.step()`.
   - **Step Over** decodes the instruction at PC. For CALL nn, CALL cc,nn, RST n, and LDIR/LDDR/CPIR/CPDR/INIR/INDR/OTIR/OTDR, it sets `once` breakpoints at `pc + length` with `when: sp ≥ sp0`, and continues. For RST 08H it also sets one at `pc + 2`, for the inline byte (see the CLAUDE.md reference facts). Anything else is a plain Step. If a user breakpoint is hit first, it wins, and the step over is abandoned.
   - **Run to Here** sets a `once` breakpoint at the target line's address, with the same byte check as a user breakpoint where lines share it (`runTo(addrs, line)`), then continues. The target is the Source cursor line, or the listing cursor if focus was last in the listing.
   - **Continue** first steps past PC if a breakpoint sits there and the pause was not that breakpoint's, because emu's skip-past only applies after a break stop. It steps until the trace's newest entry is the instruction at PC (at most 1,000 steps), since a pending interrupt's handler runs first; a halted CPU is not stepped.
   - Every temporary breakpoint is removed on any pause or stop.
   - A HALT with IFF1 off gives: "The CPU is halted (HALT) with interrupts off, so it will not move on. Press Stop, then Run."
   - Step or Step Over while running pauses first; the next press steps.
10. **Keys.** These live in the lazy `utils/running/debug-keys.ts`: one document listener, installed while Source ✎ or Run ▶ is mounted.

    | Key | Action | Claimed when |
    |---|---|---|
    | F5 | Continue; Run when idle or stopped | Run is loaded (swallowed while running, so the page never reloads under a program) |
    | F6 | Pause | running |
    | Shift+F5 | Stop | running or paused (otherwise the browser's) |
    | F9 | Toggle breakpoint | focus in the editor or a following listing |
    | F10 | Step Over | running or paused |
    | F11, F7 | Step | running or paused (F7 because macOS gives F11 to Show Desktop) |
    | Ctrl/⌘+F10 | Run to Here | a runner exists |

    - They are ignored when a `dialog[open]` is showing, in INPUT/TEXTAREA/SELECT, and when the event is already `defaultPrevented`.
    - They act inside `data-own-keys` panels and the CodeMirror content (like 5B's `anywhere`), and on the TRS-80 screen.
    - They leave alone Shift+F10 (the listing's context menu), Ctrl/⌘+Enter, and the workbench's `KEYS`; none of those uses an F-key.
    - Firefox's F7 (caret browsing) is checked by hand in review. If `preventDefault` does not stop it, the F7 alias is dropped.
11. **Registers panel** (`RegistersPanel.vue`, in Run ▶ beside the screen):
    - AF, BC, DE, HL, IX, IY, SP, PC, the alternates AF′, BC′, DE′, HL′, and I, R, IM, IFF1/IFF2 ("interrupts on/off").
    - Flags are spelled out (Sign, Zero, Half-carry, Parity/Overflow, Add/Subtract, Carry), each as 0 or 1.
    - After each pause or step, values that changed since the previous pause are marked by colour and by a "changed" word for screen readers.
    - The panel has no live region.
12. **Announcements** (`utils/running/announce.ts`): one visually hidden `role="status"` region on `document.body`, outside the `v-show` panels, created on first install.
    - On pause: "Paused at line 12, LD A,(HL), at a breakpoint."
    - In the ROM: "Paused at $0049 in the ROM (wait for a key); the program's last line was 23."
    - On step: "Line 13, INC HL. Changed: HL, F."
    - Step announcements are debounced by 150 ms, so holding F10 speaks only the last.
    - `run.message` shows the same sentence.
13. **Screen text mirror** (`ScreenText.vue`, under the screen):
    - A "Screen text" disclosure, closed by default, holds an `<ol>` of rows. Graphics bytes read as spaces, trailing spaces are trimmed, and a blank row reads "blank".
    - While open, it refreshes at most twice a second, and only when the text changed. It has no live region of its own.
    - An opt-in checkbox, "Speak screen changes", speaks through the announcer at most once a second: up to 3 changed rows as "Row 4: SCORE 120", otherwise "The screen changed (9 rows)."
14. **Not in 5C:** Step Out, conditional or hit-count breakpoints, watches in the UI, a memory view, editing registers, breakpoint clicks in the listing, and sound.

## Review Focus

1. **Frame cost:** no per-instruction JS beyond emu's trace; dispatches and style writes only on change (the counting tests in Tasks 2 and 4); `frameCost()` under 1 ms mean with `FUGLOY_PERF=1` (Task 5).
2. **First-screen budget:** at or under 252,775 B by the committed script; `check:prefetch` clean with `utils/running/`; `index.vue` gains only the prop.
3. **Exact stops:** breakpoints stop before the instruction, on the right line at a shared address; Step Over returns past CALL, recursion, and RST 08H's byte; Continue never stops again at PC; no temporary breakpoint outlives a pause (Task 1 tests).
4. **Keys:** no clash with `KEYS`, Shift+F10, or Ctrl/⌘+Enter; nothing fires in inputs or dialogs; F5 and Shift+F5 are claimed only as Ruling 10 says; keys pressed on the TRS-80 screen do not also type on it (Task 3 tests).
5. **Accessibility:** paused-line and step announcements are debounced; the mirror is throttled and opt-in to speak; every control is reachable by keyboard (F9 and the breakpoint list cover the gutter); ▶ is a non-colour cue; reduced motion is honoured; axe is clean both paused and running (e2e in Tasks 3 and 5).

---

### Task 1: The running-line runtime (DOM-free)

**Files:**

- `app/utils/emulator/runner.ts`: the trace is always on, a `break` result pauses, and it gains `onPause`, `pausedBy`, and `continue()`.
- `app/utils/emulator/running.ts`, `stepping.ts`, `registers.ts`, and `screen-text.ts`, all exported from `kit.ts`.
- `run-once.ts`: passes `onPause` and the initial breakpoints.
- Tests: `test/running-line.test.ts`, `test/stepping.test.ts`, `test/registers.test.ts`, `test/screen-text.test.ts`, and an extended `test/emulator-runtime.test.ts`.

**Interfaces (produces):**

- **Runner additions:** `pausedBy: { kind: 'pause' | 'step' | 'break'; id?: number } | null`, `continue(): void`, `RunnerOptions.onPause?(r)`, and `RunInput.breakpoints?: readonly number[]`.
- **`running.ts`:**
  - `lineAt(result, addr, bytesAt: (a: number, n: number) => ArrayLike<number>): number | null`
  - `trailOf(m, result, prev?: TrailState): TrailState`, where `TrailState = { now: number | null; trail: number[]; out: number | null }`
  - `lineMarks(t: TrailState, mode: 'running' | 'paused' | 'stopped', reduced: boolean): { line: number; class: string }[]`
  - `marksKey(marks): string`
- **`stepping.ts`:**
  - `breakAddress(result, line): number | null`
  - `stepOverTargets(m): number[] | null`
  - `createStepper(runner): { setBreakpoints(lines): { inactive: number[] }; step(); stepOver(); runTo(addrs: number[]); continue(); clearTemps() }`
- **`registers.ts`:** `readRegisters(m): RegSnap`, `registerRows(now, prev): { name, value, changed }[]`, and `flagRows(f, prev)`.
- **`screen-text.ts`:** `screenRows(raw, view): string[]`, `changedRows(a, b): number[]`, and `screenAnnouncement(rows, changed): string | null`.

- [ ] **Step 1: Write the failing tests** (stub ROM, run in CI).
  - Trail:
    - In `L: INC A / DEC B / JR L`, the trail is exactly those 3 lines, `now` is PC's line, and no line appears twice.
    - For a block copied over its own code (two lines share an address), `lineAt` and the trail pick the line whose bytes match.
    - With PC in a ROM loop, `out` is the calling line, found by one deep search and kept on the next frame without searching again.
    - `lineMarks` gives no trail when `reduced`, and the key is unchanged when the set is.
  - Runner:
    - A breakpoint stops the frame before its instruction, sets `pausedBy.kind === 'break'`, and calls `onPause`.
    - `continue()` from a breakpoint's PC does not stop again.
    - After a manual pause at a breakpoint address, `continue()` runs past it.
  - Stepping:
    - Step Over on `CALL SUB` stops at the next line with SUB's effects done.
    - On recursion, it stops only when SP is back.
    - On `RST 08H` with its byte, it stops at `pc+2` (synthetic handler).
    - On `LDIR`, it stops after the whole block.
    - A user breakpoint inside SUB wins.
    - Run to Here stops at the line.
    - No temporary breakpoint remains after any pause (check `m.debug.breaks`).
    - HALT with DI gives the sentence.
  - Registers:
    - After `LD HL,1234H`, the rows mark only HL as changed.
    - After `XOR A`, the flags spell out Zero = 1.
  - Screen text:
    - `0BFH` reads as a space, and trailing spaces are trimmed.
    - 4 changed rows give the summary sentence; 2 give the rows themselves.
- [ ] **Step 2: Run the tests** and confirm they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests** and confirm they pass.
- [ ] **Step 5: Commit** `p5: pause at breakpoints and map the running PC and its trail to source lines`.

### Task 2: Source ✎ — gutter, highlight, saved breakpoints

**Files:**

- `app/components/source/CodeEditor.vue`:
  - a breakpoint gutter as a `StateField<RangeSet<GutterMarker>>` (● set, ○ inactive, ▶ PC), mapped through changes; it replaces the inert `gutterSlot`;
  - theme rules for `fg-run-*`;
  - `showLine`, `cursorLine`, and `lineVisible`.
- `app/components/source/SourceTab.vue`: uses `useRun().debug`, and shows the "changed since this Run" sentence.
- `app/composables/useDebug.ts`: the coordinator, created in `createRun`.
- `app/composables/useRun.ts`: `debug` on `Run`.
- `app/composables/useSources.ts`, `app/utils/store.ts` (`StoredSource.breakpoints?`), and `app/utils/backup.ts`.
- Tests: `test/debug.test.ts`, `test/source-breakpoints.test.ts`, and extended `test/sources.test.ts`, `test/backup.test.ts`, and `test/source-tab.test.ts`.

**Interfaces:**

- **Consumes:** Task 1.
- **Produces:**
  - `useDebug` (as `run.debug`):

    ```ts
    {
      mode: Ref<'idle' | 'running' | 'paused' | 'stopped'>;
      marks: ShallowRef<{ line: number; class: string }[]>;
      pcAddr: Ref<number | null>;
      breakpoints: Ref<number[]>;
      inactive: Ref<number[]>;
      dirty: ComputedRef<boolean>;
      follow: Ref<boolean>;
      registers: ShallowRef<RegisterView | null>;
      toggleBreakpoint(line: number): void;
      pause(); continue(); step(); stepOver();
      runToLine(line: number): void;
      runToAddr(addr: number): void;
      announce: Ref<string | null>;
    }
    ```

  - `CodeEditor`: `setBreakpoints(lines, inactive)`; emits `update:breakpoints` (mapped lines) and `toggle-breakpoint` (gutter click); `showLine(n)` scrolls without moving the selection.

- [ ] **Step 1: Write the failing tests.**
  - Breakpoints in the gutter:
    - A gutter click on line 5 sets a breakpoint, saved with the source after 500 ms.
    - Inserting 2 lines above moves it to line 7, and deleting its line removes it.
    - A line with no code shows a hollow mark with the sentence.
    - A toggle while running adds or removes an emu breakpoint at once; while `dirty`, it waits for the next Run.
  - Dispatch counting:
    - A fake runner producing the same marks for 10 frames causes exactly 1 `setLineDecorations`.
    - 10 changing frames within 100 ms of fake time cause at most 3 (the 30 Hz cap).
    - A hidden panel causes 0, then the latest set once it is shown.
  - Changed source and pausing:
    - An edit after Run clears the marks and shows the sentence.
    - A pause scrolls the editor to the paused line without changing the selection.
  - Backup:
    - A backup carries `breakpoints`, and a restore keeps them.
    - An older backup without them still restores.
- [ ] **Step 2: Run the tests** and confirm they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests** and confirm they pass.
- [ ] **Step 5: Commit** `p5: light the running line and its trail in Source, with breakpoints in the gutter`.

### Task 3: Run ▶ — controls, registers, keys, announcements, screen text

**Files:**

- `app/components/run/RunTab.vue`: Pause/Continue, Step, Step Over, Run to Here, and Follow in the bar, each with its key in the title.
- New in `app/components/run/`: `RegistersPanel.vue`, `BreakpointList.vue` (each entry "Line N: text", with Remove and Go to line), and `ScreenText.vue`.
- `TrsScreen.vue`: hosts `ScreenText`.
- New in `app/utils/running/`: `debug-keys.ts` and `announce.ts`.
- `lazy-chunks.ts`: add `'utils/running/'` to `LAZY_ROOTS`.
- Tests: `test/debug-keys.test.ts`, `test/registers-panel.test.ts`, `test/screen-text-panel.test.ts`, and extended `test/run.test.ts` and `test/lazy-chunks.test.ts`.

**Interfaces:**

- **Consumes:** Tasks 1–2.
- **Produces:**
  - `installDebugKeys(debug, opts: { runNow(): void; focusTarget(): 'source' | 'listing' | null }): () => void`, refcounted from SourceTab and RunTab.
  - `announcer(): { say(text: string, opts?: { debounce?: number }): void }`.

- [ ] **Step 1: Write the failing tests.**
  - Keys, each as Ruling 10 says:
    - F10 and F11 step while paused, and pause while running.
    - F5 continues, and runs when idle. While running, F5 is `preventDefault`ed and does nothing else.
    - Shift+F5 stops; when idle, it is not prevented.
    - F9 in the editor toggles the cursor line, and Ctrl+F10 runs to the cursor line.
    - Nothing fires in an INPUT or with a `dialog[open]`, and Shift+F10 is never handled.
    - F10 on the focused TRS-80 screen steps and never reaches the matrix (keyboard spy).
  - Announcements:
    - A breakpoint stop puts "Paused at line N, …, at a breakpoint." in the body region and in `run.message`.
    - 5 steps within 100 ms announce once, the last.
  - Registers show changed marks after a step, spell out the flags, and update at 4 Hz while running (fake timers).
  - Screen text is closed by default; when open, it refreshes at most twice a second; "Speak screen changes" announces at most once a second.
  - Keyboard reach: every control is reachable by Tab, and the breakpoint list removes a breakpoint by keyboard.
  - `LAZY_ROOTS` throws if `utils/running/` matches nothing.
- [ ] **Step 2: Run the tests** and confirm they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests** and confirm they pass.
- [ ] **Step 5: Commit** `p5: add stepping, breakpoints, registers, debug keys and a screen-text mirror to Run`.

### Task 4: The listing follows the run

**Files:**

- `app/utils/running/listing-style.ts`: the `<style>` writer.
- `app/utils/emulator/running.ts`: `listingFollows(session, result, sourceId, origin): boolean`.
- `useDebug.ts`: listing marks, F9 and Run to Here from the listing cursor (`wb.cursor`), and Follow.
- `RunTab.vue`: the `scrollListing` prop.
- `pages/index.vue`:
  - `:scroll-listing="scrollTo"` on `RunTab`, the only first-screen change;
  - E2E-only hooks `pause()`, `debugMode()`, `listingMarks()`, and `frameCost()`, inside `__FUGLOY_E2E__`.
- Tests: `test/listing-running.test.ts` and the e2e `test/e2e/running.spec.ts`.

- [ ] **Step 1: Write the failing tests.**
  - Which listing follows:
    - After a clean Run, the source's own listing follows.
    - An Open-as-source listing of a synthetic `.CMD` follows.
    - An unrelated program opened from a file does not, and F9 there gives the sentence.
  - The `<style>` element:
    - Its text names `[data-addr="…"]` for now, the trail, and the breakpoints.
    - It is written once for an unchanged set (count the writes).
    - It is removed on stop and on Close.
  - Scrolling:
    - When paused, the listing scrolls to PC's row through `scrollListing`, and the cursor and focus are unchanged.
    - While running with Follow off, there is no scroll; with Follow on, at most 4 a second, and none while the row is in view.
  - `ListingView` and `ListingRow` are unchanged (a git diff check in review).
  - e2e:
    - Write a program with a loop, set a breakpoint with a gutter click, and Run: it stops on that line.
    - The listing row carries the paused mark, and the registers show.
    - F10 moves one line, and F5 continues.
    - The screen-text list matches `screenText()`.
    - axe is clean both paused and running.
- [ ] **Step 2: Run the tests** and confirm they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm typecheck && pnpm test:web && pnpm --filter @fugloy/web test:e2e` and confirm everything passes.
- [ ] **Step 5: Commit** `p5: light the running line in the listing and follow it when paused`.

### Task 5: Measure, perf, docs

**Files:**

- `apps/web/scripts/first-screen-size.mjs` (run as `pnpm --filter @fugloy/web size:first-screen`). It uses 5B's method: in a plain `nuxt generate` output (no `NUXT_PUBLIC_E2E`), take `index.html`'s module script and every `modulepreload`, follow each file's static imports, gzip each file at level 9, and print the file list and the sum.
- A perf case in `test/e2e/running.spec.ts`.
- Docs: `CLAUDE.md`, `docs/Fugloy-Project-Plan.md`, `CHANGELOG.md`, `README.md`, and `apps/web/app/pages/about.vue`.

- [ ] **Step 1: Measure the first screen.**
  - Run the script on main (expect 252,232 B) and on the branch; the branch must be at or under 252,775 B.
  - Record both totals, the file counts, and the Run and Source chunk sizes with their deltas in the CHANGELOG.
  - Run `pnpm --filter @fugloy/web check:prefetch` and confirm it passes.
- [ ] **Step 2: Check performance** (enforced with `FUGLOY_PERF=1`; printed only in CI).
  - A tight loop running for 3 s gives a `frameCost()` mean under 1 ms and a p95 under 2 ms.
  - Long tasks during the run match the 5B baseline.
- [ ] **Step 3: Check Sea Dragon** (gated, local only).
  - Open Sea Dragon as source on the user's Model III ROM.
  - The trail lights its lines, and its listing follows, including the relocated code.
  - A breakpoint at its print routine (`$6140`) stops on the right line.
- [ ] **Step 4: Update the docs.**
  - CLAUDE.md: 5C is done, and with it phase 5's deliverable; the `apps/web` line names `utils/running/` and the debug keys.
  - Plan phase 5 status: 5C done, phase 5 complete.
  - CHANGELOG: the running line, trail, breakpoints, stepping, registers, keys, screen-text mirror, the always-on trace and its cost, and the sizes.
  - README: the workbench row and the Source/Run paragraph.
  - About: a short "Keys in Source ✎ and Run ▶" list and the screen-text mirror.
- [ ] **Step 5: Run the full suite:** `pnpm typecheck && pnpm test && pnpm test:web && pnpm --filter @fugloy/web test:e2e`.
- [ ] **Step 6: Commit** `p5: measure the running line and document phase 5C`.
