# Phase 5 — Assembler and IDE — Design

Date: 2026-10-18. Plan entry: `docs/Fugloy-Project-Plan.md` phase 5. The user
skipped the design questions ("skip questions and start"); what they said is
quoted, and everything else is marked as my call.

## Intent

The user, in their words: "the moment I press run it should assemble and then
emulate. even if it's a tiny program that just blanks out the screen. I want
an easy to use assembler as part of this — something I always wanted from
using EDTASM but was anything but easy." And: "with the disassembled source
show what line is running — some sort of highlighting. I always wanted this,
too."

So the measure of phase 5 is the edit–run loop. EDTASM made you type, leave
the editor, assemble, save, load, and run, and errors were codes. Here you
type in the workbench, press **Run ▶**, and the program is on an emulated
TRS-80 beside the code within a moment, with the running line lit.

## Goals

1. **Run = assemble + emulate.** One button (and one key) assembles the source
   and, if it has no errors, loads it on a fresh machine and runs it. A
   three-line program that clears the screen works on a blank page.
2. **Easy assembler.** Errors sit on the line that caused them, in plain
   sentences that say what to do ("JR reaches 128 bytes either way; LOOP is
   300 bytes back — use JP"). ROM routines are callable by name from phase 3's
   tables without declaring them. Typos in mnemonics get a suggestion. A
   starter program is loaded in a new source. (My calls, stated to the user.)
3. **zmac is the referee.** On every zmac source the disassembler's round-trip
   corpus produces, the new assembler builds the identical image and entry
   (plan phase 5's deliverable). User-facing syntax beyond what the emitter
   writes is checked against zmac by its own probes.
4. **Show the running line.** In source written in the workbench and in a
   disassembled listing: while running, the current line is lit live (per
   frame) with a fading trail of recent lines; while paused, a solid
   highlight with Step, Step Over, Run to Here, gutter breakpoints, and the
   registers. (Agreed with the user.)
5. **Either model.** The program runs on a Model III or Model I (and the Model
   4 in Model III mode); the assembler warns when the program uses a ROM
   address whose code differs between the Model I and Model III ROMs.

## Non-goals (this phase)

- Macros, `INCLUDE`, and conditional assembly (none is emitted by the
  disassembler and none is needed for the starter or the phase 6 tutorial's
  first lessons; add later if a lesson needs them).
- Disk output (`.DSK`) and BASIC editing. Output is a `.CMD` (and `.CAS`
  through the existing exporter).
- Editing a disassembled listing as source in place. A disassembled program
  can be opened *as source* (the zmac text becomes an editable source tab);
  edits there are a new program, not hint edits.
- Bundling, fetching, or committing any ROM. The user supplies one.

## Anti-goals

- An assembler that produces wrong bytes without an error (the reason
  `cschweda/z80-assembler` is not adopted: it compiles `LD A,(3C00H)` as
  `LD A,0` and ignores a second `ORG`; recon 2026-10-18).
- A Run button that needs more than one press, a dialog, or a file save.
- Error codes or messages that name the parser instead of the problem.

## Decisions

- **New package `packages/asm` (`@fugloy/asm`)**, TypeScript strict, ESM, no
  DOM or Node APIs, no runtime dependencies beyond `@fugloy/z80` and
  `@fugloy/disasm` (`MemoryImage`, `writeCmd`, the symbol tables). Released
  with core (z80, disasm, cli) at the next core minor version.
- **Encoder by inverting `@fugloy/z80`'s generated tables** (800 real
  encodings, 798 distinct forms; `LD (nn),HL` / `LD HL,(nn)` take the base
  `22`/`2A` form, as zmac does). Instruction lengths come from the table, so
  pass 1 is exact. `decode(encode(x)) = x` over every form is a test.
- **Syntax:** what zmac accepts for the constructs below, case-insensitive
  for mnemonics, registers, and directives; labels with a colon anywhere or
  without one in column 1; numbers `0FFH`, `$FF`, `0xFF`, `1010B`,
  decimal, `'A'`; strings with `''`; expressions `+ - * / MOD` (or `%`) `& | ^ ~ << >>`,
  `HIGH`/`LOW`, `$`, parentheses (an operand that is entirely parenthesised
  is memory where the instruction has a memory form there; elsewhere zmac
  reads it as the plain value, and asm gives the same bytes with a warning); directives `ORG`, `EQU`, `DEFL`/`=`,
  `DB`/`DEFB`/`DEFM`, `DW`/`DEFW`, `DS`/`DEFS`, `.PHASE`/`.DEPHASE`, `END
  [entry]`. Where zmac's rule is unclear (label case, labels inside
  `.PHASE`), a zmac probe decides and becomes a test.
- **Output:** `{ image: MemoryImage, entry, symbols, sourceMap, listing,
  diagnostics }`; `.CMD` through `writeCmd`. The source map maps every
  *runtime* address to its source line (and back), so the IDE can light the
  line the PC is on, including code under `.PHASE`.
- **No `ORG` (my call):** the program starts at `5200H` and an info note says
  so. **No `END` entry (my call):** `entry` is null as zmac gives it; the IDE
  runs from the first assembled byte.
- **IDE:** the workbench's dimmed **Source ✎** (left page) and **Run ▶**
  (right page) tabs. The editor is a plain-text editor with line numbers,
  error marks, a breakpoint gutter, and the running-line highlight; Run ▶
  holds the screen (canvas, TRS-80 character set), the keyboard, the
  controls, and the registers. The emulator runs in the browser
  (`@fugloy/emu` moves to `apps/web` dependencies).
- **ROMs:** supplied by the user in the Run tab (pick or drop a file),
  recognised by SHA-256 (`ROM_HASHES`), stored in IndexedDB, never in a
  backup; the Manuals pattern. Without one, Run explains what is needed and
  the program still assembles and lists.

## Sub-projects

- **5A — the assembler** (`packages/asm`, the zmac referee, ROM names, the
  Model I/III warning, the CLI's `asm` command).
- **5B — Source ✎ and Run ▶** (the editor, the browser emulator with screen
  and keyboard, the ROM store, Run = assemble + emulate, open a disassembly
  as source).
- **5C — the running line** (source map wiring, live highlight and trail in
  source and listing, pause/step/breakpoints/registers).

Deliverable (plan phase 5): a program typed in the workbench runs on either
model, and the assembler matches zmac byte for byte across the corpus.

## Left to the builder

Editor implementation (a textarea overlay or a small code editor library,
within the workbench's bundle budget), the canvas character set source (a
public-domain or self-drawn TRS-80 glyph set, never a ROM dump), frame
pacing, and key mapping details.
