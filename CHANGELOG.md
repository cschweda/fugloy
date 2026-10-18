# Changelog

All notable changes to Fugløy are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); until 1.0 each
project phase lands as a minor version.

Releases are tagged `vX.Y.Z` on `main`.

## [Unreleased]

### Added

- The workbench's **Explain** tab, first on the right page: a click on a
  listing row opens it, and while it shows every cursor move re-explains, so
  code can be stepped through a line at a time. A code line gets one or two
  plain-English sentences with its real addresses, values, and names (`Copy
  $3681 (13,953) bytes from $5200 (L5200) to $497F (L497F)`), from register
  values proven on every path to the line and never from a guess; a "what's
  at" preview for each address it uses (the listing lines there, or the
  symbol-table entry with purpose and citation), each moving the cursor there;
  the patterns it is part of (block copies and fills, counted loops, delay
  loops, a loader moving the program to where it runs); and a quieter strip
  with size, T-states, flags changed, and "undocumented". The **routine
  summary** says what the routine around the line provably does: length,
  callers and jumpers, how it ends, screen writes by row and column, keyboard
  reads, ports, ROM and program calls, data read and written, and loops.
  A data row explains its **data region**: its extent (to the next code or
  label, user names included), the instructions that load its address, the
  variable that address is kept in, the loop that reads it and the tests that
  split its bytes into kinds, and a **picture** of its bytes in the TRS-80
  character set, block graphics included, at a width of 8, 16, 32, 64 (the
  default), or any other. A `.BAS` listing says Explain covers machine code.
  `@fugloy/disasm` exports the engine (`explainLine`, `explainRow`,
  `summarizeRoutine`, `summaryNotes`, `dataRegion`, `sentenceText`,
  `screenCell`, `blockCells`, `trsGlyph`), which has no DOM and returns
  structured sentences, not HTML.
- Block comments: the `note <text>` hint directive (`block <i>:<offset> note
  …`), printed as `; text` lines above an address in the listing and the zmac
  source, and carried in the JSON IR as `notes`. An empty `note` is a blank `;`
  line; several notes at one address print in file order. `at … note` is
  refused. In the workbench, **:** or **Block comment…** on the right-click
  menu opens a box prefilled with the notes there, offering "above the
  routine" or "above this line" inside a routine; saving replaces the notes
  as one undoable edit, and emptying the box removes them. **Use as comment**
  under Explain's routine summary opens the box with the summary, after any
  notes already there, for the user to rewrite before saving.
- An annotated Sea Dragon: `examples/sea-dragon/seadrg01.hints` now names 19
  routines and labels and 22 variables and tables, and carries block comments
  on 46 addresses: the loader, the title screen, the main loop (`MAIN_LOOP`)
  and what it calls (`DRAW_CAVERN`, `DRAW_PLAYER`, `MOVE_PLAYER`,
  `AIR_SUPPLY`, `UPDATE_OBJECTS`), sound (`TONE`, `NEXT_NOTE`), scoring, lost
  ships and restarts, and the data (`CAVERN_MAP`, `MAP_PTR`, `RESTARTS`,
  `MAP_CHARS`, `ROW_OFFSETS`). Researched with Explain and the listing;
  what is a reading of the code says "probably". It is the example of a fully
  commented program, and its zmac source still rebuilds the identical image.
  Among the findings: two buffers the game clears before use hold leftover
  text of the authors' assembler source, with their own label names
  (`HITFLG`, `NOTEBUF`, `WATBEG`, `WATLEV`, `DECAIR`).
- `@fugloy/z80`: every template and decoded instruction has a generated
  `flags` field, the flags it changes in `SZHPNC` order (`''` for none;
  the undocumented bits 3 and 5 are not listed), covered by the exhaustion
  test. The design also proposed an "opcode family" field; none was added,
  since the mnemonic and operands already identify the family.
- The workbench numbers every listing line in a gutter of its own (not part
  of the text), and the status line gives the total.
