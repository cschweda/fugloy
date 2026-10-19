# Phase 6: Learn assembly with Fugløy

Designed with the user on 2026-10-19. Their words are quoted; everything else that decides
something is marked **Claude's call**.

## Intent

"They're a retro computer enthusiast, and they want to ease into it." "This is for someone like
me — a coder for years — but I've never built an assembly language game. The Z80 seems like the
best way to ease into it." The learner reads a small finished program, assembles it, watches it
run on a TRS-80 that looks like the real thing, changes it, and runs it again: "stuff that makes
you want to look at the source, assemble it, and then see it in action in the emulator."

This supersedes the plan's earlier audience ("people who have never programmed"): the lessons
assume programming and explain what familiar ideas become on a Z80.

## Goals

1. **A ladder of small programs**, each showing how one part of the Z80 works: "white out the
   screen, etch-a-sketch, moving a spaceship along the bottom of the screen and shooting …
   a rock scissors paper game — simple stuff — but apps that can demonstrate how the z80 works."
2. **A short lesson beside each program** ("a short lesson would be great"), with a line or two
   of JavaScript where it helps ("especially javascript as you suggest").
3. **The registers explained**, early and plainly, including why the pairs are BC, DE and HL
   (asked: "Why 'HL' and not 'BE'?").
4. **The Westmoreland games** beside the lessons, as real programs built from the same pieces.
5. **The capstone: a Space Invaders-style game from a blank page**, "short chapters. Piece by
   piece", "as many lessons as necessary — with the ability to run the lesson at the lesson's
   end (so there's always something to run)."
6. **No ROM needed** for any lesson (asked; answered yes).
7. **A real TRS-80 screen**: "Same aspect ratio, same fonts, enlargable where possible — but it
   should look like a real trs80 screen." For the Model I and the Model III.

## Non-goals

- Teaching programming itself (variables, loops, functions as ideas).
- The Model 4 in lessons (its programs would differ; the Model III and Model I are enough).
- Accounts, progress tracking on a server, certificates. Progress and edits stay in the browser.
- Sound in the first cut (the cassette-port beeper can be a later chapter). **Claude's call.**

## Anti-goals (what would make it a failure even if it works)

- A lesson that needs a ROM, or ends with nothing to run.
- A screen that does not look like the real machine.
- Explanations pitched at someone who has never programmed, or prose that buries the code.
- A lesson program that drifts from what its text says (every lesson program is tested).

## Part 0: the screen's shape (Run ▶ and Learn)

Research (2026-10-19; 48k.ca "Beamhacking: Video Timing", MAME `trs80.cpp`, xtrs
`trs_xinterface.c`, emu `models.js`): both machines draw a line in the same 63.13 µs, but the
Model I's 384 active dots take 36.07 µs (10.6445 MHz dot clock) and the Model III's 512 take
50.50 µs (10.1376 MHz), so at equal height the Model I's picture is 50.50 / 36.07 ≈ 1.40 times
narrower. The absolute shape depended on a monitor's knobs; xtrs and trsjs show the Model III at
4:3; MAME's Model III screen parameters are a marked placeholder.

- **Decided (Claude's call, offered to the user, no photo available):** the Model III screen is
  4:3; the Model I is (4/3) × (36.07 / 50.50) ≈ 0.952:1, drawn from the timing figures in code
  with a comment citing them. The Model 4 keeps 4:3 (both its sizes).
  6A ruling: no model is drawn narrower than its dots across where space allows (rows scale by
  whole screen pixels), so in a typical panel the Model I is taller than the Model III.
- Both enlarge with the window (as today, by whole rows) and gain a **full-screen** button
  (the Fullscreen API on the screen box; Esc leaves it). This fixes Run ▶ too.
- A photo of a real screen can later adjust the two numbers; nothing else depends on them.

## Part 1: the Learn page

A new page, `/learn`, linked from the site's header and the workbench. Three columns (chosen
from mockups: "A looks good for now"): **lesson | program | TRS-80**.

- **Lesson column:** the lesson's text (headings, short paragraphs, code snippets, a
  JavaScript aside where it helps), a **Try it** box (a change to make, then Run again), and ◀ ▶
  to the previous and next lesson. A lesson list (the ladder, with done marks kept in the
  browser) opens from the column's header.
- **Program column:** the lesson's program in the same CodeMirror editor as Source ✎ (its inline
  errors and fixes), editable. Run ▶ (and Ctrl/⌘+Enter) assembles and runs it on the TRS-80
  column. **Reset to the lesson** restores the original. Edits are kept per lesson in the
  browser. **Claude's call:** a lesson's program is not one of the workbench's sources, but
  **Open in the workbench** copies it into one.
