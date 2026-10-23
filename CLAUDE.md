# Fugløy

TRS-80 Model I/III disassembler and (later) recompiler. The full design is in
`docs/Fugloy-Project-Plan.md`; read it before any non-trivial change. This file
holds the conventions that are not in the plan and the rules for working here.

## What we are building right now

v1, phases 1–4 of the plan, shipped as 1.0.0 on 2026-10-17. The emulator's
later phases follow, in the Roadmap's order. The recompiler and
bundler stay in Part 2 until the plan's kill criteria have been reviewed. If a
task seems to need machinery from a later step, stop and say so.

Current phase: **v1 released as 1.0.0 (2026-10-17), core 1.3.0 and `@fugloy/emu` 0.5.0 on npm (2026-10-19), `@fugloy/mcp` 0.1.2 (2026-10-18); emu phases 5–7 released in emu 0.3.0; the Model 4 (emu phase 6b) done for Model III mode and the native hardware, merged to main (2026-10-18); emu 0.4.0 and mcp 0.1.2 published 2026-10-18; a version 6 DOS boot still needs an LS-DOS 6 / TRSDOS 6 disk. Plan phase 5A, the assembler (`@fugloy/asm` and `fugloy asm`), merged to main (2026-10-18; plan `docs/superpowers/plans/2026-10-18-phase5a-assembler.md`), released in core 1.3.0 (2026-10-19). 5B, the workbench's Source ✎ and Run ▶ (CodeMirror 6 editor with inline errors and one-click fixes; one press assembles and runs on a fresh machine, on the user's ROM, stored per model in the browser, or on Fugløy's stub ROM; Open as source ✎ turns a disassembly into a source that reassembles byte for byte), merged to main (2026-10-19), all five tasks done (plan `docs/superpowers/plans/2026-10-18-phase5b-source-run.md`). 5C, the running line (the line a program is on lit live in Source ✎ and in a listing of the same program, with a fading trail; breakpoints by gutter click or F9, saved with the source; Continue, Step, Step Over and Run to Here; the registers and flags; debug keys F5–F11; a screen-text mirror), merged to main (2026-10-19), all five tasks done (plan `docs/superpowers/plans/2026-10-19-phase5c-running-line.md`); with it phase 5's deliverable is met. 5D, the TRS-80 on screen (the screen's glyphs from xtrs's character generators on a black tube; a TRS-80 that powers on when Run ▶ opens with a ROM, with Power, Reset and Pause; Programs to try: Sea Dragon, Rear Guard, Eliminator; the debugger in a disclosure; `m.video.altCharset` in emu), merged to main (2026-10-19), all five tasks done (plan `docs/superpowers/plans/2026-10-19-phase5d-real-machine.md`). Phase 6A, the screen's true shape (Model III and Model 4 at 4:3, the Model I at about 0.952:1 from the video timing, rows by whole screen pixels, never narrower than its dots across where space allows; a Full screen button in Run ▶; plan `docs/superpowers/plans/2026-10-19-phase6a-screen-shape.md`), merged to main (2026-10-19). 6B, the Learn page and lessons 1–7 (a header link first in the Site nav; lesson | program | TRS-80 in three columns, always on the stub ROM; each lesson self-contained, building on the last, runnable on the Model III; edits and done marks kept in the browser; plan `docs/superpowers/plans/2026-10-19-phase6b-learn-page.md`), merged to main (2026-10-19), all eight tasks done. 6C, Build Space Invaders (twelve filled-in chapters in `apps/web/content/learn/invaders/` from a blank loop to a game with a base, marching and descending invaders, a BCD score, bombs, lives, GAME OVER and faster waves; new, changed and removed lines marked; served at `/learn/invaders/<slug>/`; the lesson list shows both courses; plan `docs/superpowers/plans/2026-10-19-phase6c-invaders.md`), merged to main (2026-10-19), all five tasks done; with it phase 6 is done. Emu phase 7's Model I half, the differential harness against xtrs in lockstep and MAME 0.289 by a trace our machine follows (plan `docs/superpowers/plans/2026-10-19-emu-phase7-model1-differential.md`), merged to main (2026-10-23), all five tasks done: thirteen Model I sessions of 10 million instructions with no divergence the known classes do not explain against either reference, three core fixes it found (EX (SP),rr's write order, a repeating block instruction's flags 3 and 5, SCF and CCF's flags 3 and 5 after an instruction that left the flags alone), and the 20 cps key drop settled as the Level II 1.3 ROM's. The NVDA and VoiceOver hand checks wait for the project's final phase.**
v1 is disassembler phases 1–4: the core decoder and loaders (v0.1.0), Pass 1
and Pass 2 (v0.2.0), the cited symbol tables (phase 3: eight JSON tables, 634
entries, in `packages/disasm/data/symbols/`, compiled by `pnpm symbols`), and
the web workbench in `apps/web` (phase 4: Nuxt 4 + Nuxt UI, static; design
`docs/superpowers/specs/2026-10-17-phase4-web-workbench-design.md`, plan
`docs/superpowers/plans/2026-10-17-phase4-web-workbench.md`), including the
**Explain** tab (design `docs/superpowers/specs/2026-10-17-explain-tab-design.md`;
engine `packages/disasm/src/explain/`, UI
`apps/web/app/components/side/ExplainTab.vue`), block comments (the hint
file's `note` directive, the `:` key), and an annotated Sea Dragon
(`examples/sea-dragon/seadrg01.hints`). The site is deployed on Netlify from `main` at
`app.fugloy.dev` (live since 2026-10-18, Let's Encrypt; DNS at DNSimple);
`fugloy.dev` and `www.fugloy.dev` 301 to it (ask the user before any DNS
change). Emu phase 1 is done: the Z80 core in `packages/emu` passes ZEXDOC and
ZEXALL, all 67 groups each (`pnpm zex:install`, then `FUGLOY_ZEX=1`), and its
T-states match `@fugloy/z80` for every opcode. Emu phase 2 is done: the
`Machine` facade (`step`, `run`, registers, memory), `m.video.text()`, the
`m.sound` ring, the cycle-timed `m.keyboard` queue with the ROM keyboard-scan
hook, and the `.CMD`, `.BAS`, and `.CAS` loaders with manifests
(`docs/fugloy-emu-spec.md` §3, §6, §11; plan
`docs/superpowers/plans/2026-10-17-emu-phase2.md`). Sea Dragon, Eliminator, and
Rear Guard reach their title screens through `Machine` (Armored Patrol was
rejected), and a scripted session repeats byte for byte. Emu phase 3 is done
(merged 2026-10-18): `m.debug` (breakpoints, watches,
hooks, coverage, callers, trace, snapshots, labels) and `m.debug.labelFile()`,
read by the disassembler and the CLI's `--labels`; a scripted session's label
file feeds the disassembler (plan
`docs/superpowers/plans/2026-10-18-emu-phase3.md`), and Sea Dragon's is
committed as `examples/sea-dragon/seadrg01.labels.json`. Emu phase 4 is done
(merged 2026-10-18): `@fugloy/mcp` v0.1 with MCP phases
A–C, 23 tools (lifecycle, execution, inspection; break, watch, hits, trace,
callers, disasm; label, labels, coverage, suggest, and the
`<program>.fugloy.json` sidecar), plan
`docs/superpowers/plans/2026-10-18-emu-phase4-mcp.md`. A headless Claude Code
session found Sea Dragon's print routine (`$6140`) and labelled it unaided;
`packages/mcp/test/story-7-rom.test.js` is the scripted form. MCP phases
D–F are done (plan
`docs/superpowers/plans/2026-10-18-mcp-phases-d-f.md`): snapshots,
`restore`, `diff`, `search`, `callees` (D); resources, the four prompts, and
the ROM symbols resource (E); guardrail tests, golden transcripts for stories
1–3, and the `publish.sh` `mcp` set (F), 29 tools in all. Story 7 ran
unaided on Sea Dragon, Eliminator, and Rear Guard (the release check, MCP
spec §10; results in the CHANGELOG and `packages/mcp/README.md`). Published
(2026-10-18): core 1.2.0 (`v1.2.0`), emu 0.2.0 (`emu-v0.2.0`), mcp 0.1.0
(`mcp-v0.1.0`); then emu 0.3.0 (`emu-v0.3.0`) and mcp 0.1.1 (`mcp-v0.1.1`). Emu phase 5 is done and merged (released in emu 0.3.0;
plan `docs/superpowers/plans/2026-10-18-emu-phase5.md`): `m.fdc` (mount,
unmount, drives, export as DMK) and `m.load.dsk`; the WD1793 follows the
FD179X data sheet item by item, with what is unverified listed in emu spec
§5; JV1, JV3, and DMK read exactly; MCP `load` detects a disk image by content
and boots it from drive 0. The local dual-boot DMKs (Eliminator, Rear Guard)
boot to their Duo-Loader menu and load each game to its title, and Scarfman
boots to its title (`packages/emu/test/integration/disk-boot.test.js`); no
TRSDOS 1.3 image is present, so the emu spec §10 TRSDOS row stays open.
Disk images stay in the gitignored `fixtures/real/`; synthetic ones are in
`fixtures/synthetic/disk/`. Release coupling: the MCP server now needs emu's
`m.fdc`, `m.load.dsk`, `DiskImage`, `JV1_MODEL1_SD_TRACKS`, and `m.clockHz`, which emu 0.2.0 lacks,
so emu 0.3.0 had to be on npm before `@fugloy/mcp` 0.1.1; both are published
(2026-10-18). Emu phase 6 is done for the Model I and merged (plan
`docs/superpowers/plans/2026-10-18-emu-phase6-model1.md`): `new Machine({
model: 1, ram, expansion, lowercase })` (models described in
`src/machine/models.js`; the Model III's save state is byte-identical to
before), the Level II ROM (1.2 and 1.3 recognised), 4–48K, the Expansion
Interface's 40 Hz latch at `$37E0`, WD1771 at `$37EC`–`$37EF`, and printer,
the bit-6 video gate and the lowercase option, port `$FF` and 500-baud
cassette, and the keyboard with the scan hook. Fourteen `.CMD` programs reach
their titles on it (`packages/emu/test/integration/model1-programs.test.js`)
and the four local disks boot (`model1-disk.test.js`); MCP `load` takes
`model: 1` on `roms.model1`, and its timing follows the machine's clock (emu
spec §5, §11; MCP spec §5). The Model 4 was split off (phase 6 plan, Ruling
1) into emu phase 6b (plan `docs/superpowers/plans/2026-10-18-emu-phase6b-model4.md`),
done for Model III mode and the native hardware, merged to main (2026-10-18),
published (emu 0.4.0, 2026-10-18):
`new Machine({ model: 4, ram: 64 | 128 })` on the Model 4 ROM
(`fixtures/real/model4.rom`, from the cpmarchives TRS32 ROM set, recognised as
`model4-trs32`; its `MODEL4P.ROM` is an emulator's stand-in, not Tandy's 4P
ROM, so the 4P is out of scope) boots to Model III BASIC's READY in map 0 at
2 MHz, where Sea Dragon matches the Model III screen for screen and T-state
for T-state from READY (the ROMs differ in 727 bytes); the dual-boot DMKs
and Scarfman boot on it (`model4-disk.test.js`); the four memory maps and
128K banking behind port `$84` (`m.mem.ram` holds the 32K banks in order;
`m.mem.map` reads the map, page, and register),
80×24 video, the port `$EC` clock switch to 4 MHz (`m.clockHz` follows it;
timer 30/60 Hz, after xtrs), and save states, all from MAME and xtrs (emu
spec §5) and proven by synthetic programs; coverage is keyed by `(map,
page)` (`m.debug.coverage.keys`, `bitsOf`; the label file writes each key,
the disassembler applies `"0:0"`; spec §8, §12); MCP `load` takes `model: 4`
on `roms.model4`. Open: a version 6 DOS boot (no LS-DOS 6 / TRSDOS 6 disk
is local) and the checks spec §5 lists for it (the 60 Hz timer at 4 MHz).
`pnpm --filter @fugloy/emu test` runs the emu suite alone. The emu 0.3.0
release carried the Model I, which mcp 0.1.1 needed; mcp 0.1.2's
`load { model: 4 }` needs emu 0.4.0; both are published. The Sea Dragon
speed test runs only with `FUGLOY_BENCH=1` (it flaked beside the parallel
suite); `./publish.sh check` runs it alone after the suite. Emu phase 7 is
done for the Model III and merged (plan
`docs/superpowers/plans/2026-10-18-emu-phase7-differential.md`): trsjs, Peter
Phillips's JavaScript conversion of trs80gp, is the reference; it has no
license, so `pnpm trsjs:install` fetches it into the gitignored `tools/trsjs/`
(SHA-256 pinned) and its tests run only with `FUGLOY_TRSJS=1`
(`packages/emu/test/diff/`, `pnpm diff <program>`). Six scripted game
sessions of 10 million instructions each run with no divergence the known
classes (`test/diff/known.js`, each with its evidence) do not explain; the
harness found and fixed two core bugs (R while halted, port `FF` bits 5–1).
Its Model I half (plan
`docs/superpowers/plans/2026-10-19-emu-phase7-model1-differential.md`, merged
to main 2026-10-23; the user approved installing both references, 2026-10-20) adds xtrs, cloned at a pinned commit, patched and built headless
by `pnpm xtrs:install` into `tools/xtrs/` and run in lockstep over a pipe
(`FUGLOY_XTRS=1`), and MAME 0.289 (Homebrew; `pnpm mame:install` assembles
`trs80l2`'s ROM set from `roms.model1` into `tools/mame/`), whose recorded
trace our machine follows from power-on, its 40 Hz on MAME's schedule
(`FUGLOY_MAME=1`); `pnpm diff --model 1` runs a program against xtrs,
`--reference mame` records MAME's run of a program (its `--keys` pressed on
MAME's matrix) into a temporary folder and follows it, deleting the trace, and
`--reference mame --trace <file>` follows a recorded trace. Thirteen
Model I sessions (`test/diff/model1-fixtures.test.js`, their runners shared in
`model1-session.js`: the four `examples/`
programs and nine from `fixtures/real/`, 10 million instructions each past the
load) have no divergence the known classes do not explain against either, and
against MAME none but its video read without the bit-6 gate; each reference
declares the known classes it needs (`Reference.classes`; MAME no step class,
xtrs no general flag 3 and 5 class), and the comparator applies only those.
The Model I harness found and fixed three more core bugs (EX (SP),rr's write
order, a repeating block instruction's flags 3 and 5, SCF and CCF's flags 3 and
5 after an instruction that left the flags alone), and settled the 20 cps key
drop as the Level II 1.3 ROM's own debounce (emu spec §5). Open: no Model I
session takes an interrupt or reads `$37E0`, so an interrupt-driven session (a
DOS from a DMK) against both references waits (emu spec §12).

## Stack and layout

- pnpm monorepo. Node 22 LTS. TypeScript strict, ESM only.
- `packages/z80` — opcode table generated from the x/y/z/p/q decomposition, plus
  per-instruction length, operands, cycle count, control-flow effect. No I/O.
- `packages/disasm` — loaders (.CMD, .BAS, raw), memory image, passes, symbol
  tables, IR, emitters. No DOM, no Node APIs; must run in a browser.
- `packages/asm` — the Z80 assembler (`@fugloy/asm`, plan phase 5A): an
  encoder inverted from z80's tables (no opcode named in asm), two passes,
  zmac's syntax and directives, ROM/hardware/DOS names predefined per
  `model`/`dos` at the lowest priority (Ruling 5), the Model I/III note
  (`code: 'rom-difference'`; a warning with no model named, info with one;
  never for a predefined name or a port), a source map by run address, and `toCmd` (whose
  transfer address is END's entry or the first assembled byte). No DOM, no
  Node APIs; runtime dependencies z80 and disasm only (emu is a
  devDependency, for the starter test). Released with core. zmac is its
  referee: `packages/disasm/test/roundtrip/zmac.ts`'s `assemble(source,
  options)` runs both (importing asm by relative path, not as a dependency,
  to avoid a pnpm workspace cycle), and `pnpm asm:corpus` checks every real
  program under the Model III and Model I tables. Its stricter-than-zmac list
  is in `packages/asm/README.md`. The starter is
  `packages/asm/examples/clear-screen.z`.
- `packages/cli` — Node wrapper over disasm and asm (`fugloy asm`). The only package that touches `fs`.
- `apps/web` — Nuxt 4 + Nuxt UI, static generation, no server routes (phase 4).
  The folder is `apps/web` (package `@fugloy/web`); the emu spec's
  `apps/workbench` means the same app. Its tests run with `pnpm test:web`,
  its browser tests with `pnpm --filter @fugloy/web test:e2e`. From 5B it
  imports asm and emu: emu only through `app/utils/emulator/` (the stub ROM
  `stub-rom.z`, boot and snapshot, the `Runner`, the screen, the keyboard,
  the ROM checks); Source ✎ (`components/source/`, CodeMirror 6), Run ▶
  (`components/run/`) and the kit load lazily, and `pnpm --filter @fugloy/web
  check:prefetch` proves the first screen never preloads them. Sources and
  ROMs live in IndexedDB (`useSources`, `useRoms`); ROM bytes are never
  bundled, fetched, committed, or backed up. The screen's glyphs come from
  xtrs's `trs_chars.c` (the TRS-80 character generators;
  `scripts/build-glyphs.ts` writes `glyphs.generated.ts`, never hand-edited;
  the licence is in `apps/web/NOTICE.md`). From 5C the running line's
  DOM-free logic (trail, stepping, registers, screen text) is in
  `utils/emulator/`, the coordinator in `composables/useDebug.ts`, and the
  DOM helpers in the lazy root `utils/running/` (the listing's `<style>`, the
  debug keys F5–F11 and Ctrl/⌘+F10, the announcer). `pnpm --filter
  @fugloy/web size:first-screen` measures the first screen against its
  252,775 B gzip budget, on a plain `generate`.
  From 5D, Run ▶ opens as a TRS-80: with a ROM stored for the model it powers
  on (stopping at Cass? and Memory Size? for the user), with Power, Reset and
  Pause under the screen and Programs to try (`run/ProgramsToTry.vue`); the
  stepping buttons, registers, breakpoints and Screen text sit in a Debugger
  disclosure that a source Run or a pause opens; with no ROM the tube says so.
  From 6A the tube is 4:3 for the Model III and Model 4 and about 0.952:1 for
  the Model I (`MODEL1_ASPECT`, `tubeAspect`, `tubeFit`, `panelFit` in
  `utils/emulator/screen.ts`), and Run ▶ has a Full screen button
  (`screen-fullscreen`).
  From 6B the Learn page (linked first in the header) shows one item at a time,
  lesson | program | TRS-80, on the stub ROM only (`createRun`'s `stubOnly` keeps it
  there even when a ROM is stored). From 6C one catch-all page,
  `pages/learn/[...path].vue`, draws `components/learn/CoursePage.vue` for both
  courses: the lessons in `apps/web/content/learn/<NN-slug>/` at `/learn/<slug>/`
  (`/learn/` opens lesson 1) and the Space Invaders chapters in
  `apps/web/content/learn/invaders/<NN-slug>/` at `/learn/invaders/<slug>/`
  (`/learn/invaders/` opens chapter 1; both aliases are canonical to their first
  item). Each folder holds `lesson.md` (front matter and cited hardware claims),
  `program.z` and `check.json`; the format and parser are
  `utils/learn/lesson-format.ts` and `lessons.ts`. The course indexes are generated
  (`utils/learn/learn-index.generated.ts`, `pnpm --filter @fugloy/web learn-index`,
  with a staleness test), and each item's text and program load on their own per
  page (`useAsyncData`), so a page carries no other item's text. Progress
  (`localStorage`, every access in try/catch) is `utils/learn/progress.ts`, keyed by
  the lesson's slug or `invaders/<slug>`, so edits and done marks never collide;
  `utils/learn/diff.ts` marks each chapter's changes against the one before. The
  columns are `components/learn/LessonText.vue`, `components/source/LessonEditor.vue`
  and `components/run/LessonMachine.vue` (lazy). Source ✎ and the Learn page share
  `components/source/useSourceChecks.ts` and `ProblemsList.vue`. The checks are
  `packages/asm/test/lessons.test.ts`: every lesson and chapter `program.z`
  assembles with asm and zmac to the same image, runs headless on the stub ROM
  without entering the ROM's space, and reaches its `check.json` screen
  (`FUGLOY_REQUIRE_ZMAC=1` in CI). Lessons 1 and 3–7 and chapters 10–12 link to Sea
  Dragon through `/?example=sea-dragon&at=XXXX` (`utils/deep-link.ts`). The Explain
  tab loads lazily, which took the workbench's first screen from 252,257 B to
  228,912 B; it is 229,039 B now against 252,775 B. `pnpm --filter @fugloy/web
  size:first-screen -- --page learn|invaders` measures the Learn and chapter pages
  (202,885 B) against `LEARN_BUDGET` (221,184 B gzip).
- `packages/emu` — headless, deterministic TRS-80 emulator core (the Model III
  and, from emu phase 6, the Model I; from emu phase 6b, the Model 4), plain JavaScript ESM, no DOM, no Node APIs. Spec: `docs/fugloy-emu-spec.md`.
  Extracted from `cschweda/trs80-emulator` in its phase 0 (`NOTICE.md`); tests
  that need a ROM read its path from the gitignored `fugloy.mcp.json`.
- `packages/mcp` — stdio MCP server over emu. Spec: `docs/fugloy-mcp-spec.md`.
  Plain JavaScript ESM, no build step; the bin is `bin/fugloy-mcp.js`, which
  imports disasm and z80 from their `dist/` (run `pnpm build` or
  `pnpm typecheck` first). Depends on emu, disasm, and z80 as `workspace:^`
  (pnpm pack rewrites them to `^0.4.0` and `^1.2.0`), and on the MCP SDK and
  zod at exact versions. Phases A–F are built: one machine per process
  (a Model III, a Model I from `load { model: 1 }` on `roms.model1`, or a
  Model 4 from `load { model: 4 }` on `roms.model4`),
  every result text, errors as sentences,
  stdout JSON-RPC only. It writes only the sidecar `<program>.fugloy.json`
  and explicit `coverage export` paths. Tests run on a synthetic ROM in CI;
  `phase-a-rom` and `story-7-rom` need the ROM in `fugloy.mcp.json`. Golden
  transcripts are committed only for synthetic sessions
  (`test/golden/story-0{1,2,3}.txt`). Story and MCP prompts live in
  `packages/mcp/prompts/` (shipped in the package; the root `prompts/` is a
  README pointing there); the dev config is `.mcp.json.example` (copy to the
  gitignored `.mcp.json`).
- `docs/label-format.md` — the label and coverage file shared by emu, mcp,
  and disasm (§8 of the emu spec).
- `fixtures/synthetic` — committed, generated by the test suite's writers.
- `examples/` — committed public-domain programs: the Westmoreland and Gilman
  games released into the public domain in 1995 (Sea Dragon, Rear Guard,
  Eliminator, Armored Patrol). The tests read them like samples, so CI runs
  real-program tests. Nothing copyrighted goes here, and no build that
  carries someone else's code or credit.
- `sample/` — gitignored. Copyrighted sample programs live here; tests
  that need them call `skipIfMissing()` and must pass when the folder is empty.
- Tests: Vitest. Every loader rule in the plan has a synthetic fixture and a
  test named after the rule.

## Roadmap

1. **disasm — phase 2 (shipped as v0.2.0).** Pass 1 and Pass 2 per the plan:
   recursive descent, zmac emitter and image round trip, labels, hint file,
   hidden-code detection, heuristics, rebasing, relocation. Sub-projects A
   (Pass 1 and the round-trip proof), B (labels and the hint file), C (hidden
   code, heuristics, rebasing, relocation).
2. **disasm — phase 3, then phase 4 (released as v1, 1.0.0, 2026-10-17)**:
   symbol tables, then the web workbench. Emu phases 2+ and the MCP server
   follow.
3. **emu — phases 0–7** (`docs/fugloy-emu-spec.md` §11). 0: import
   `cschweda/trs80-emulator`, strip DOM, boot to `READY` in Node. 1: Z80 core
   passes ZEXALL. 2: Model III devices and `.CMD`/`.BAS`/`.CAS` loaders.
   3: debugger API, coverage, the label file. 4: `@fugloy/mcp` v0.1. 5: FDC
   and disk images. 6: Model I, then Model 4. 7: differential harness. Phases 0,
   1, 2, and 3 are done and merged; phase 4, `@fugloy/mcp` v0.1, is done and
   merged; emu 0.4.0 and mcp 0.1.2 are on npm (2026-10-18); phase 5 is done
   and merged; phase 6 is done for the Model I and merged. The
   Model 4 half of phase 6, split off (2026-10-18) into emu phase 6b, is done
   for Model III mode and the native hardware, merged to main (2026-10-18),
   published (emu 0.4.0, mcp 0.1.2) (the
   Model 4 ROM `fixtures/real/model4.rom`; the TRS32 set's `MODEL4P.ROM` is a
   stand-in, not Tandy's 4P ROM); a version 6 DOS boot still needs an LS-DOS 6
   or TRSDOS 6 disk. Phase 7 is done for the Model
   III (merged) and for the Model I, against xtrs and MAME (merged to main
   2026-10-23).
4. **mcp — phases A–F** (`docs/fugloy-mcp-spec.md` §11). A: lifecycle,
   execution, and inspection tools. B: break, watch, trace, callers, disasm.
   C: labels, coverage, sidecar file. D: snapshots, diff, search, callees.
   E: resources, prompts, ROM symbols. F: guardrails, golden transcripts, npm
   publish. A starts after emu phase 0; B and C need emu phase 3. A, B, and
   C are done (emu phase 4, merged); D, E, and F are done and merged, and
   `@fugloy/mcp` 0.1.1 is on npm (2026-10-18).

The plan's phase 5 (assembler and IDE) is not placed in this sequence: it comes
after v1 and needs phases 3 and 4 and emu phases 2–3. Its design
(`docs/superpowers/specs/2026-10-18-phase5-assembler-ide-design.md`) splits it
into 5A, the assembler (merged to main), 5B, the workbench's
Source ✎ and Run ▶ (merged to main (2026-10-19)), and 5C, the running line
(merged to main 2026-10-19; it completes phase 5's deliverable), and 5D, the TRS-80 on screen (merged to main 2026-10-19). Phase 6, **Learn assembly
with Fugløy** (requested 2026-10-17), follows phase 5: an introduction to
assembly language for non-programmers, not only retro fans, on the small and
straightforward Z80, with instant feedback (Explain's tutor voice on each line
written, the assembler and emulator running the code) and a tutorial that
builds a Space Invaders-style game from a blank page (a base along the bottom,
a shot going straight up, invaders marching left and right and inching down,
as Big Five's Super Nova did), opening the public-domain games side by side.
It needs phase 5 and emu phases 2–3; audience, lesson format, and how much
TRS-80 to hide are decided at design time. No estimate yet. When phase 4 builds the
site, it gets a "technical details" page carrying the interactive explainer of
how Fugløy was built (dark, infographic, many examples, written for a curious
student or retro enthusiast; requested 2026-10-16). Its source is
`docs/technical-details/inside-fugloy.html`. The site also ships full SEO
(requested 2026-10-16): a title and description on every page, canonical
URLs on `app.fugloy.dev`, Open Graph and Twitter card tags whose image is
the social card `docs/images/og-image.png` (1200×630, at an absolute URL,
with alt text), favicons from the card's ø tile, `robots.txt`,
`sitemap.xml`, and JSON-LD. The card's source is `docs/images/og-image.svg`.

## Conventions

- Addresses print as uppercase hex with a `$` prefix in prose and `H` suffix in
  emitted assembly (`$3C00` in comments and docs, `3C00H` in zmac output).
- The 64K image is a `Uint8Array(65536)` with a parallel `Uint8Array` bitmap;
  never a sparse map.
- Opcode tables are generated, never hand-edited. If a decode is wrong, fix the
  generator and the exhaustion test, not the table.
- Hint-file format is line-oriented text keyed by `block <index>:<offset>` as the
  plan specifies; do not switch to JSON without updating the plan first.
- Symbol tables are data files (`packages/disasm/data/symbols/*.json`), one per
  table, each entry with a `cite` (a `sources.json` id and a page), compiled by
  `pnpm symbols` into `src/symbols/tables.generated.ts`, which is never
  hand-edited. No symbols in code.
- Detect file format from content, never from extension.
- No external runtime dependencies in `z80` or `disasm`. Dev dependencies are
  fine.

## Working rules

- Finish the phase's deliverable before polishing. A CLI that prints a correct
  linear sweep beats a half-built recursive descent.
- When the plan and the code disagree, say which one should change rather than
  silently picking one.
- Keep `docs/Fugloy-Project-Plan.md` current: when a decision in it is
  superseded, edit the plan in the same change.
- Commit messages: imperative, one line, phase-prefixed (`p1: add .CMD loader`).

## Reference facts (from the plan's appendix)

- .CMD `01` record length byte counts the 2 address bytes and wraps: 0 → 254
  data bytes, 1 → 255, 2 → 256.
- .BAS line: 2-byte next pointer, 2-byte line number, body, `00`; two zero bytes
  end the program. Line *N*'s body is at `ptr(N-1) + 4`.
- Hidden BASIC code is detected by parse validity, not byte statistics — the
  token range `80`–`FB` overlaps common Z80 opcodes.
- Only `RST 08H` takes an inline parameter byte.
