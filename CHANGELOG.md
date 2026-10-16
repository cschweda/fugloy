# Changelog

All notable changes to Fugløy are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); until 1.0 each
project phase lands as a minor version.

Releases are tagged `vX.Y.Z` on `main`.

## [Unreleased]

Phase 2, sub-projects A (Pass 1 and the round-trip proof) and B (labels and
the hint file), plus the emulator and MCP server stubs.

### Added

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
  binaries; the phase-1 linear sweep is `--sweep`. `.BAS` listings are
  unchanged unless `--entry` names hidden code.
- The pass 1 header counts bytes decoded as code and, separately, bytes typed
  as data by hints.
- Project plan: the undocumented-opcode spelling question is closed (zmac's
  names, which the listing already used).
- README: CI badge, release badge (latest semver tag, live now that the
  repository is public), repository link; changelog release links.
- `linkWorkspacePackages` in `pnpm-workspace.yaml`, so a semver range on a
  workspace package resolves locally the way npm workspaces would.

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
