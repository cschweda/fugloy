# Phase 3: symbol tables

Design spec, 2026-10-16. Phase 3 of `docs/Fugloy-Project-Plan.md` ("Symbol
tables", and "Pass 2: labels, symbols, and annotations"), written straight from
the plan at the user's request. Every decision below that the plan does not
make is the author's call and is marked **(call)**; §11 lists them for review.
Phase 4, the web workbench, follows and reads the same data for its side panel.

Built 2026-10-16 and 2026-10-17. On 2026-10-17 the text was corrected to match
the code: where the first draft said otherwise (page numbers, lookup names,
header wording, which names are coined), it now says what was built.

## 1. Goal

A listing names the ROM, hardware, and DOS addresses a program uses, and every
name traces to a page of a published source.

- `CALL 0049H` lists as `CALL $KBWAIT` with the trailing comment "wait for a key
  and return it in A" on a Model III; `JP 402DH` as `JP $JP2DOS` (TRSDOS 1.3)
  or `JP @EXIT` (LDOS); `LD HL,3C00H` as `LD HL,VIDEO`; `OUT (0ECH),A` as
  `OUT (MODEPORT),A`.
- The zmac output defines each name it uses with `EQU`, so the round trip still
  rebuilds the identical image.
- A machine selector picks the tables: Model I, Model III, or Model 4 (service
  call names only). The selector changes names, never analysis.
- The Model I and Model III ROM maps are entered separately from their own
  sources and compared; where they differ, a listing says which machine it
  assumed.

**Done when:** asylum16 (with `fixtures/hints/asylum16.hints`, `--machine 1`)
lists its display, keyboard, cassette, and BASIC calls by name; Volcano Hunter
lists its hardware references by name (it calls no ROM or DOS routine at all;
its references are `MODEPORT`, `CASSETTE`, and `KEYBOARD`, and
`fixtures/hints/volcano.hints` relocates the game to its runtime address,
`$42E9`, so the listing shows its code and not data decoded as code); both
still round-trip through zmac; every table entry carries a citation; and the
plan's Landscape table is verified or corrected before any public README
repeats it.

## 2. Non-goals

- New analysis. Pass 1 is unchanged; names never change what a byte is.
- Complete maps. The plan budgets the first hundred entries of each ROM map plus
  the DOS vectors; the tables keep growing after the phase.
- Naming external addresses from the hint file. Hint keys stay block-relative;
  a top-level `symbol` directive can come later.
- Detecting the machine from a program. The selector is explicit, with a stated
  default **(call)**.
- Model 4 beyond service-call names (Part 2).
- Reproducing any source's prose. Purposes are one-line paraphrases; sources
  are cited by page, never quoted at length.

## 3. Sources

The library is in the gitignored `docs/reference/` (user-supplied scans and the
survey's downloads, with a README). Tables cite works bibliographically, with an
archive.org identifier or URL so anyone can find them; local file names never
appear in committed data. Pages are cited as each source prints them.

| Id | Work | Used for | Pages |
| --- | --- | --- | --- |
| `m3-basic` | Tandy, *TRS-80 Model III Operation and BASIC Language Reference Manual* (2nd ed., 1980) | Model III ROM calls and their `$` names; RAM addresses | ch. 12, `12/2`–`12/26` (summary table `12/24`, RAM addresses `12/25`–`12/26`) |
| `paay` | Edwin R. Paay, *Level II ROM Reference Manual* (MICRO-80 Products, 1980) | Model I ROM map and reserved RAM | 2–22, 23–30, tables 31–65 |
| `decker` | Jack Decker, *TRS-80 ROM Routines Documented* (The Alternate Source, 1983) | Second source, Model I/III/4, by address | e.g. 12–14, 53, 64 |
| `l2-1979` | Radio Shack, *Level II BASIC Reference Manual* (1979) | USR linkage, Model I memory map, device addresses | `8-8`, `8-9`, `D-1`, `D-2` |
| `m1-trh` | Radio Shack 26-2103, *TRS-80 Micro Computer Technical Reference Handbook* (2nd ed., 1982) | Model I memory map, video RAM, the cassette port | 12, 33, 44–45, 50 |
| `m3-trm` | Tandy, *TRS-80 Model III Technical Reference Manual* (1981) | Model III memory map and ports | 14, 15, 21–22 |
| `trsdos13` | Tandy, *TRS-80 Model III Disk System Owner's Manual* (TRSDOS, ©1980) | TRSDOS 1.3 system routines, `$` names | 74–89 |
| `ldos51` | *LDOS 5.1* manual (Tandy edition) | LDOS memory maps, `@` names, Model I/III differences | 6-29 to 6-35 |
| `soltoff` | Roy Soltoff, *The Programmer's Guide to LDOS/TRSDOS Version 6* (MISOSYS, 1983/84; free to redistribute) | LS-DOS 6 service calls | 99, 101–104 |
| `m4-trm` | Tandy 26-2110, *TRS-80 Model 4 Technical Reference Manual* (1983) | Second source for service calls | 227, 331–335 |

The Model I's memory-mapped device registers (`$37DE`–`$37EF`) cite `decker`
63, and p. 64 as well for `$37E8`. Seven of them (`$37DE`, `$37DF`, `$37E0`,
`$37E1`, `$37E4`, `$37E8`, `$37EC`) also cite `l2-1979` D-2; `$37ED`–`$37EF`
cite `paay` 24 instead, since D-2 prints only `$37EC` of the disk controller
block. `m1-trh` documents the keyboard, video RAM, and port `$FF`. (The first
draft listed `m1-trh` pages 12, 34, and 86; page 34 was wrong, and page 86 is a
circuit example, not a device table.)

`kiwisincebirth/TRS-80-ROMS` at `736bcba` is a cross-check only: it has no
license and derives from an unlicensed disassembly **(call)**.

OCR misreads slashed zeros. Every address is confirmed before it is committed:
against the decimal/hex pair the source prints (Tandy and TRSDOS print both),
against the page image, or against a second source.

Page conventions found while entering the data. In the OCR of Decker's and
Paay's books, a `Page N` line (Decker) or a bare `N` (Paay) is a footer that
closes page N, not a header that opens it. The Model III BASIC manual is cited
chapter and page, `12/N`, as the archive.org edition prints them; another scan
of it prints running numbers 58 higher (`12/24` is `82` there). `l2-1979` cites
use the hyphens its footers print (`8-9`, `D-2`), though its index writes
slashes. TRSDOS 1.3 pages are the printed ones; its scan pages run 9 higher.
Soltoff's and the Model 4 manual's lists are cited by the page number their
contents give.

## 4. Decisions

### 4.1 Tables and files

`packages/disasm/data/symbols/` holds one JSON file per table (CLAUDE.md's
rule), edited by hand:

| File | Contents |
| --- | --- |
| `sources.json` | The registry in §3: id, author, title, publisher, year, edition, locator |
| `rom-model1.json` | Level II ROM, Model I: routines, RST vectors, ROM-resident data, reserved RAM in the `$4000` page |
| `rom-model3.json` | Level II ROM, Model III, entered from its own sources, not copied from Model I |
| `hardware-model1.json`, `hardware-model3.json` | Memory-mapped regions (keyboard, video, printer, disk) and I/O ports |
| `dos-trsdos13.json` | TRSDOS 1.3 (Model III) |
| `dos-ldos51-model1.json`, `dos-ldos51-model3.json` | LDOS 5.1, one per machine (the map differs: `@CMD` is `$4400` on Model I, `$4296` on Model III) |
| `svc-lsdos6.json` | LS-DOS 6 service calls by number |

DOS tables hold only RAM-resident addresses; a ROM address always takes the ROM
table's name **(call)** (LDOS's Model I map also names `@KBD` `$002B` and `@KEY`
`$0049`; those stay ROM names).

### 4.2 Entry shape

```json
{
  "addr": "0049",
  "name": "$KBWAIT",
  "kind": "routine",
  "purpose": "wait for a key and return it in A",
  "cite": [{ "source": "m3-basic", "page": "12/12" }],
  "note": "optional: a disagreement between sources, or a Model I/III difference"
}
```

- `addr` is four uppercase hex digits; a port entry has `"port": "EC"` instead,
  a service call `"svc": 10`.
- `kind` is `routine`, `vector`, `variable`, `region`, `port`, or `svc`.
- `variable`, `vector`, and `region` entries have `length` in bytes (default 1).
- `cite` has at least one entry; `source` names a `sources.json` id; `page` is
  printed as the source prints it (`12/12`, `6-29`, `86`).
- `coined: true` marks a name the sources do not give (§4.3).

### 4.3 Naming **(call)**

Sources name the same address differently (`$KBWAIT`, `@KEY`, `_KEY` for
`$0049`; `$JP2DOS` and `@EXIT` for `$402D`), so each table follows one rule:

1. **ROM, both machines:** Tandy's `$` names (`m3-basic`, ch. 12), the only
   names the manufacturer published. A Model I entry takes the Tandy name when
   a Model I source (`paay`, `decker`) describes the same routine at the same
   address; it cites both.
2. **DOS:** the DOS manual's own spelling: `$JP2DOS` in `dos-trsdos13`,
   `@EXIT` in the LDOS tables, `@DSPLY` for service call 10. A name a source
   prints may also end in one `$` (LDOS and LS-DOS print `TIME$` and
   `@FLAGS$`); a coined name may not.
3. **Everything else** (hardware, ROM routines no source names): a coined name,
   marked `coined`, in capitals, digits, and underscores, starting with a
   letter, at most 12 characters, and never starting with `$` or `@` or ending
   in `$`, which stay reserved for names a source prints. Hardware manuals name
   signals (`RTCIN*`), not symbols, so hardware names are coined and their
   addresses cited, with one exception: `$PRSTAT`, the Model III's printer
   status at `$37E8`, is a name Tandy prints (`12/24`).

zmac accepts every one of these spellings and keeps `$KBWAIT`, `KBWAIT`, and
`@DSPLY` distinct, but folds case (`kbwait` and `KBWAIT` collide), so every
uniqueness check is case-insensitive.

### 4.4 Machine and DOS selection **(call)**

- `--machine 1|3|4`, default `3`: the emulator, the user's ROM, and the only
  manufacturer-named ROM table are Model III. The listing header always says
  which tables it used.
- `--dos trsdos|ldos|none`: the sources disagree on names, so the DOS table is
  chosen, not merged. Default `trsdos` on Model III (Tandy's own DOS, `$`
  names like its ROM), `ldos` on Model I (no TRSDOS 2.3 source in the
  library); `--dos trsdos` with `--machine 1` is an error. `none` suits
  cassette programs that never run under a DOS.
- `--machine 4` uses `svc-lsdos6` only: no ROM or hardware table, as the plan's
  "Model 4 (symbols only)" says.

### 4.5 Where names apply

Only addresses outside the loaded image take table names; inside the image the
program's own labels, synthesized or from the hint file, always win. Outside
it:

| Use | Takes names from | Rendering |
| --- | --- | --- |
| `JP`/`CALL`/`JR`/`DJNZ` target, declared jump-table entry | `routine`, `vector` | `CALL $KBWAIT`, plus the purpose as a trailing comment; a jump table's `DW` row carries the names (`DW $KBWAIT,$VDCHAR`) and no comment, the legend carrying the purposes |
| `(nn)` memory operand | `variable`, `vector`, `region` | `LD A,(CURADDR)`; inside a span, `(CURADDR+0001H)` |
| `LD BC/DE/HL/IX/IY,nn` immediate, plain `DW` | `variable`, `vector`, `region` | `LD HL,VIDEO+0140H`; a `DW` row typed `words` by a hint names the same way, without a comment |
| `IN A,(n)` / `OUT (n),A` | `port` | `OUT (MODEPORT),A` |
| `RST n` | `routine` at that address | operand stays numeric; the comment is `NAME: purpose` |
| `RST 28H` after `LD A,n` (Model 4) | `svc` | operand stays numeric; comment `@DSPLY (SVC 10): purpose` |

A routine name never applies to an immediate, so `LD BC,0033H` used as a count
stays a number. Offsets print in the listing's number format. The machine tag
of §4.6 ends the comment on a named transfer and on an `RST`, and a `.BAS` note
line (§5.4); a service-call comment carries none, since a service call is no ROM
name.

If a table name collides, ignoring case, with a user or synthesized name in the
same program, the table name is dropped for that address, which stays numeric,
and the header notes it **(call)**: zmac would otherwise stop on a doubly
defined symbol.

### 4.6 Model I and Model III compared

The two ROM tables are entered independently. A generated report,
`data/symbols/COMPARISON.md`, lists every address in either table as shared
(same name and kind), different, or one-sided. A test fails when an address is
in both tables with a different name or kind and neither entry has a `note`.
In a listing, a ROM name carries a tag in its comment, `[Model III]` or
`[Model I]`, unless the comparison classes its address as shared. The tag
means this name came from this machine's table and is not confirmed shared:
the other table either names a different routine there or has no entry for the
address. So a one-sided address is tagged too, not only a `different` one, and
the reader knows which machine the listing assumed.

### 4.7 Packaging **(call)**

`packages/disasm` must run in a browser and publishes only `dist`, built from
`src` by `tsc -b`; the JSON lives outside `src`. So the JSON stays the edited
source and `pnpm symbols` (`packages/disasm/scripts/write-symbols.ts`, run by
`tsx`) validates it and writes `packages/disasm/src/symbols/tables.generated.ts`,
a typed constant module, plus `COMPARISON.md`. The generated files are
committed and never hand-edited, like the opcode tables; CI regenerates and
fails on a difference, in the step that already does so for fixtures. No JSON
imports, so no change to the TypeScript, Node, or bundler settings.

Validation, in the generator and in a test: schema; hex and port ranges; every
`cite` names a known source and a page, and no purpose, note, or page has a
line break; names valid for zmac, not reserved (the hint parser's `RESERVED`),
not shaped like a synthesized label (`L5210`, `SUB_5340`, …), and unique
ignoring case within every machine-and-DOS combination; a `$` or `@` prefix and
a trailing `$` only on uncoined names; one entry per port number and per
service call number; regions in a table do not overlap.

## 5. Components

### 5.1 `src/symbols/` (new)

- `tables.generated.ts`: the data.
- `select.ts`: `selectSymbols({ machine, dos }): SymbolSet`, merging the tables
  for a selection (ROM, hardware, DOS, or SVCs), with lookups
  `code(addr)`, `data(addr)` (returns entry and offset), `port(n)`, `svc(n)`,
  and `machineTag(entry)`; also `defaultDos`, `tablesFor`, `describeSelection`,
  and `SelectionError`.
- Exported from `@fugloy/disasm` with the sources registry, so phase 4's side
  panel can show an entry's purpose and citations. The root names are
  `SYMBOL_TABLES` and `SYMBOL_SOURCES`; the generated module's own `TABLES` and
  `SOURCES` are renamed at the package edge because `@fugloy/z80` already
  exports an unrelated `TABLES`.

### 5.2 Pass 2 (`src/analysis/symbols.ts`, `src/emit/operands.ts`)

`AnalyzeOptions` gains `tables`, a `SymbolSet` from `selectSymbols`; without
it nothing is named, so library callers opt in and existing callers are
unchanged, while the CLI always passes one (default Model III) **(call)**.
`Analysis` gains the external names and the list of table names used. Naming happens at render time in
`renderOperands`, which already names `rel`, jump and call `imm16`, data
`imm16`, and `mem` operands; it gains the external lookups of §4.5 and port
operands. Synthesized and user symbols are unchanged, and inside-the-image
addresses never reach the table lookup.

### 5.3 Emitters

- **Listing:** names in operands; the purpose and the machine tag joined into
  the existing comment column. The header gains `; symbols: Model III ROM,
  hardware, TRSDOS 1.3` on the line after the `; pass 1:` line, and that line's
  `N external targets` becomes `N external targets (M named)`, where M counts
  the targets a routine or vector entry names (a service-call comment does not
  count). Then one legend line per table name used, `; table name $KBWAIT =
  $0049: wait for a key and return it in A (m3-basic 12/12)` (a port reads
  `= port $EC`, a service call `= SVC 10`), and for a name dropped for a
  collision, `; table name VIDEO not used: the program has its own video`.
- **zmac:** one `NAME EQU nnnnH ; purpose` line per memory or port name used,
  ahead of the program's own `EQU`s; call-site purpose comments. A service call
  gets no `EQU`.
- **IR:** `machine` and `dos` at the top, and `tableNames`: each table name
  used, including `RST` and service-call entries, as `{ key, name, kind, table,
  purpose, cite }`, where `key` is the address, port number, or call number.
  The three fields appear only when tables were supplied (the CLI always
  supplies them). Additive, so `fugloyIr` stays `1` **(call)**.
- **`--sweep`** stays unnamed, as it is today.

### 5.4 `.BAS` listings

A line whose `PEEK`, `POKE`, or `DEFUSR` argument is a constant address in the
selected tables is followed by a note line naming it, for example
`;   16526 = $408E … (USRVEC)`: the address in decimal and in hex, the purpose
(elided here), the name in parentheses, and the machine tag of §4.6 where it
applies (`;   16445 = $403D … (PORTFFBITS) [Model I]`, an address only the
Model I table names). Inside a span the name carries a decimal offset
(`KEYBOARD+64`). A note line, not a trailing comment, because `;` is BASIC's
PRINT separator and would read as program text. The phase-2C parser supplies
the constants, so no column offsets are needed, and it keeps every statement's
expressions, so a `PEEK` is found in an `IF` condition, a `PRINT` item, a `FOR`
bound, an `ON` selector, and a `DEF FN` body as well as in an assignment. Only
a literal address counts (or a minus sign and a literal, for an address above
32767): `POKE A,0` and `POKE 16526+1,0` get no note, and neither does `USR`,
whose argument is a value, not an address.

A `PEEK` or `POKE` looks an address up as data, then as code; a `DEFUSR` the
other way round. An address inside the loaded image gets no note, as in §4.5. A
line gets one note per distinct address, in the order its statements first use
them. `entries.ts` keeps its `TXTTAB` and `USR_VECTOR` constants, which drive
analysis rather than naming **(call)**.

### 5.5 CLI

`--machine` and `--dos`, with usage text, validation (`--machine 2` and
`--dos trsdos --machine 1` are errors that name the valid values), and the
header line. Defaults as in §4.4.

## 6. Data flow

JSON tables → `pnpm symbols` (validate, generate, compare) → `tables.generated.ts`
→ `selectSymbols` per `--machine`/`--dos` → `analyze` → emitters look up external
operands at render time → listing, zmac (`EQU`s), IR.

## 7. Data scope for this phase

- `rom-model3`: the 28 calls of Tandy's summary (`12/24`), its RAM addresses
  (`12/25`–`12/26`), the RST entry points (`$0000`–`$0038`), and further entries
  from `decker`, to about 100. Built: 150 entries (27 of the 28 summary rows; the
  28th, `$PRSTAT`, is in `hardware-model3`). They include 29 entries of the
  `$4000`-page RAM that Decker gives for both machines (his reserved RAM map
  applies to the Model I and the Model III unless he marks an address, p. 64):
  the RST jump vectors at `$4000`–`$4012` beside Tandy's `$400C`, the device
  control blocks' fields, the BASIC pointers and flags, and the accumulators,
  each under the Model I table's name, so the comparison classes them shared.
  `$403D`, which Decker marks Model I only (p. 65), stays out.
- `rom-model1`: about 100 from Paay's map (2–22) and reserved RAM (23–30).
  Built: 125 entries. The comparison, as built: 102 addresses shared, 4
  different, 19 Model I only, 44 Model III only.
- Hardware: each machine's memory map regions and ports from its manual. Built:
  13 entries for the Model I, 17 for the Model III.
- DOS: TRSDOS 1.3's documented routines and storage addresses (74–89), 24
  entries; LDOS 5.1's maps (6-29 to 6-35), 107 entries for the Model I and 101
  for the Model III. On both machines LDOS's names for the three device control
  blocks (`KIDCB$`, `DODCB$`, `PRDCB$`) are notes on the ROM tables' entries at
  each block's first byte, since the ROM names win in the `$4000` page.
- `svc-lsdos6`: every call on Soltoff's 101–104, 97 entries.
- First priority in every table: each external address asylum16 and Volcano
  Hunter reach. asylum16 with its hints reaches 17 ROM addresses: `$0000`; the
  RSTs at `$0008`, `$0010`, `$0020`, `$0030`, and `$0038`; `$002B`, `$0033`,
  `$0112`, `$01F8`, `$0212`, `$0235`, `$0264`, `$0287`, `$0296`, `$093E`, and
  `$1A19`; and four addresses above its image (`$8AC3`, `$A6C3`, `$AACD`,
  `$CD7A`) that no table will name. Sixteen of the 17 ROM addresses are named;
  `$0112` is banner text in the ROM (Decker p. 80), not a routine, no source
  names it, and it stays numeric. Volcano Hunter's pass 1 decodes 26% of the
  program, reaches no ROM call, and writes port `$EC`. It turned out to call no
  ROM or DOS routine at all: with `fixtures/hints/volcano.hints`, which
  relocates the game to its runtime address, `$42E9`, pass 1 decodes 34%, and
  the listing also names port `$FF` (`CASSETTE`) and the keyboard (`KEYBOARD`),
  but still no call.

## 8. Error handling

- A malformed or inconsistent table fails `pnpm symbols` with the file, the
  entry, and the rule it breaks; CI fails the same way.
- Unknown `--machine` or `--dos` values, and `--dos trsdos --machine 1`, are CLI
  errors with the valid values.
- A table name dropped for a collision is reported in the listing header, never
  silently.

## 9. Testing

- **Data:** the validation rules of §4.7 as tests; the comparison rule of §4.6;
  sync between the JSON and the generated module (CI step).
- **Naming:** each row of §4.5, including the negative cases: a routine address
  used as an immediate stays numeric; an address inside the image keeps the
  program's label; a colliding table name falls back to a number.
- **Selection:** the same program lists differently under `--machine 1` and
  `--machine 3` where the tables differ, with the machine tag; `--dos` switches
  `$JP2DOS` and `@EXIT`; `--machine 4` names `RST 28H` after `LD A,10` as
  `@DSPLY` and names nothing else.
- **Round trip:** every zmac test still rebuilds the identical image, now with
  `EQU`s; a synthetic fixture (the 27-byte routine from the social card:
  `CALL 0049H`, `JP 402DH`) round-trips under each machine and DOS.
- **Real programs** (skip when absent): asylum16 with its hints names 16 of the
  17 ROM addresses of §7 (`$0112`, banner text, stays numeric); Volcano Hunter,
  with its hint file, names its hardware references and calls no ROM or DOS
  routine; both round-trip.
- **`.BAS`:** a synthetic program with `POKE 16526,…` and `PEEK(14400)` gets
  the comments.
- Tests that pin numbers today (`CALL 0033H`, `LD HL,3C00H`) change on
  purpose, with the default machine.

## 10. Risks

- **OCR errors in addresses.** Mitigation: the confirmation rule of §3; the
  Model I/III comparison flags disagreements at shared addresses.
- **Copyright.** Paay's manual forbids reproduction; Keil's scans ask not to be
  reposted. Mitigation: paraphrased purposes, page citations, and nothing from
  `docs/reference/` in git.
- **A wrong default machine.** The header names the tables; `--machine 1`
  changes them; the comparison tag marks the addresses where it matters.
- **Data entry volume.** Bounded by §7; asylum16's and Volcano Hunter's
  addresses first.
- **IR consumers** see three new top-level fields (`machine`, `dos`,
  `tableNames`), only when tables were supplied. The IR has no consumers
  outside this repo.

## 11. Calls made without the user

1. Default `--machine 3`; DOS defaults `trsdos` (Model III) and `ldos` (Model I);
   a `--dos` option exists because the sources disagree.
2. Naming rule (§4.3): Tandy `$` names for ROM on both machines when the routine
   matches; each DOS manual's own spelling; coined names for hardware (except
   `$PRSTAT`, which Tandy prints) and unnamed routines, never with `$` or `@`.
3. JSON tables plus a generated, CI-checked TypeScript module, not JSON imports.
4. Table names apply only outside the loaded image; on a collision the address
   stays numeric.
5. Routine names only where an operand is used as a code address; ports named;
   `RST` and service calls as comments.
6. `kiwisincebirth/TRS-80-ROMS` as a cross-check only.
7. The IR stays version 1.
8. Volcano Hunter may get a hint file so its ROM and DOS calls are reached. It
   got one, which relocates the game; no ROM or DOS call turned up, because the
   game makes none.

## 12. Sequencing

1. Table format, generator, validation, comparison, sources registry, CI step;
   CLAUDE.md's roadmap (phase 3, then phase 4; emu phases 2+ and the MCP server
   after v1).
2. `selectSymbols` and the `machine`/`dos` options in `analyze`.
3. Operand naming, comments, header, legend, `EQU`s, IR fields; the tests that
   pin numbers updated.
4. CLI flags.
5. Hardware tables, then the Model III ROM table, then the Model I ROM table,
   then the comparison report.
6. DOS tables and service calls (with `RST 28H` naming under `--machine 4`).
7. `.BAS` comments.
8. asylum16 and Volcano Hunter (with its hint file if needed).
9. The Landscape table verified or corrected; README, CHANGELOG, the plan, and
   CLAUDE.md updated.