- `@fugloy/emu`, emu phase 0: the core of `cschweda/trs80-emulator` (v1.6.0)
  — Z80 CPU, Model III memory map and I/O, keyboard matrix, cassette, WD1793
  disk controller, disk images, printer, `.CAS`/`.CMD` formats, save states —
  as plain ESM with no DOM. An injected logger replaces `console` and a
  built-in base64 replaces `Buffer`/`atob`/`btoa`. A check links and runs the
  package in an empty `node:vm` context, as the spec requires. The Model III
  ROM named in `fugloy.mcp.json` (see `fugloy.mcp.example.json`) boots to
  `READY` in Node, the same way twice. 348 upstream tests came along, 23 of
  them needing the ROM; the renderer, sound, UI, and every ROM, disk, and
  program file stayed upstream.
- `@fugloy/emu`, emu phase 1: the Z80 core passes ZEXDOC and ZEXALL, all 67
  groups each, run one Vitest test per group through a CP/M harness
  (`pnpm zex:install`, then `FUGLOY_ZEX=1`; CI runs them in `exerciser.yml`),
  and its T-states match `@fugloy/z80` for every opcode, both ways for each
  conditional. On the way:
  - `CPL` sets flags 3 and 5.
  - MEMPTR follows the documented rules, interrupt entry included, and save
    states keep it.
  - `IN F,(C)`, `OUT (C),0`, and the `NEG`, `RETN`, and `IM` duplicates exist,
    and the other undefined `ED` opcodes are 8-T-state NOPs.
  - A `DD` or `FD` before another prefix or `ED` is a 4-T-state step with no
    maskable interrupt after it, and one before `EX DE,HL` or `EXX` is
    ignored.
  - The block I/O instructions set every flag.
  - `ADC`, `SBC`, `AND`, `XOR`, `OR`, and `CP` on `(HL)` take 7 T-states, not 4.
- `examples/rear-guard/`, `examples/eliminator/`, and `examples/armored-patrol/`:
  three more of the Westmoreland and Gilman games released into the public
  domain in 1995, beside Sea Dragon, each with a README saying what every
  build is; the real-program tests run on them in CI too. Builds that carry
  someone else's code or credit stay out.
- A social card at the top of the README, for the site's `og:image` too:
  `docs/images/og-image.svg`, and `og-image.png` at 1200×630. It is dark,
  in the explainer's palette, its text outlined so it looks the same
  everywhere (Inter and JetBrains Mono, both SIL OFL 1.1), and its listing is
  Fugløy's own output.
