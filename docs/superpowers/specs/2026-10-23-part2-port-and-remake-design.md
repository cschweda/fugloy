# Part 2 — From a TRS-80 Program to a JavaScript Game (Design, draft)

**Status:** approved by the user, 2026-10-23 ("that works — please start"). The user asked for a
draft without the design questions ("skip — just start drafting"), so every choice below that the
user did not state is marked **(Claude's call)**; the user accepted them with the design.

## Why

The project plan's Part 2 has always been the end state: "recompile a program to readable
TypeScript and export it as a self-contained static bundle that plays on any static host". The
user's own goal, stated twice, is sharper and slightly different:

- 2026-10-17: turn games like Sea Dragon into modern browser games in JavaScript (canvas or
  Phaser) — "TRS-80 preservation is less important to me than the game itself being upgraded and
  updated for a modern browser."
- 2026-10-18: "export the old TRS-80 as a new javascript program (canvas or phaser) that has no
  deps on the TRS-80 but is a complete recreation of the app" — "the same app, just on a
  completely different platform", for graphic and text programs.

So the goal is a game that is *the same game* and *no longer a TRS-80 program*: no ROM, no Z80
interpreter, no original binary, and in the end not even the TRS-80's screen memory — yet
provably the game Westmoreland and Gilman wrote. Everything v1, the emulator, the assembler and the
Learn course built is the toolkit for that: the disassembler and its hints say what the code is,
the emulator says what it does, and the differential harness shows how to prove two programs do
the same thing.

**Kill criteria, reviewed 2026-10-23.** The plan's two conditions for starting Part 2 are met:
phase 3 produced a readable Asylum listing (its ROM calls named, round-trip clean), and phase 4
shipped (v1, 1.0.0, 2026-10-17) well inside its estimate. The user chose to go ahead with Part 2
on 2026-10-23.

## The idea in one paragraph

Two steps, each with a referee. **The port**: the recompiler turns a program's disassembly (its
IR, its hint file, and emulator traces) into readable JavaScript — one function per routine,
named by the hint file's labels, its notes as comments — that runs on a small runtime standing in
for the machine (memory, the screen, the keyboard, sound, and the few ROM routines the program
calls). The emulator is the port's referee: the same keys at the same emulated moment go to both,
and the first instruction-block whose result differs is named. **The remake**: once the port is
proven, the game's state (the sub's position, the enemies, the score, all named in the hint file)
is lifted out of TRS-80 memory into plain JavaScript objects, and a new presentation — modern
graphics, sound and controls — is built over it, and then the logic itself is rewritten into
idiomatic code, module by module. The port is the remake's referee: recorded play on the port must
replay identically on the remake's logic. At the end, the remake has no TRS-80 in it at all.

## Goals

1. **A verified port of Sea Dragon** (`examples/sea-dragon/seadrg01.cmd`, public domain since
   1995) that plays in a browser at full speed with no ROM, no Z80 interpreter and none of the
   original code bytes (the data it reads, its graphics, text and tables, is carried as data), and
   matches `@fugloy/emu` frame for frame on scripted sessions from the title to GAME
   OVER.
2. **A recompiler that is general enough for the next games**: Rear Guard, Eliminator, and the
   Learn course's own Space Invaders, without starting over for each.
3. **A remake of Sea Dragon** for a modern browser: upgraded presentation, the same game rules,
   with the TRS-80's memory model gone from its code, checked against the port.
4. **Publishable**: public-domain ports and remakes ship as self-contained static bundles on an
   arcade page (and later `<slug>.fugloy.dev`), as the plan's bundler step says.

## Non-goals

- Shipping any ROM, any copyrighted program, or any original binary. Bundles carry translated code
  and Fugløy's own runtime only. Programs whose rights don't allow it are ported for the user's
  own use and never published.
- A one-button translator for arbitrary programs with no human in the loop. As in v1, heuristics
  propose and the user decides: the hint file is an input, and a program that needs a few hints to
  translate is normal.
- BASIC programs (`.BAS`). They need a different translator (BASIC semantics, not Z80), and the
  user's graphic games are machine code. Text adventures in machine code come after the graphic
  games, because they lean on ROM text routines (more stand-ins).
- WebAssembly, speed tricks, lazy flags. A 2 MHz machine is slow; readability wins (the plan's
  decisions stand).
- The Model 4's banked memory and LS-DOS. Model III and Model I programs first.

## Anti-goals (would make this a failure even if it technically works)

