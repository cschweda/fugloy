# Explain tab: a tutor for each line of machine code

Requested 2026-10-17, after phase 4 was merged and deployed to
fugloy.netlify.app. An addition to the phase 4 workbench, before v1 ships.

## Intent

The user is a coder coming back to the TRS-80 and Z80. They want to click
a line of a disassembly and be told, in plain English, what it does,
for their own curiosity and for anyone learning from Fugløy. Their words:
"what the instruction does, in plain English, including the addresses
(get the value at X, jump to Y), and then show what's at X or Y."

They chose the harder version on purpose. Explain does not only describe
an instruction in general ("copy BC bytes from (HL) to (DE)"). It reads the
lines around it and says what this line does here ("copies 13,953 bytes
from $5200 to $497F, moving the program to where it runs"). It reads like a
tutor, not a reference card.

## Goals

1. A new **Explain** tab on the right page. Clicking a line on the left
   opens it and explains that line.
2. Each explanation leads with one or two plain-English sentences, with the
   real addresses, values and names filled in.
3. Each address the line uses gets a **"what's at X"** preview: the listing
   lines there, its label and comment, or its symbol-table entry (name,
   purpose, citation). Each preview is a link that moves the cursor there.
4. Explanations use what the code proves about register values on the way
   to the line: constants loaded earlier, block copies, counted loops.
   They also recognize a few common patterns, so the explanation says what
   a group of lines accomplishes.
5. TRS-80 knowledge is spoken: ROM routines by their cited purpose, screen
   memory as row and column, ports by name and what they control.
6. A quieter details strip: size in bytes, T-states (both when
   conditional), the flags it changes, and "undocumented" when it is.

## Non-goals

- **BASIC lines.** A `.BAS` listing shows a short "Explain covers machine
  code; BASIC comes later" note. The user deferred BASIC to a later phase.
- Running code. This is static: no emulator, nothing executed.
- Explaining a whole routine or the whole program in prose. The scope is
  one line, plus the few lines that set it up.
- Game meaning. Fugløy cannot know that $5200 is the "player's score".
  Only names the user or the tables gave, and facts the analysis proves,
  appear.

## Anti-goals

These would make it a failure even if it technically works:

- **A confident wrong value.** If a register's value is not proven on
  every path to the line, Explain must not state one. When it is unsure,
  it says less, and says where the value comes from instead ("HL holds
  whatever it held when L4A21 was reached; L4A21 is called from 3
  places").
- Jargon without translation. "Load the accumulator" is fine as a second
  clause, never as the whole sentence.
- A wall of text. The sentence comes first. Details are secondary and
  visually quieter.
- Slowing the listing down. Clicking or arrowing through lines must stay
  instant (the listing's current bar: a step within a frame).

## Behaviour

- **Opening.** Clicking a row (code, data or label) moves the cursor as
  now and switches the right page to Explain. Clicking a link inside a
  row (a label or table name) still opens the Symbol tab, as now.
- **Following the cursor.** While Explain is showing, any cursor move
  (arrow keys, G, a followed link that lands in the listing) updates it.
  So you can step through code line by line. When another right tab is
  showing, arrow keys do not switch tabs; only a click does.
- **Before anything is clicked.** Explain shows a one-line prompt:
  "Click a line to have it explained."
- A **label row** explains the label: who calls it or jumps to it (links),
  and whether it is the entry point.
- A **data row** says these are bytes the code is not known to run. It
  shows them as text when they are printable (TRS-80 character set), and
  as numbers otherwise. It lists the instructions that refer into this
  data, using the uses the Symbol tab already computes. It reminds the
  reader of the key that turns data into code, and back.
- An **ORG or header row** gets a one-line explanation of what it is.

## How the tutor knows values

Explain runs a small, local value tracker. My call on its scope:

- It walks **backwards** from the line along straight-line code, as far as
  the previous label or the previous instruction that is a jump target.
  An xref target is a merge point. It also stops at a call (registers are
  unknown after one, unless the callee is a ROM routine whose table entry
  says it preserves them; none do yet, so a call clears everything), and
  at a cap of 32 instructions.
- It tracks 8- and 16-bit registers (A, B, C, D, E, H, L, and the pairs,
  plus IX and IY) through `LD r,n`, `LD rr,nn`, `LD r,r'`, `INC`/`DEC`,
  `XOR A`, and `LD rr,(nn)` as "the word at $nnnn", without a value.
  Anything else that writes a register makes it unknown. The movers
  analysis (`packages/disasm/src/analysis/movers.ts`) already tracks
  BC/DE/HL this way for LDIR. The two share the per-instruction rule
  (what one instruction does to the known registers, today's `step()`),
  but movers keeps its own forward walk. Moving movers to the backward,
  merge-aware walk would drop proposals and change `--write-hints`
  output, which is out of scope. They can still differ: movers may
  propose a move whose setup Explain cannot prove on every path. Explain
  then states no values, and says the loader analysis proposes this
  move.
- **Loops.** One exception to "stop at a jump target": a loop's own head.
  When the only jumps into the head are the loop's own backward jumps
  (the `DJNZ` or the wait loop's jump), and the only other way in is
  falling through from the line before, the walk skips the loop body and
  carries on from the line before the loop. Registers the body writes
  are unknown on later trips round. Only the count register's value on
  entry is used (B for DJNZ). If anything else jumps into the loop, the
  count is unknown.
- At a merge point, a value is known only if the walk proved it; otherwise
  Explain says where control comes from (callers and jumpers, as links).
- Memory contents are not tracked, except to name what an address *is*
  (a label, a symbol-table entry, screen memory).

## Patterns, first set

My call, kept small; each pattern names the lines it spans:

- **Block copy:** `LDIR`/`LDDR` with known HL, DE and BC. Says how many
  bytes go from where to where. It also says the copy moves the program
  to where it runs when either of these holds:
  - the movers analysis proposes this LDIR;
  - an applied `relocate` hint matches its source and destination.

  The second case matters because movers skips any move a `relocate` hint
  already covers. Sea Dragon opens with `seadrg01.hints` applied, so its
  LDIR gets no movers proposal.
- **Fill:** `LD (HL),n`, then `LD DE,HL+1`, then `LDIR`. Says "fills N bytes
  at $X with $nn". When the range is screen memory, it says "clears the
  screen" (fill with $20) or "fills the screen with …".
- **Counted loop:** `DJNZ` with B known on entry to the loop. Says "repeats
  the lines from L… to here N times". Without a known B, it says "repeats
  B times".
- **Wait loop:** a short loop of `DEC`, a test and a backward jump, with
  nothing else in it. Says it is a delay, with a T-state estimate when
  the count is known.

Anything that matches no pattern still gets its single-line explanation.
More patterns can be added later as one entry each.

## TRS-80 knowledge

- **Screen memory.** $3C00–$3FFF is 64 × 16 characters on both Model I
  and Model III. An address there reads as "the screen, row r, column c"
  (0-based, row 0 at the top), and a known range as "rows r1–r2".
- **ROM routines, variables and ports** come from the selected symbol
  tables (`TableEntry.purpose`, `cite`), so Explain says what the Symbol
  tab would say, briefly, with the citation link. A port write reads as
  "send A to port $EC (MODEPORT): …purpose".
- **RST.** `RST 08H` and the rest read through their table entries; RST 08H
  also mentions its inline byte.

## Where it lives

- **Engine:** `packages/disasm/src/explain/`, so it can run in the
  browser with no DOM, as the rest of the library does. A CLI
  `fugloy explain <file> <addr>` could reuse it later, but is not part of
  this work. Its input is the Session, an address (and the row kind), and
  its output is structured data (sentences made of text and link pieces,
  previews, details), not HTML. The web app renders it, as rows are
  rendered from spans today.
- `@fugloy/z80` gains two generated fields per template and instruction:
  the opcode family (from the x/y/z/p/q decomposition the generator
  already uses) and the flags it changes. Both are generated, never
  hand-entered, and the exhaustion test covers them. This is a public
  API addition to the package, which is fine while unreleased.
- The per-instruction sentences come from the generated opcode
  decomposition's families, not from a hand-written table of every opcode
  (there are about 1,300 forms). There is one template per family: LD r,r',
  ALU A,r, the rotates, the block instructions and so on. The tables stay
  generated (the project rule), and every opcode must produce a sentence,
  which an exhaustion test checks.
- **UI:** `apps/web/app/components/side/ExplainTab.vue`, a new right tab
  placed first (Explain, Symbol, Index, Program, Manual, Run).

## Tests and done-criteria

- An exhaustion test: every documented and undocumented opcode form
  explains without throwing and yields a non-empty sentence.
- Golden sentences for a fixed set of Sea Dragon lines, including:
  - the entry loader's LDIR at $888B, with `seadrg01.hints` applied as the
    workbench opens it ("copies 13,953 bytes from $5200 to $497F" and
    that it moves the program to where it runs);
  - a screen write;
  - a ROM call;
  - a conditional jump;
  - a DJNZ loop;
  - a data row that decodes as text;
  - a line whose register is unknown because of a merge point (it must
    not state a value).
- The value tracker's tests include the anti-goal: a value set on only one
  of two paths into a line is never reported.
- Browser test: clicking a row opens Explain with the sentence, and
  arrowing down updates it. Clicking a "what's at" preview moves the
  cursor. With Program showing, arrowing does not switch tabs. axe finds
  nothing.
- Perf: arrowing through 200 lines with Explain open stays within the
  listing's current bar.

## Decided by the user

- A new Explain tab that opens on click.
- The tutor version that reads the surrounding lines, despite the extra
  work.
- Plain English with the real addresses filled in, and previews of what is
  at each address.
- Machine code only; BASIC later.

## My calls

Check these while reading:

1. Arrow keys update Explain when it is showing, but only a click switches
   to it.
2. Explain is the first right tab.
3. The tracker is backward and local (to the previous merge point, a call,
   or 32 instructions), and says less rather than guessing.
4. The pattern set (block copy, fill, counted loop, wait loop).
5. One sentence template per opcode family, not per opcode.
6. The engine lives in `@fugloy/disasm`; no CLI command now.
7. Screen positions are 0-based rows and columns.
8. Movers shares only the per-instruction rule and keeps its forward
   walk. When the two differ, Explain says the loader analysis proposes
   the move instead of stating values.
9. The loop-head exception for counts, limited to loops entered only by
   falling through.
10. "Moves the program" also comes from an applied `relocate` hint.
11. `@fugloy/z80` gains generated opcode-family and flag fields.

## Left to the builder

- Wording of each template, within the anti-goals above.
- Layout of the tab, in the existing side-tab style (Symbol and Program
  tabs).
- The exact structured-output types.
