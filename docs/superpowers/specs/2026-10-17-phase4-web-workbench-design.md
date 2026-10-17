# Phase 4: the web workbench — design

Date: 2026-10-17. Status: draft for review.

Plan of record: `docs/Fugloy-Project-Plan.md`, "Web app", "Hint file", and
phase 4 under "Phases and estimates". This document settles how the plan's
phase 4 looks and behaves. Where it adds to the plan, the plan is updated in
the same change (see "Plan and CLAUDE.md changes").

## Intent

Fugløy's disassembler works from a terminal today. Phase 4 puts it in a
browser: a static site at `app.fugloy.dev` where you drop a TRS-80 program
and read it as a fully labeled, annotated listing. You fix it up as you read
by marking data, naming routines and writing comments, and you take the
result away as zmac source that reassembles to the same image.

The user's words for the feel: modern and sleek, dark mode first, syntax
highlighting wherever it applies. A coder coming back to retro computing and
the Z80 should look at it and think "yes, this is how it should look". The
model is the Inform 7 IDE: two facing pages, each with tabs, web-friendly.

**The long-term goal (not phase 4).** The workbench is meant to grow into an
IDE: see the listing, **play the program in an emulator** beside it, **edit
the source, reassemble, and play again**, mostly for small programs. That is
plan phase 5 plus emu phases 2–3, many weeks away. Phase 4 builds none of it,
but its layout and data model must leave an obvious place for it, so the IDE
is added to the workbench later, not built as a second app.

**What would make the user wince.** Not being able to load a public-domain
program in one click and see how the workbench looks and works. The bundled
examples are a hard requirement, not a nice-to-have. (The user also named
"not seeing the game run in emulation". That is the long-term goal above,
confirmed as out of scope for phase 4.)

## Goals

1. The plan's v1 done-criterion: asylum16.cmd gives a listing with named ROM
   calls that reassembles to the original image (already true in the CLI),
   and that listing can be **annotated and saved in the browser**.
2. A first visit shows the workbench working within one click, using a
   bundled public-domain game.
3. Everything in the plan's "Web app" section: drop zone, header facts,
   recursive descent with the selected machine's symbols, marking, jump
   tables, renaming, comments, side panel, export, IndexedDB persistence,
   virtualized listing.
4. Full SEO as the plan and `CLAUDE.md` specify, plus the "Technical details"
   page hosting the Inside Fugløy explainer.
5. Deployed to Netlify at `app.fugloy.dev`. `netlify.toml` already exists.
6. **Bring-your-own manuals** (added by the user during design): read the
   cited manual page inside Fugløy from your own PDF. See "Manuals".
7. **Runnable exports** (added by the user during design): the loaded program
   as a `.CMD` load module and as a `.CAS` cassette image that other TRS-80
   emulators (trs80gp, trsjs, the user's own) can run. See "Export".

## Non-goals (phase 4)

- No emulator, no Run panel contents, no ROM handling. `packages/emu` stays
  at phase 1, as `CLAUDE.md` requires.
- No assembler, no editable source, no reassembly in the browser. Round-trip
  proof stays in the test suite via zmac.
- No `.DSK` export (needs a DOS on the disk; the user chose `.CMD` and `.CAS`).
- No guessing heuristic for the machine. The Program tab's machine verdict
  comes only from cited table evidence (see "Machine and DOS").
- No phone layout. Desktop first; mobile is a later phase. The site must not
  break on a narrow screen (it can show a "best on desktop" notice and one
  page at a time), but nothing is designed for touch.
- No accounts, no server, no uploads. Files never leave the machine.
- No new disassembler features (new heuristics, new symbol entries) beyond
  what the browser needs to render and edit what the CLI already produces.

## Anti-goals

- A second, browser-only disassembler. The site calls `@fugloy/disasm`; any
  logic the UI needs that is not presentation goes into the library, where the
  CLI and tests share it.
- Hint state that lives only in the UI. The hint file stays the single source
  of truth for every edit, so the CLI and the browser always agree.
- A layout that has to be torn up to add Run and Source later.

## Constraints

- `apps/web`, **Nuxt 4 + Nuxt UI**, static generation, no server routes
  (plan, "Stack"). The folder is `apps/web`, not the emu spec's
  `apps/workbench`: `netlify.toml` already builds `@fugloy/web` from
  `apps/web`. This settles the open naming question in `CLAUDE.md`.
- `packages/disasm` has no DOM or Node APIs and no runtime dependencies. That
  doesn't change. The web app may have runtime dependencies (Nuxt, Nuxt UI, a
  virtual-list helper if needed); `z80` and `disasm` may not.