- **An emulator in disguise.** A port that is mostly a `switch (pc)` interpreter, or that embeds
  the original bytes and decodes them at run time, is not a port. A labelled interpreter fallback
  is allowed only for a region the recompiler provably cannot translate, it must be listed in the
  port's report, and Sea Dragon's port must have none.
- **Unreadable output.** Generated code nobody can read (`l_49bf()`, `t0 = t1 ^ t2` for pages)
  defeats the remake, which starts by reading the port. Names come from the hint file; notes
  become comments; one routine is one function.
- **"Looks right" without proof.** A port that plays but has never been compared frame for frame
  with the emulator is not done; the comparison is the definition of done.
- **A remake that is a different game.** The remake may look and sound new, but the rules, the
  timing of play, and the scoring are Sea Dragon's, and a recorded game replays on it to the same
  score.

## Constraints

- Everything runs in the browser with no server (the site is static, Netlify, `app.fugloy.dev`).
- `@fugloy/z80` and `@fugloy/disasm` keep no runtime dependencies; the new packages follow suit.
- The emulator is the oracle, so a port's tests need what the emulator needs: Sea Dragon on the
  Model III ROM locally (the user's ROM, as today), and in CI a stub ROM that carries Fugløy's own
  stand-ins for the ROM routines the program calls (see "The runtime").
- Addresses, hint-file format, generated tables and test conventions as in `CLAUDE.md`.
- Public-domain status is per program and recorded in its manifest; only those programs are ever
  published.

## The how — decided

### Packages (the plan's Stack already names them)

- `packages/recomp` (`@fugloy/recomp`): IR + hint file + emulator traces in, JavaScript source and
  a report out. No DOM, no Node APIs (it runs in the workbench too), no runtime dependencies beyond
  `@fugloy/z80` and `@fugloy/disasm`.
- `packages/runtime` (`@fugloy/runtime`): what a ported program runs on. No dependencies.
- The CLI gains `fugloy port <program> --hints <file> [--trace <file>] -o <dir>`.
- The workbench later gains a Port tab; not in the first milestone.

### Output language: JavaScript **(changes the plan, which said TypeScript)**

The user asked for "a new javascript program". The port is plain modern JavaScript (ES modules,
JSDoc types so editors and `tsc --checkJs` can follow it), so it runs from a static folder with no
build step and the user reads exactly what ships. The project plan's Part 2 section is updated to
say so in the same change as this design.

### What the port's code looks like (Claude's call on the shape; the plan's decisions kept)

An illustration of the shape (not real output):

```js
/** TITLE_LOOP ($49EE). The title loop. Each pass is one frame of the title animation: clear
 * nine rows of the off-screen buffer (667 bytes from $4529), draw into it (SUB_4A0A, SUB_4AA5
 * and SUB_4B1F), and let TITLE_FRAME show it and look for ENTER. (seadrg01.hints) */
export function TITLE_LOOP(z) {
  for (;;) {
    z.hl = 0x4529; z.bc = 667; …                // one statement per instruction, in order
    z.tick(41);                                 // each block's T-states, from @fugloy/z80
    SUB_4A0A(z);                                // CALL 4A0AH
    SUB_4AA5(z);
    SUB_4B1F(z);
    TITLE_FRAME(z);                             // leaves the loop by jumping into START_GAME
  }
}
```

- The machine state `z` holds the registers (`a`, `f`, `bc`, `de`, `hl`, `ix`, `iy`, `sp`, and the
  alternate set), and `z.mem` the 64K as a `Uint8Array` (the plan's rule: never a sparse map).
  Flags are computed eagerly, in plain code, by small shared helpers (`add8`, `sub8`, `daa` …) so
  each instruction stays one line.
- One routine (a CALL target or the entry) is one function; its basic blocks become structured
  code (`if`, loops) where the control flow allows, labelled blocks otherwise. A CALL is a call; a
  RET is a return; stack discipline is checked. A transfer that breaks it — Sea Dragon's
  TITLE_FRAME jumps into START_GAME, whose `POP AF` drops TITLE_FRAME's return address so the title
  loop is left for good — is translated as an explicit transfer (here, an exception or a returned
  "next routine" that unwinds to the game's top level) that the hint file or the trace names, and
  the report lists it.
- Every block ends with `z.tick(n)`, its exact T-states from `@fugloy/z80`'s tables, so timing,
  sound and the referee's frame boundaries line up with the emulator to the T-state.
- Names come from the hint file (`name`), else the disassembler's labels; notes and `at` comments
  become JSDoc and line comments.
- Indirect jumps: translated from a known target set (hint file or trace); otherwise a small
  `switch` on the address at that site, which the report calls an interpreter and the anti-goal
  forbids for Sea Dragon (whose IR has none).
- Self-modifying code: found by the emulator, not guessed — a write into a byte that executes
  (coverage plus a write watch over the code regions, `m.debug`). Each site becomes a variable the
  write updates and the instruction reads. Sea Dragon's `LD A,(IY+n)` at `$49BF` has its
  displacement `n` (the byte `DATA_49C1`) rewritten for each column, so it becomes
  `z.a = z.mem[(z.iy + signed(z.mem[0x49C1])) & 0xffff]`: the displacement is read at run time.
  As M2 built it: a rewritten operand (a displacement, an immediate, a word, a `JP`'s target) is
  read from memory when its instruction runs; a swapped opcode (Sea Dragon swaps three) is a choice
  between the instructions the trace saw there, each translated ahead of time, as
  `switch (z.mem[site])`, and a value the trace did not see stops the port with a sentence. Anything
  else is still an error naming the site, with a hint to add.
- Interrupts: a program that enables them gets a check at each block end for a pending heartbeat,
  as the plan says. Sea Dragon runs with interrupts off, so its port has none.

### The runtime (Claude's call on its scope)

The hardware half of an emulator without the instruction interpreter:

- **Memory**: `Uint8Array(65536)`; video RAM at `$3C00`–`$3FFF`; the keyboard matrix read at
  `$3800`–`$38FF` from the current key state; writes below `$3C00` ignored (ROM and keyboard), as
  on the machine.
- **Screen**: the 64×16 (and 32-column) text and block-graphics screen drawn to a canvas with the
  workbench's own renderer and xtrs's character generators (`apps/web`'s `screen.ts` and
  `glyphs.generated.ts`, moved into the runtime so both use one copy), at the Model III's 4:3 or
  the Model I's shape (6A).
- **Keyboard**: browser keys to the TRS-80 matrix, as the workbench maps them.
- **Sound**: writes to the cassette port (`$FF`) with their T-state, turned into a square wave
  (WebAudio), as `@fugloy/emu`'s `m.sound` ring records them.
- **Ports**: `$EC` (the Model III's mode: 32/64 columns), `$FF`, and the rest as the program needs.
- **ROM stand-ins**: Fugløy's own code for each ROM routine a program calls, with the same effect
  on registers, memory and T-states. Sea Dragon needs one: `$0060` (`$DELAY`, a BC-counted delay),
  as built in M2 the same short delay loop the ROM has, at the ROM's addresses, written to match the
  routine's timing measured on the emulator.
  The same stand-ins, assembled as Z80 by `@fugloy/asm` into a stub ROM at the same addresses, let
  the emulator run the original in CI without the user's ROM, so the referee runs everywhere; the
  real ROM is the referee locally as well.
- **Pacing**: the port runs as ordinary functions in a Web Worker (the plan's decision: no
  generators, no `yield` per call); the runtime hands it a frame's worth of T-states at a time
  (1/60 s of the Model III's 2.02752 MHz), and the busy-wait delay loops that games time
  themselves with run at their true length in emulated time, so the game plays at the original's
  speed. The 1K screen is posted to the page each frame.

### The referee for the port

- The same scripted keys, delivered at the same emulated T-state, to `@fugloy/emu` running the
  original and to the port. At every block end the port's registers and the memory it wrote are
  compared with the emulator stepped to the same point (from M2 the mode register too, port `$EC`'s
  latch, which the player draws the screen from); at every frame boundary, video RAM. The
  first difference names the block, the instruction and the field, as `pnpm diff` names a step.
- This reuses the differential harness's ideas (`packages/emu/test/diff/`) but not its code:
  that harness compares two emulators instruction by instruction; this compares an emulator with
  translated code block by block.
- Done means: the scripted sessions (title, start, a game played to GAME OVER, at both skill
  levels) run with no difference for their whole length, in CI on the stub ROM and locally on the
  user's ROM.

### The remake (the user's real goal; Claude's call on the ladder)

The remake is reached in three rungs, each checked against the one below:

1. **New presentation over the port.** The port runs unchanged; a new renderer reads the game's
   state from memory through the hint file's names (`SUB_X`, `ENEMIES`, `SCORE`, …) and draws it
   with modern sprites, smooth motion and real sound, instead of drawing video RAM. The TRS-80
   screen stays available as a switch (and as a debug overlay). Nothing about play changes.
2. **State out of memory.** The game's variables move from `z.mem` addresses into a plain
   `game` object, one subsystem at a time (the sub, the enemies, the mines, the score), each move
   checked by replaying recorded games on the port and on the new code: the same inputs must give
   the same state, frame by frame.
3. **Idiomatic logic.** Routine by routine, the translated Z80 is rewritten as ordinary
   JavaScript (`moveSub(game, input)`), checked the same way. When the last routine is rewritten,
   `z` is gone: no registers, no 64K, no ports — "no deps on the TRS-80".

Upgrades that change the game (new levels, new enemies, higher resolution play) are a separate,
later choice; until then "upgraded and updated" means presentation and feel, not rules.

### Milestones

- **M1 — The pipeline on programs Fugløy wrote.** The recompiler and runtime on synthetic
  programs and then every Learn lesson and Space Invaders chapter (`apps/web/content/learn/`):
  they call no ROM, their sources are known, and each already has a `check.json` screen. Done when
  every lesson and chapter's port matches the emulator for its check run, in CI.
  **Done (2026-11-13, plan `docs/superpowers/plans/2026-10-23-part2-m1-port-pipeline.md`, all six
  tasks, branch `part2-m1`).** All 19 programs (lessons 1–7, chapters 1–12) on both models their
  `check.json` names, the Model III and the Model I (38 runs), are assembled, ported with their own
  labels as names, and refereed through their check steps in the suite CI runs
  (`packages/recomp/test/learn.test.ts`, about 61 s locally): all 38 match emu at every block start
  and every frame. Their ports hold 129 routines and 717 blocks on each model; Task 6 wrote all 129
  as structured code (loops, `if`/`else`, `break` and `continue`), none labelled (a `switch` over its
  blocks, kept for a routine whose loop is entered other than at its head), 486,570 bytes of
  JavaScript in all (572,788 as labelled blocks). None of the programs writes into its
  own code, and no port lists a place that refuses as it runs. The CLI has `fugloy port <program.cmd>
  --model 1|3 [--hints <file>] [-o <dir>]` (no `--trace` yet; the model is named). Known limits:
  EI's one-instruction delay is not modelled (no Learn program has EI); the referee does not compare
  sound or cassette writes (none uses IN or OUT); self-modifying code is refused, and found only by
  the referee, not by `port()`; a block reached from two routines is translated in each.
- **M2 — Sea Dragon's port.** The `$DELAY` stand-in, the self-modification census and its sites,
  sound, the keyboard; the scripted sessions above with no difference; playable in the browser.
  **Done (2026-11-13, plan `docs/superpowers/plans/2026-11-13-part2-m2-sea-dragon-port.md`, all
  nine tasks, branch `part2-m2`).** A census (`pnpm census`) plays three scripted games on emu,
  Novice, Expert and two players (Novice, then Expert), from the title to GAME OVER and back, on
  Fugløy's game stub ROM, and writes a port trace (`docs/port-trace-format.md`), committed as
  `examples/sea-dragon/seadrg01.trace.json`: eight rewritten sites (nine bytes), one dropped return
  address (`$4BAC`), two ROM bytes read as data. `seadrg01.cmd` with its hint file and that trace
  ports to one module of 430,623 bytes: 28 routines, every one structured (none labelled), 846
  blocks over them (110 of the 736 translated in more than one routine), the four rewritten
  displacements and the rewritten `JP` target read from memory, the three swapped opcodes each a
  `switch` between the two instructions seen (the M2 plan's first "Claude's call"), the drop an unwind to a
  continuation routine, the three jumps back to the entry a stack reset, the six `$DELAY` calls on
  the runtime's stand-in, the two ROM bytes in the module, and none of the game's code bytes. The
  referee, which now also compares the sound (every port `$FF` write, its T-state and byte) at every
  frame and the mode register at every block, finds no difference in any of the three games (84,124,477, 57,536,697 and 131,821,072
  T-states; refereed in 3.8, 2.4 and 5.3 s locally) in the suite CI runs
  (`packages/recomp/test/sea-dragon.test.ts`), and none locally on the user's Model III ROM booted
  to READY (where the ROM's `$0003` differs from the module's, and no register depends on it). The
  keyboard is the referee's: each key a session presses reaches both machines at the same block.
  Limits: `seadrg01.cmd` on the Model III only; a port takes no interrupts (Sea Dragon enables
  none); the three games are the paths those sessions take, not every path through the game, and
  the census cannot see what `docs/port-trace-format.md` lists. The screen renderer and its glyphs
  are the runtime's (`@fugloy/runtime/screen`), shared with the workbench (Task 8). **Playable in
  the browser** (Task 9): the port runs in a Web Worker (`@fugloy/runtime/player`), which blocks
  with `Atomics.wait` to keep the emulated clock with real time (more than a quarter of a second
  behind, it moves its origin rather than run fast), reads the key matrix from memory shared with
  the page, and posts video RAM and the port `$FF` writes each 1/60 s of the clock; the page draws
  with the runtime's renderer and plays the cassette port's levels through WebAudio. `pnpm play`
  writes the static folder and serves it locally with `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` (the plan's calls 4 and 5: not on the site until M3).
  The port starts with emu's registers at the entry on the game stub ROM, since the game reads R
  before it sets it. Checked by test, in CI: the clock (a wait when ahead, none when behind, no
  catching up after a two-second stall), the sound (a square wave at absolute sample positions) and
  the keys (the workbench's Shift rule; a key's repeated key-downs not restarting its hold; a key
  pressed and released at once held for nine frames,
  150 ms, above the longest gap measured between Sea Dragon's reads of its controls in play, 127 ms
  at Novice), and the worker's loop over Sea Dragon's port for 600 frames, each screen and each
  frame's sound equal to emu's at the same T-state with the same keys, from the first frame.
  Checked in headless Chromium (a script, not a person): the page is cross-origin isolated; it ran
  at 100.0% of the Model III's clock over ten seconds; the title animates; ENTER, `1`, `0` start a
  game, typed as instant taps too; the sub moves, held and on instant taps of the arrows, and stops
  within one of the game's polls of a held arrow's key-up; SPACE fires, on an instant tap too (a shot
  runs right along the surface row; a headless A/B run of the port shows the shot and its sound
  appear with SPACE and not without); a game
  reaches GAME OVER and returns to the title; with the page and its worker stopped for a minute
  (SIGSTOP of the browser's renderer: a stall, not a background tab), the game went on at normal
  speed; sound buffers were scheduled with sound in them, none dropped; no console errors. A second,
  independent look at the page, in another headless browser, saw the title drawn. Not checked:
  anyone listening, and a tab in a real browser's background.
- **M3 — The bundle and the arcade.** The plan's bundler: a per-game manifest (name, authors,
  year, machine, files, hints, rights), one static folder or `<trs80-game>` element, an arcade page
  listing the public-domain ports; Sea Dragon first.
- **M4 — Sea Dragon's remake**, the three rungs above.
- Then Rear Guard and Eliminator (their ROM stand-ins: Eliminator calls `$0049`, `$0060`, `$01D3`,
  `$05D9`, `$0A7F`, `$14C9`), and the Space Invaders capstone as a remake example in the Learn
  course.

## Left to the builder (the implementation plans decide)

- How basic blocks become structured code (a known algorithm, e.g. the "relooper" or a
  dominator-based structurer), and how far to take it before labelled blocks are acceptable.
- The flag helpers' exact shape, and whether rarely read flags (bits 3 and 5) are computed
  everywhere or only where a later instruction can observe them (they must match the emulator
  wherever compared).
- The report's format (per routine: translated, structured or labelled, any interpreter regions,
  self-modification sites, stand-ins used).
- Where the referee's sessions live (`packages/recomp/test/`, with scripts like the emu sessions').
- Moving the screen renderer and key map from `apps/web` into `@fugloy/runtime` without breaking
  the workbench's first-screen budget.

## Claude's calls, for the user to check

1. JavaScript, not TypeScript, for the generated code (changes the plan; the user said
   "javascript").
2. Plain canvas, not Phaser, for the port's runtime; Phaser (or not) is decided at M4 for the
   remake's presentation, when there is something to compare.
3. The port comes before the remake, as the referee for it — rather than a remake written by hand
   from the listing.
4. Sea Dragon is the first real game, after M1's own programs.
5. ROM stand-ins are Fugløy's own code, also assembled into a stub ROM so CI can run the original.
6. "Upgraded" means presentation and feel until the user asks for rule changes.
7. BASIC programs and text adventures are out of scope for now.
