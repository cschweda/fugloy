# Phase 5B (Source ✎ and Run ▶) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the workbench, a program typed in **Source ✎** runs on an emulated TRS-80 in **Run ▶** with one press. `@fugloy/asm` assembles it and marks each error on its line with a one-click fix. A clean program runs on a fresh `@fugloy/emu` Machine, with a canvas screen and the keyboard, on the user's ROM, or with no ROM at all for a program that never calls it.

**Architecture:**
- DOM-free runtime in `apps/web/app/utils/emulator/`: the stub ROM, boot and snapshot, the `Runner` frame loop, the screen renderer into an RGBA buffer, and the keyboard adapter.
- Two composables, `useSources` and `useRoms`, over the existing IndexedDB store, which moves to version 2 with stores `sources` and `roms`.
- Two components, `SourceTab.vue` (CodeMirror 6) and `RunTab.vue`, wired into `pages/index.vue`. The editor, asm and emu load in a lazy chunk.
- No Web Worker: the loop runs on `requestAnimationFrame` on the main thread.

**Tech Stack:** Nuxt 4, Vue 3, CodeMirror 6 (`@codemirror/state`, `view`, `commands`, `lint`; MIT), `@fugloy/asm`, `@fugloy/emu`, Vitest (happy-dom, fake-indexeddb), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-phase5-assembler-ide-design.md` (Intent, Goals 1–2 and 5, Decisions "IDE" and "ROMs", sub-project 5B).
- **APIs:**
  - `packages/asm/README.md`: `assemble`, `AsmResult`, `sourceMap`, `diagnostics[].fix`, `toCmd`.
  - `packages/emu/README.md` and `src/machine/machine.js`: `Machine`, `load.cmd`, `run`, `video.raw/columns/rows`, `keyboard`, `debug.snapshot/restore`, `clockHz`, `ROM_HASHES`.
- **Precedents:**
  - `useManuals.ts`: user files in IndexedDB, hashing, sentences.
  - `utils/store.ts`, `utils/backup.ts`.
  - `usePersistence.ts`: `flushOnLeave`.
  - `packages/asm/test/starter.test.ts`: a synthetic ROM that runs the starter.

## Global Constraints

- No ROM bytes are ever bundled, fetched, committed, or written to a backup. The stub ROM is Fugløy's own source (`stub-rom.z`), assembled at run time, and holds no Tandy code.
- Keys reach the emulated machine only while the screen element has focus. Typing in the editor, in inputs, or in dialogs never does.
- The first screen's JavaScript does not grow. CodeMirror, asm, and emu load by dynamic `import()` when Source or Run is first opened.
  - Budget: first-screen JS grows by 5 KB gzip at most.
  - The lazy chunk's size is recorded in the CHANGELOG.
- Every message is a sentence that names the problem and the next step. No codes.
- `apps/web` reaches emu only through `utils/emulator/`. The one escape-hatch use, `m.system.keyboard`, lives in `keyboard.ts` with a typed shim.
- Commit messages: imperative, one line, prefix `p5:`. No `Co-Authored-By` or any AI trailer.
- Keep `CLAUDE.md`, `docs/Fugloy-Project-Plan.md` (phase 5 status), `CHANGELOG.md` (under [Unreleased]), and the About page current.

## Rulings made while planning

1. **Editor: CodeMirror 6, loaded lazily.** 5C and phase 6 need features CM6 has as primitives:
   - 5C: a live line highlight with a fading trail (60 updates a second), a breakpoint gutter, and decorations (`Decoration.line`, `gutter`/`GutterMarker`, `StateField` + `StateEffect`).
   - Phase 6: inline tutor widgets.
   - Also: transactional undo for fixes, hover tooltips, and screen-reader support.

   A textarea overlay rebuilds all of that by hand and breaks when metrics drift. CM6 costs about 90 KB gzip, kept off the first screen. There is no language package: comments and labels are styled with `MatchDecorator`.
2. **No Web Worker in 5B.** emu runs Sea Dragon at about 40× real time, so a 60 Hz frame costs well under 1 ms. A worker would add a video copy every frame, key latency, and asynchronous access to `m.debug`, which 5C needs synchronously. `Runner` is an interface, so a worker can replace it later.
3. **Frame pacing by elapsed time.**
   - Each frame runs `round(m.clockHz × dt)` T-states.
   - `dt` is capped at 1/30 s, so a hidden tab does not cause a catch-up storm.
   - `clockHz` is read every frame, because the Model 4 can switch clock.
   - A hidden page stops rAF, which pauses the program.
4. **Glyphs: X.Org `font-misc-misc` `6x12.bdf`, and `6x10.bdf` for 80×24, public domain.** The headers carry `COPYRIGHT "Public domain terminal emulator font.  Share and enjoy."` (gitlab.freedesktop.org/xorg/font/misc-misc, pinned at commit `c4e2af05`, font-misc-misc 1.1.3).
   - 6×12 is exactly the Model III's cell: 384×192 / 64×16.
   - `scripts/build-glyphs.ts` converts a local copy once into the committed `utils/emulator/glyphs.generated.ts`, covering 20H–7EH; 7FH is self-drawn. It records the source URL and SHA-256, and refuses a BDF without the public-domain line.
   - 80H–BFH are computed as 2×3 blocks. Bit 0 is top-left, 1 top-right, 2 middle-left, 3 middle-right, 4 bottom-left, 5 bottom-right.
   - 00H–1FH show as 40H–5FH, as `m.video.text()` folds them.
   - C0H–FFH draw as the block of `b & 3FH`, as on the Model I.
   - The Model III's special and katakana sets are not drawn, a stated difference: their only source is the ROM's character generator.
   - Model 4 inverse video: bit 7 set shows the character inverted.
5. **Stub ROM: yes.** Without a ROM, Run uses `stubRom(model)`: `stub-rom.z` (DI, LD SP,0, fill `$3C00–$3FFF` with spaces, HALT), assembled by `@fugloy/asm` and padded with HALT (`76H`) to the model's ROM size.

   Reasons:
   - The user's own example ("a tiny program that just blanks out the screen") must work on a blank page.
   - The starter needs nothing from the ROM.
   - `packages/asm/test/starter.test.ts` already proves the approach.

   A program that needs the ROM is caught twice, each time with a sentence naming the line:
   - **Statically:** a `kind: 'rom'` symbol used, an `RST`, or a `CALL`/`JP` target below the ROM's end.
   - **At run time:** the HALT trap (PC inside the ROM). The caller is found from the stacked return address through `sourceMap.lineOf`. `EI` under the stub stops at the `$0038` trap with a sentence once an interrupt is delivered: always on the Model I (its clock interrupt has no mask), and on the Model III and 4 only after the program unmasks one at port `E0H` (the ROM normally does; with every source masked a bare `EI` runs on, as on the hardware).
   - Confirmed by a test: emu leaves PC just past the HALT, so the trap reads the HALT at PC-1.
6. **ROMs: per model, by hash.**
   - Stored in the IndexedDB `roms` store keyed by model (`1 | 3 | 4`) as `{ bytes, sha256, recognized, name, addedAt }`.
   - A `ROM_HASHES` name gives the model by its prefix. A file Fugløy doesn't recognise is kept only at a size the model takes, with the model chosen by the user, and marked as not recognised.
   - ROMs never go in `makeBackup` and are never fetched.
   - With a ROM, Run boots it to READY once per ROM per page session and keeps `m.debug.snapshot()` in memory. Each Run restores that snapshot on a new Machine and calls `m.load.cmd`. The boot answers the prompts: Cass? and Memory Size? on the Model III and 4, SIZE? on the Model I, within 8 emulated seconds.
7. **The model belongs to the source.**
   - The default is the Model III. A source opened from a disassembly takes `session.selection.machine`.
   - The Run tab's model select sets it. It goes to both `assemble(text, { model })` and `new Machine({ model })`, so ROM names and the machine agree.
   - The top bar's MachinePicker stays the listing's.
8. **Run key: Ctrl+Enter / ⌘+Enter**, everywhere in the workbench, including inside the editor. It is a CM6 keymap entry plus a workbench binding with `anywhere: true`, which bypasses `isTyping`. Run doesn't move focus. While a program runs unfocused, the screen says "Click the screen to type to the TRS-80".
9. **Focus model.**
   - The screen is a `tabindex="0"` element with `role="application"` and an aria-label saying that keys go to the TRS-80 and Tab leaves.
   - It maps keys through the matrix's own browser mapping: `m.system.keyboard.keyDown(e.key, e.code)` and `keyUp(e.code)`. It calls `preventDefault` only for mapped keys.
   - Tab and modified keys (Ctrl, ⌘, Alt) are never captured.
   - On blur, every key is released (`matrix.reset()`).
10. **Assemble → listing: automatic only for the source's own program.** After a clean Run, the workbench may reopen `toCmd(result)` as `<name>.cmd` with `{ origin: 'source', keepView: true }`, but only if no program is open, or the open one has `origin: 'source'` and the same source id.
    - It doesn't switch tabs, and it keeps the cursor if its address still exists.
    - Persistence skips such sessions: no saved hints, no carry-over, no conflict dialog.
    - A program opened from a file is never replaced without the user's action, "Show in Listing" in the Run tab.
11. **Sources: several, autosaved, backed up.**
    - The IndexedDB `sources` store holds `{ id, name, text, model, savedAt }`, plus the current id.
    - A save waits until 500 ms after typing stops, and is flushed on leave.
    - A new source is the starter (`packages/asm/examples/clear-screen.z`, raw import via an alias).
    - Sources go in the backup as an optional `sources` array (still `fugloyBackup: 1`). A restore adds missing sources and suffixes a clashing name. ROMs never go in the backup.
12. **The workbench opens with no program.** It shows when `session !== null || sources.current !== null`. With no session, the listing-bound tabs show one sentence: "Run the source to see its listing here". The first screen gains "Write a program" and "Continue <name>".
13. **Live diagnostics.** The source is re-assembled 250 ms after typing stops (asm keeps 3,000 lines under 60 ms), so the marks are current before Run. Run always assembles fresh.
14. **Not in 5B:** sound (`m.sound` is left alone; autoplay policy and 1-bit audio resampling are a task of their own), disks, `.CAS`, and 5C's running line, step UI, breakpoints, and registers.

## Review Focus

1. **Keys:** a key typed in the editor, the G box, or a dialog must never reach the matrix, and a key held when the screen loses focus must not stay down (Task 4 tests, e2e).
2. **No ROM leaks:** `makeBackup` output, the generated site, and every network request must be ROM-free (Task 1 backup test; Task 4 e2e asserting no requests beyond the site's own assets during Run).
3. **Stub safety:** the stub must never run a ROM-calling program silently wrong. The static check and the HALT trap each name the line (Task 2 tests with `CALL $VDCLS`, `RST 10H`, `EI`).
4. **Quiet listing refresh:** the automatic refresh must not switch tabs, steal focus, open persistence dialogs, or replace a file-opened program (Task 4 tests).
5. **Glyph provenance:** the generated table cites a BDF whose header says public domain, and nothing is derived from a ROM's character generator (Task 2 converter test; About page credit).

---

### Task 1: Storage, sources, ROMs, and the dependencies

**Files:**
- `apps/web/package.json`: move `@fugloy/emu` to dependencies; add `@fugloy/asm` `workspace:*` and the four `@codemirror/*` packages.
- `aliases.ts`: `@fugloy/asm` → src, `@fugloy/emu` → `packages/emu/src/index.js`, and an alias for asm's examples.
- `app/types/fugloy-emu.d.ts`: the typed subset the web uses; fold `test/emu-shim.d.ts` into it.
- `app/utils/store.ts`: DB version 2, stores `sources` and `roms`.
- `app/utils/hash.ts`: Web Crypto SHA-256, factored out of `useManuals`.
- `app/composables/useSources.ts`, `app/composables/useRoms.ts`, `app/utils/backup.ts`.
- Tests: `test/sources.test.ts`, `test/roms.test.ts`; extend `test/backup.test.ts` and `test/persistence.test.ts` (an upgrade from v1 keeps hints and manuals).

**Interfaces (produces):**
- `useSources(): { list, current: Ref<Source | null>, create(opts?: { name?, text?, model? }): Promise<Source>, select(id), update(id, patch), rename(id, name), remove(id), flush(), unavailable }`, where `Source = { id, name, text, model: 1 | 3 | 4, savedAt }`. `create()` with no text uses the starter.
- `useRoms(): { have(model): boolean, info(model): { name, sha256, recognized } | null, bytes(model): Promise<Uint8Array | null>, add(file, model?): Promise<{ ok: true; model } | { ok: false; reason }>, remove(model), unavailable }`.

- [ ] Steps: write the failing tests:
  - a new source is the starter, on the Model III;
  - edits autosave after 500 ms and on flush;
  - a v1 database upgrades with its hints and manuals intact;
  - a Model III ROM recognised by hash goes to model 3 whatever its file name;
  - a recognised ROM picked for another model is refused, naming its model;
  - an unrecognised file of the wrong size is refused with the sizes, and one of the right size needs a model;
  - a backup carries sources and no `roms` key or ROM bytes;
  - a restore adds sources.

  Run (fail), implement, run (pass), commit `p5: store sources and user ROMs in the browser, and back up sources`.

### Task 2: The emulator runtime (DOM-free)

**Files:**
- `app/utils/emulator/`: `stub-rom.z`, `stub-rom.ts`, `boot.ts`, `runner.ts`, `screen.ts`, `glyphs.generated.ts` (from `scripts/build-glyphs.ts`), `rom-use.ts` (the static check), `keyboard.ts`.
- Tests: `test/emulator-runtime.test.ts` (stub, CI), `test/screen.test.ts`, `test/glyphs.test.ts`, `test/emulator-rom.test.ts` (gated on `fugloy.mcp.json`, as `emulator-run.test.ts` is).

**Interfaces (produces):**
- `stubRom(model): Uint8Array`; `bootedSnapshot(model, rom): Snapshot`, cached by sha256.
- `romUse(result: AsmResult, model): { line: number; text: string } | null`: the first line that needs the ROM, with a sentence.
- `createRunner(opts: { machine: Machine; result: AsmResult; stub: boolean; schedule?: (cb) => number; cancel?; now?: () => number; onFrame?: (r: Runner) => void }): Runner`, where `Runner = { state: 'running' | 'paused' | 'stopped'; pc: number; machine; result; stopReason: string | null; start(); pause(); resume(); step(): void; stop(reason?) }`.
  - `step` runs one instruction (`m.step()`), for 5C.
  - `onFrame` fires after each frame's slice; 5C hooks its PC→line mapping there.
- `renderScreen(raw: Uint8Array, view: { columns, rows, wide, inverse }, out: Uint8ClampedArray, width: number): boolean`. It returns false when nothing changed since the last call.
- `attachKeyboard(el: HTMLElement, getMachine: () => Machine | null): () => void`.

- [ ] Steps: write the failing tests:
  - **The stub:**
    - the starter leaves video RAM all spaces and PC at WAIT;
    - a screen pre-filled with X is blanked;
    - a fresh stub boot shows spaces, not `@`.
  - **ROM use:**
    - `CALL $VDCLS` is refused before running, naming the line and the routine;
    - a computed `JP (HL)` into the ROM stops at the trap with the caller's line;
    - `EI` under the stub stops at `$0038` with the interrupt sentence;
    - an exception thrown by the emulator stops the run with a sentence.
  - **The frame budget, on a fake clock:** 16.7 ms runs `clockHz/60 ± 1` T-states, and a 2 s gap runs at most `clockHz/30`.
  - **Control:** `pause`, `resume` and `step` move PC as expected.
  - **`renderScreen`:** 'A' comes from the table, `0BFH` is a full cell, `81H` is the top-left block only, 32-column doubling works, and 80×24 works with inverse.
  - **Glyph provenance:** the converter refuses a BDF without the public-domain comment, and the generated table's header names the source and hash.
  - **Gated, on a real Model III and Model I ROM:** the boot snapshot reaches READY, and the starter blanks the screen from it.

  Run, implement, run, commit `p5: run assembled programs on a stub or user ROM with a canvas-ready screen`.

### Task 3: Source ✎, the editor

**Files:**
- `app/components/source/SourceTab.vue` and `app/components/source/CodeEditor.vue` (CM6, lazy).
- `app/utils/source/diagnostics.ts`: AsmResult diagnostics → CM `Diagnostic`s, with an action per `fix`.
- `app/utils/source/fix.ts`; `app/utils/source/decorate.ts` (comment and label `MatchDecorator`s).
- Tests: `test/source-diagnostics.test.ts`, `test/source-fix.test.ts`, `test/source-tab.test.ts` (happy-dom: the list and the toolbar).

**Interfaces (produces):**
- `CodeEditor` exposes `{ setDiagnostics(d: Diagnostic[]), revealLine(n), focus(), setLineDecorations(set: { line: number; class: string }[]), gutterSlot }`.
  - The last two are inert in 5B. They are where 5C puts the highlight, the trail and the breakpoint gutter.
- It emits `update:text`, `run` (Mod+Enter) and `fix`.

- [ ] Steps: write the failing tests:
  - a diagnostic's 1-based line and columns map to the right CM range, including on a tab-indented line;
  - applying a `fix` replaces exactly `column..endColumn` and is one undo step;
  - the list under the editor shows each diagnostic as severity, line and message; a click reveals the line, and a Fix button applies the fix;
  - the marks refresh 250 ms after typing stops;
  - the toolbar does New, select, Rename, Delete (with a confirm) and Download `.z`;
  - Mod+Enter in the editor emits `run`.

  Enable the tab by dropping `later` from Source ✎. Run, implement, run, commit `p5: add the Source tab with inline errors and one-click fixes`.

### Task 4: Run ▶, the key, and the listing

**Files:**
- `app/components/run/RunTab.vue`.
- `app/components/run/TrsScreen.vue`: the focus element; a canvas 768×576, or 640×480 for 80×24, with `image-rendering: pixelated`.
- `app/composables/useRun.ts`: assemble; on errors, send them to Source; otherwise run the ROM check, then the Machine and the Runner. It keeps `lastResult` and `runner` for 5C.
- `pages/index.vue`: the tabs go live; the workbench shows without a session; the `anywhere` binding; test hooks `run()`, `screenText()` and `runnerState()`.
- `composables/useWorkbenchKeys.ts` (`anywhere`), `composables/useWorkbench.ts` (`OpenOpts.origin`, `keepView`), `composables/usePersistence.ts` (skip `origin: 'source'`), `components/FirstScreen.vue`.
- Tests: `test/run.test.ts`, `test/run-keys.test.ts`, extend `test/workbench.test.ts`, and the e2e `test/e2e/run.spec.ts`.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `useRun(): { run(): Promise<void>; stop(); runner: ShallowRef<Runner | null>; lastResult: ShallowRef<AsmResult | null>; message: Ref<string | null> }`.

- [ ] Steps: write the failing tests:
  - **Running:**
    - Run with errors marks them, shows Source, reveals the first, and starts no Machine;
    - Run of the starter with no ROM shows a blank canvas and "Running on Fugløy's stub ROM (no ROM needed for this program)";
    - a ROM-calling program with no ROM shows the sentence and the listing, and runs nothing;
    - with a stored ROM, it runs from the booted snapshot;
    - dropping a ROM on the tab stores it;
    - Mod+Enter runs from the editor, the listing and the page.
  - **Keys:** keys typed in the editor or the G box never reach the matrix; keys reach it while the screen is focused; Tab leaves; blur releases every key.
  - **The listing:** a clean Run refreshes a source-origin listing without changing tabs or opening a dialog. It never replaces a file-opened program unless "Show in Listing" is pressed.
  - **e2e:** Write a program → Run → `screenText()` is all spaces and the canvas centre pixel is the background; no request goes beyond the site's own origin; axe is clean on the Run tab.

  Run, implement, run (`pnpm typecheck && pnpm test:web && pnpm --filter @fugloy/web test:e2e`), commit `p5: add the Run tab: one press assembles and runs on a fresh machine`.

### Task 5: Open a disassembly as source, and the docs

**Files:**
- `app/components/side/ProgramTab.vue` and `ExportMenu.vue`: "Open as source ✎".
- `useSources`: `fromSession(s)`.
- `pages/about.vue`: the font credit and license, and the ROM statement.
- `docs/Fugloy-Project-Plan.md`, `CLAUDE.md`, `CHANGELOG.md`.
- Tests: `test/open-as-source.test.ts`, and an e2e step in `run.spec.ts`.

- [ ] Steps: write the failing tests:
  - Sea Dragon, from `examples/`, opened as source gives `renderSession(s, 'zmac')` as a new source named `seadrg01.z`, with model 3.
  - Assembling it with `model: 3` gives the session's image (same runs and bytes) and entry.
  - A program whose text doesn't reassemble exactly (a synthetic `BYTE_EXACT_EXCEPTIONS` case) opens with a one-line note naming the first differing address.
  - Running the opened source on the gated real ROM shows Sea Dragon's title (local only).

  Measure the lazy chunk and first-screen sizes and record them. Then the docs:
  - CLAUDE.md: the current phase and the `apps/web` layout line;
  - the plan's phase 5 status;
  - CHANGELOG: Source, Run, the stub ROM, the ROM store, the font credit, and the sizes.

  Run the full suite, commit `p5: open a disassembly as source and document Source and Run`.