- Formats are detected from content, never extension. The same is true in
  the drop zone.
- Addresses: `$3C00` in prose and UI chrome, `3C00H` in emitted assembly, as
  everywhere else. The listing shows what the CLI listing shows.
- The hint file format does not change (line-oriented text, block-relative
  keys, SHA-256 identity). If the workbench needs a directive that doesn't
  exist, the plan is updated first.
- Tests: Vitest for logic; Playwright for the browser flow (plan, "Stack").
  The full suite must still pass in a clean worktree with no `fixtures/real`
  and no `sample/`.
- Nothing copyrighted is bundled. The bundled programs are the four
  public-domain games in `examples/`. The symbol tables (names, one-line
  purposes, citations) ship as they are. No ROM image is ever bundled.

## What the user decided

### Layout: two facing pages (Inform 7 style)

Chosen from three mockups (A: facing pages; B: VS Code-style three column;
C: listing only).

- **Top bar:** Fugløy wordmark; the file name; a **machine** picker (Model I,
  Model III, Model 4 symbols only) and a **DOS** picker. Both change only the
  symbol table, per the plan, and the listing re-renders. **Export ▾** on the
  right (see "Export"). Links to Technical details and About.
- **Left page**, tabs: **Listing** and **Hints**, plus a dimmed **Source ✎**
  tab marking where the editor will go.
  - *Listing:* address, bytes, label, mnemonic and operands, comment, beside a
    gutter of line numbers (each row's line in the whole listing, also while
    the header is folded; added 2026-10-17 at the user's request).
    Virtualized. Syntax-highlighted: mnemonics, registers, numbers, program
    labels, and table names (ROM, hardware, DOS) each have a distinct color.
    Comments are muted italic. Table names and labels are links.
  - *Hints:* the current hint file as text, read-only in phase 4 (my call:
    editing happens in the listing, so this tab shows each edit landing as a
    line). Shows matched/unmatched blocks and warnings, as the CLI header
    does.
  - A `.BAS` program shows its BASIC listing (with named PEEK/POKE/DEFUSR
    addresses, as the CLI does). One with hidden machine code shows the
    pass 1 listing, exactly as the CLI decides.
- **Right page**, tabs: **Symbol**, **Index**, **Program**, plus a dimmed
  **Run ▶** tab marking where the emulator will go.
  - *Symbol:* the selected name's address, description, citation (source and
    page, from `sources.json`), and every place the program uses it, each a
    link. Clicking a citation opens the **Manual** tab at that page (see
    "Manuals"). For a program label: its cross-references (callers, jumpers,
    readers).
  - *Index:* every label, routine, table name, and proposal, filterable,
    each a link into the listing.
  - *Program:* a **spec sheet** for the program, educational and historical
    in tone (the user approved a mockup of it on Sea Dragon). Sections:
    - **History** (bundled examples only): title, authors, publisher, year,
      rights (for example "public domain 1995"). A dropped file shows its
      `.CMD` name record if it has one.
    - **Machine:** runs on Model I, Model III, or both, with the evidence in
      plain words. For example: "Writes port `$EC` (MODEPORT), which only the
      Model III has. Its one ROM call, `$0060` $DELAY, is the same on both."
      (The mockup claimed `$0060` differs. The comparison classes it shared,
      and the sheet says only what the data says.) Built from phase 3's data: the
      ROM comparison (shared / different / Model I only / Model III only)
      and the per-machine hardware tables. "Unknown" is a valid answer.
    - **Loading:** format and record count, name record, load range and
      size, entry and how it was found (transfer address, hint, mined),
      relocations in words ("a 15-byte stub copies the game down to `$497F`
      and jumps there"), and the memory needed (16K / 32K / 48K from the
      highest address used). A 64K memory-map strip shows ROM, keyboard and
      video, and the program's ranges.
    - **Talks to:** the hardware, ROM calls, and DOS calls it uses, each a
      link to the Symbol tab. "No DOS calls: needs no DOS once loaded" when
      that is so.
    - **Code:** bytes decoded as code, routine count, and other facts the
      analysis already has. The builder picks which ones. Each must be
      computed, not estimated.
    - **Analysis:** the CLI header's diagnostics and the heuristic
      **proposals** (proposed tables, movers), with a one-click "apply" that
      adds the proposal's hint line.

    The spec-sheet facts are computed in `@fugloy/disasm` (a function from an
    analysis to a plain object), not in the UI, so the CLI could print them
    later and the tests can check them on the examples. The Sea Dragon facts
    above are the test.
