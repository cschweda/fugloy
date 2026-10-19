# Phase 6C: Space Invaders from a blank page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Twelve short chapters on the Learn page that build a Space Invaders-style game from a blank page, piece by piece, each chapter's program the last one with its changes highlighted, already filled in, and always runnable.

**Architecture:** Chapters are lesson folders (`lesson.md`, `program.z`, `check.json`, the 6B format) under `apps/web/content/learn/invaders/<NN-slug>/`, served at `/learn/invaders/<slug>/` by the same page machinery as the lessons, generalised from "the lessons" to "a course" (an ordered list of items with a base path). A line diff (`utils/learn/diff.ts`) between a chapter's program and the previous chapter's marks new and changed lines in the editor and lists removed lines struck through beside it. The 6B harness runs every chapter like a lesson and also checks each chapter differs from the one before.

**Tech Stack:** Nuxt 4 / Vue 3, TypeScript strict, CodeMirror 6 decorations, `@fugloy/asm`, `@fugloy/emu`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-19-phase6-learn-assembly-design.md` (Part 4, Constraints, Delivery 6C)

## Global Constraints

- Short chapters, piece by piece, "as many lessons as necessary — with the ability to run the lesson at the lesson's end (so there's always something to run)". The first cut is the spec's twelve; the builder may split or merge (record it).
- Each chapter is self-contained, builds on the previous, and ends on a runnable program on the Model III (user, 2026-10-19): its `program.z` assembles and runs alone; chapter 1 starts from a blank page; every later chapter is the previous chapter's program with its changes; `models` lists `3` first (the Model I where the chapter allows it).
- Each chapter's new code is **already filled in** ("filled in"): the learner reads the highlighted changes, runs the chapter, and tweaks it. Every chapter opens on its own version; **Reset to the lesson** restores it; it never starts from the learner's edits to the chapter before.
- Chapters may change and remove earlier lines, not only add; the changes are shown: new lines highlighted, changed lines marked, removed lines struck through.
- Every chapter program passes the 6B lesson checks (asm with no warning or error, zmac's image, no `EI`, the stub ROM, `check.json` with scripted keys) and differs from the chapter before.
- The finished game (chapter 12) is a proper small game on the Model III: a base that moves and fires, rows of invaders that march and descend, collisions, a score, bombs and lives, waves that speed up — in the spirit of Big Five's Super Nova. No sound (spec Non-goals). No `EI`: timing by counted loops.
- Everything a chapter says about the hardware is cited as in 6B (row addresses cited; the in-row key bit order framed as Fugløy's emulator's, from the ROM's own keyboard routine; clock speeds as what Fugløy runs). Z80 claims exact. The "Carried over / New" paragraph of 6B becomes "What changed": exact against the diff.
- The workbench's first screen stays ≤ 252,775 B (229,027 B now); the Learn page's first screen ≤ `LEARN_BUDGET` 221,184 B, and a chapter page within the same budget. Neither budget is raised without the user. `check:prefetch` passes.
- Lesson edits and done marks stay in the browser (6B's `Progress`), keyed so a chapter never collides with a lesson.
- Commit messages: `p6: …`, imperative, one line, no AI co-author trailer.

## Review Focus

1. **A chapter whose diff is long** (a rework that touches many lines): the editor's marks and the removed-lines list stay readable and in step with the text (line numbers right after a removal). Test in Task 1 (diff unit tests on a rework; e2e on a chapter with removals once Task 3 has one).
2. **The learner edits a chapter**: the marks describe the chapter's own text only — once the text differs they hide, saying so, and Reset brings them back; they never mark the learner's own lines as the chapter's. Test in Task 1.
3. **Moving from lesson 7 into chapter 1, and between chapters, while running**: the old program stops, the new chapter's text and marks show (6B's Review Focus 2, for chapters). Test in Task 1 (e2e) and Task 5 (the link from lesson 7).
4. **A game that never ends in a test run** (the invaders loop forever): `check.json` steps stop where the screen proves the claim; the harness never waits on the game to finish. Test in each content task.
5. **Progress keys**: a chapter `01-…` and lesson `01-…` keep separate edits and done marks. Test in Task 1.

---

### Task 1: Chapters as a course, the diff marks, and chapter 1

**Files:**
- Create: `apps/web/content/learn/invaders/01-blank-loop/` (`lesson.md`, `program.z`, `check.json`)
- Create: `apps/web/app/utils/learn/diff.ts`
- Modify: `apps/web/app/utils/learn/lessons.ts` (`CHAPTERS`, `chapterBySlug`; both lists read only `NN-slug` folders)
- Modify: `apps/web/app/pages/learn/[[slug]].vue` → its body moves to `apps/web/app/components/learn/CoursePage.vue`; create `apps/web/app/pages/learn/invaders/[[slug]].vue`
- Modify: `apps/web/app/components/source/LessonEditor.vue` (the marks), `apps/web/app/components/learn/LessonText.vue` or a new `ChangesList.vue` (removed lines)
- Modify: `apps/web/nuxt.config.ts` (prerender `/learn/invaders/` and each chapter), `packages/asm/test/lessons.test.ts` (chapters too)
- Test: `apps/web/test/learn-diff.test.ts`, `apps/web/test/learn-format.test.ts`, `apps/web/test/learn-progress.test.ts` (keys), `apps/web/test/e2e/learn.spec.ts`

**Interfaces:**
- Produces (`diff.ts`):
  ```ts
  export type LineMark = 'new' | 'changed';
  export interface LineDiff {
    /** 1-based lines of the new text, each new or changed (a changed line replaces a removed one in place). */
    marks: Map<number, LineMark>;
    /** Removed lines of the old text, each with the new-text line it sat before (1-based; text length + 1 at the end). */
    removed: { before: number; text: string }[];
  }
  export function lineDiff(oldText: string, newText: string): LineDiff;
  ```
  A longest-common-subsequence diff over lines, compared with trailing whitespace trimmed. Inside each hunk, removed and added lines pair up in order as `changed`; extra added lines are `new`; extra removed lines go to `removed`. Chapter 1's diff is against the empty text (every line `new`).
- Produces (`lessons.ts`): `export const CHAPTERS: readonly Lesson[]` from `content/learn/invaders/NN-slug/`; `chapterBySlug(slug)`; `LESSONS` and the 6B harness and prerender list read only `^\d{2}-` folders, so `invaders/` is not a lesson.
- Produces: `CoursePage.vue` with props `{ items: readonly Lesson[]; item: Lesson; basePath: '/learn' | '/learn/invaders'; course: 'lessons' | 'invaders'; previous: Lesson | null }` — the 6B page's three columns, lesson list, ◀ ▶, Progress, Run, Reset, Open in the workbench, Explain, Sea Dragon box, SEO, all as in 6B, with the kicker `Learn Z80 assembly · Lesson N of 7` or `Build Space Invaders · Chapter N of 12`. Progress ids: the lesson's slug for lessons, `invaders/<slug>` for chapters.
- Produces: `LessonEditor` prop `marksAgainst: string | null` (the previous chapter's program; `null` for lessons). While the editor's text equals the chapter's own program, new lines carry a green band and a `+` gutter mark, changed lines an amber bar and `~` (`data-testid="change-mark"` on the gutter elements, CodeMirror line classes `fg-chg-new`, `fg-chg-changed`), and the removed lines show beside the editor in a **What changed** list (`data-testid="lesson-removed"`, each line struck through with its position named for screen readers: "Removed before line 12: …"). Once the text differs, the marks hide and a note (`data-testid="lesson-marks-hidden"`) says `"Your edits hide the chapter's marks. Reset to the lesson brings them back."`.
- `/learn/invaders/` opens chapter 1 and names chapter 1's URL as its canonical one (6B's `/learn/` rule).
- Chapter 1, **A blank screen and a game loop that does nothing yet**: clear the screen (from lesson 1's fill, written fresh), a main loop that calls a counted WAIT and jumps back. Its "What changed" says everything is new; its text says where the game will grow.

- [ ] **Step 1: Write the failing tests:** `learn-diff.test.ts` — identical texts give no marks; an appended line is `new`; an edited line is `changed` at its line; a deleted line goes to `removed` with the right `before`; a rework (3 lines out, 5 in) gives 3 `changed` and 2 `new`; trailing-space-only changes are no change; empty old text marks every line `new`. `learn-format.test.ts` — `CHAPTERS[0].slug === '01-blank-loop'`, `LESSONS` has no `invaders` entry. `learn-progress.test.ts` — `markDone('invaders/01-blank-loop')` leaves `01-white-out` not done. `lessons.test.ts` (harness) — the chapters run like lessons, and each chapter's program differs from the previous chapter's. `learn.spec.ts` — `/learn/invaders/` shows chapter 1, its title, and 16+ `change-mark`s; Run ▶ turns the screen blank and the loop runs; typing a line hides the marks with the note, Reset shows them again (Review Focus 2); moving from lesson 7 to chapter 1 while running stops the run (Review Focus 3); `/learn/` still works as before (its 6B tests pass unchanged).
- [ ] **Step 2: Run** them — expect FAIL.
- [ ] **Step 3: Implement.** Keep 6B's behaviour for lessons exactly; the page moves into `CoursePage.vue` without changing what it renders for lessons.
- [ ] **Step 4: Run** `pnpm test:web`, typecheck, the harness with `FUGLOY_REQUIRE_ZMAC=1`, the full e2e after `pnpm build`, `check:prefetch`, `size:first-screen` (workbench) and `size:first-screen -- --page learn` — all pass, budgets held.
- [ ] **Step 5: Commit** `p6: add the Space Invaders course, its change marks, and chapter 1`

### Task 2: Chapters 2–5

**Files:** `apps/web/content/learn/invaders/02-base/`, `03-move-base/`, `04-shot/`, `05-one-invader/` (each `lesson.md`, `program.z`, `check.json`)

**Interfaces:**
- Consumes: Task 1's folder layout, harness and marks (no code change expected).
- Content (spec Part 4 items 2–5): **2** draw the base on the bottom row (a routine, its position in memory); **3** move it with the arrow keys, kept inside the screen; **4** fire one shot that rises and disappears; **5** one invader. Each chapter's "What changed" names every new, changed and removed piece, exactly as the diff shows. Lessons 5–6 taught these ideas; a chapter may say so ("as in lesson 5") but explains briefly again — the chapter stands alone.
- Each `check.json` proves the chapter's claim with margins of at least ~50,000 T from the program's keyboard reads and screen writes (6B's measured standard), no extra keys.

- [ ] **Step 1: Write** chapter 2; run the harness — expect PASS.
- [ ] **Step 2: Write** chapter 3; run the harness — expect PASS.
- [ ] **Step 3: Write** chapter 4; run the harness — expect PASS.
- [ ] **Step 4: Write** chapter 5; run the harness — expect PASS; read 2–5 on the page with their marks, run each, do each Try it.
- [ ] **Step 5: Commit** `p6: add chapters 2 to 5`

### Task 3: Chapters 6–9

**Files:** `invaders/06-row/`, `07-march/`, `08-descend/`, `09-hit/`

**Interfaces:**
- Content (spec Part 4 items 6–9): **6** a row of invaders from a table (the one invader becomes a table: lines change and go — this chapter shows removals); **7** the row marches left and right; **8** reaching an edge, it inches down; **9** the shot hits an invader (collision: compare the shot's next cell with the invader characters, remove the invader and the shot).
- Review Focus 1's e2e: add a step on chapter 6 to `learn.spec.ts` — its removed lines show struck through, and each changed line's gutter mark sits on the line the diff names.
- `check.json`: chapter 9 aims and fires so a known invader is hit and its cell clears.

- [ ] **Step 1–4: Write** each chapter, harness after each; read each on the page; add the chapter 6 e2e step and run `learn.spec.ts`.
- [ ] **Step 5: Commit** `p6: add chapters 6 to 9`

### Task 4: Chapters 10–12

**Files:** `invaders/10-rows-score/`, `11-bombs-lives/`, `12-waves/`

**Interfaces:**
- Content (spec Part 4 items 10–12): **10** several rows and a score (a number printed in decimal: the score kept as BCD with `DAA`, or a binary-to-decimal routine — the chapter explains its choice); **11** invaders drop bombs (a falling character from a chosen invader, using `LD A,R` as lesson 4 did), a bomb hitting the base loses a life, the game ends with no lives left (a GAME OVER line); **12** clearing a wave starts the next one faster (the march delay shortens), and the finished game's text says what the learner built and points back at Sea Dragon.
- `check.json`: chapter 10 proves a hit adds to the score; chapter 11 proves a bomb reaches the bottom row and a life is lost (the R-driven choice is deterministic in a headless run; say so in the report, not in check.json); chapter 12 proves a cleared wave redraws the invaders (drive it by a scripted sequence, or by a test-only short wave only if the chapter's text explains the constant).

- [ ] **Step 1–4: Write** each chapter, harness after each; read each on the page; play chapter 12 to a cleared wave and to GAME OVER.
- [ ] **Step 5: Commit** `p6: add chapters 10 to 12`

### Task 5: Link the course and record 6C

**Files:**
- Modify: lesson 7's `lesson.md` (its last paragraph links to `/learn/invaders/`)
- Modify: `CoursePage.vue` (the lesson list shows both courses: Lessons 1–7, then Build Space Invaders 1–12)
- Modify: `apps/web/public/sitemap.xml` (each chapter's canonical URL), `apps/web/test/seo.test.ts` (the chapters among the pages; `/learn/invaders/` an alias like `/learn/`)
- Modify: `apps/web/scripts/first-screen-size.mjs` if a chapter page needs its own `--page` (else record that chapter pages share the Learn page's measurement)
- Modify: `CHANGELOG.md`, `docs/Fugloy-Project-Plan.md` (phase 6: 6C merged, phase 6 done), `CLAUDE.md` (Current phase; Stack and layout)

- [ ] **Step 1: Write the failing checks:** seo (each chapter's title, description, canonical, in the sitemap; `/learn/invaders/` canonical to chapter 1); `learn.spec.ts` (lesson 7's link opens chapter 1; the lesson list lists both courses with done marks).
- [ ] **Step 2: Run** them — expect FAIL.
- [ ] **Step 3: Implement** the links and the records.
- [ ] **Step 4: Run** `pnpm typecheck`, `pnpm test` (zmac), `pnpm test:web`, `test:seo`, `check:prefetch`, the full e2e, both `size:first-screen` measurements — all pass.
- [ ] **Step 5: Commit** `p6: link the Space Invaders course and record phase 6C`
