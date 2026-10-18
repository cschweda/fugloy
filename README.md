<p align="center">
  <a href="docs/images/og-image.png"><img src="docs/images/og-image.svg" alt="Fugløy: a Z80 disassembler for the TRS-80. Disassemble, label, reassemble, byte for byte. Beside it, Fugløy's own pass 1 listing of a short Model III routine, with its video and DOS addresses named." width="100%"></a>
</p>

# Fugløy

[![CI](https://github.com/cschweda/fugloy/actions/workflows/ci.yml/badge.svg)](https://github.com/cschweda/fugloy/actions/workflows/ci.yml)
[![Z80 exercisers](https://github.com/cschweda/fugloy/actions/workflows/exerciser.yml/badge.svg)](https://github.com/cschweda/fugloy/actions/workflows/exerciser.yml)
[![Release](https://img.shields.io/github/v/tag/cschweda/fugloy?label=release&sort=semver&style=flat)](https://github.com/cschweda/fugloy/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TRS-80](https://img.shields.io/badge/TRS--80-Model%20I%20%C2%B7%20Model%20III-ffb547.svg)](#what-is-it)
[![zmac](https://img.shields.io/badge/zmac-round%20trip-62e3d4.svg)](https://github.com/gp48k/zmac)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg)](https://www.typescriptlang.org)

**A TRS-80 disassembler that reads programs the way the machine stored them,
finds the code, and proves that its output rebuilds the original byte for
byte.**

## What is it?

Fugløy takes a program for the TRS-80 Model I or Model III, a `.CMD` load
module or a tokenized BASIC program saved to disk, and turns it into:

- a **listing** that separates code from data, names every jump, call, and
  data reference, names the ROM, hardware, and DOS addresses a program uses,
  and shows machine code hidden in BASIC at the address it really occupies;
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
what a program does, and it covers the code that a particular run reaches. The
debugger's view is live memory, not a listing you can edit, keep, and rebuild.
trs80gp can also record a run as a disassembly (Record → Bus Use); its manual
says the result should be a good one once the program has been put through its
paces, and that a program that relocates itself needs a relocated copy loaded
first.

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

**TRS-80 disassemblers** read `.CMD` files directly. MISOSYS's DSMBLR (1983)
ran on the TRS-80 itself, and DASM80 and Z80Disasm are command-line programs
for Windows; each takes "screening" files that mark address ranges as data.
None of the three documents reading tokenized BASIC.

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
- **It names the machine's own addresses.** ROM routines, hardware registers
  and ports, and DOS vectors and service calls come out by name, from eight
  tables of 634 entries, each entry citing a page of a published source. The
  Model I and Model III ROM maps are entered separately and compared, and a
  name the other machine's map does not confirm says which machine it came
  from. `--machine` and `--dos` choose the tables.
- **It proves its output.** The tests assemble Fugløy's source with a pinned
  zmac and compare every byte: every Z80 encoding, every synthetic fixture,
  83 real programs, and the Model I Level II ROM.
- **It keeps your notes.** Names, comments, and code and data decisions live
  in a plain-text hint file keyed by content, so one file fits a relocated
  build of the same program, and a BASIC program after `--rebase`.

The roadmap adds a web workbench next, then a headless emulator and an MCP
server, so that what a program does at run time can confirm and extend what
the static analysis finds.

## User stories

What people come to Fugløy for, and how each one is done today.

- **As a fan who grew up with a TRS-80 game,** I want to read its machine
  code as labeled assembly, so that I can see how it really worked.
  *Today:* `pnpm fugloy game.cmd` lists it, with the jumps, calls, and data
  references inside the program named.
- **As a reader of a listing,** I want ROM and DOS calls named, so that
  `CALL 0033H` reads as showing a character. *Today:* it lists as
  `CALL $VDCHAR`, with what the routine does beside it, for the machine and DOS
  you pick with `--machine` and `--dos`.
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
- **As someone without a terminal,** I want to explore and annotate a listing
  in the browser. *Planned:* phase 4's web workbench.

## Status

**Current release: [v1.0.0](https://github.com/cschweda/fugloy/releases/tag/v1.0.0)**, v1: phases 1–4 of the plan.
Phase 3 names ROM, hardware, and DOS addresses from cited symbol tables, with
`--machine` and `--dos` choosing them. Phase 4 is the web workbench, live at
[fugloy.netlify.app](https://fugloy.netlify.app/): open a program or one of the
four public-domain games, read and annotate the listing, click any line for a
plain-English explanation in the Explain tab, write block comments, save in
your browser, and export zmac source, hints, IR, `.CMD`, or `.CAS`. Earlier
releases: phase 2, Pass 1 and Pass 2, as
[v0.2.0](https://github.com/cschweda/fugloy/releases/tag/v0.2.0); phase 1, the
core decoder and loaders, as
[v0.1.0](https://github.com/cschweda/fugloy/releases/tag/v0.1.0). The
emulator's phases 0 and 1 are done (the core of
[trs80-emulator](https://github.com/cschweda/trs80-emulator) in
`packages/emu`, booting the Model III ROM to `READY` in Node and passing ZEXDOC
and ZEXALL). Next is the emulator's phase 2, the Model III devices and program
loaders, then the MCP server (see the roadmap in [CLAUDE.md](CLAUDE.md)). Later,
phase 5 adds an assembler with an IDE in the workbench: write Z80 code,
assemble it, and run it on an emulated Model I or Model III. Every change is
recorded in [CHANGELOG.md](CHANGELOG.md); releases are tagged `vX.Y.Z` on
`main`.

| Package | What it holds |
| --- | --- |
| `packages/z80` | Z80 opcode tables generated from the x/y/z/p/q decomposition (unprefixed, `CB`, `ED`, `DD`/`FD`, `DDCB`/`FDCB`) with length, operands, cycle counts, and control-flow effect; a decoder; an exhaustion test against an independently typed reference. No I/O. |
| `packages/disasm` | 64K memory image with a load bitmap and block log, `.CMD` and `.BAS` loaders, content-based format detection, raw loader, a Level II BASIC parser and entry-point miner, pass 1 recursive descent, labels, the hint file, string and proposal heuristics, rebasing, relocation, the cited symbol tables (`data/symbols`, compiled by `pnpm symbols`), zmac emitter, JSON IR, linear sweep, plain-text listings. No Node or DOM APIs, so it runs in a browser. |
| `packages/cli` | `fugloy <file> [--base <hex> \| --rebase <hex>] [--entry <hex>]... [--hints <path> \| --write-hints <path>] [--machine 1\|3\|4] [--dos trsdos\|ldos\|none] [--format listing\|zmac\|ir] [--sweep] [--color] [-o <path>]`, the only package that touches the file system. |
| `packages/emu` | The headless, deterministic TRS-80 Model III emulator core from trs80-emulator: Z80 CPU, memory map, I/O, keyboard, cassette, disk controller, save states. No DOM; boots the ROM to `READY` in Node. Design in [docs/fugloy-emu-spec.md](docs/fugloy-emu-spec.md). |
| `packages/mcp` | The stdio MCP server that lets an AI assistant drive the emulator (`bin/fugloy-mcp.js`), in progress in emu phase 4: the phase A and B tools so far (load, run, step, key, inspect memory and the screen; breakpoints, watches and their hits, the trace, callers, and a disassembly with coverage marks); design in [docs/fugloy-mcp-spec.md](docs/fugloy-mcp-spec.md). |
| `fixtures/synthetic` | Generated fixtures, one `.CMD` or `.BAS` per loader rule and analysis case plus their hint files, written by the test suite's own `.CMD` writer and BASIC tokenizer. |
| `fixtures/hints` | Hint files for real programs; `asylum16.hints` carries Asylum's generated relocate lines, and `volcano.hints` relocates Volcano Hunter's game to its runtime address. |

Phase 4 adds a static web workbench (`apps/web`, Nuxt 4, deployed to Netlify).

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
pnpm symbols       # validates data/symbols/*.json, regenerates the tables module and COMPARISON.md
pnpm zmac:install  # builds the pinned zmac into tools/ for the round-trip tests

pnpm fugloy path/to/program.cmd          # load module: pass 1 listing (descent from the entry)
pnpm fugloy path/to/program.bas          # tokenized BASIC: its lines, any hidden code disassembled
pnpm fugloy program.bas --rebase 7000    # the same program as if saved from $7000
pnpm fugloy path/to/code.bin --base 5200 # raw binary at a base address (hex)

pnpm fugloy game.cmd --entry 7000 --entry 7A40   # extra entry points for pass 1
pnpm fugloy game.cmd --machine 1                 # Model I names (the default is 3); --dos trsdos|ldos|none picks the DOS's
pnpm fugloy game.cmd --format zmac -o game.z     # assembler source that reassembles to the same image
pnpm fugloy game.cmd --format ir                 # JSON: regions, blocks, xrefs, symbols, proposals, relocations
pnpm fugloy game.cmd --sweep                     # the phase-1 linear sweep instead of pass 1
pnpm fugloy game.cmd --color                     # the listing in color on a terminal (plain when piped or with NO_COLOR)
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
; pass 1: roots $700D; 3 of 28 bytes decoded as code (11%); 22 typed as data; 1 external target (1 named); 0 notes
; symbols: Model III ROM, hardware, TRSDOS 1.3
; table name $RESET = $0000: restart the whole system from the Cass? prompt, as at power-on (m3-basic 12/15)
; code lines: 1; entries mined: 0

10 GOTO 30
; line 20: machine code, 6 bytes at $700D
700D  C3 00 00      JP $RESET               ; entry; restart the whole system from the Cass? prompt, as at power-on
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

A real program: the first build of *Sea Dragon* (1982), which Wayne
Westmoreland released into the public domain in 1995. Pass 1 alone finds only
its 15-byte loader, which copies the game from `$5200` down to `$497F` and
jumps there, and the listing header proposes the two hint lines that
describe the copy (`pnpm fugloy examples/sea-dragon/seadrg01.cmd`, excerpt; the
game ships with Fugløy in [`examples/sea-dragon/`](examples/sea-dragon/)):

```
; seadrg01.cmd: load module, 56 blocks, 1 run, 13968 bytes, entry $8881 (transfer address)
; pass 1: roots $8881; 15 of 13968 bytes decoded as code (0%); 52 typed as data; 1 external target (0 named); 0 notes
; symbols: Model III ROM, hardware, TRSDOS 1.3
; proposed move: LDIR at $888B copies $5200-$8880 to $497F-$7FFF; declare with:
;   block 0:$0000 relocate $497F $3681
;   block 0:$0000 entry
…
8881  00            NOP                     ; entry
8882  21 00 52      LD HL,DATA_5200
8885  11 7F 49      LD DE,497FH
8888  01 81 36      LD BC,3681H
888B  ED B0         LDIR
888D  C3 7F 49      JP 497FH
```

Put those two lines under the skeleton that `--write-hints` writes, as
[`seadrg01.hints`](examples/sea-dragon/seadrg01.hints) does, and pass the
file with `--hints`: the game then decodes at `$497F`, 45% of its bytes as
code, and the zmac output still assembles to the identical memory image. The
committed file goes on to name and comment the game's main routines and data
(`MAIN_LOOP`, `DRAW_CAVERN`, `CAVERN_MAP`, …), as an example of an annotated
listing.

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

### Symbols

A listing names the ROM, hardware, and DOS addresses a program uses outside
its own image. These rows of *Eliminator* (`pnpm fugloy
examples/eliminator/elimin8d.cmd`) read as numbers before phase 3, and still do
under `--sweep`:

```
8D74  3A 40 38      LD A,(3840H)
8DB2  CD 49 00      CALL 0049H
9826  D3 FF         OUT (0FFH),A
ADAC  CD 60 00      CALL 0060H
AEBC  CD 20 44      CALL 4420H
```

Now they read as names, and the listing's header says which tables it used and,
in a legend, what each name is (excerpt):

```
; symbols: Model III ROM, hardware, TRSDOS 1.3
; table name $KBWAIT = $0049: wait for a key and return it in A (m3-basic 12/12)
; table name $INIT = $4420: open a file, creating it if it does not exist (trsdos13 78)
…
8D74  3A 40 38      LD A,(KEYBOARD+0040H)
8DB2  CD 49 00      CALL $KBWAIT            ; wait for a key and return it in A
9826  D3 FF         OUT (CASSETTE),A
ADAC  CD 60 00      CALL $DELAY             ; pause for a time set by BC
AEBC  CD 20 44      CALL $INIT              ; open a file, creating it if it does not exist
```

- `--machine 1|3|4` picks the machine. The default is 3, since the emulator and
  the only ROM names a manufacturer published, Tandy's, are Model III's.
  `--machine 4` names LS-DOS 6 service calls only: `LD A,10` before `RST 28H`
  is commented `@DSPLY (SVC 10)`.
- `--dos trsdos|ldos|none` picks the DOS whose names to use. The manuals name
  one address differently (`$INIT` in Tandy's TRSDOS 1.3, `@INIT` in LDOS, both
  for `$4420`), so the DOS is chosen, not merged. The default is `trsdos` on a
  Model III and `ldos` on a Model I; `none` suits cassette programs.
  `--dos trsdos` with `--machine 1`, `--dos trsdos` or `ldos` with
  `--machine 4`, and a value that is not listed are errors that say what to use
  instead (exit 2).
- Names apply only outside the loaded image; inside it the program's own labels
  win. A table name that equals one of the program's own, ignoring case, is
  dropped for that listing and the header says so. A routine name never stands
  for a number used as a value, so `LD BC,0033H` stays a count.
- `[Model I]` or `[Model III]` at the end of a comment on a ROM name says the
  name came from that machine's table and the other machine's table does not
  confirm it: it names a different routine at that address, or has no entry
  there. A ROM name with no tag is one the two tables give alike. `CALL 0055H`
  lists as `CALL $RSTX ; send a character to the RS-232-C port [Model III]` by
  default and stays `CALL 0055H` under `--machine 1`, whose table has nothing
  at `$0055`.
- The zmac source defines each name it uses with `EQU`, so the round trip still
  rebuilds the identical image. The IR gains `machine`, `dos`, and
  `tableNames`.
- A tokenized BASIC line that `PEEK`s, `POKE`s, or `DEFUSR`s a constant address
  the tables name is followed by a note line, not a comment, because `;` is
  BASIC's `PRINT` separator:

  ```
  20 IF PEEK(14400)=128 THEN PRINT "SPACE"
  ;   14400 = $3840 memory-mapped keyboard (KEYBOARD+64)
  ```

  Both machines' ROM tables name the BASIC pointers programs reach for most,
  such as the USR vector at 16526–16527 and the program-start pointer at
  16548–16549, so their notes carry no machine tag.

Every name cites a page. The tables are eight JSON files in
`packages/disasm/data/symbols/`, 634 entries from ten published works, each
with a purpose and a `cite`: a source and the page as that source prints it.
Names are Tandy's where Tandy published one (`$KBWAIT`), a DOS manual's own
spelling for DOS routines (`$INIT`, `@INIT`), and otherwise coined (`VIDEO`,
`CASSETTE`), which the data marks. `pnpm symbols` validates the files and
writes the module the code uses, and
[COMPARISON.md](packages/disasm/data/symbols/COMPARISON.md), which lists every
address in the two ROM maps as shared, different, or in one only. The tables
are not complete and keep growing: asylum16, listed with `--machine 1` and its
hint file, has 16 of the 17 ROM addresses it reaches named, and the 17th,
`$0112`, is banner text, not a routine. Volcano Hunter calls no ROM or DOS
routine, so what its listing names is its hardware.

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
- [packages/disasm/data/symbols/COMPARISON.md](packages/disasm/data/symbols/COMPARISON.md):
  the Model I and Model III ROM maps side by side, generated from the tables.
- [CLAUDE.md](CLAUDE.md): working conventions and the roadmap.

## Getting ROMs and programs

Fugløy ships no ROMs. It ships four games by Wayne Westmoreland and Terry
Gilman that are public domain, in [`examples/`](examples/): *Sea Dragon*,
*Rear Guard*, *Eliminator*, and *Armored Patrol*; for everything else, bring
your own. The disassembler itself needs no ROM; only the ROM
smoke test and the emulator do. The emulator's tests read the ROM paths from
the file `$FUGLOY_CONFIG` names, else `fugloy.mcp.json` at the repository root
(copy `fugloy.mcp.example.json`), else `~/.config/fugloy/fugloy.mcp.json`.
Without one they skip; a config that names a missing ROM fails them.

- **ROMs.** The [kiwisincebirth/TRS-80-ROMS](https://github.com/kiwisincebirth/TRS-80-ROMS)
  repository holds Model I Level II and Model III ROM images in its
  `test-roms` folder, along with commented disassemblies of the ROMs. The
  smoke test looks for the Model I Level II image as
  `fixtures/real/level2-model1.rom`.
- **Public-domain games.** Wayne Westmoreland, who wrote his TRS-80 games
  with Terry Gilman, released them into the public domain in 1995:
  *Armored Patrol* and its original form, *Tank Zone*; *Eliminator*, their
  *Defender* clone; *Sea Dragon*; *Rear Guard*; *Zaxxon*; and a *Donkey Kong*
  that was never sold.
  [trs-80.org](http://www.trs-80.org/games-by-wayne-westmoreland-and-terry-gilman.html)
  offers them as `AIGAMES.ZIP`, two disk images. Fugløy reads `.CMD` and
  `.BAS` files, not disk images, so extract the programs from the images
  first. The
  [TRS-80 software archive](http://cpmarchives.classiccmp.org/trs80/Software/Model%201/)
  at classiccmp.org has several of them as ready-made `.CMD` files, filed by
  first letter and often in more than one version.
- **Everything else.** Programs you own, as `.CMD` load modules or tokenized
  `.BAS` files saved from Level II or Disk BASIC.

## Sample programs

The four public-domain games in `examples/` are committed, so the
real-program tests run on them everywhere, CI included; each folder's README
says what every build is. The other programs and the ROM images the tests use
stay out of the repo: Asylum, Volcano Hunter, Voyage of the Valkyrie, Space
Warp, Pirate's Adventure, Voodoo Castle, Deathmaze 5000, Planetfall,
Penetrator, Super Nova, Crazy Painter, Crush, Crumble & Chomp, Super Star
Trek, and the builds of the public-domain games that carry someone else's
code or credit (Sea Dragon's build 05, an Eliminator build re-badged to
another author, the Model 4 launcher for Armored Patrol). Tests that need them look in
`sample/` or `fixtures/real/`, both gitignored, and skip when the files are
absent, so the suite passes on a fresh clone.

## Conventions

Addresses are `$3C00` in prose and comments and `3C00H` in emitted assembly.
Opcode tables are generated, never hand-edited. The image is a flat
`Uint8Array(65536)` with a parallel bitmap. See `CLAUDE.md` for the rest.

## Repository

Source and issues: [github.com/cschweda/fugloy](https://github.com/cschweda/fugloy).
CI builds the pinned zmac and requires it, then runs typecheck, the tests,
the build, and a check that the committed synthetic fixtures and the generated
symbol tables still match their sources, on every push and pull request.

Releases to npm go through `./publish.sh`, in two steps, from `main` after
CI has passed. `./publish.sh check core` (or `emu`) runs every check, packs
the packages, installs the tarballs in a scratch project and runs them, and
stages them in `.release/`. `./publish.sh publish` then publishes those
exact tarballs with npm's two-factor code: it asks for the code, or takes
it as `--otp <code>`, and tags the release. `core` is `@fugloy/z80`,
`@fugloy/disasm`, and `@fugloy/cli` at one version; `emu` is `@fugloy/emu`.
Bump the version and add its `CHANGELOG.md` entry in a commit first.

## License

MIT, © 2026 Christopher Schweda. See [LICENSE](LICENSE).