- **Status line:** size and blocks, percent decoded as code, entry, and the
  save state of the hints ("saved", "unsaved", "no hints yet").
- The divider between the pages can be dragged.
- The dimmed tabs show and say "coming later" rather than being hidden, so
  the site shows where it is going.

### First screen

The workbench is the home page. Before a file is loaded, the left page is a
**drop zone** (drop or pick a `.CMD`, `.BAS`, or raw binary). Beside it are
**one-click buttons for the four public-domain games** in `examples/`: Sea
Dragon, Rear Guard, Eliminator, Armored Patrol. One click loads the game and
shows its listing with the right page populated.

My calls:
- The examples are described by a small manifest in `apps/web` (game, builds,
  main build, machine, the history fields, the README's rights quote and
  source link), copied from the example READMEs. The `.CMD` files are served
  from `examples/` at build time, not duplicated in git.
- Each game gets one button, opening a chosen build: `seadrg01.cmd` with its
  committed `seadrg01.hints`, and for the others the build their README
  presents as the main one. A small menu on the button lists the other
  builds.
- A raw binary asks for its load address before analysis, as `--base` does.

### Editing: keyboard first, with a right-click menu

The user approved this scheme:

| Key | Action |
| --- | --- |
| **C** / **D** / **W** / **S** | mark the selection code / bytes / words / string |
| **T** | declare a jump table from the selection |
| **N** | rename the label under the cursor |
| **;** | edit the comment on the current row |
| **G** | go to an address or label |
| **Alt+←** / **Alt+→** | back / forward through jumps followed, like a browser |
| **⌘Z** / **Ctrl+Z** (and redo) | undo / redo the last edit |
| **Esc** | back out of the current action |

The right-click menu on a row offers the same actions. Rows are selected
with click, shift-click, and arrow keys. Following a link (clicking a label
or a jump target) moves the cursor there and pushes the back stack.

