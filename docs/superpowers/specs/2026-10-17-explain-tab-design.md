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
7. **Block comments** (added at the user's request the same day): a few
   lines of the user's own prose above a routine or any line, such as
   "; Draws the sub at row B, column C". They are kept in the hint file
   and shown in the listing, the zmac source and the IR.
8. **Routine summary** (added the same day): Explain also says what the
   routine around the line does, from facts the analysis proves: what it
   writes on the screen, which ports and ROM routines it uses, what data
   it reads and writes, its loops, and who calls it. A **Use as comment**
   button puts that summary into the routine's block comment, for the
   user to rewrite in their own words ("draw the sprite"). The tutor
   supplies facts; the user supplies meaning.

## Non-goals

- **BASIC lines.** A `.BAS` listing shows a short "Explain covers machine
  code; BASIC comes later" note. The user deferred BASIC to a later phase.
- Running code. This is static: no emulator, nothing executed.
- Explaining the whole program in prose. The scope is one line, the few
  lines that set it up, and the facts of the routine around it.
- Game meaning. Fugløy cannot know that $5200 is the "player's score" or
  that a routine draws a sprite. Only names the user or the tables gave,
  and facts the analysis proves, appear. The user adds meaning through
  names and comments.
- **AI-written summaries.** Having a language model guess what a routine
  does would send the program to an online service. That breaks "your
  files stay in your browser", and the user does not want to handle
  copyrighted programs that way. Discussed and left out.

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
- A **data row** says these are bytes the code is not known to run, and
  then explains the **data region** the row belongs to (see below). It
  reminds the reader of the key that turns data into code, and back.
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
- **Loops.** A `DJNZ` loop's count is B on entry: what the walk proves
  just before the loop's head. It is used only when three things hold:
  - every jump into the head comes from that `DJNZ`;
  - nothing outside the loop jumps into its body;
  - nothing in the body changes B or calls out.

  Inside the loop, the head is still a merge point, so the body's
  registers stay unknown. (This narrower rule replaced a general "skip the
  loop" exception while the plan was written: a forward branch inside a
  body, as at Sea Dragon's $49B1–$49CA, would have stopped that exception
  from ever proving a count.)
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

## Data regions

Added the same day. The user pointed at Sea Dragon's long run of data
rows and asked what they are. They are one region, DATA_7399, which runs
from $7399 to $7FFF at the address the game runs at (3,175 bytes, 795
listing rows; $7C1A–$8880 in the file, which loads it $881 higher).
Corrected after the build: this paragraph first said $7399–$8880 and
1,988 rows, mixing the runtime start with the file's end. Its address is
loaded at $4C42 and stored in DATA_624A, which serves as a pointer, and
the loop at L5FB9 walks it. Bytes $00–$0F are control codes there.
Explain says all of this without being told. (The annotated hint file
now names the two CAVERN_MAP and MAP_PTR; see the showcase below.)

- **Extent.** The region is the run of data bytes containing the row,
  from the nearest label at or before it (or the start of the run) to
  the next code or the next label, any label: a generated one that code
  refers to, or a name the user gave. It gets a name, a size, and its
  first and last address.
- **Who uses it.** Every instruction whose operand points into the
  region (`LD HL,DATA_7399`, `LD A,(…)`, DW words in tables), as links.
- **Kept as a pointer.** When the instruction after a load of the
  region's address stores that register into a variable
  (`LD (DATA_624A),HL`), it says the address is kept in that variable,
  and lists the instructions that read the variable back.
- **How it is read**, when one of those users loads HL with the region and
  falls into a loop that reads `(HL)`. Explain names that loop, says
  whether it steps forward or back, and mentions any test that splits the
  bytes into kinds (an `AND` mask with a conditional jump, a `CP n`
  split). An example sentence: "bytes $00–$0F are treated differently
  (AND 0F0H at $5FC5)". This reports only the instructions it saw; it
  never guesses what the kinds mean.
- **Picture.** The region's bytes are drawn in the TRS-80 character set,
  with $80–$BF as the machine's 2×3 block graphics, in a small canvas at a
  width the user can change: 64 (screen width) by default, with buttons
  for 8, 16, 32 and 64 and a free field for any other width. Graphics,
  maps and title screens often become recognizable this way. Text bytes
  ($20–$7F) draw as characters; anything else draws as a dim dot.
  Showing the region costs nothing until it is drawn, and drawing is
  limited to the region (at most 16K).
- A block comment above the region's first address is how the user
  records what it is ("sea-floor map, one column per scroll step").

## Showcase: an annotated Sea Dragon

As part of this work, Sea Dragon's committed hint file
(`examples/sea-dragon/seadrg01.hints`) gets block comments and names for
its main routines and data regions. These are researched with the new
Explain tab, marked as interpretation where they are, and written in the
same voice as the tutor. Sea Dragon is public domain, so the annotated
listing ships as the example of a fully commented program. The other three
games follow later.

Done 2026-10-17: the hint file names 19 routines and labels and 22
variables and tables (TITLE_LOOP, MAIN_LOOP, DRAW_CAVERN, AIR_SUPPLY, TONE, CAVERN_MAP,
MAP_PTR, RESTARTS and others) and has block comments on 46 addresses: the
loader, the title screen, the main loop and the routines it calls, sound,
scoring, and the data. Generated names that many tests pin (L497F,
SUB_4B9E, L49B1, L5FB9) are kept and explained in notes. One finding came from the data itself: leftover text
of the authors' assembler source sits in two buffers the game clears
before use, with their own label names (HITFLG, NOTEBUF, WATBEG, WATLEV,
DECAIR), which supports reading the map's control codes as the water
surface and one routine as the air supply.

## Block comments

- **Hint format.** A new directive, `note <text>`, keyed like `comment`
  (`block <index>:<offset> note <text>`). There may be several at one
  address. They keep their order in the file, one line of prose each. An
  empty `note` is a blank comment line, which separates paragraphs.
  `writeHints` keeps them in input order within an address (it already
  sorts stably). `at` lines do not take `note`: block comments describe
  code, and code is loaded. The project plan's hint-file section is
  updated in the same change. Existing hint files are unaffected, because
  the format takes new directives without a version bump.
- **Listing.** Each note line prints as `; text` on its own row above the
  address's label (or above the line, when it has none), with a blank row
  before the first. The listing goldens change only for files with notes,
  so the existing 112 do not change.
- **zmac source.** The same `; text` lines above the label. The round trip
  still assembles byte-identically, since comments assemble to nothing.
- **IR.** An address's notes appear as `notes: string[]` beside its name
  and comment.
- **Workbench.** The right-click menu gets **Block comment…**, and so
  does a key (`Shift+;`, which is `:` on a US keyboard; the builder may
  pick another free key and must list it in the key help). It opens a
  multi-line box at the cursor, prefilled with the address's current notes.
  Saving replaces all the notes at that address, as one undoable edit.
  Emptying the box removes them. The cursor's address is where the notes
  go. When the cursor is inside a routine, the box offers "above the
  routine (L4A21)" and "above this line" as a choice; the default is the
  routine.

## Routine summary

- **What a routine is.** The code reached from a routine's start by
  following jumps and branches but not calls, stopping at returns. Its
  start is the nearest address at or before the line that is called (or
  RST'd), or is an entry point, and from which the line is reachable that
  way. If no such start reaches the line, there is no routine summary,
  only the line explanation. Cap: 2,000 instructions. Past that, the
  summary says it stopped.
- **Facts it reports**, each only when proven, as plain sentences:
  - length (instructions and bytes);
  - who calls it and jumps to it (links);
  - how it ends (returns, jumps on to another routine, or loops forever);
  - screen writes: rows and columns when the addresses are known
    (direct stores, stores through a known HL, block copies and fills
    into $3C00–$3FFF), otherwise "writes to the screen" when a store's
    address is a known screen address but not the exact cell;
  - keyboard reads ($3800–$38FF, by row of the key matrix where the table
    names it);
  - ports read and written, with their names;
  - ROM routines it calls, with their purposes;
  - program routines it calls (names, links);
  - data labels it reads and writes (names, links);
  - loops (count when known).
- **Use as comment** writes the summary as note lines at the routine's
  start, through the same edit path as the Block comment box. It opens the
  box prefilled, so the user can change it before saving. It never saves
  silently.
- The summary is computed when Explain shows a line in a routine whose
  summary is not cached. It is cached per session and routine start, and
  must stay within the listing's current bar for a cursor step (the cache
  makes stepping inside one routine free).

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

- Hint format: `note` parses, writes back in order, round-trips. Several
  notes at one address keep their order. An empty note is a blank line.
  `at … note` is refused with a clear error.
- Listing and zmac: notes print above the label. The 112 existing goldens
  are unchanged. Sea Dragon with a note still round-trips byte-identically
  through zmac.
- Routine summary: golden summaries for three Sea Dragon routines. One
  writes the screen with known rows and columns, one calls ROM routines,
  and one loops with a known count. A routine reached from two starts
  reports from the nearest start that reaches the line.
- Browser: Block comment from the menu and from the key, then Undo.
  Use as comment prefills the box and saves only on Save.

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
12. Block comments are a new `note` directive, several per address, with
    no `at` form.
13. The Block comment key is `Shift+;` (`:`), and the box defaults to
    "above the routine".
14. What counts as a routine, its 2,000-instruction cap, and the list of
    facts the summary reports.
15. Use as comment opens the box prefilled and never saves on its own.
16. The data-region rules (extent, pointer variable, read loop), and the
    picture view's widths and 16K limit.
17. Sea Dragon's hint file gets researched comments as a showcase; the
    other games later.

## Left to the builder

- Wording of each template, within the anti-goals above.
- Layout of the tab, in the existing side-tab style (Symbol and Program
  tabs).
- The exact structured-output types.
