# Phase 6B: the Learn page and lessons 1–7 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A page at `/learn/` where a coder who has never written assembly reads a short lesson, runs its Z80 program on a TRS-80 screen with no ROM, steps it and watches the registers, changes it and runs it again, over a ladder of seven lessons with Sea Dragon beside them.

**Architecture:** Lessons are files (`apps/web/content/learn/<NN-slug>/lesson.md` and `program.z`, plus a `check.json` the CI harness drives). A small parser in `utils/learn/` turns each `lesson.md` into blocks the page renders (on the server too, so the text is in the generated HTML). The page reuses 5B–6A's machinery: `createRun` gains a stub-only, listing-free mode and runs the lesson's program from an in-memory `Sources`; the editor and the TRS-80 column are new thin components inside the existing lazy roots (`components/source/`, `components/run/`), so neither the workbench's first screen nor the Learn page's own first screen carries CodeMirror, asm or emu. One Vitest file in `packages/asm` assembles every lesson with asm and zmac and runs it on the stub ROM in emu with the scripted keys of its `check.json`.

**Tech Stack:** Nuxt 4 / Vue 3, TypeScript strict, CodeMirror 6, `@fugloy/asm`, `@fugloy/emu`, `@fugloy/disasm` (Explain), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-19-phase6-learn-assembly-design.md` (Parts 1–3, Constraints, Delivery 6B)

## Global Constraints

- Audience: "a coder for years" who has never built an assembly game. Lessons explain what familiar ideas become on a Z80; they never teach programming itself. Short paragraphs; code first; a JavaScript aside where it helps ("especially javascript").
- No lesson needs a ROM, and every lesson ends on a program that runs. The Learn page always runs on the stub ROM (`apps/web/app/utils/emulator/stub-rom.z`), even when a ROM is stored.
- No lesson turns interrupts on (no `EI`); timing is a counted delay loop. The screen is memory at `3C00H` (64×16), the keyboard is memory at `3800H`–`3BFFH`.
- Every lesson program: assembles with `@fugloy/asm` with no warning and no error, matches zmac (image, runs, entry), runs headless on the stub ROM in `@fugloy/emu` without entering the ROM's space, and reaches the screen its lesson describes (its `check.json`, with scripted keys where it reads keys). CI runs this with `FUGLOY_REQUIRE_ZMAC=1`.
- Everything a lesson says about the hardware is cited with a `sources.json` id and page (`m3-trm`, `m1-trh`, …), in the lesson file's front matter.
- Layout A: three columns, **lesson | program | TRS-80**; narrow windows stack them in that order.
- Lesson edits and done marks stay in this browser (`localStorage`, every access in try/catch; the page works without it). No server.
- The Learn link stays out of the header and the sitemap until the last task (Task 8), so that what merges is whole.
- The workbench's first screen stays within 252,775 B gzip (252,262 B now). The budget is not raised without the user's agreement: if Task 7 or 8 cannot fit, stop and ask. The Learn page gets its own first-screen measurement and budget (Task 8).
- `check:prefetch` passes (no lazy chunk prefetched by any generated page, `/learn/` included).
- Accessibility: axe checks as the rest of the site; NVDA/VoiceOver hand checks wait for the project's final phase.
- Code style: match the surrounding files (the header comment saying exactly what is true, sentences for every message with the next step, `data-testid`s on what tests touch).
- Commit messages: `p6: …`, imperative, one line, no AI co-author trailer.

## Review Focus

1. **A lesson program the learner broke** (an assembly error, an infinite loop that never draws, a `RET` from the entry, a jump into the ROM): the Learn page says why in a sentence and shows the error line in the editor, as Run ▶ does; it never hangs the page. Test in Task 4 (e2e: type a bad line, Run, see the error; `RET` at the entry, Run, see the stub's sentence).
2. **Moving between lessons while a program runs** (◀ ▶, the lesson list, the browser's Back): the old program stops, the new lesson's program and text show, and no keys, registers or running line from the old one remain. Test in Task 4.
3. **The learner's edits survive** a reload and a visit to another lesson, and **Reset to the lesson** brings back the original and clears the saved edit; with `localStorage` throwing (a private window), the page still works and keeps edits for the visit. Test in Task 3 (unit) and Task 4 (e2e reload).
4. **Keys typed while the editor has focus never reach the TRS-80**, and keys typed on the screen never type into the editor (etch-a-sketch's arrows, rock-paper-scissors' letters). Test in Task 4 (e2e with lesson 1's program and a lesson that reads keys, once Task 5 has one).
5. **A lesson that allows the Model I** run there shows the Model I's shape and font; a lesson that does not, offers no Model I. Test in Task 4 (unit on the switch's options, e2e on shape).

---

### Task 1: The lesson format, lesson 1, and the CI harness

**Files:**
- Create: `apps/web/content/learn/01-white-out/lesson.md`, `program.z`, `check.json`
- Create: `apps/web/app/utils/learn/lesson-format.ts`
- Create: `apps/web/app/utils/learn/lessons.ts`
- Create: `packages/asm/test/lessons.test.ts`
- Test: `apps/web/test/learn-format.test.ts`

**Interfaces:**
- Produces (`lesson-format.ts`):
  ```ts
  export type Inline = { kind: 'text' | 'code' | 'em' | 'strong'; text: string } | { kind: 'link'; text: string; href: string };
  export type LessonBlock =
    | { kind: 'h2'; id: string; text: string }
    | { kind: 'p'; inlines: Inline[] }
    | { kind: 'ul'; items: Inline[][] }
    | { kind: 'code'; lang: 'z80' | 'js'; text: string };
  export interface Cite { source: string; page: string; about: string }
  export interface GameBox { example: 'sea-dragon'; addr: number; name: string; blocks: LessonBlock[] }
  export interface Lesson {
    slug: string; number: number; title: string; idea: string;
    models: (1 | 3)[];           // the first is the lesson's own model
    body: LessonBlock[];          // without the two sections below
    tryIt: LessonBlock[];         // the "## Try it" section, required
    game: GameBox | null;         // the "## In a real game" section with front matter `game`
    cites: Cite[];
    program: string;
  }
  export function parseLesson(slug: string, md: string, program: string): Lesson; // throws Error with a sentence naming the slug and line
  ```
- Produces (`lessons.ts`): `export const LESSONS: readonly Lesson[]` (by number, from `import.meta.glob('../../../content/learn/*/lesson.md', { query: '?raw', eager: true, import: 'default' })` and the matching `program.z`), `export function lessonBySlug(slug: string): Lesson | null`.
- The file format (Task 1 fixes it; later tasks only add files):
  - Front matter between `---` lines, `key: value`: `title`, `idea` (one line: the Z80 idea it shows), `models` (`3` or `3, 1`), `game` (`sea-dragon <run address hex> <NAME>`, optional), and `cite` (repeatable: `<source id> <page> <what it supports>`).
  - The body is a Markdown subset: `## ` headings, paragraphs, `- ` lists, fenced code with `z80` or `js`, inline `` `code` ``, `*em*`, `**strong**`, `[text](href)`. Anything else (HTML, `#`/`###` headings, images, tables) is an error. `## Try it` is required; `## In a real game` is required exactly when `game` is set.
  - `check.json`: `{ "models": [3] | [3, 1], "steps": Step[] }`, `Step` one of `{ "run": <T-states> }`, `{ "press": "<emu key>" }`, `{ "release": "<emu key>" }`, `{ "row": <0-15>, "text": "<exact row, trailing spaces trimmed>" }`, `{ "cell": "<hex address>", "byte": "<hex>" }`, `{ "pcIn": "<LABEL>" }` (PC is within that label's line's bytes, for "it is waiting here").
