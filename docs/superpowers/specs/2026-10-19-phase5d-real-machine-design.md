# Phase 5D: the TRS-80 on screen

Requested 2026-10-19: "the emulator should look and act like the emulator at trs80js
(https://trsjs.48k.ca/) … actual Model I and III screen, not a screen with typing underneath. Run
it as an actual TRS-80." The user skipped the design questions and asked for a start, so every
choice below that is not quoted is **Claude's call**, marked as such where it matters.

## Intent

Run ▶ today is a debugger panel with a screen in it: the screen is drawn in a generic X.Org font,
the ROM's `Cass?` and `Memory Size?` are answered out of sight, there is no machine at all until a
source is assembled, and controls, registers, breakpoints, the ROM section and the screen-text
disclosure surround the tube. trsjs is a TRS-80: a black tube in the machine's own character
font, a cursor waiting at `Cass?`, and a few controls on and under the screen. 5D makes Run ▶ the
second kind of thing without losing what 5B and 5C built.

## Goals

1. **The machine's own look.** The screen draws the real character generator glyphs, black tube,
   white phosphor, at the machine's 4:3 shape, sized as large as the panel allows.
2. **A machine that is on.** With a ROM for the model, opening Run ▶ (or pressing Power) boots
   it live and visibly: `Cass?`, then `Memory Size?`, then `READY`, each waiting for the user, as
   on the real machine. The user can type BASIC at `READY` and run it. Reset reboots.
3. **Typing goes straight to the TRS-80.** The screen takes focus when the machine powers on,
   on Reset, and when Run ▶ starts a program, so the user types without clicking first.
4. **Programs to try**, as trsjs lists them: the bundled public-domain games run on the machine
   with one press each.
5. **Run ▶ still works as in 5B/5C**: one press assembles the source and runs it at once on a
   machine booted to READY (the cached snapshot), with the running line, breakpoints and stepping.

## Non-goals

- No CRT effects (scanlines, curvature, glow). trsjs has none. *(Claude's call.)*
- No cassette or disk UI in 5D (trsjs's settings menu). Later.
- No code from trsjs (no licence) or lkesteloot's emulator; Fugløy keeps its own `@fugloy/emu`.
- Screen-reader hand checks (NVDA, VoiceOver) wait for the final phase (user, 2026-10-19). The
  automated axe checks stay.

## Anti-goals

- A screen that looks like a TRS-80 but cannot be used like one (no BASIC at READY).
- A Run ▶ that is slower than 5B's because it now boots visibly every time.
- ROM bytes bundled, fetched or committed (5B's rule stands).

## Decisions

### Glyphs (Claude's call: xtrs's tables)

The glyphs come from xtrs's `trs_chars.c` (Timothy Mann; the Model III sets read from real
character generator ROMs by Todd P. Cromwell III), pinned to commit
`3a2180c063811a715faa28d39a94739c33e0abd0`. Its licence (Clarendon Hill Software 1992, and an
MIT-style grant by Timothy P. Mann 1996–2020) allows copying with the notice kept; the notice goes
into the generated file and `NOTICE.md`. lkesteloot/trs80's `Fonts.ts` (MIT) carries the same
tables from the same source, which confirms them.

`scripts/build-glyphs.ts` is rewritten to read a local copy of `trs_chars.c` (fetched by hand from
the pinned URL, checked against its SHA-256, not committed) and write `glyphs.generated.ts`, never
hand-edited. The X.Org tables go. The sets:

| Model | xtrs CG | Cell | Notes |
|---|---|---|---|
| Model I, stock | 1 | 6×12 | the standard Model I generator; bit 6 as emu's gate makes it |
| Model I, lowercase kit | 2 | 6×12 | the replacement generator sold with the kit |
| Model III | 4 | 8×12 | xtrs's Model III default (katakana alternates) |
| Model 4 | 8 | 8×12, 8×10 at 80×24 | xtrs's Model 4 default (international alternates) |

A Model I raster is 384×192, a Model III/4 raster 512×192 (640×240 at 80×24); the canvas scales
it to 4:3. Graphics bytes `80H`–`BFH` stay procedural 2×3 blocks at the cell's width. On the Model
III and 4, `C0H`–`FFH` show the generator's alternate set when port `$EC` bit 3 (ENALTSET) is set,
and the block of the low six bits otherwise, as the hardware does; emu gains `m.video.altCharset`
to say which (a read of the mode register it already keeps). The Model I keeps `C0H`–`FFH` as
blocks. The hollow box drawn for `7FH` goes: the generator has a glyph there.

### The tube (Claude's call)

Black (`#000`) with white phosphor (`#f2f2f2`), no border radius, no scan effects, a thin dark
frame. The screen fills the panel's width up to the size where its pixels scale by a whole number
in each direction where they can (crisp at common widths), never wider than the panel.

### The machine is on

A new **machine session** in `useRun` (no program) boots the model's ROM on a fresh Machine and
hands it to the runner live: the runner gains a programless mode (no source map, no running line,
no stop on a PC in the ROM). The ROM's prompts are left for the user; nothing is typed for them.

- **When it powers on.** Opening Run ▶ with a ROM for the source's model powers the machine on
  if nothing is running. With no ROM, the tube shows, in its own font, `NO ROM FOR THE MODEL III`
  and a line saying to add one below; the stub ROM has no BASIC, so it is not powered on.
- **Power** (on/off) and **Reset** sit under the screen with Pause, as on trsjs. Reset reboots
  the same model from its ROM (a cold start, memory cleared).
- **Model.** Changing the model switches the machine (powered on again on the new model's ROM).
- **Run ▶** replaces whatever the machine is doing with the assembled program, as now (snapshot at
  READY, then the `.CMD`). When the program returns to the ROM on a real ROM, the machine keeps
  running: the user is back at BASIC's READY (the 5B "the program returned" stop still applies on
  the stub ROM, which has nowhere to return to). *(Claude's call.)*
- **Stop** ends a program and powers the machine off; Power turns it back on.

### Programs to try

Under the controls, a short list: Sea Dragon, Rear Guard and Eliminator (Armored Patrol does not
reach its title; it is left out), each with its year and a Run button that loads its main build's
`.CMD` from `/examples/<id>/` onto the machine booted to READY (the same snapshot Run ▶ uses) and
starts it at its transfer address. They need the model's ROM; with none, the button says so in a
sentence and runs nothing. The machine follows the example's model. *(Claude's call: the three
that reach their titles, from `data/examples.ts`.)*

### Layout

Top to bottom: the bar (Model, Run ▶, Stop, Show in Listing), the run message, **the screen**,
the machine row under it (Power, Reset, Pause/Continue), Programs to try, then a **Debugger**
disclosure holding the step controls, Follow, the registers, the breakpoints and Screen text, and
last the ROM section. The Debugger disclosure opens by itself when a run pauses (a breakpoint, a
step, Pause), and the debug keys F5–F11 keep working while it is closed. *(Claude's call: the
debugger stays one click away, out of the TRS-80's way.)*

### Focus

Today nothing focuses the screen but a click (`RunTab`'s `focusScreen` has no caller). In 5D the
screen takes focus on power-on and Reset while Run ▶ is the tab showing, when the Run tab's own
Run ▶ button or a Program to try starts a program, and on a click. Ctrl/⌘+Enter from Source ✎ or
the listing leaves focus where it was, as 5B's tests require. The "Click the screen to type" hint
stays for a running machine without focus.

## What stays

Everything 5B and 5C test: Run ▶ semantics, the stub ROM, the ROM store, the running line,
breakpoints, stepping, the debug keys, the screen-text mirror's content, the lazy loading and the
first screen's budget (5D's code is all in the lazy Run chunk; the glyph table grows, and is in
that chunk).

## Left to the builder

The runner's programless mode's exact shape, the Power control's wording, the frame sizing
arithmetic, and the tests (unit tests for the glyph table and renderer per model, e2e for
power-on, typing at READY on a real ROM — skipped without one — and Programs to try).