- **TRS-80 column:** the Run ▶ screen (Part 0's shape and full-screen), on the stub ROM, with
  the registers and flags under it (5C's panel) and Step / Continue, so a lesson can say "step
  and watch HL move". **Claude's call:** a click on a program line shows Explain's sentence for
  it under the program, as the workbench's Explain tab does.
- Model: each lesson names its model (Model III by default); a switch runs it on the Model I
  where the lesson allows, and the text notes the differences that matter (no lowercase, the
  narrower screen).
- Narrow windows stack the columns (lesson, program, screen). **Claude's call.**

## Part 2: the ladder (as many lessons as necessary)

User (2026-10-19): "each lesson should be self contained, building on the previous, and provide a
runnable deliverable at the end (on Model III emulator)." So each lesson's program is complete in
itself (it assembles and runs alone, with nothing included from another lesson), builds on the
lesson before it (it reuses and extends that lesson's code and ideas, and the text says what is
carried over and what is new), and ends on a program that runs on the Model III; the Model I is an
option where a lesson allows it, never the only one.

**Claude's call** on the order and split, from the user's list; each lesson names the Z80 idea it
shows and ends on a program that runs. On the stub ROM there is no ROM to call, so the lessons
drive the hardware directly — itself the lesson: the screen is memory at `3C00H`, the keyboard
is memory at `3800H`–`3BFFH`. No lesson turns interrupts on (the stub ROM has no handler); timing
is a counted delay loop.

1. **White out the screen** — `LD`, a 16-bit pointer and counter, a loop (the starter
   `clear-screen.z` in its lesson form).
2. **The registers, and why HL** — A, F (the flags), B–L, the fixed pairs BC/DE/HL (from the
   3-bit register numbers in the encoding: neighbours pair), H and L as High and Low, the
   8080/8008 lineage, IX/IY, SP, PC, the shadow set; stepping lesson 1 and watching them.
3. **Etch-a-sketch** — reading the keyboard matrix (arrow keys' row and bits), `AND` and bit
   tests, moving a position in video memory, plotting with a graphics character.
4. **Rock, paper, scissors** — printing text from a table, waiting for a key, a random choice
   from the R register, `CP`, the flags and conditional jumps.
5. **A ship along the bottom** — `CALL` and `RET`, the stack, a delay loop, erasing and redrawing.
6. **The ship fires** — two things moving at once, a game loop, keeping state in memory.
7. **Invaders march** — tables of data, `IX` with an offset, `DJNZ`.

Each lesson has an **In a real game** box pointing at the same idea in a Westmoreland game
(Sea Dragon, Rear Guard, Eliminator) — Part 3.

## Part 3: the Westmoreland games beside the lessons

An **In a real game** box opens the workbench on that game at a named address with its hints
(Sea Dragon's annotated hint file is the model), so the learner sees Westmoreland and Gilman
doing the same thing at full size. **Claude's call:** the builder finds and checks each address
in the annotated listings; where no clear match exists the box is left out rather than stretched.
**Claude's call (builder check):** the first cut points only at Sea Dragon, the one game with an
annotated hint file (`examples/sea-dragon/seadrg01.hints`); hint files for Rear Guard and
Eliminator are a later task, after which their boxes are added.

## Part 4: the capstone — Space Invaders from a blank page

Short chapters, piece by piece, as many as needed; each chapter's program is the last one with
its changes shown: new lines highlighted, changed lines marked, removed lines struck through (a
real game reworks earlier code: the do-nothing loop gets a body, one invader becomes a table).
**Claude's call** (builder check, 2026-10-19): chapters may change and remove earlier lines, not
only add; CI checks each chapter against the previous one as a marked diff. Each chapter runs at
its end. Each chapter's new code is **already filled in** (user, 2026-10-19: "filled in"): the
learner reads the highlighted changes, runs the chapter, and tweaks it; every chapter opens on
the lesson's own version (Reset to the lesson restores it), not on the learner's edits to the
chapter before. **Claude's call** on the first
cut of chapters (the builder may split or merge):

1. A blank screen and a game loop that does nothing yet.
2. Draw the base on the bottom row.
3. Move the base with the arrow keys, kept inside the screen.
4. Fire one shot that rises and disappears.
5. One invader.
6. A row of invaders (a table).
7. The row marches left and right.
8. Reaching an edge, it inches down.
9. The shot hits an invader (collision).
10. Several rows, and a score.
11. Invaders that drop bombs; losing a life.
12. Winning a wave; the next wave faster.

The finished game is a proper small game on the Model III (and the Model I where the lesson
allows), in the spirit of Big Five's Super Nova and its kin.

## Constraints

- Lesson content is files in the repository (Claude's call: `apps/web/content/learn/<NN-slug>/`
  with `lesson.md` and `program.z`, chapters likewise under `invaders/`), shipped with the static
  site. No server.
- Every lesson program is checked in CI: it assembles with `@fugloy/asm` and matches zmac, runs
  headless on the stub ROM in `@fugloy/emu`, and reaches the screen its lesson describes (a
  scripted key sequence where it reads keys). Chapter programs also check that each one is the
  previous one plus its highlighted lines.
- The Learn page loads lazily and does not grow the workbench's first screen (its 252,775 B
  budget, 510 B left); the Learn page gets its own first-screen measurement.
- Everything the lessons say about the hardware is cited as the symbol tables are (the Model III
  Technical Reference Manual, the Model I handbook), in the lesson files.
- Accessibility: axe checks as the rest of the site; NVDA/VoiceOver hand checks wait for the
  project's final phase (user, 2026-10-19).

## Delivery

**Claude's call (builder check):** in sub-phases merged one at a time, as 5A–5D were, since main
deploys to `app.fugloy.dev`: **6A** Part 0 (the screen's shape and full screen, in Run ▶ too);
**6B** the Learn page and lessons 1–7, with the Sea Dragon boxes; **6C** the capstone chapters.
The Learn link stays out of the header (the page reachable only by its URL, and out of the
sitemap) until 6B is merged. Each sub-phase is recorded in the CHANGELOG; the site is the
release (no npm package changes unless a library gains an API, which then releases as usual).
The workbench's first screen must stay within its budget: the Learn link is plain markup, and
if it still does not fit, something else on the first screen is trimmed; the budget is not
raised without the user's agreement.

## Left to the builder

The lesson text itself, the programs, the keyboard-matrix details, the exact chapter split, the
Learn page's components and routes, how lesson progress is stored, and the tests.
