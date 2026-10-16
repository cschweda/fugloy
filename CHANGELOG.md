# Changelog

All notable changes to Fugløy are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); until 1.0 each
project phase lands as a minor version.

Releases are tagged `vX.Y.Z` on `main`.

## [Unreleased]

Phase 2, sub-projects A (Pass 1 and the round-trip proof), B (labels and the
hint file), and C (hidden code, heuristics, rebasing, and relocation), plus
the emulator and MCP server stubs. With C the phase 2 deliverable is met:
every synthetic fixture round-trips, and Valkyrie's hidden code disassembles
at its true addresses.

### Added

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
- A BASIC line that leaves `THEN` out of `IF` (`IF A PRINT`, `IF A 100`)
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

[Unreleased]: https://github.com/cschweda/fugloy/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/cschweda/fugloy/releases/tag/v0.1.0
