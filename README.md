# Fugløy

[![CI](https://github.com/cschweda/fugloy/actions/workflows/ci.yml/badge.svg)](https://github.com/cschweda/fugloy/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/tag/cschweda/fugloy?label=release&sort=semver&style=flat)](https://github.com/cschweda/fugloy/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A Z80 disassembler for the TRS-80 Model I and Model III that reads `.CMD` load
modules and tokenized `.BAS` programs directly, rebuilds the memory image the
way the machine would, and prints a listing. The full design, phases, and the
measured facts about the sample programs are in
[docs/Fugloy-Project-Plan.md](docs/Fugloy-Project-Plan.md); working
conventions are in [CLAUDE.md](CLAUDE.md).

Named after the island in *Voyage of the Valkyrie*; spelled `fugloy` in code.

## Status

**Current release: [v0.1.0](https://github.com/cschweda/fugloy/releases/tag/v0.1.0), phase 1: core decoder and loaders.**
**Phase 2, Pass 1 and Pass 2, is complete.** Recursive descent, zmac source
that reassembles to the identical memory image (proven against every fixture,
every present real program, and every Z80 encoding under a pinned zmac), a
JSON IR, labels, and the hint file; machine code hidden in tokenized BASIC
found by parse validity and disassembled at its true addresses; strings,
jump-table and loader-stub proposals; rebasing; and relocated regions analyzed
where they run. Next come the emulator's first phase and phase 3's ROM and
DOS symbol tables, in the order the roadmap in `CLAUDE.md` gives. Every change
is recorded in [CHANGELOG.md](CHANGELOG.md); releases are tagged `vX.Y.Z` on
`main`.

| Package | What it holds |
| --- | --- |
| `packages/z80` | Z80 opcode tables generated from the x/y/z/p/q decomposition (unprefixed, `CB`, `ED`, `DD`/`FD`, `DDCB`/`FDCB`) with length, operands, cycle counts, and control-flow effect; a decoder; an exhaustion test against an independently typed reference. No I/O. |
| `packages/disasm` | 64K memory image with a load bitmap and block log, `.CMD` and `.BAS` loaders, content-based format detection, raw loader, a Level II BASIC parser and entry-point miner, pass 1 recursive descent, labels, the hint file, string and proposal heuristics, rebasing, relocation, zmac emitter, JSON IR, linear sweep, plain-text listings. No Node or DOM APIs, so it runs in a browser. |
| `packages/cli` | `fugloy <file> [--base <hex> \| --rebase <hex>] [--entry <hex>]... [--hints <path> \| --write-hints <path>] [--format listing\|zmac\|ir] [--sweep] [-o <path>]`, the only package that touches the file system. |
| `fixtures/synthetic` | Generated fixtures, one per loader rule, written by the test suite's own `.CMD` writer and BASIC tokenizer. |

Later phases add per-machine ROM and DOS symbol tables and a static web
workbench (`apps/web`, Nuxt 4, deployed to Netlify).

## Requirements

Node 22 (`.nvmrc`) and pnpm 10.

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
pnpm fugloy game.cmd --format ir                 # JSON: regions, basic blocks, xrefs, diagnostics
pnpm fugloy game.cmd --sweep                     # the phase-1 linear sweep instead of pass 1
pnpm fugloy game.cmd --write-hints game.hints    # a hint-file skeleton to edit by hand
pnpm fugloy game.cmd --hints game.hints          # apply entries, overrides, tables, names, comments
```

A hint file is line-oriented text keyed by block and offset, so it diffs in
git and the same file applies to a relocated build of the same program:

```
fugloy-hints 1
block 0 length $4F49 hash 7f83b1657ff1fc53    # start $6300
block 0:$4E12 name MAIN_ENTRY
block 0:$0D12 table 16 2
block 0:$1A00 bytes $40
block 0:$2000 comment main loop
block 0:$00E1 relocate $42F3 $0080    # these bytes run at $42F3: analyzed there, emitted under .PHASE
```

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

## Sample programs

The copyrighted programs used as fixtures (Asylum, Volcano Hunter, Voyage of
the Valkyrie, Armored Patrol, Space Warp, Sea Dragon, Pirate's Adventure,
Voodoo Castle, Deathmaze 5000) and the ROM images are never committed. Tests that need them look
in `sample/` or `fixtures/real/`, both gitignored, and skip when the files are
absent.

## Conventions

Addresses are `$3C00` in prose and comments and `3C00H` in emitted assembly.
Opcode tables are generated, never hand-edited. The image is a flat
`Uint8Array(65536)` with a parallel bitmap. See `CLAUDE.md` for the rest.

## Repository

Source and issues: [github.com/cschweda/fugloy](https://github.com/cschweda/fugloy).
CI runs typecheck, tests, build, and a check that the committed synthetic
fixtures still match their writers on every push and pull request.

## License

MIT, © 2026 Christopher Schweda. See [LICENSE](LICENSE).