**Names and comments outside the program** (the user's decision): **N** and
**;** also work on addresses outside the loaded image, such as RAM variables
above the program or operand targets no table names. This needs one new
address-keyed directive (for example `at $7F00 name SCORE` /
`at $7F00 comment ...`; the builder settles the syntax) in the hint-file
format. The plan's "Hint file" section is updated first, the parser,
writer, and `applyHints` learn it, and the CLI honours it like any other
directive. Table names (ROM, hardware, DOS) are not renamable: they come from
the cited tables. A user name at the same address overrides the table name
in the listing only, and the Symbol tab still shows the table entry.

**Pure `.BAS` programs are read-only in phase 4** (my call). C/D/W/S/T mean
nothing on BASIC lines, and BASIC-line comments don't exist in the format.
The hidden-code (pass 1) view of a `.BAS` program is editable like any other
listing.

Every edit becomes a hint-file directive. The library re-analyzes and the
listing re-renders, keeping the cursor on the same address. Undo removes or
restores directives, so undo and the hint file can never disagree.

### Persistence

Hints save automatically to IndexedDB, keyed by the program's SHA-256. Drop
the same file next week and its names and comments come back.

**Applying a dropped hint file follows the library, not a whole-file check**
(my call; the plan and the code disagreed). The plan's "Identity" bullet says
the workbench refuses a mismatch, but its key rule and `applyHints` pair
hints by block length and hash, so one hint file serves several builds, and
the CLI never checks the `program sha256` line. The workbench does what the
CLI does: apply what matches and report unmatched blocks' hints in the Hints
tab. It refuses only a hint file of which **no** block matches. The plan's
"Identity" bullet is reworded to say this. When a program has no saved hints
but IndexedDB holds hints for another program with matching blocks (another
build of the same game), the workbench offers to carry them over.

Bundled examples with committed hints start from those hints; the user's
edits then save over them locally.

**Hosting and storage (decided with the user, 2026-10-17).** Netlify serves
static files only. Everything the user adds (hints, settings, manuals, and
later ROMs) lives in that browser's IndexedDB, on that machine. The workbench
asks for persistent storage (`navigator.storage.persist()`) so the browser
does not evict it. There is no server storage, no accounts, no Supabase, no
droplet. The user explicitly does not want to host or be responsible for
copyrighted material, and moves between a Mac and a PC, adding manuals once
on each.

**Back up / Restore** (on the Manuals page, and in the top bar's menu): one
JSON file holding every saved hint file (as hint-file text, keyed by program
SHA-256, with the file name) and the per-program settings (machine, DOS).
Restore merges it in. For a program present in both, the restored copy wins
only after a confirmation naming the program. The backup never contains
manuals, ROMs, or program files, only the user's own work.

### Machine and DOS

The spec sheet's machine verdict (above) is evidence from the cited tables,
not a guessing heuristic. My calls: when a program is first opened, the
picker is set to the verdict if it names exactly one machine, otherwise
to Model III and its default DOS, as the CLI does. Each bundled example opens
with the machine its manifest gives. The verdict never overrides the picker.
The picker's choice is remembered per program in IndexedDB, as a workbench
preference beside the hints. It is not a hint directive, because it changes
names, not analysis. The status line shows the selected machine and DOS.

A program opened as one machine can still be looked at as the other. The
verdict is computed from what the program touches, which is the same under
either picker setting.

### Export

**Export ▾** offers:

- **zmac source**, the **hint file**, and the **JSON IR** (the plan's three).
- **`.CMD`** (the user's addition): the loaded memory image written as a load
  module, with the program's entry as the transfer address and its name
  record when it had one. Phase 4 edits never change program bytes, so this
  needs no assembler. It is most useful for a raw binary (it gives it an
  entry and makes it runnable) and for oddly packaged files such as
  `ARMOUR.III`. The test suite's `CmdWriter`
  (`packages/disasm/test/writers/cmd-writer.ts`) moves into `@fugloy/disasm`
  as a real export, and the tests keep using it.
- **`.CAS`** (the user's addition): a cassette image. For a machine-code
  program, a SYSTEM tape (`A5` sync, `55` + six-character name, data blocks,
  entry). For a `.BAS` program, a BASIC tape. The writer goes in
  `@fugloy/disasm`.

**Correctness bar:** each exported `.CMD` reloads through `loadCmd` to the
same memory image and entry. Each `.CAS` decodes back to the same image,
checked by a decoder in the tests (the emu's `cas-format` loader may serve as
a cross-check in tests only; `disasm` takes no dependency on `emu`). At least
one exported example is run once by hand in a real emulator (trs80gp or
trsjs) before the phase is called done, and the result recorded.

A program whose blocks overlap or that relocates itself exports the file's
load image (what the loader put in memory), not the runtime view.

### Manuals (bring your own)

The user wants to read the cited manuals inside Fugløy. Most of them (the
Tandy and Radio Shack manuals, Paay, Decker) are still under copyright, so the
site hosts none of their text or page images. Instead they work like ROMs:
**you provide your own copy**, it stays in your browser, and Fugløy shows it.

- **Manuals page** (`/manuals`, linked from the top bar): every source in
  `sources.json`, by exact title, author or publisher, year, and edition or
  catalog number, with a plain note that these must be provided
  independently, and a link to where a scan is known to exist (the
  `locator`). Each entry shows whether you have it.
- **The cover when you don't have it** (the user's request, so you can be
  sure you're finding the right book): for sources scanned on archive.org,
  the cover comes from archive.org's item-image service
  (`https://archive.org/services/img/<identifier>`, checked 2026-10-17 for
  the Model III TRM: a JPEG). It is fetched from archive.org, not hosted by
  Fugløy. The page says so, and the request carries nothing about your
  files. Sources without a scan (the Model I Technical Reference Handbook,
  26-2103, and the Model 4 TRM, 26-2110) show a plain title card. Once you
  have added a manual, its entry shows page 1 of your own copy instead.
- **Adding a manual:** drop a PDF on the Manuals page (or from the "Add this
  manual" link a citation shows). Fugløy recognizes the archive.org scans by
  SHA-256. For any other PDF you pick which manual it is. The file is stored
  in IndexedDB, never uploaded, and can be removed.
- **Manual tab** on the right page, beside Symbol, Index and Program:
  renders your copy at the cited **printed** page, sharp at any zoom. When
  the PDF has a text layer, the name or address you came from is highlighted
  on the page. You can page through freely, and back returns to the listing.
- **Printed page → PDF page.** Scans start with covers and blanks, so `p.15`
  is rarely PDF page 15. For each known archive.org scan, a small checked
  table in the repository (data, not code) maps printed pages to PDF pages.
  It is verified by hand the way phase 3's citations were, including the
  front matter and any roman-numbered pages. For any other PDF you set the
  mapping once ("which PDF page is printed page 1?"), stored with the file.
- **Without the manual**, a citation shows its title and page, the cover, an
  **"Open page N on archive.org"** link to that page of the scan (from the
  same printed-page table, using archive.org's `/page/n<leaf>` reader
  address, checked when the table is built), and "Add this manual". Nothing
  is broken. The user's view: your own PDF is the fast path, opened inside
  Fugløy with no network. The archive.org page is the fallback.
- **Hosted, anchored text** for sources we may redistribute (Soltoff's
  *Programmer's Guide to LDOS/TRSDOS 6* is free to redistribute) is a later
  idea, not phase 4.

My calls: PDF rendering uses PDF.js (`pdfjs-dist`), a dependency of
`apps/web` only, loaded lazily the first time a manual is opened, so the
workbench's first load stays fast. This adds roughly a week to the phase.

### Pages

- `/` — the workbench.
- `/technical-details` — the Inside Fugløy explainer, from
  `docs/technical-details/inside-fugloy.html` (a page fragment the host
  wraps). Its numbers are as of phase 2; updating them and its pre-phase-3
  sample output is part of this phase (deferred from phase 3).
- `/manuals` — your manuals (above).
- `/about` — what Fugløy is, that files never leave your machine, credits
  (the symbol tables' sources, zmac, the public-domain release of the
  Westmoreland and Gilman games with the trs-80.org quote), a link to the
  repository.

All four share the top bar.

### SEO (from the plan and CLAUDE.md, unchanged)

On every page: a title and description; a canonical URL on
`https://app.fugloy.dev` (with a trailing slash past the home page, as in
`/about/`, where Netlify serves each generated directory; `og:url` and
`sitemap.xml` use the same URLs); Open Graph and Twitter card (`summary_large_image`)
tags whose image is `docs/images/og-image.png` (1200×630) at an absolute URL,
with alt text; favicons from the card's ø tile (source
`docs/images/og-image.svg`). Site-wide: `robots.txt`, `sitemap.xml`, and
JSON-LD `SoftwareApplication` on the home page.

## Shape of the build

The plan says the virtualized listing is phase 4's main technical risk and is
prototyped first. Order:

1. **Listing prototype.** `apps/web` scaffold, a virtualized listing of a real
   program (Sea Dragon, then the largest sample available) with syntax
   highlighting. Smooth scroll, jump-to-address, and re-render after an edit
   with the cursor held, on an 8,000+ row program. If this fails, stop and
   report; it is the plan's named risk.
2. **Structured listing rows from the library.** Today `renderPass1Listing`
   returns a string. The workbench needs the same content as rows with typed
   spans (address, bytes, label, mnemonic, operand pieces with their target
   addresses and kinds, comment), so it can color and link them without
   re-parsing text. This belongs in `@fugloy/disasm`, and the text renderer
   should become a thin formatter over it, so the CLI and the site can never
   drift. The same goes for the `.BAS` listing. (The builder designs the row
   type. The test is that the text listing is byte-identical before and
   after.)
3. Drop zone, examples, header facts, machine/DOS pickers.
4. Right page: Symbol, Index, Program.
5. Editing and the hint-file round trip, undo/redo, back/forward.
6. IndexedDB persistence, hint-file drop, export.
7. Manuals: the Manuals page, the Manual tab, the page tables for the
   archive.org scans. Then Technical details and About; SEO; favicons.
8. Playwright flow; Netlify deploy (ask the user before the first deploy and
   before any DNS change).

The hint-format change (names and comments outside the image) and the
`.CMD`/`.CAS` writers are library work. They can run before or alongside
step 3, but the plan text is updated before the directive is coded.

### Proving the done-criterion

asylum16.cmd is copyrighted and lives in the gitignored `sample/`, so CI
cannot load it (my call on how to prove it):
- **CI (Playwright)** proves the browser flow on a public game: open
  `seadrg01.cmd` from its example button with its committed hints, rename a
  label, add a comment, reload the page, and see both restored. Then export
  zmac source and confirm it matches the CLI's zmac output for the same
  hints. The CLI's existing zmac round trip covers reassembly.
- **asylum16** is checked locally: a Playwright test that `skipIfMissing()`s
  without the file, plus one recorded manual pass under Model I.

Phase 3 deferred items that land here, because the side panel and live
re-render surface them:
- `sources.json` `ldos51`/`soltoff`: two URLs in one `locator` and
  "c. 1982" in `year`. The Symbol tab prints these, so fix the data shape.
- IR `tableNames` omits names used only by `.BAS` notes; the Index needs
  them.
- `listing.ts` recomputes `externalUses`/`commentEntries` on every render.
  Memoize, since the workbench re-renders on every edit.
- `ir.ts` imports the emit layer. Untangle it if the row work touches it.
- The README social card and the explainer show pre-phase-3 output; refresh
  both.

## Room for the IDE (later)

Not built now, but phase 4 must not block it:
- The **Run ▶** tab on the right page and **Source ✎** tab on the left page
  exist (dimmed) from the start, so the layout already has their homes.
- Analysis state lives in one place the UI observes (analysis + hint file),
  not scattered through components, so a future emulator can share the same
  program and labels. The emu spec's label file (`docs/label-format.md`) is
  the later bridge. Phase 4 doesn't implement it.
- No decision here should assume the listing is the only view of a program.

## Left to the builder

- Component structure, state management (Pinia or plain composables),
  routing details, and which virtual-list approach (Nuxt UI's, a small
  library, or hand-rolled), as long as step 1's bar is met.
- The exact color palette and fonts, within "dark first, sleek, modern". A
  light theme is optional. Dark is the default and must be excellent.
- Whether analysis runs on the main thread or in a Web Worker. The CLI
  analyzes Sea Dragon in well under 0.2 s including Node startup, so either
  may do. Measure on the largest sample.
- The structured row type and how the text renderer is rebuilt over it.
- How Playwright gets the example files (they are committed, so CI has them).

## Plan and CLAUDE.md changes in the same work

- Plan, "Web app": record the facing-pages layout, the bundled examples on
  the first screen, the keyboard scheme, the About and Technical details
  pages, and the dimmed Run/Source tabs as the hooks for phase 5.
- Plan, "Hint file": add the address-keyed name/comment directive. Reword
  "Identity" to block-paired application, refusing only when nothing
  matches.
- Plan, "Web app": the header's "detected machine" becomes the spec sheet's
  evidence-based machine verdict. Add the spec sheet to the side panel and
  the `.CMD` and `.CAS` exports to step 5.
- Plan, "Web app": add the Manuals page and Manual tab (bring your own,
  covers from archive.org, nothing hosted).
- Plan, "Stack": `apps/web` confirmed. `CLAUDE.md`: drop the "settle the name
  before phase 4" note.
- `CLAUDE.md` "Current phase" updated as phase 4 progresses.
