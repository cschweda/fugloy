# Fugløy

[![CI](https://github.com/cschweda/fugloy/actions/workflows/ci.yml/badge.svg)](https://github.com/cschweda/fugloy/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/tag/cschweda/fugloy?label=release&sort=semver&style=flat)](https://github.com/cschweda/fugloy/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A TRS-80 disassembler that reads programs the way the machine stored them,
finds the code, and proves that its output rebuilds the original byte for
byte.**

## What is it?

Fugløy takes a program for the TRS-80 Model I or Model III, a `.CMD` load
module or a tokenized BASIC program saved to disk, and turns it into:

- a **listing** that separates code from data, names every jump, call, and
  data reference, and shows machine code hidden in BASIC at the address it
  really occupies;
- **zmac assembler source** that assembles back into exactly the same bytes;
- a **JSON description** of the program (regions, basic blocks,
  cross-references, symbols) for other tools to build on.

It is a command-line tool for Node 22 today. Its core library has no runtime
dependencies and uses no Node or browser APIs, so the same code will run in
the planned web workbench.

Named after the island in *Voyage of the Valkyrie*; spelled `fugloy` in code.

## Why Fugløy

### How the usual tools work

**Emulators** run the program on a simulated TRS-80, and their debuggers let
you watch it execute, instruction by instruction. That is the best way to see
what a program does, but it leaves you with a live view of memory rather than
a labeled listing you can edit, keep, and rebuild.

**General-purpose disassemblers** start from a raw memory dump. You tell them
where the code begins and they decode forward from there, so text, tables,
and graphics come out as nonsense instructions until you mark them by hand.
The large interactive suites follow jumps and calls instead. Either way they
are built for any Z80 system, and the TRS-80's habits are left to you:

- a `.CMD` file is a list of load records, not a memory image, and real
  files bend the format's rules;
- tokenized BASIC stores each keyword as a single byte, and games hid machine
  code inside BASIC lines so that one load brought in both;
- many games load high in memory and copy themselves elsewhere before they
  run, so the code you want is never where the file put it.

Nothing in that workflow checks that the listing, assembled again, gives back
the bytes it came from.

### What Fugløy does differently

- **It reads the machine's own formats.** `.CMD` load records, quirks
  included, and tokenized Level II BASIC are recognized by their content,
  never by the file's extension, and the bytes land in a 64K image exactly
  where the TRS-80 would put them.
- **It finds code hidden in BASIC.** Every line is parsed as BASIC, statement
  by statement; a line that cannot be BASIC is machine code, disassembled at
  its true address. Fugløy also follows the program's own `PEEK` and `POKE`
  arithmetic to the entry point the BASIC text plants. On all 13 *Voyage of
  the Valkyrie* files it finds exactly the 182 code lines and the entry that
  line 250 builds.
- **It follows the flow.** Recursive descent from the program's real entry
  points keeps data out of the instruction stream. Text becomes quoted
  strings, and jump tables and self-moving loaders are proposed with the
  exact hint lines that would declare them, never applied behind your back.
- **It analyzes code where it runs.** A `relocate` hint says that some bytes
  execute at another address. Fugløy analyzes them there and emits them
  inside zmac's `.PHASE`, so the source still rebuilds the file. Asylum's 123
  loader records become 123 such hints, generated from the game itself, and
  61% of the game then decodes at its running address.
- **It proves its output.** The tests assemble Fugløy's source with a pinned
  zmac and compare every byte: every Z80 encoding, every synthetic fixture,
  46 real programs, and the Model I Level II ROM.
- **It keeps your notes.** Names, comments, and code and data decisions live
  in a plain-text hint file keyed by content, so one file fits a relocated
  build of the same program, and a BASIC program after `--rebase`.

The roadmap adds a headless emulator and an MCP server next, so that what a
program does at run time can confirm and extend what the static analysis
finds.

## User stories

What people come to Fugløy for, and how each one is done today.

- **As a fan who grew up with a TRS-80 game,** I want to read its machine
  code as labeled assembly, so that I can see how it really worked.
  *Today:* `pnpm fugloy game.cmd` lists it, with the jumps, calls, and data
  references inside the program named.
- **As someone studying a BASIC game,** I want the machine code hidden in its
  lines shown at the addresses it occupies, so that I can follow what the
  BASIC hands off to. *Today:* `pnpm fugloy game.bas` parses every line,
  disassembles the ones that cannot be BASIC, and finds the entry point the
  BASIC plants when it uses one of the common idioms.
- **As a preservationist,** I want a disassembly I can trust byte for byte,
  so that an annotated or repaired copy can be rebuilt exactly. *Today:*
  `--format zmac` writes source that the test suite reassembles and compares
  with the original, for every fixture and every sample program present.
- **As a reverse engineer working over many evenings,** I want my names,
  comments, and code-or-data decisions kept in a file I can commit, so that
  nothing I learn is lost and the same notes fit other builds of the program.
  *Today:* hint files are plain text keyed by content; one file fits Asylum
  1b, 1c, and 1d.
- **As someone taking apart a game that moves itself,** I want its code
  analyzed at the addresses where it runs, so that the listing matches what
  the CPU executes. *Today:* `relocate` hints, and proposals with the exact
  hint lines for the common copy-then-jump loaders.
- **As a modder,** I want to change the assembly and rebuild the program, so
  that I can fix a bug or make a variant. *Today:* the zmac source
  reassembles as it stands, labels and relocated regions included, so your
  edits start from a faithful copy.
- **As a tool builder,** I want the analysis as data, so that I can build my
  own views on it. *Today:* `--format ir` writes JSON with regions, basic
  blocks, cross-references, symbols, proposals, and relocations, and the core
  library is written to run in a browser.
- **As a teacher,** I want real examples of how 1980 software fit BASIC and
  machine code into 48K, so that students can see the tricks for themselves.
  *Today:* the listings show tokenized BASIC, hidden code, and self-moving
  loaders next to the bytes they came from.

Planned, per the roadmap:

- **As someone checking what really runs,** I want to run the program and see
  which bytes execute, so that the listing can be confirmed against the real
  thing. *Planned:* the headless emulator in `packages/emu`.
- **As a reader of a listing,** I want ROM and DOS calls named, so that
  `CALL 0033H` reads as showing a character. *Planned:* phase 3's symbol
  tables.
- **As someone without a terminal,** I want to explore and annotate a listing
  in the browser. *Planned:* phase 4's web workbench.

## Status

**Current release: [v0.1.0](https://github.com/cschweda/fugloy/releases/tag/v0.1.0)**, phase 1: core decoder and loaders.
**Phase 2, Pass 1 and Pass 2, is complete and not yet released.** It brings
recursive descent, zmac source that reassembles to the identical memory
image, a JSON IR, labels, the hint file, machine code hidden in tokenized
BASIC found by parse validity and placed at its true addresses, strings,
jump-table and loader-stub proposals, rebasing, and relocated regions
analyzed where they run. Next is the emulator's phase 0, booting the
TRS-80's ROM to `READY` in Node; phase 3's ROM and DOS symbol tables are not
yet scheduled (see the roadmap in [CLAUDE.md](CLAUDE.md)). Every change is
recorded in [CHANGELOG.md](CHANGELOG.md); releases are tagged `vX.Y.Z` on
`main`.

| Package | What it holds |
| --- | --- |
| `packages/z80` | Z80 opcode tables generated from the x/y/z/p/q decomposition (unprefixed, `CB`, `ED`, `DD`/`FD`, `DDCB`/`FDCB`) with length, operands, cycle counts, and control-flow effect; a decoder; an exhaustion test against an independently typed reference. No I/O. |
| `packages/disasm` | 64K memory image with a load bitmap and block log, `.CMD` and `.BAS` loaders, content-based format detection, raw loader, a Level II BASIC parser and entry-point miner, pass 1 recursive descent, labels, the hint file, string and proposal heuristics, rebasing, relocation, zmac emitter, JSON IR, linear sweep, plain-text listings. No Node or DOM APIs, so it runs in a browser. |
| `packages/cli` | `fugloy <file> [--base <hex> \| --rebase <hex>] [--entry <hex>]... [--hints <path> \| --write-hints <path>] [--format listing\|zmac\|ir] [--sweep] [-o <path>]`, the only package that touches the file system. |
| `packages/emu` | A stub for the headless, deterministic TRS-80 emulator; design in [docs/fugloy-emu-spec.md](docs/fugloy-emu-spec.md). |
| `packages/mcp` | A stub for the MCP server that will let an AI assistant drive the emulator; design in [docs/fugloy-mcp-spec.md](docs/fugloy-mcp-spec.md). |
| `fixtures/synthetic` | Generated fixtures, one `.CMD` or `.BAS` per loader rule and analysis case plus their hint files, written by the test suite's own `.CMD` writer and BASIC tokenizer. |
| `fixtures/hints` | Hint files for real programs; `asylum16.hints` carries Asylum's generated relocate lines. |

Later phases add per-machine ROM and DOS symbol tables and a static web
workbench (`apps/web`, Nuxt 4, deployed to Netlify).

## Requirements

Node 22 (`.nvmrc`) and pnpm 10. The round-trip tests also need zmac, which
`pnpm zmac:install` builds from a pinned commit into the gitignored `tools/`
folder; that takes git, make, a C compiler, and bison. Without zmac those
tests skip; with `FUGLOY_REQUIRE_ZMAC=1`, as in CI, they fail instead.

## Use

```sh
pnpm install
pnpm test          # vitest, all packages
pnpm typecheck     # tsc project references plus the test sources
pnpm build         # emits packages/*/dist
pnpm fixtures      # regenerates fixtures/synthetic from the writers
pnpm zmac:install  # builds the pinned zmac into tools/ for the round-trip tests

pnpm fugloy path/to/program.cmd          # load module: pass 1 listing (descent from the entry)
pnpm fugloy path/to/program.bas          # tokenized BASIC: its lines, any hidden code disassembled
pnpm fugloy program.bas --rebase 7000    # the same program as if saved from $7000
pnpm fugloy path/to/code.bin --base 5200 # raw binary at a base address (hex)

pnpm fugloy game.cmd --entry 7000 --entry 7A40   # extra entry points for pass 1
pnpm fugloy game.cmd --format zmac -o game.z     # assembler source that reassembles to the same image
pnpm fugloy game.cmd --format ir                 # JSON: regions, blocks, xrefs, symbols, proposals, relocations
pnpm fugloy game.cmd --sweep                     # the phase-1 linear sweep instead of pass 1
pnpm fugloy game.cmd --write-hints game.hints    # a hint-file skeleton to edit by hand
pnpm fugloy game.cmd --hints game.hints          # apply names, comments, entries, code and data, tables, relocations
```

The exit code is 0 on success, 1 when a file cannot be read or written, and 2
for a usage error, a file that is neither a load module nor tokenized BASIC,
a hint-file error, or a relocation that cannot apply.

### What the output looks like

A tokenized BASIC program with machine code in line 20, from the test
fixtures (`pnpm fugloy fixtures/synthetic/bas/hidden-code.bas`):

```
; hidden-code.bas: tokenized BASIC, 3 lines, saved from $7000 to $701A, FF header, 1 unparsed
; pass 1: roots $700D; 3 of 28 bytes decoded as code (11%); 22 typed as data; 1 external target; 0 notes
; code lines: 1; entries mined: 0

10 GOTO 30
; line 20: machine code, 6 bytes at $700D
700D  C3 00 00      JP 0000H                ; entry
7010  C9 00 3E      DB 0C9H,00H,3EH
30 END
```

Code that loads at `$8000` but runs at `$5000`, as zmac source (`pnpm fugloy
fixtures/synthetic/cmd/relocated-code.cmd --hints
fixtures/synthetic/hints/relocated-code.hints --format zmac`). Labels take the
running addresses, and the bytes still assemble where the file loads them:

```
	ORG	8000H
	.PHASE	5000H
L5000:
	CALL	SETONE
	JR	L5007	; skip the padding
	DB	00H,00H
L5007:
	RET
SETONE:
	LD	A,01H
	RET
	.DEPHASE
	ORG	8100H
	LD	HL,8000H
	LD	DE,L5000
	LD	BC,000BH
	LDIR
	JP	L5000
	END	8100H
```

### Hint files

A hint file is line-oriented text keyed by block and offset, so it diffs in
git. Write a skeleton with `--write-hints`, then add one directive per line:
`entry`, `code`, `bytes <n>`, `words <n>`, `string`, `nocode`,
`table <count> 2`, `name <label>`, `comment <text>`, or
`relocate <addr> <length>`.

```
fugloy-hints 1
block 0 length $4F49 hash f5a5fd42d16a2030    # asylum1b.cmd, loaded at $6300
block 0:$4E12 name MAIN_ENTRY                 # the transfer address, $B112
block 0:$4E12 comment where the game starts
```

A block is recognized by its length and a fingerprint of its first 64 bytes,
not by its address, so this file also fits asylum1c and asylum1d: the same
20,297 bytes loaded at `$A000` and `$5200`. An excerpt of
[fixtures/hints/asylum16.hints](fixtures/hints/asylum16.hints), where each
stream record of the loader becomes a `relocate` line:

```
block 0 length $3FF0 hash 5167633e79339601    # start $8000
block 0:$00E1 relocate $42F3 $0080
block 0:$0165 relocate $4373 $0080
block 0:$01A0 entry
```

### How the analysis reads a program

The format is detected from content, never from the extension; `.III`,
`.bad`, and `.CMD` are all load modules. Raw binaries need `--base`. Bytes
pass 1 does not reach are listed as `DB`, and terminated printable text as a
quoted string. A `.BAS` line that does not parse as BASIC is machine code: the
listing shows it disassembled at its true address, along with any entry point
the BASIC text plants (`DEFUSR`, the USR vector, a poked `JP`). Jump and call
targets, data references, and declared tables get `L`, `SUB_`, `DATA_`, and
`TBL_` labels; `name` hints rename them. The listing header proposes jump
tables and loader stubs (a copy with `LDIR` followed by a jump into it) with
the exact hint lines that would declare them; nothing is applied until those
lines are in a hint file. A code line whose bytes happen to read as BASIC
(`XOR A / RET` is `LPRINT INKEY$`) stays BASIC; declare it with a `code` hint,
and a jump that lands inside such a line says which line and which hint.

## Documentation

- [docs/Fugloy-Project-Plan.md](docs/Fugloy-Project-Plan.md): the design,
  the phases, the hint-file format, and measured facts about the sample
  programs.
- [CHANGELOG.md](CHANGELOG.md): every change, by release.
- [docs/fugloy-emu-spec.md](docs/fugloy-emu-spec.md) and
  [docs/fugloy-mcp-spec.md](docs/fugloy-mcp-spec.md): the emulator and the MCP
  server.
- [docs/label-format.md](docs/label-format.md): the label and coverage file
  shared by the emulator, the MCP server, and the disassembler.
- [CLAUDE.md](CLAUDE.md): working conventions and the roadmap.

## Sample programs

The copyrighted programs used as fixtures (Asylum, Volcano Hunter, Voyage of
the Valkyrie, Armored Patrol, Space Warp, Sea Dragon, Pirate's Adventure,
Voodoo Castle, Deathmaze 5000) and the ROM images are never committed. Tests
that need them look in `sample/` or `fixtures/real/`, both gitignored, and
skip when the files are absent.

## Conventions

Addresses are `$3C00` in prose and comments and `3C00H` in emitted assembly.
Opcode tables are generated, never hand-edited. The image is a flat
`Uint8Array(65536)` with a parallel bitmap. See `CLAUDE.md` for the rest.

## Repository

Source and issues: [github.com/cschweda/fugloy](https://github.com/cschweda/fugloy).
CI builds the pinned zmac and requires it, then runs typecheck, the tests,
the build, and a check that the committed synthetic fixtures still match
their writers, on every push and pull request.

## License

MIT, © 2026 Christopher Schweda. See [LICENSE](LICENSE).