- Lesson 1, **White out the screen**: `LD`, a 16-bit pointer and counter, a loop (spec Part 2.1). Its program is `packages/asm/examples/clear-screen.z` turned to fill with the all-lit graphics block `0BFH` (so the screen goes white), with lesson-voice comments; the JavaScript aside is the same loop over a `Uint8Array(1024)`. Cites the screen at `3C00H` (`m3-trm`, and `m1-trh` since it allows `3, 1`). `game: sea-dragon 4B9E CLEAR_SCREEN`-style box only if the builder confirms the hints' `$021F` note (run `$4B9E`, which clears with `$80`) in the listing; the box contrasts `$80` (no pixels) with `0BFH`.

- [ ] **Step 1: Write the failing tests.** `learn-format.test.ts`: a minimal valid lesson parses to the expected `Lesson` (front matter, blocks, `tryIt`, `game`, `cites`); each rule's error is thrown with the slug and line in its message (no `## Try it`; `game` without its section and the section without `game`; an unknown front-matter key; `models: 4`; a `###` heading; raw HTML; an unclosed fence; a fence language other than `z80`/`js`); `LESSONS[0].slug === '01-white-out'` and every lesson's `number` matches its folder's `NN`. `packages/asm/test/lessons.test.ts`, one `describe` per folder under `apps/web/content/learn/`: the program assembles for each model in `check.json` with `diagnostics` empty; zmac gives the same image, runs and entry (`skipIfNoZmac()` from `../../disasm/test/roundtrip/zmac.js`); no `EI` is assembled; on emu (`new Machine({ model, roms: { level2: stub } })`, the stub assembled from `apps/web/app/utils/emulator/stub-rom.z` and padded with `76H` to `0x3800` bytes, run `until: 'halt'`, then `m.load.cmd(toCmd(r))`) each step of `check.json` holds and PC never falls below `0x3800` at any `run` step's end; the lesson's `models` front matter equals `check.json`'s `models`.
- [ ] **Step 2: Run** `pnpm --filter @fugloy/web exec vitest run test/learn-format.test.ts` and `pnpm vitest run packages/asm/test/lessons.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** `parseLesson`, `LESSONS`, and lesson 1's three files. Heading ids are the heading's words in lower case joined by `-`.
- [ ] **Step 4: Run** both tests with `FUGLOY_REQUIRE_ZMAC=1` (after `pnpm zmac:install` if `tools/zmac` is missing) — expect PASS; `pnpm typecheck` and `pnpm --filter @fugloy/web typecheck` pass.
- [ ] **Step 5: Commit** `p6: add the lesson format, lesson 1, and the lesson checks`

### Task 2: A stub-only Run for lessons

**Files:**
- Modify: `apps/web/app/composables/useRun.ts`
- Test: `apps/web/test/run-lesson.test.ts`

**Interfaces:**
- Produces: `RunDeps.stubOnly?: boolean` — every Run uses the stub ROM (`rom` null for `runOnce`) and the ROM store is never loaded; `powerOn`, `reset` and `runExample` say `LESSON_NO_POWER` (`'Lessons run on Fugløy\'s stub ROM, so there is no BASIC to turn on. Press Run ▶ to run the lesson\'s program.'`) and do nothing else. `RunDeps.listing?: boolean` (default true) — false: the Run never opens or touches the workbench (`useWorkbench` is not called; the debugger gets `wb: undefined`; `showInListing` does nothing; `listable` is false).
- Consumes: `createSources({ open: async () => null, starter: async () => text })` (existing) as the lesson's in-memory `Sources`.

- [ ] **Step 1: Write the failing tests:** with `createRun({ sources, stubOnly: true, listing: false, kit, runner })` (the fake clock of `test/run.test.ts`'s helpers, `test/source-run-support.ts`): a Run of lesson 1's program runs with message `STUB_RUNNING` even when a fake `roms` reports a stored Model III ROM, and the fake `roms.start` is never called; `useWorkbench` is never called (spy via `vi.mock('~/composables/useWorkbench')` that throws); `powerOn()` sets the message to `LESSON_NO_POWER` and `power.value === 'off'`; `debug.step()` after a pause moves PC and fills `debug.registers`.
- [ ] **Step 2: Run** `pnpm --filter @fugloy/web exec vitest run test/run-lesson.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** both options in `buildRun`; update the file's header comment for them.
- [ ] **Step 4: Run** `pnpm test:web` and `pnpm --filter @fugloy/web typecheck` — expect PASS (5B–5D's Run tests unchanged).
- [ ] **Step 5: Commit** `p6: let a Run be stub-only and leave the workbench alone`

### Task 3: Lesson progress in the browser

**Files:**
- Create: `apps/web/app/utils/learn/progress.ts`
- Test: `apps/web/test/learn-progress.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Progress {
    edit(slug: string): string | null;        // the saved edit, or null
    saveEdit(slug: string, text: string): void; // text equal to the lesson's own removes the edit
    clearEdit(slug: string): void;
    done(): ReadonlySet<string>;
    markDone(slug: string): void;
  }
  export function createProgress(lessonText: (slug: string) => string, storage?: () => Storage | null): Progress;
  ```
  Keys: `fugloy:learn:edit:<slug>`, `fugloy:learn:done` (a JSON array of slugs). Every storage access in try/catch; a throwing or absent storage keeps everything in memory for the visit. Corrupt JSON in `done` reads as none.

- [ ] **Step 1: Write the failing tests:** round trip of an edit; saving the lesson's own text removes the key; `clearEdit`; `markDone` twice keeps one entry; a `storage` whose every method throws still answers from memory (Review Focus 3); `done` with `"{"` stored is empty.
- [ ] **Step 2: Run** `pnpm --filter @fugloy/web exec vitest run test/learn-progress.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test — expect PASS.
- [ ] **Step 5: Commit** `p6: keep lesson edits and done marks in the browser`

### Task 4: The Learn page

**Files:**
- Create: `apps/web/app/pages/learn/[[slug]].vue` (`/learn/` shows lesson 1; `/learn/<slug>/` each lesson)
- Create: `apps/web/app/components/learn/LessonText.vue` (renders `LessonBlock[]`; plain markup, no lazy parts)
- Create: `apps/web/app/components/source/LessonEditor.vue` (lazy root: CodeEditor, the Run ▶ button and Ctrl/⌘+Enter, the breakpoint gutter, the running line, inline errors and fixes, Reset to the lesson, Open in the workbench, and Explain's sentence for a clicked line)
- Create: `apps/web/app/components/run/LessonMachine.vue` (lazy root: the run message, TrsScreen, Pause/Continue, Step, Step Over, Full screen, RegistersPanel, ScreenText; the Model switch when the lesson allows two)
- Create: `apps/web/app/utils/learn/explain-line.ts`
- Modify: `apps/web/nuxt.config.ts` (`nitro.prerender.routes`: `/learn/` and every lesson's `/learn/<slug>/`, read from the content folder names)
- Test: `apps/web/test/e2e/learn.spec.ts`, `apps/web/test/learn-page.test.ts`

**Interfaces:**
- Consumes: Task 1's `LESSONS`, `lessonBySlug`, `Lesson`; Task 2's `createRun({ sources, stubOnly: true, listing: false })`; Task 3's `createProgress`; existing `CodeEditor` (props `docId`, `text`, `label`; events `update:text`, `run`, `fix`, `toggle-breakpoint`, `update:breakpoints`; `setLineDecorations`), `TrsScreen` (`machine`, `running`, `model`; exposes `focus`, `toggleFullscreen`, `fullscreen`, `canFullscreen`), `RegistersPanel` (`debug`), `ScreenText` (`machine`), `installDebugKeys(debug, opts)`.
- Produces: `explainSourceLine(result: AsmResult, bytes: Uint8Array, line: number, model: 1 | 3): string | null` in `explain-line.ts` — the line's first run address from `result.sourceMap.addressesOf(line)`, a disasm session from the .CMD (`openProgram`, the model's default symbols), and `sentenceText` of `explainLine(session, addr)`'s lead sentences; null for a line with no code. `data-testid`s: `lesson-text`, `lesson-title`, `lesson-prev`, `lesson-next`, `lesson-list-toggle`, `lesson-list`, `lesson-done-<slug>`, `lesson-run`, `lesson-reset`, `lesson-open-workbench`, `lesson-explain`, `lesson-model`, `lesson-message`, `lesson-step`, `lesson-pause`, `lesson-fullscreen`, `lesson-try`, `lesson-game`.
- Behaviour fixed here (the builder lays it out):
  - The page owns one in-memory `Sources` and one Run (stub-only, no listing) for its life; each lesson has its own source in it (made on first visit, from the saved edit or the lesson's program; edits saved through `Progress` 500 ms after typing stops). Changing lesson stops the run (Review Focus 2) and selects that lesson's source.
  - A clean Run marks the lesson done. The lesson list (opened from the lesson column's header) shows every lesson by number and title with its done mark.
  - **Reset to the lesson** puts the lesson's program back, clears the saved edit, and stops the run.
  - **Open in the workbench** creates a workbench source (`useSources().create({ name: '<slug>.z', text, model })`, which makes it current) and navigates to `/`; the workbench then shows Source ✎ with that text (the builder finds how the page opens Source ✎ with no program, `wb.writing`, and sets it before navigating).
  - Clicking a program line after a clean Run shows Explain's sentence for it under the editor (`lesson-explain`, `aria-live="polite"`); before a Run it says `'Run the program, then click a line to read what it does.'`.
  - The Model switch shows only for `models.length > 1`; changing it stops the run and the next Run assembles for that model.
  - Columns: CSS grid, three columns from 1200 px wide, stacked below (lesson, program, screen).
  - `usePageSeo` per lesson: title `<lesson title> — Learn Z80 assembly`, a description from `idea`, path `/learn/<slug>`. The page is not linked from anywhere yet and not in `sitemap.xml` (Task 8).
  - The editor and the machine load with `defineAsyncComponent` (both live under lazy roots); the lesson text renders on the server.

- [ ] **Step 1: Write the failing tests.** `learn-page.test.ts` (happy-dom, mounting `LessonText` and the page's pure helpers): blocks render as `h2`/`p`/`ul`/`pre code`; a `js` block carries the label "In JavaScript"; `explainSourceLine` on lesson 1's `LD HL,3C00H` line returns a sentence mentioning `3C00` and null on a comment line. `learn.spec.ts` (no ROM, as CI): `/learn/` shows lesson 1's title and text in the generated HTML (fetch the page, before scripts run); Run ▶ makes `lesson-message` say the stub sentence, and the screen turns white (sample `trs-canvas` with `getImageData` at its top-left, centre and bottom-right pixels: each lit, none the background colour); Pause then Step changes a register row; typing `BAD` on a new line and Run shows the error sentence naming that line (Review Focus 1); replacing the program with `ORG 7000H` / `RET` / `END` and Run shows the stub's return sentence (Review Focus 1); an edit survives a reload, Reset brings the original back (Review Focus 3); ▶ while running moves to lesson 2 (once Task 5 adds it, the test uses whichever lesson is second, skipping with a message while there is only one), the run stops, the registers clear (Review Focus 2); keys typed in the editor leave the machine's keyboard matrix untouched (read `m.system.keyboard` through an e2e hook the page compiles in only with `__FUGLOY_E2E__`, as `pages/index.vue` does) (Review Focus 4); a lesson with `models: 3, 1` shows `lesson-model` and on Model I the tube's width ÷ height is within 0.01 of 0.952 (Review Focus 5; lesson 1 allows both); axe finds no violations on `/learn/`; at 800 px wide the three columns stack.
- [ ] **Step 2: Run** `pnpm --filter @fugloy/web exec vitest run test/learn-page.test.ts` and, after `pnpm build`, `pnpm --filter @fugloy/web exec playwright test test/e2e/learn.spec.ts` — expect FAIL.
- [ ] **Step 3: Implement** the page, the three components, `explain-line.ts`, and the prerender routes.
- [ ] **Step 4: Run** `pnpm test:web`, `pnpm --filter @fugloy/web typecheck`, the full `pnpm --filter @fugloy/web test:e2e`, `check:prefetch`, and `size:first-screen` on a plain `generate` — expect all pass, the workbench's first screen unchanged in size (no link to Learn yet).
- [ ] **Step 5: Commit** `p6: add the Learn page`

### Task 5: Lessons 2–4

**Files:**
- Create: `apps/web/content/learn/02-registers/`, `03-etch-a-sketch/`, `04-rock-paper-scissors/` (each `lesson.md`, `program.z`, `check.json`)

**Interfaces:**
- Consumes: Task 1's format; Task 1's harness checks them with no code change.
- Content fixed by the spec (Part 2):
  - **2, The registers, and why HL** — A, F (the flags), B–L, the fixed pairs BC/DE/HL (the 3-bit register numbers in the encoding: B=0 C=1 D=2 E=3 H=4 L=5 (HL)=6 A=7, so neighbours pair, and `LD r,r'` is `01 rrr rrr`; cite Zilog's Z80 CPU User Manual only if it is added to `sources.json` with a page, else cite nothing for the encoding and show it from Fugløy's own z80 table), H and L as High and Low (an address's two bytes), the 8008/8080 lineage (the 8008's H and L addressed memory; the 8080 paired B–C and D–E; the Z80 kept both and added IX, IY, the shadow set), SP, PC; a short program that loads and adds and pairs registers and ends in a wait loop, with "Pause, then Step, and watch HL" in Try it. The JavaScript aside: `const hl = (h << 8) | l`.
  - **3, Etch-a-sketch** — reading the keyboard matrix: the arrow keys' row at `3840H` (bit 3 up, 4 down, 5 left, 6 right; cite `m3-trm` and `m1-trh` with pages, after checking the bit order in emu's `src/devices/keyboard.js` and the manuals), `AND` and `BIT` tests, moving a position in video memory with bounds, plotting with a graphics character. `check.json` presses RIGHT for a counted run and checks the plotted cells.
  - **4, Rock, paper, scissors** — printing text from a table, waiting for a key (R, P or S rows of the matrix), a random choice from `LD A,R`, `CP`, the flags and conditional jumps. `check.json` presses a key and checks that one of the three result lines shows (the R register's value at that cycle is fixed in a headless run, so the test may name the exact line it expects, saying so in a comment).
  - Each has `## Try it` (one change and what Run will show), a JavaScript aside, and an In a real game box only where Task 7's search finds a clear Sea Dragon match (leave `game` out for now; Task 7 adds boxes).
- Review Focus 4's e2e (keys on the screen reach the machine, keys in the editor do not) moves from lesson 1 to lesson 3 here: add the step to `learn.spec.ts` (arrow keys on the screen plot; arrow keys in the editor move the cursor and plot nothing).

- [ ] **Step 1: Write** lesson 2's three files, then run `pnpm vitest run packages/asm/test/lessons.test.ts` with `FUGLOY_REQUIRE_ZMAC=1` — expect PASS for 01 and 02.
- [ ] **Step 2: Write** lesson 3's files and the e2e step; run the harness and `playwright test test/e2e/learn.spec.ts` — expect PASS.
- [ ] **Step 3: Write** lesson 4's files; run the harness — expect PASS.
- [ ] **Step 4: Read** each lesson on the page (`pnpm --filter @fugloy/web dev`), run it, do its Try it, and fix any text that does not match what the screen shows.
- [ ] **Step 5: Commit** `p6: add lessons 2 to 4`

### Task 6: Lessons 5–7

**Files:**
- Create: `apps/web/content/learn/05-ship/`, `06-ship-fires/`, `07-invaders-march/` (each `lesson.md`, `program.z`, `check.json`)

**Interfaces:**
- Consumes: Task 1's format and harness; Task 5's keyboard facts (lesson 3) referred to, not repeated.
- Content fixed by the spec (Part 2):
  - **5, A ship along the bottom** — `CALL` and `RET`, the stack (`PUSH`/`POP`, what `SP` does; the stub's stack is at the top of memory), a delay loop (its T-states counted against the 2.03 MHz clock, Model I 1.77 MHz), erasing and redrawing a three-character ship on row 15 moved by the left and right arrows. `check.json`: press LEFT, run, ship moved left by the expected cells; at column 0 it stays.
  - **6, The ship fires** — two things moving at once in one game loop, state kept in memory (`DB`/`DW` variables, `LD A,(SHOT_Y)`), space bar fires, the shot rises and disappears at row 0, one shot at a time. `check.json`: press SPACE, run, a shot character is above the ship; run on, it is gone.
  - **7, Invaders march** — a table of data (`DB` rows), `IX` with an offset (`LD A,(IX+2)`), `DJNZ`; a row of invaders drawn from a table marching left and right. `check.json`: two snapshots a counted run apart show the row moved one cell.
  - Lesson 7's text ends by pointing at the capstone ("the next part builds a whole game, piece by piece"), without a link (6C adds it).

- [ ] **Step 1: Write** lesson 5's files; run the harness — expect PASS.
- [ ] **Step 2: Write** lesson 6's files; run the harness — expect PASS.
- [ ] **Step 3: Write** lesson 7's files; run the harness — expect PASS.
- [ ] **Step 4: Read** each on the page, run it, do its Try it, and fix any mismatch.
- [ ] **Step 5: Commit** `p6: add lessons 5 to 7`

### Task 7: In a real game: Sea Dragon at an address

**Files:**
- Create: `apps/web/app/utils/deep-link.ts` (loaded by dynamic import only)
- Modify: `apps/web/app/pages/index.vue` (one guarded dynamic import on mount)
- Modify: lessons' `lesson.md` (front matter `game` and the `## In a real game` section, where a match is clear)
- Modify: `apps/web/app/components/learn/LessonText.vue` or the page (the box: its text and an **Open Sea Dragon at NAME** link)
- Test: `apps/web/test/deep-link.test.ts`, `apps/web/test/e2e/learn.spec.ts`

**Interfaces:**
- Produces: the workbench URL `/?example=sea-dragon&at=<4 hex digits>` (run address); `openDeepLink(search: string, wb: Workbench, go: (addr: number) => void): Promise<boolean>` in `deep-link.ts` — opens the example with its hints (`wb.openExample(id)`), moves the cursor to `at` (`go`), and removes the query with `history.replaceState`; returns false (doing nothing) for an unknown example, a missing or malformed `at`, or Armored Patrol. `index.vue` calls it only when `location.search` is not empty: `if (location.search !== '') void import('~/utils/deep-link').then((d) => d.openDeepLink(location.search, wb, go))`.
- The box link is `/?example=sea-dragon&at=<hex>`; its label is `Open Sea Dragon at <NAME>`.
- Candidates to confirm in `examples/sea-dragon/seadrg01.hints` and the listing (offsets from `$497F`): lesson 1 ↔ the screen clear at block offset `$021F`; lesson 3 ↔ `$01DF` (watches `$3840` for ENTER); lesson 4 ↔ `$022D` (1 or 2 Players?, keyboard row `$3810`, `CP` and jumps); lesson 5 ↔ the frame delay (`FRAME_DELAY`); lesson 6 ↔ the main loop at `$0339`; lesson 7 ↔ a table walked with an index (`DATA_6602` read with `LD A,(IY+n)` at `$0032`). Lesson 2 gets none unless a clear match appears. Each box's text says what the same idea looks like there, in two or three sentences, in the hints' plain style; a box whose match is not clear is left out (spec Part 3).

- [ ] **Step 1: Write the failing tests:** `deep-link.test.ts`: a valid query opens the example and calls `go(0x4B9E)` for `at=4B9E`, and replaces the URL; `at=XYZ`, `at=12345`, `example=nope` and `example=armored-patrol` return false and open nothing. `learn.spec.ts`: lesson 1's box link opens the workbench with Sea Dragon, the cursor row on `$4B9E`, and the address bar back to `/`.
- [ ] **Step 2: Run** them — expect FAIL.
- [ ] **Step 3: Implement** `deep-link.ts` and the guarded import; confirm each candidate address in the listing (open Sea Dragon in the workbench, read the rows) and write the boxes that hold.
- [ ] **Step 4: Run** `pnpm test:web`, typecheck, the full e2e, `check:prefetch`, and `size:first-screen` on a plain `generate` — expect all pass and the first screen within 252,775 B. If it is over, stop and ask the user (Global Constraints).
- [ ] **Step 5: Commit** `p6: open Sea Dragon at an address from a lesson`

### Task 8: Link Learn, measure it, and record 6B

**Files:**
- Modify: `apps/web/app/components/TopBar.vue` (a `Learn` link first in the Site nav, to `/learn`)
- Modify: `apps/web/public/sitemap.xml` (`/learn/` and each lesson's URL)
- Modify: `apps/web/test/seo.test.ts` if it lists the pages
- Modify: `apps/web/scripts/first-screen-size.mjs` (a `--page learn` mode: the same method on `learn/index.html`, with its own budget constant `LEARN_BUDGET`)
- Modify: `apps/web/app/pages/about.vue` (the lessons in one sentence, if the page lists the site's parts)
- Modify: `CHANGELOG.md` (Unreleased), `docs/Fugloy-Project-Plan.md` (phase 6: 6B merged), `CLAUDE.md` (Current phase; the `content/learn/` layout and the lesson checks in Stack and layout)

**Interfaces:**
- `LEARN_BUDGET` is the Learn page's first screen as this task measures it, rounded up to the next 1,024 B, plus 5,120 B (the method 5B used for the workbench's budget); the script exits 1 over it.

- [ ] **Step 1: Write the failing check:** the seo test (or `pages.spec.ts`) expects `/learn/` with a title, description and canonical URL, in the sitemap, and linked from the header on every page.
- [ ] **Step 2: Run** it — expect FAIL.
- [ ] **Step 3: Implement** the link, the sitemap, the measurement mode, and the records.
- [ ] **Step 4: Run** `pnpm typecheck`, `pnpm test`, `pnpm test:web`, `pnpm --filter @fugloy/web test:seo`, `check:prefetch`, the full e2e, `size:first-screen` (the workbench within 252,775 B; if the link puts it over, stop and ask the user) and `size:first-screen -- --page learn` — expect all pass.
- [ ] **Step 5: Commit** `p6: link the Learn page and record phase 6B`