- Symbol tables, phase 3: listings, zmac source, and the IR name the ROM,
  hardware, and DOS addresses a program uses outside its own image, and every
  name cites a page of a published work. The tables are eight hand-edited JSON
  files in `packages/disasm/data/symbols/`, 634 entries from ten works, each
  with a purpose and a citation (the source, and the page as it prints it):
  - `rom-model1` 125 entries (Paay's *Level II ROM Reference Manual*, Decker's
    *TRS-80 ROM Routines Documented*, Radio Shack's *Level II BASIC Reference
    Manual*) and `rom-model3` 150 (Tandy's *Model III Operation and BASIC
    Language Reference Manual*, chapter 12, and Decker, with the `$4000`-page
    RAM he gives for both machines), entered separately and compared:
    `COMPARISON.md` lists 102 addresses as shared, 4 as different, 19 as Model I
    only, and 44 as Model III only, and a test fails when a difference has no
    note.
  - `hardware-model1` 13 and `hardware-model3` 17, ports included (Radio
    Shack's Model I technical handbook, the Level II manual, Decker, and Paay;
    the Model III *Technical Reference Manual*).
  - `dos-trsdos13` 24 (the TRSDOS 1.3 owner's manual), `dos-ldos51-model1` 107
    and `dos-ldos51-model3` 101 (the LDOS 5.1 manual), and `svc-lsdos6`, 97
    service calls (Soltoff's *Programmer's Guide to LDOS/TRSDOS Version 6* and
    the Model 4 *Technical Reference Manual*).
  - `pnpm symbols` validates the files (schema, hex ranges, citations, names
    zmac accepts and unique ignoring case, no overlapping regions) and writes
    the generated `src/symbols/tables.generated.ts` and `COMPARISON.md`; CI runs
    it and fails on a difference.
- `--machine 1|3|4` (default 3) and `--dos trsdos|ldos|none` (default `trsdos`
  on a Model III, `ldos` on a Model I) choose the tables; `--machine 4` names
  LS-DOS 6 service calls only. A pair with no tables (`--dos trsdos` on a
  Model I, `--dos trsdos` or `ldos` on a Model 4) and an unknown value are usage
  errors (exit 2) that say what to use. `@fugloy/disasm` exports
  `selectSymbols`, `defaultDos`, `tablesFor`, `describeSelection`, `SymbolSet`,
  `SelectionError`, `SYMBOL_TABLES`, and `SYMBOL_SOURCES`, and `analyze` takes
  the resulting `SymbolSet` as `tables`.
- What the names reach, only outside the loaded image: `CALL`, `JP`, `JR`, and
  `DJNZ` targets and declared jump tables take routine and vector names, with
  the routine's purpose as a comment (`CALL $KBWAIT ; wait for a key and return
  it in A`); `(nn)` operands, `LD rr,nn` immediates, and typed `DW` rows take
  variable, vector, and region names (`LD HL,VIDEO+0140H`); `IN` and `OUT` take
  port names; an `RST` comment reads `NAME: purpose`, and on `--machine 4` an
  `RST 28H` after `LD A,n` reads `@DSPLY (SVC 10): …`. A routine name never
  replaces a number used as a value, and a table name that equals one of the
  program's own, ignoring case, is dropped and reported. The listing header
  gains `; symbols: Model III ROM, hardware, TRSDOS 1.3`, `N external targets
  (M named)`, and a legend line for each name used (address, purpose,
  citation); the zmac source defines each name with an `EQU`, so every round
  trip still rebuilds the identical image; the IR gains `machine`, `dos`, and
  `tableNames` (`fugloyIr` stays 1). A comment ends in `[Model I]` or
  `[Model III]` when the other machine's ROM table does not confirm the name,
  because it names a different routine there or has no entry. The default
  listing changes with this (`CALL 0033H` is now `CALL $VDCHAR`); `--sweep`
  still prints numbers, and `--color` paints a `$` or `@` name as one token.
- `.BAS` notes: a tokenized BASIC line that `PEEK`s, `POKE`s, or `DEFUSR`s a
  constant address the tables name is followed by a note line, not a trailing
  comment, since `;` is BASIC's `PRINT` separator: `;   14400 = $3840
  memory-mapped keyboard (KEYBOARD+64)`. The parser now keeps every statement's
  expressions, so a `PEEK` is found in an `IF` condition, a `PRINT` item, a
  `FOR` bound, an `ON` selector, and a `DEF FN` body as well as in an
  assignment; `USR`'s argument is a value and gets no note. Both machines' ROM
  tables name 16526/16527 (the USR vector) and 16548/16549 (the program-start
  pointer), so those notes carry no machine tag.
- Real programs: asylum16, listed with `fixtures/hints/asylum16.hints` under
  `--machine 1`, has 16 of the 17 ROM addresses it reaches named. The 17th,
  `$0112`, is banner text in the ROM, not a routine, and no table names it,
  nor the four addresses above the game's image. Volcano Hunter calls no ROM or
  DOS routine at all; its listing names its hardware (`MODEPORT`, `CASSETTE`,
  `KEYBOARD`), and the new `fixtures/hints/volcano.hints` relocates its game to
  the runtime address its loader copies it to, `$42E9`, which lifts decoded
  code from 26% to 34% and removes 37 notes. Both still round-trip, now with
  their names defined.
- The project plan's Landscape table of other tools was checked against their
  documentation on 2026-10-17, with the sources dated under the table. It was
  wrong or incomplete for trs80gp (its Record → Bus Use writes a disassembly
  from a run) and TRSTools (its viewer disassembles `.CMD` files), it left out
  DASM80 and DSMBLR III, which read `.CMD` files, and `zdis` could not be
  identified.
- The web workbench, phase 4 (`apps/web`, Nuxt 4 and Nuxt UI, generated as a
  static site, no server): drop a `.CMD`, a `.BAS`, or a raw binary, or open
  one of the four public-domain games with one click, and read its listing on
  the left of two facing pages beside a Symbol, Index, Program, and Manual
  tab on the right. The listing is the CLI's text, virtualized and
  highlighted, with names and labels as links. Edit from the keyboard or a
  right-click menu (C/D/W/S/T to mark, N to rename, ; to comment, G to go,
  Alt+←/→ back and forward, ⌘Z/⇧⌘Z undo and redo); every edit is a hint-file
  line, shown in the Hints tab. Hints and the machine and DOS choice save to
  IndexedDB by program SHA-256, a build's hints are offered to another build
  whose blocks match, and Back up and Restore move the work between browsers
  as one JSON file. The Program tab is a spec sheet: the machine verdict with
  its evidence, loading, memory needed and a memory map, what the program
  talks to, code statistics, and the analysis's proposals with an "apply".
  Export ▾ writes the zmac source, the hint file, the JSON IR, a `.CMD` load
  module, and a `.CAS` tape. The `/manuals` page lists every cited work with
  its archive.org cover; add your own PDF and a citation opens it at the cited
  printed page, through a checked page table per archive.org scan. Also
  `/technical-details` (the Inside Fugløy explainer, refreshed to phase 3's
  output) and `/about`, a title, description, canonical URL on
  `app.fugloy.dev`, Open Graph and Twitter card on every page, favicons,
  `sitemap.xml`, `robots.txt`, and JSON-LD.
- `@fugloy/disasm` grows what the workbench needs, all usable from the CLI or
  any script: `openProgram`, `withHintText`, `withHintFile`, `withSelection`,
  and `renderSession` (one session for opening, hinting, and rendering a
  program; the CLI now runs through it); `listingRows`, `basRows`, and
  `formatRow` (the listing as typed rows, the text renderers now a formatter
  over them, byte-identical on 112 golden listings); `programFacts` (the spec
  sheet's facts and an evidence-based machine fit); `writeCmd`/`CmdWriter`
  (moved from the test suite), `writeSystemCas`, and `writeBasicCas`;
  `nameProblem` (why a name is refused); and `MANUALS`/`manualPage` (the
  printed-page tables of the archive.org scans).
- The `at` hint directive: `at <addr> name <label>` and `at <addr> comment
  <text>` name and comment addresses outside the loaded image (RAM variables,
  unnamed operand targets). The listing header, the zmac source (an `EQU`),
  and the IR use them like any name; on a loaded address one is not applied
  and draws a warning, since the block-relative form survives relocation.
- Symbol sources gain `url`, `catalog`, `archiveId` (derived from an
  archive.org url), and `permissionUrl` (required wherever a source is marked
  redistributable), replacing the free-text `locator`.
- Browser tests in CI: a `web` job in `ci.yml` installs Chromium and runs the
  web type check, the unit tests, the SEO checks on the generated pages,
  and the Playwright specs; the specs that need gitignored samples or PDFs
  skip there. `done-criterion.spec.ts` tells the workbench
  story on Sea Dragon in one test: open it, go to `4B9E`, rename it `INIT`,
  comment it, undo both and redo them, reload and find both saved, export the
  hint file and zmac source and match the zmac byte for byte against
  `@fugloy/cli`'s `run` for the downloaded hints, export a `.CMD` that reloads
  through `loadCmd` to seadrg01's image and entry, undo and redo a new edit in
  the reloaded page, and drop a JPEG. The
  listing performance spec's timing limits apply only with `FUGLOY_PERF=1`.
- Phase 4's checks, recorded 2026-10-17:
  - The v1 done-criterion, met locally: `asylum.spec.ts` opens asylum16 in
    Chromium, drops `fixtures/hints/asylum16.hints` on it, picks Model I, sees
    `CALL $KBCHAR`, `CALL $CSHIN`, and `CALL $CSOFF`, renames `SUB_53F8` to
    `TAPE_LOAD` (its caller at `$43CB` follows) and comments it, reloads, and
    finds the rename, the comment, the hints, and Model I kept. It skips
    without the sample.
  - The exported Sea Dragon `.CMD` and `.CAS` run: `emulator-run.test.ts`
    boots `@fugloy/emu` on the real Model III ROM to `READY`, loads each
    export through the emulator's own loaders (`parseCmd`/`fastLoadCmd`, and
    `parseCas`/`fastLoadSystem` with no checksum errors), runs five emulated
    seconds, and finds the title screen ("BY: Wayne Westmoreland & Terry
    Gilman", "(C) Copyright 1982"), identical in video RAM to the screen the
    original `seadrg01.cmd` draws; ENTER then brings "1 or 2 Players?". This
    stands in for a run by hand in trs80gp or trsjs. The tape is loaded by
    the fast path, not by playing its pulses through `CLOAD`/`SYSTEM`. It
    skips without the ROM.
  - Listing performance in Chromium on an Apple M4, with
    `FUGLOY_PERF=1`: a raw 48K load of seadrg01 (18,562 rows) flings to the
    bottom and back with frames at p50 16.7 ms and p95 16.8 ms and no long
    task; 101 scrollbar jumps a frame apart, p95 16.7 ms; `scrollToAddr`
    median 16.4 ms, max 18.0 ms; a rename's re-render 87.7 ms (a table
    change 25 ms) with the cursor row unmoved. asylum16 (7,779 rows): the
    same frame times, `scrollToAddr` median 15.3 ms, re-renders 16–44 ms.

### Changed

- A BASIC line with an empty body prints as `10`, not `10 ` with a trailing
  space, in the listing (found when the text renderers became formatters
  over rows).
- MEMTOP's purpose in `rom-model3` no longer says it falls back to the top of
  RAM; it is the Memory Size? answer.
- The workbench's G box (UI input only; the hint file keeps its number
  rules): an explicit `$4B9E`, `0x4B9E`, or `4B9EH` is an address; otherwise
  a label name, ignoring case, so a label spelled like hex (`CAFE`) wins;
  otherwise bare hex of one to four digits (`4000` is `$4000`, `B` is
  `$000B`); decimal needs a `#` (`#19358`). Anything past `$FFFF` is refused,
  and an unknown token says what to type.
- In the workbench, Eliminator opens as Model I: `elimin8d` calls `$01D3`,
  which only the Model I ROM has, though its README says it runs on both.
- The workbench, after its final review:
  - Saved hints that no longer apply to their program are kept, never
    overwritten: opening the program says why ("Your saved hints for … no
    longer apply: …. They are kept, not replaced."), the status line reads
    "not saved (saved hints kept)", and the first edit asks, with Download
    the saved hints and Replace them, before anything saves over them. Esc
    does not answer it.
  - Restore lists backup entries whose hints do not parse and skips them,
    restoring the rest, and writes any edit still waiting to save before it
    compares.
  - Pending saves are also written when the page is hidden (a tab or app
    switch), not only on `pagehide`.
  - Questions whose yes replaces saved work (Restore's Replace, the kept
    hints' Replace them) put the first focus on the safe button.
  - A file over 64K that is not a program (a disk image) is no longer offered
    as a raw binary, and the raw load address is refused when the file would
    run past `$FFFF` from it, with the highest address it fits at.
  - JetBrains Mono, the listing's face, is self-hosted from Fontsource
    (Latin, 400 and 700) and credited on the About page; before, the CSS
    named it but nothing loaded it.
  - Canonical, `og:url`, and `sitemap.xml` URLs end in a slash past the home
    page (`https://app.fugloy.dev/about/`), where Netlify serves each page.
  - The browser checks' `window.__fugloyTest` hook is compiled in only when
    `NUXT_PUBLIC_E2E=1` (Playwright's web server); the site's build leaves it
    out, and `test:seo` checks that.

### Fixed

- `@fugloy/emu`'s `fromBase64` accepts whitespace and the URL-safe alphabet
  again, as upstream's decoder did.
- `fugloy` no longer crashes when the reader of its output goes away and the
  write fails with `ENOTCONN` or `ECONNRESET` instead of `EPIPE`, as Node's
  piped stdio can on macOS; 0.2.0's fix caught only `EPIPE`.

## [0.2.0] - 2026-10-16

Phase 2 of the plan: Pass 1 and Pass 2, built as sub-projects A (Pass 1 and
the round-trip proof), B (labels and the hint file), and C (hidden code,
heuristics, rebasing, and relocation), plus `--color`, the emulator and MCP
server stubs, and the first program the repository ships, the public-domain
*Sea Dragon*. Deliverable, met: every synthetic fixture round-trips, and
Valkyrie's hidden code disassembles at its true addresses. `@fugloy/z80`,
`@fugloy/disasm`, and `@fugloy/cli` are 0.2.0; the `@fugloy/emu` and
`@fugloy/mcp` stubs keep their own 0.1.0.

### Added

- `examples/sea-dragon/`: *Sea Dragon* (Wayne Westmoreland and Terry Gilman,
  1982), public domain since 1995, in ten `.CMD` builds with a ready hint file
  for `seadrg01.cmd`. It is the first real program in the repository, so the
  real-program tests now run on it in CI too.
- `--color`: the listing in color on a terminal (addresses, bytes,
  mnemonics, registers, numbers, labels, strings, comments, warnings). It
  stays plain when piped, written with `-o`, or with `NO_COLOR` set; zmac
  source and the IR are never colored, since other tools read them.

- Level II BASIC lexer and parser: a line counts as BASIC only when every
  statement parses, each keyword checked against its argument shape over one
  expression grammar, Disk BASIC statements and `&H`/`&O` constants included.
  On every Voyage of the Valkyrie file exactly lines 2–247, 182 lines, come
  out as machine code.
- `.BAS` analysis: line headers typed as words and BASIC bodies as bytes with
  their text attached, each code line's body a candidate root; entry points
  mined from `DEFUSR`, the USR vector, and a poked `JP`, through an abstract
  evaluator over constants and "program start plus N" (Valkyrie's line 250
  resolves to program start + 14 in all 13 files).
- `.BAS` listing and zmac output: BASIC lines as text, code lines
  disassembled at their true addresses; the zmac output (`DW` headers, `DB`
  bodies with the line as a comment, instructions) reassembles to the
  identical image, labels included, for every Valkyrie file.
- Strings: terminated runs of printable bytes are typed as strings and
  emitted as quoted `DB` rows (quotes doubled, other bytes in hex), byte-exact
  under zmac.
- Proposals, reported in the listing header and the IR (`proposals`) and
  never applied: jump tables (three or more words that all land on decoded
  instructions) and LDIR mover stubs (`LD HL,src / LD DE,dst / LD BC,len /
  LDIR` and a jump or pushed address into the copy), each with the exact hint
  lines that would declare it.
- `--rebase <hex>` for a `.BAS`: the program as saved from another address.
  Hints written before still match, since block identity reads line pointers
  as offsets, and operands that still point into the old range are marked
  stale.
- `relocate <addr> <length>` hint directive and an analysis space: a region
  is analyzed at the address it executes at and emitted under zmac's
  `.PHASE`/`.DEPHASE`, so the file image still round-trips. A destination over
  memory that stays loaded, or over another destination, is an error (exit 2).
- `fixtures/hints/asylum16.hints` now relocates Asylum's 123 loader-stream
  records, generated from the sample by a test script: the game decodes from
  `$43AE` at its runtime address, 61% of its bytes as code.
- New real samples in the round-trip tests (Space Warp, Sea Dragon, Pirate's
  Adventure, Voodoo Castle, Deathmaze 5000). Applying their mover proposals
  lifts decoded code from under 1% to between 19% and 68%.
- A smoke test on the Model I Level II ROM: half of it decodes as code from
  its documented entry points, and it reassembles byte for byte.

- Hint file (`--hints`): line-oriented text keyed by block and offset, with
  content-based block identity (length plus a SHA-256 prefix of the first 64
  bytes, computed in pure TypeScript) so the same hints apply to relocated
  builds; directives `entry`, `code`, `bytes`, `words`, `string`, `nocode`,
  `table`, `name`, `comment`; every parse error reports its line.
- `--write-hints <path>` writes a hint-file skeleton (identities and `--entry`
  addresses) and refuses to overwrite.
- Annotations drive Pass 1: overrides win and are applied before descent,
  `nocode` ends paths, declared tables seed roots, `code` with a length
  forces decoding.
- Pass 2 symbols: `L` jump targets, `SUB_` call targets, `DATA_` data
  references (`LD BC|DE|HL|IX|IY,nn` and `(nn)` operands into loaded memory),
  `TBL_` tables; user names replace them.
- Labels in zmac output (`NAME:` lines, `EQU` for a symbol inside an
  instruction, `DW` rows for words and tables), in the listing, and in the IR
  (`symbols`, `hints`); every round trip re-proven with labels on, including
  all real samples.
- `fixtures/hints/asylum16.hints`, documenting that build's self-relocating
  loader: it copies the payload from `$80DD` down to `$42F3` and jumps to
  `$43AE`, so its game code is never at a loaded address.

- Pass 1 recursive descent (`@fugloy/disasm`): a byte-kind map parallel to
  the image, decoded instructions, cross-references, external (ROM) targets,
  indirect jumps, and diagnostics; paths end at returns, indirect and
  unconditional jumps, and `HALT`; the first decode of a byte wins; the byte
  after `RST 08H` is data.
- zmac emitter with absolute operands, proven byte-exact against all 1786
  non-prefix Z80 encodings under the pinned zmac; the redundant `ED 63`/`ED 6B`
  forms are emitted as `DB`; `END` carries only a transfer address the file
  itself had.
- Versioned JSON IR (`fugloyIr: 1`): loaded ranges, regions, basic blocks
  with successors, xrefs, externals, indirect jumps, diagnostics.
- Pass 1 listing with a reached-bytes summary and notes.
- CLI: `--entry <hex>` (repeatable), `--format listing|zmac|ir`, `--sweep`,
  `-o <path>`.
- Round-trip harness: `pnpm zmac:install` builds `gp48k/zmac` at a pinned
  commit into gitignored `tools/`; tests assemble emitted source and compare
  memory images and bitmaps, never files; every synthetic fixture and every
  present real sample round-trips; CI builds zmac and requires it.
- `@fugloy/emu` and `@fugloy/mcp` as stub packages: ESM `package.json`, empty
  `src/index.js`, READMEs linking their specs in `docs/`, one import test
  each; `mcp` depends on `emu` by the semver range `^0.1.0`.
- `docs/label-format.md`, the label and coverage file format shared by emu,
  mcp, and disasm, extracted from §8 of `docs/fugloy-emu-spec.md`.
- `packages/disasm/README.md`.
- A Roadmap in `CLAUDE.md`: disasm phase 2 (in progress), then emu phases
  0–7, then mcp phases A–F.

### Changed

- `fugloy <file>` prints the pass 1 listing for load modules and raw
  binaries; the phase-1 linear sweep is `--sweep`. A `.BAS` with hidden code
  or a planted entry gets the pass 1 listing too; a plain BASIC program keeps
  its BASIC listing.
- `BasLine.parsed` and `detokenize().ok` mean the line parses as BASIC,
  lexically and by statement shape; the reason names the byte offset. A
  file's line 1 still has to read as BASIC bytes for the file to count as
  BASIC, but a grammar failure there only marks that line as code.
- A line whose bytes happen to read as BASIC, such as `XOR A / RET` as
  `LPRINT INKEY$`, stays BASIC unless a `code` hint covers it; the hint lists
  it as code, and a jump that lands inside such a line says so and names the
  hint.
- The IR (`fugloyIr: 1`) gains `entries`, `proposals`, and `relocations`;
  with relocations, `regions` describe runtime addresses while `loaded`
  keeps the file's runs.
- Listing and zmac rows break at the start of every typed region, and bytes
  typed as a string (including by a `string` hint) print quoted.
- A `.BAS` block's identity reads its line pointers as offsets from the
  program start, so a `.BAS` hint file written before this change no longer
  matches.
- The pass 1 header counts bytes decoded as code and, separately, bytes typed
  as data by hints.
- Project plan: the undocumented-opcode spelling question is closed (zmac's
  names, which the listing already used).
- README: CI badge, release badge (latest semver tag, live now that the
  repository is public), repository link; changelog release links.
- `linkWorkspacePackages` in `pnpm-workspace.yaml`, so a semver range on a
  workspace package resolves locally the way npm workspaces would.
- Project plan: phase 5, an assembler with an IDE in the workbench, after
  v1; Part 2's public bundles gather on an arcade page, starting with the
  Westmoreland and Gilman games released into the public domain in 1995; the
  `LDDR`/`JP (HL)` mover shape is a deferred idea.
- `BasLine.statements` holds each line's parsed statements, and the entry
  miner reads them instead of parsing every line a second time.
- A `.CMD` `03` record that whole records follow is skipped as a comment, as
  TRSDOS 2.3 and NEWDOS/80 do; only a `03` that ends the file, or one followed
  by debris, ends the load. Rear Guard's cracked copies open with one
  (`THE MARK OF "ZORRO"`) and were rejected before.
- New real samples in the round-trip tests: Rear Guard, Eliminator,
  Planetfall, Penetrator, Super Nova, Crazy Painter, and the BASIC programs
  of Super Star Trek, Crush, Crumble & Chomp, and Eliminator's patchers.

### Fixed

- `analyze` keeps the reasons it refuses relocations in annotations built
  without `applyHints` (`Analysis.relocationErrors`, also listed as warnings)
  instead of dropping those relocations silently.
- The string heuristic finds a message in a `.BAS` code line that runs up to
  the line's `00` terminator or ends just before it; the typed line frame no
  longer blocks it.
- A hint that starts before a relocated source and runs into it is clipped
  where the source starts, and the warning names the source; it used to
  cover bytes that execute elsewhere.
- `--entry` given the file address of relocated code says where that code
  runs (`use --entry 5005`) instead of "not in loaded memory".
- The BASIC lexer and parser read a name or a string of any length; one
  past about 125K bytes overflowed the call stack (no 64K program has one,
  but the library takes any bytes).
- A BASIC line that leaves `THEN` out of `IF` (`IF A PRINT`, `IF A,100`)
  parses, as the ROM's IF handler at `$2039` allows; such lines were reported
  as machine code (all 59 "code lines" in Super Star Trek were these).
- `fugloy` no longer crashes with an unhandled `EPIPE` when the reader of its
  output stops early (`fugloy game.cmd | head`); it ends quietly.

## [0.1.0] - 2026-10-14

Phase 1 of the plan: core decoder and loaders. Deliverable: a CLI that prints
a linear-sweep listing of any `.CMD` or raw binary and a detokenized listing
of any `.BAS`.

### Added

- pnpm monorepo with `@fugloy/z80`, `@fugloy/disasm`, and `@fugloy/cli`;
  TypeScript strict, ESM only, Vitest, `tsc` project references for `dist/`.
- `@fugloy/z80`: opcode tables generated from the x/y/z/p/q decomposition for
  the unprefixed, `CB`, `ED`, `DD`/`FD`, and `DDCB`/`FDCB` groups, each entry
  with length, operands, cycle counts, and control-flow effect; a decoder and
  zmac-style formatter. `SLL` and the IX/IY half registers are decoded; other
  undocumented forms decode as `DB` of the bytes the CPU would consume. An
  exhaustion test decodes all 1792 encodings against a committed reference
  built from independently typed flat tables.
- `@fugloy/disasm`: 64K memory image (`Uint8Array(65536)` plus a parallel
  bitmap) with a block log and overlap log; `.CMD` loader implementing every
  rule in the plan, including the `01` length wrap, overlapping and
  out-of-order blocks, missing `02`, `03`, `05`, `1F`, and the `04`/`06`–`10`
  PDS/ISAM records; Level II BASIC token table, `.BAS` loader with pointer
  chain validation and base-address derivation, and a detokenizer that reports
  lines failing the phase-1 lexical check as unparsed with address and length;
  content-based format detection; raw loader; linear sweep; listing renderers.
  No Node or DOM APIs.
- `@fugloy/cli`: `fugloy <file> [--base <hex>]`.
- `fixtures/synthetic`: 18 `.CMD` and 7 `.BAS` fixtures generated by the test
  suite's own record writer and BASIC tokenizer; a test fails if a committed
  fixture drifts from its writer.
- Real-program tests that assert the plan appendix's load ranges and entry
  points for every listed file and skip when the (uncommitted) programs are
  absent.
- README, MIT license, `.nvmrc`, `netlify.toml` for the phase-4 static site,
  GitHub Actions CI, `.editorconfig`.

### Changed

- Project plan: the core is built with `tsc` project references rather than
  tsup (TypeScript 7's native compiler has no JS API for tsup's declaration
  plugin).

### Fixed

- `.CMD` module name and copyright text are escaped before they reach a
  listing, so file content cannot forge listing lines or terminal escapes.
- A transfer (`02`) record with a `00` length byte, as ARMOUR.III carries, is
  read as the transfer address rather than a truncated record.

### Known limitations

- Hidden-code detection by parse validity, recursive descent, label
  synthesis, symbol tables, and hint files are phase 2 and later; the listing
  is a plain linear sweep from each loaded run.
- The `03` record's length semantics are not specified by the plan; the
  loader stops at it and skips a length-prefixed payload when one is present.
- A damaged `.CMD` (truncated record or unknown record type) is detected only
  when at least two load records precede the damage; there is no `--format`
  override yet.

[Unreleased]: https://github.com/cschweda/fugloy/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/cschweda/fugloy/releases/tag/v0.2.0
[0.1.0]: https://github.com/cschweda/fugloy/releases/tag/v0.1.0
