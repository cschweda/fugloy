# Phase 3: Symbol Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Listings name the ROM, hardware, and DOS addresses a program uses, each name cited to a page of a published source, with a machine selector and a zmac round trip that still rebuilds the identical image.

**Architecture:** Hand-edited JSON tables in `packages/disasm/data/symbols/` are validated and compiled by `pnpm symbols` into a committed, generated TypeScript module. `selectSymbols({ machine, dos })` builds a `SymbolSet`; `analyze` wraps it in `ExternalNames`, which refuses loaded addresses and names that collide with the program's own. The renderer looks external operands up at render time, so the listing, zmac output (with `EQU`s), and IR all name the same things.

**Tech Stack:** TypeScript strict ESM, Vitest, `tsx` for the generator, zmac (pinned) for the round trip.

**Spec:** `docs/superpowers/specs/2026-10-16-phase3-symbol-tables-design.md`. The sources it cites are in the gitignored `docs/reference/` (see its `web-sources/README.txt`).

## As built (2026-10-17)

This plan is the execution record, so the tasks below stay as written. Where the code differs from what they say:

- **Root exports (Tasks 2 to 4).** `@fugloy/disasm` exports the tables as `SYMBOL_TABLES` and `SYMBOL_SOURCES`, because `@fugloy/z80` already exports an unrelated `TABLES`. Wherever a task says `TABLES` or `SOURCES` from the package root, read the `SYMBOL_` names; the generated module keeps `TABLES` and `SOURCES`.
- **Tagged `RST` comments (Task 4's Interfaces and Step 1).** An `RST` comment is `NAME: purpose`, then `[Model I]` or `[Model III]` whenever the comparison does not class the address as shared, as on a named transfer. A service-call comment carries no tag. `.BAS` note lines carry it too (Task 10).
- **Rows Task 4 leaves out.** A declared jump table's `DW` row and a `words`-typed data row are named (`DW $KBWAIT,$VDCHAR`), without a comment; the new module `src/analysis/words.ts` decides which bytes pair into words. The IR's `tableNames` includes the `RST` and service-call entries.
- **Task 6's pages.** The Model I tables cite `m1-trh` pages 12, 33, 44–45, and 50, not 12, 34, and 86 (page 86 is a circuit example). The device registers at `$37DE`–`$37EF` cite `decker` 63 (and 64 for `$37E8`); seven of them (`$37DE`, `$37DF`, `$37E0`, `$37E1`, `$37E4`, `$37E8`, `$37EC`) also cite `l2-1979` D-2, and `$37ED`–`$37EF` cite `paay` 24 instead, since D-2 prints only `$37EC` of the disk controller block. A `Page N` line in Decker's OCR closes page N.
- **Tasks 7 and 8.** `$PRSTAT` (`$37E8`) is Tandy's name and sits in `hardware-model3`, so `rom-model3` holds 27 of the 28 summary rows. There is no entry at `$0112` (banner text, Decker p. 80). `l2-1979` cites are `8-8`, `8-9`, `D-1`, and `D-2`, not "8/9".
- **Task 9's pages and names.** `trsdos13` pages 74–89 (not 74–86), `soltoff` 99 and 101–104 (not 101–103), `m4-trm` 227 and 331–335 (not 334 alone). A name a source prints may end in one `$` (`@FLAGS$`), and a table has one entry per port number and per service call number.
- **Task 10.** The parser keeps every statement's expressions, so a `PEEK` is noted in an `IF`, `PRINT`, `FOR`, `ON`, or `DEF FN`, not only in an assignment.
- **Task 11.** asylum16 names 16 of the 17 ROM addresses it reaches. Volcano Hunter calls no ROM or DOS routine, so its hint file only relocates the game; the two `entry` hints first written at `$4000` and `$4003`, bytes nothing executes, were dropped.
- **Task 12.** The Landscape table gained rows for DASM80 and DSMBLR III, found while checking the others.

## Global Constraints

- `packages/disasm` stays free of Node and DOM APIs; only `scripts/` and tests touch `fs`.
- No external runtime dependencies in `z80` or `disasm`.
- Symbol data lives only in `packages/disasm/data/symbols/*.json`; the generated module is never hand-edited.
- Detect file format from content, never from extension (unchanged).
- Nothing from `docs/reference/` is committed. Purposes are one-line paraphrases; never copy a source's wording beyond a name.
- Every table entry cites at least one `sources.json` id and a page printed as the source prints it.
- Every address is confirmed before commit: against the decimal/hex pair the source prints, the page image, or a second source (OCR misreads slashed zeros).
- Names: a source's own spelling (`$KBWAIT`, `@EXIT`), or a coined name (`coined: true`) of capitals, digits, and `_`, starting with a letter, at most 12 characters, never starting with `$` or `@`. Uniqueness is checked ignoring case (zmac folds case).
- Commit messages: one line, imperative, prefixed `p3:`, no AI co-author or session trailers.

## Review Focus

1. **An external address used both as a call target and as a number** (`CALL 0033H` and `LD BC,0033H` in one program): the call is named, the count stays `0033H`. Task 4.
2. **A program name that equals a table name ignoring case** (a hint names a routine `video` while the program writes `LD HL,3C00H`): the table name is dropped for that listing, the address stays numeric, the header says so, and zmac still assembles. Tasks 3 and 4.
3. **A program loaded or relocated over system addresses** (Volcano Hunter loads `$3C00`–`$4005`; asylum16 runs over the `$4400` page): those addresses keep the program's labels, never a hardware or DOS name. Task 3.
4. **A region boundary:** `$4000` is not `VIDEO+0400H`; `$3BFF` is `KEYBOARD+03FFH` only if the keyboard region is 1024 bytes in that table. Task 2.
5. **Selections that make no sense** (`--machine 1 --dos trsdos`, `--machine 4 --dos ldos`, `--machine 2`): a CLI error naming the valid values, never a listing with the wrong names. Task 5.

---

### Task 1: Table format, validation, generator, and comparison

**Files:**
- Create: `packages/disasm/src/symbols/types.ts`, `packages/disasm/src/symbols/validate.ts`, `packages/disasm/src/symbols/compare.ts`, `packages/disasm/scripts/write-symbols.ts`, `packages/disasm/data/symbols/{sources,rom-model1,rom-model3,hardware-model1,hardware-model3,dos-trsdos13,dos-ldos51-model1,dos-ldos51-model3,svc-lsdos6}.json`, generated `packages/disasm/src/symbols/tables.generated.ts` and `packages/disasm/data/symbols/COMPARISON.md`
- Modify: root `package.json` (script `symbols`), `.github/workflows/ci.yml` (sync step), `CLAUDE.md` (roadmap and the symbol-data rule)
- Test: `packages/disasm/test/symbols/validate.test.ts`, `packages/disasm/test/symbols/data.test.ts`

**Interfaces:**
- Produces (`src/symbols/types.ts`):
  - `type Machine = 1 | 3 | 4`; `type Dos = 'trsdos' | 'ldos' | 'none'`
  - `type TableId = 'rom-model1' | 'rom-model3' | 'hardware-model1' | 'hardware-model3' | 'dos-trsdos13' | 'dos-ldos51-model1' | 'dos-ldos51-model3' | 'svc-lsdos6'`
  - `type EntryKind = 'routine' | 'vector' | 'variable' | 'region' | 'port' | 'svc'`
  - `interface Cite { source: string; page: string }`
  - `interface TableEntry { table: TableId; kind: EntryKind; key: number; name: string; length: number; purpose: string; cite: readonly Cite[]; coined: boolean; note?: string }` — `key` is the address, port number, or call number; `length` is 1 unless given.
  - `interface Source { id: string; author: string; title: string; publisher: string; year: string; edition?: string; locator: string }`
  - `type RomClass = 'shared' | 'different' | 'model1-only' | 'model3-only'`; `type RomComparison = Readonly<Record<string, RomClass>>` keyed by four hex digits.
  - `SELECTIONS: readonly { machine: Machine; dos: Dos; tables: readonly TableId[] }[]`, the six valid selections: `{1,ldos}` → rom-model1, hardware-model1, dos-ldos51-model1; `{1,none}` → rom-model1, hardware-model1; `{3,trsdos}` → rom-model3, hardware-model3, dos-trsdos13; `{3,ldos}` → rom-model3, hardware-model3, dos-ldos51-model3; `{3,none}` → rom-model3, hardware-model3; `{4,none}` → svc-lsdos6.
- Produces (`src/symbols/validate.ts`): `validateTables(files: { file: string; json: unknown }[], sources: unknown): { tables: Record<TableId, TableEntry[]>; sources: Source[]; errors: string[] }`. Each error names the file, the entry's index and name, and the rule.
- Produces (`src/symbols/compare.ts`): `compareRoms(model1: readonly TableEntry[], model3: readonly TableEntry[]): { classes: Record<string, RomClass>; unexplained: string[] }` and `renderComparison(model1, model3, classes): string`.
- Produces (`src/symbols/tables.generated.ts`): `SOURCES: readonly Source[]`, `TABLES: Readonly<Record<TableId, readonly TableEntry[]>>`, `ROM_COMPARISON: RomComparison`.
- Produces (`scripts/write-symbols.ts`): `buildSymbolOutputs(dataDir: string): { module: string; comparison: string; errors: string[] }`; run directly, it writes both files or prints the errors and exits 1.

JSON file shape: `{ "table": "<TableId>", "entries": [ … ] }`; an entry has `addr` (four hex digits), `port` (two hex digits), or `svc` (a number), plus `name`, `kind`, `purpose`, `cite`, and optional `length`, `coined`, `note`. `sources.json` is `{ "sources": [Source, …] }` with the ten ids of the spec's §3: `m3-basic`, `paay`, `decker`, `l2-1979`, `m1-trh`, `m3-trm`, `trsdos13`, `ldos51`, `soltoff`, `m4-trm`.

Validation rules (each is a test case): known table id; `addr` is `/^[0-9A-F]{4}$/` (so `4O2D`, letter O, fails), `port` `/^[0-9A-F]{2}$/`, `svc` an integer 0–127; `kind` allowed for the table (`port` only in hardware tables, `svc` only in `svc-lsdos6`, never `region` in DOS tables); DOS-table addresses at least `$4000`; `cite` non-empty with known sources and non-empty pages; the name rule of Global Constraints (`$`/`@` only on uncoined names; not in the hint parser's `RESERVED`; not matching its `SYNTH_NAME`); and, for every entry of `SELECTIONS`, no two names equal ignoring case and no two memory entries covering the same address.

Comparison rule: an address in both ROM tables is `shared` when name and kind match, else `different`, and `different` without a `note` on either entry goes into `unexplained`, which `buildSymbolOutputs` reports as errors.

Seed data, each value confirmed in this plan's research (the data tasks add the rest):

| Table | Entries (name `addr` → cite) |
| --- | --- |
| `rom-model3` | `$KBCHAR` `002B` → m3-basic 12/11; `$VDCHAR` `0033` → 12/20; `$KBLINE` `0040` → 12/12; `$KBWAIT` `0049` → 12/12; `$DELAY` `0060` → 12/10 (all `routine`) |
| `dos-trsdos13` | `$INIT` `4420` → trsdos13 78; `$OPEN` `4424` → 79; `$READ` `4436` → 80; `$WRITE` `4439` → 80; `$CLOSE` `4428` → 85; `$JP2DOS` `402D` → 86 |
| `dos-ldos51-model1` | `@EXIT` `402D`, `@ABORT` `4030` → ldos51 6-29; `@CMD` `4400`, `@ERROR` `4409`, `@OPEN` `4424`, `@CLOSE` `4428`, `@READ` `4436`, `@WRITE` `4439` → 6-30; `@DSPLY` `4467` → 6-31 |
| other tables | `"entries": []` |

- [ ] **Step 1: Write the failing validation tests** — `test/symbols/validate.test.ts`, one `it` per rule above, each building the smallest bad input and asserting the error text contains the file, the entry's name, and the rule. Include `validateTables([{ file: 'rom-model3.json', json: { table: 'rom-model3', entries: [{ addr: '4O2D', name: 'X', kind: 'routine', purpose: 'p', cite: [{ source: 'm3-basic', page: '1' }] }] } }], sources)` → an error mentioning `4O2D`; a coined `$FOO` → error; `kbwait` beside `KBWAIT` in tables of one selection → a case-insensitive duplicate error; a DOS entry at `3C00` → error; and a clean seed set → no errors.
- [ ] **Step 2: Run** `pnpm -s vitest run packages/disasm/test/symbols/validate.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement `types.ts`, `validate.ts`, `compare.ts`.** Normalize `addr`/`port`/`svc` into `key`, default `length` to 1 and `coined` to false.
- [ ] **Step 4: Run** the same command — PASS.
- [ ] **Step 5: Write the data files and `scripts/write-symbols.ts`.** The module is `/* Generated by pnpm symbols from data/symbols/*.json. Do not edit. */` followed by the three exports as typed literals, entries sorted by table then key. Add `"symbols": "tsx packages/disasm/scripts/write-symbols.ts"` to the root `package.json`. Run `pnpm symbols`. Expected: it reports both files written, 20 entries in all.
- [ ] **Step 6: Write `test/symbols/data.test.ts`:** `buildSymbolOutputs(<data dir>)` has no errors; its `module` equals the committed `tables.generated.ts` and its `comparison` equals `COMPARISON.md` (failure message: "run pnpm symbols"); `TABLES['rom-model3']` has `$KBWAIT` at `0x0049` citing `{ source: 'm3-basic', page: '12/12' }`; `TABLES['dos-trsdos13']` has `$JP2DOS` at `0x402D`.
- [ ] **Step 7: Run** `pnpm -s vitest run packages/disasm/test/symbols` — PASS. Then edit one byte of the generated file, rerun, see the sync test fail with "run pnpm symbols", and run `pnpm symbols` to restore.
- [ ] **Step 8: CI and CLAUDE.md.** In `ci.yml`, the fixtures step becomes `pnpm fixtures && pnpm symbols && git diff --exit-code -- fixtures/synthetic packages/disasm/src/symbols/tables.generated.ts packages/disasm/data/symbols/COMPARISON.md` (name: "fixtures and symbol tables are in sync with their sources"). In CLAUDE.md: the "Symbol tables are data files" convention adds "compiled by `pnpm symbols` into `src/symbols/tables.generated.ts`, which is never hand-edited"; the Roadmap gains item "**disasm — phase 3, then phase 4** (decided 2026-10-16): symbol tables, then the web workbench; emu phases 2+ and the MCP server resume after v1", and the paragraph saying phases 3 and 4 are not placed is replaced by that; "Current phase" says phase 3 is in progress.
- [ ] **Step 9: Run** `pnpm -s test 2>&1 | tail -4` — green. **Commit** (with this plan file): `git commit -m "p3: compile cited JSON symbol tables into a generated module"`.

### Task 2: Selecting tables

**Files:**
- Create: `packages/disasm/src/symbols/select.ts`
- Modify: `packages/disasm/src/index.ts` (exports)
- Test: `packages/disasm/test/symbols/select.test.ts`

**Interfaces:**
- Consumes: Task 1's types, `TABLES`, `ROM_COMPARISON`.
- Produces:
  - `interface SymbolSelection { machine: Machine; dos: Dos }`
  - `defaultDos(machine: Machine): Dos` — 3 → `'trsdos'`, 1 → `'ldos'`, 4 → `'none'`.
  - `tablesFor(sel: SymbolSelection): TableId[]` — the `SELECTIONS` row for the pair; any other pair throws `SelectionError` (exported class) whose message names the valid values.
  - `describeSelection(sel): string` — `Model III ROM, hardware, TRSDOS 1.3`; `Model I ROM, hardware, LDOS 5.1`; `Model III ROM, hardware, LDOS 5.1`; `… , no DOS`; `Model 4 service calls (LS-DOS 6)`.
  - `class SymbolSet` with `readonly selection: SymbolSelection`, `entries(): readonly TableEntry[]`, `code(addr): TableEntry | undefined` (kind `routine` or `vector` at exactly `addr`), `data(addr): { entry: TableEntry; offset: number } | undefined` (kind `variable`, `vector`, or `region` with `key <= addr < key + length`), `port(n)`, `svc(n)`, `machineTag(entry): string | undefined` (`'[Model III]'` or `'[Model I]'` for a ROM-table entry whose address is not `shared` in the comparison; otherwise undefined).
  - `selectSymbols(sel: SymbolSelection, tables = TABLES, comparison = ROM_COMPARISON): SymbolSet` — the defaults make tests able to pass small in-memory tables.

- [ ] **Step 1: Write the failing tests:** each `tablesFor` row and each error (`{1,'trsdos'}`, `{4,'ldos'}`); `defaultDos`; with in-memory tables, `code(0x0049)` finds a routine and `code(0x004A)` does not; `data(0x3C00 + 0x140)` on a 1024-byte region gives offset `0x140`; `data(0x4000)` is undefined (Review Focus 4); `code()` never returns a `variable`; `data()` never returns a `routine`; `machineTag` gives `'[Model III]'` for an entry classed `different` under machine 3 and undefined for `shared`.
- [ ] **Step 2: Run** `pnpm -s vitest run packages/disasm/test/symbols/select.test.ts` — FAIL.
- [ ] **Step 3: Implement `select.ts`; export** `selectSymbols`, `defaultDos`, `tablesFor`, `describeSelection`, `SymbolSet`, `SelectionError`, `SOURCES`, `TABLES`, and the types from `src/index.ts`.
- [ ] **Step 4: Run** — PASS. **Commit:** `p3: select a machine's and DOS's tables as a symbol set`.

### Task 3: External names in Pass 2

**Files:**
- Create: `packages/disasm/src/analysis/externals.ts`
- Modify: `packages/disasm/src/pipeline.ts` (`AnalyzeOptions`, `Analysis`, `analyze`)
- Test: `packages/disasm/test/symbols/externals.test.ts`

**Interfaces:**
- Consumes: `SymbolSet` (Task 2); the analysis `SymbolTable` and `MemoryImage`/analysis space already in `pipeline.ts`.
- Produces:
  - `interface ExternalName { entry: TableEntry; text: string }` — `text` is `NAME`, or `NAME+` plus `hexWord(offset)` from `@fugloy/z80` (`VIDEO+0140H`).
  - `class ExternalNames` — `constructor(set: SymbolSet | undefined, isLoaded: (addr: number) => boolean, programNames: Iterable<string>)`; `code(addr)`, `data(addr)`, `port(n)`: `ExternalName | undefined`; `svc(n): TableEntry | undefined`; `machineTag(entry)`; `readonly dropped: readonly TableEntry[]`; `readonly selection: SymbolSelection | undefined`. `code` and `data` return undefined for loaded addresses; any entry whose name equals a program name ignoring case is dropped and never returned.
  - `externalUses(instructions: Iterable<Instruction>, names: ExternalNames): TableEntry[]` — the distinct entries the renderer will name (Task 4's rules), sorted by table order then key.
  - `AnalyzeOptions.tables?: SymbolSet`; `Analysis.externals: ExternalNames` (empty when no `tables`); `Analysis.tablesUsed: TableEntry[]`.

- [ ] **Step 1: Write the failing tests:** an image at `$3C00`–`$4005` (Volcano's shape) makes `data(0x3C10)` undefined while `data(0x3BF0)` is named (Review Focus 3); a program name `video` drops a table `VIDEO` and lists it in `dropped` (Review Focus 2); without `tables`, `analyze(...).externals.code(0x49)` is undefined and every existing test still passes; `analyze(loadRaw(<the 27-byte routine>, 0x5200), { tables })`'s `tablesUsed` names `0049` and `402D` given seed-like in-memory tables. The routine: `F3 31 00 70 21 00 3C 11 01 3C 01 FF 03 36 20 ED B0 CD 49 00 FE 0D 20 F9 C3 2D 40`.
- [ ] **Step 2: Run** `pnpm -s vitest run packages/disasm/test/symbols/externals.test.ts` — FAIL.
- [ ] **Step 3: Implement** `externals.ts` and wire it into `analyze` (program names are `analysis.symbols.list()` names; `isLoaded` is the analysis space's).
- [ ] **Step 4: Run** it and `pnpm -s vitest run packages/disasm` — PASS, nothing else changed. **Commit:** `p3: name addresses outside the image from the selected tables`.

### Task 4: Rendering: operands, comments, header, EQUs, IR

**Files:**
- Modify: `packages/disasm/src/emit/operands.ts`, `packages/disasm/src/emit/zmac.ts`, `packages/disasm/src/listing.ts`, `packages/disasm/src/ir.ts`, `packages/disasm/src/index.ts`
- Test: `packages/disasm/test/symbols/naming.test.ts`, `packages/disasm/test/roundtrip/symbols-roundtrip.test.ts`; the IR snapshot does not change, because it supplies no tables

**Interfaces:**
- Consumes: `ExternalNames`, `Analysis.externals`, `Analysis.tablesUsed` (Task 3); `describeSelection` (Task 2).
- Produces:
  - `renderOperands(ins, symbols?, externals?: ExternalNames)`, `renderInstruction(ins, symbols?, externals?)`, `instructionLine(ins, symbols?, externals?)`: after the existing program-symbol lookup misses, `rel` and transfer `imm16` use `externals.code`; a `dataReference` `imm16` and every `mem` use `externals.data`; a `port` operand uses `externals.port` (`OUT (NAME),A`); `rst`, `imm8`, and non-reference `imm16` never take table names.
  - `externalComment(ins: Instruction, prev: Instruction | undefined, externals: ExternalNames): string | undefined` in `operands.ts`: a named transfer gives the entry's `purpose` plus `machineTag` when present; `RST n` with a `code(n)` entry gives `NAME: purpose`; with machine 4, `RST 28H` whose `prev` is `LD A,n` with `svc(n)` gives `NAME (SVC n): purpose`; otherwise undefined.
  - `EmitOptions.externals?: ExternalNames` and `EmitOptions.tablesUsed?: readonly TableEntry[]`.
  - `Ir.machine?: Machine`, `Ir.dos?: Dos`, `Ir.tableNames?: { key: number; name: string; kind: EntryKind; table: TableId; purpose: string; cite: readonly Cite[] }[]`; all three fields appear only when tables were supplied.

Rendering decisions: the listing joins `externalComment` into the existing comment column after the hint comment; the pass 1 header adds `; symbols: <describeSelection>` after the `; pass 1:` line and, when any external target exists, the `N external targets` phrase becomes `N external targets (M named)`; a legend line per used entry, `; table name $KBWAIT = $0049: wait for a key (m3-basic 12/12)` (ports `= port $EC`, calls `= SVC 10`), and per dropped entry `; table name VIDEO not used: the program has its own VIDEO`. zmac writes `NAME\tEQU\t<hexWord or hexByte>\t; purpose` for every used memory or port entry, before the existing symbol `EQU`s, and appends `externalComment` like hint comments. Service calls get no `EQU`.

- [ ] **Step 1: Write the failing tests** in `naming.test.ts`, with in-memory tables and `loadRaw` programs at `$5200`: `CALL 0049H` → `CALL $KBWAIT` with comment `wait for a key`; `JP 402DH` → `JP $JP2DOS`; `LD HL,3C00H` → `LD HL,VIDEO`; `LD HL,3D40H` → `LD HL,VIDEO+0140H`; `LD A,(4020H)` with a 2-byte variable at `4020` → `LD A,(CURSOR)`, and `(4021H)` → `(CURSOR+0001H)`; `OUT (0ECH),A` → `OUT (MODEPORT),A` (in-memory port name); `RST 08H` stays `RST 08H` with comment `SYNCHK: …`; a program with both `CALL 0033H` and `LD BC,0033H` names only the call (Review Focus 1); machine 4 with `LD A,0AH` / `RST 28H` comments `@DSPLY (SVC 10): …` and names nothing else; the header has the `; symbols:` line, `(M named)`, the legend, and the dropped-name line; zmac output contains `$KBWAIT\tEQU\t0049H` once even when called twice; IR has `machine`, `dos`, and `tableNames`.
- [ ] **Step 2: Write the failing round trip** in `symbols-roundtrip.test.ts` (with `skipIfNoZmac()`): the 27-byte routine, assembled from `emitZmac` output under `{3,'trsdos'}`, `{3,'ldos'}`, `{1,'ldos'}`, and `{3,'none'}` with the real `TABLES`, gives the identical image (`expectSameImage`), and the `{3,'trsdos'}` source contains `CALL\t$KBWAIT` and `JP\t$JP2DOS`.
- [ ] **Step 3: Run** `pnpm -s vitest run packages/disasm/test/symbols packages/disasm/test/roundtrip` — FAIL.
- [ ] **Step 4: Implement** the renderer, comment, listing, zmac, and IR changes; pass `analysis.externals` and `analysis.tablesUsed` wherever `analysis.symbols` is passed today.
- [ ] **Step 5: Run** `FUGLOY_REQUIRE_ZMAC=1 pnpm -s vitest run packages/disasm` — PASS; existing tests unchanged because none supply tables. **Commit:** `p3: name external operands, define them for zmac, and list them in the IR`.

### Task 5: CLI `--machine` and `--dos`

**Files:**
- Modify: `packages/cli/src/index.ts` (options, USAGE, validation, `analyze` call)
- Test: `packages/cli/test/cli.test.ts`

**Interfaces:**
- Consumes: `selectSymbols`, `defaultDos`, `SelectionError` (Task 2); `AnalyzeOptions.tables` (Task 3).
- Produces: `--machine <1|3|4>` (default 3) and `--dos <trsdos|ldos|none>` (default `defaultDos(machine)`); every analyzed output (listing, `--format zmac`, `--format ir`) gets `tables: selectSymbols(...)`; `--sweep` and the plain-BASIC listing do not (Task 10 adds BASIC comments).

USAGE lines (exact):
```
  --machine <n>    name ROM, hardware, and DOS addresses for Model 1, 3
                   (the default), or 4 (LS-DOS 6 service calls only)
  --dos <name>     the DOS whose names to use: trsdos (Model III default),
                   ldos (Model I default), or none
```
Errors, exit 2: `fugloy: --machine must be 1, 3, or 4`; `fugloy: --dos must be trsdos, ldos, or none`; `fugloy: --dos trsdos is the Model III DOS; use --machine 3 or --dos ldos`; `fugloy: --machine 4 names LS-DOS 6 service calls only; leave out --dos`.

- [ ] **Step 1: Write the failing tests:** each error (Review Focus 5) with its exit code and message; the default run of a raw `CALL 0049H` program lists `CALL $KBWAIT` and the header `; symbols: Model III ROM, hardware, TRSDOS 1.3`; `--machine 1` changes the header to `Model I ROM, hardware, LDOS 5.1`; `--dos ldos` turns `JP $JP2DOS` into `JP @EXIT`; `--sweep` output is unchanged. The existing assertions that pin `LD HL,3C00H` (lines 33 and 107) still hold: the hardware tables are empty until Task 6, which flips them to `LD HL,VIDEO`.
- [ ] **Step 2: Run** `pnpm -s vitest run packages/cli` — FAIL.
- [ ] **Step 3: Implement** the options and validation (catch `SelectionError` for the pairs; check values before calling it).
- [ ] **Step 4: Run** — PASS. **Commit:** `p3: choose the machine and DOS on the command line`.

### Task 6: Hardware tables

**Files:**
- Modify: `packages/disasm/data/symbols/hardware-model1.json`, `hardware-model3.json`, regenerated files
- Test: `packages/disasm/test/symbols/data.test.ts`, `packages/cli/test/cli.test.ts` (the `VIDEO` flip)

Sources: Model I, `m1-trh` p. 12 (memory map), p. 34 (video RAM), p. 86 (memory-mapped devices); Model III, `m3-trm` p. 14 (memory map), p. 15 (I/O port description), pp. 21–24 (port bits). Coined names. `VIDEO` (`3C00`, length 1024) and `KEYBOARD` (`3800`, the length each manual decodes) are fixed by this plan in both tables; the rest are the implementer's, one per memory-mapped device on Model I (interrupt latch, printer, disk controller, cassette and display control, as p. 86 lists them) and one per I/O port on Model III (p. 15's list: `E0`, `E4`, `E8`–`EB`, `EC`, `F0`–`F3`, `F4`, `F8`, `FF`), each `purpose` paraphrased from the page.

- [ ] **Step 1: Write the failing assertions:** both tables have `VIDEO` at `0x3C00` length 1024 and `KEYBOARD` at `0x3800`; `hardware-model3` has a port entry for `0xEC` and `0xFF`; `hardware-model1` has no port `0xEC`; every entry cites `m1-trh` or `m3-trm` respectively.
- [ ] **Step 2: Run** `pnpm -s vitest run packages/disasm/test/symbols/data.test.ts` — FAIL.
- [ ] **Step 3: Enter the entries,** confirming each address on its page; `pnpm symbols`.
- [ ] **Step 4: Run** the data tests, then flip the two `cli.test.ts` assertions to `LD HL,VIDEO` and run `pnpm -s test` — PASS. **Commit:** `p3: enter the Model I and Model III hardware tables`.

### Task 7: The Model III ROM table

**Files:**
- Modify: `packages/disasm/data/symbols/rom-model3.json`, regenerated files
- Test: `packages/disasm/test/symbols/data.test.ts`

Sources: `m3-basic` ch. 12 (routines `12/2`–`12/23`, summary table `12/24`, RAM addresses `12/25`; Tandy prints decimal and hex, so confirm by the pair); `decker` for the RST vectors (`$0008`–`$0038`) and Model III routines Tandy does not list (coined names). Scope: every routine in the `12/24` summary, every `12/25` RAM address (`variable` or `vector`, with `length`), the eight RST vectors `$0000`–`$0038`, and every address of Asylum's list (spec §7) that a Model III source documents, about 100 in all and at least 60.

- [ ] **Step 1: Write the failing assertions:** at least 60 entries; every `12/24` routine name present (assert the count equals the table's row count, 28); `0x00`, `0x08`, `0x10`, `0x18`, `0x20`, `0x28`, `0x30`, and `0x38` present; `$PRCHAR` at `0x003B`; no entry cites `kiwisincebirth`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Enter,** `pnpm symbols`. **Step 4: Run** `pnpm -s vitest run packages/disasm/test/symbols` — PASS. **Commit:** `p3: enter the Model III ROM table from Tandy's ROM subroutines chapter`.

### Task 8: The Model I ROM table and the comparison

**Files:**
- Modify: `packages/disasm/data/symbols/rom-model1.json`, regenerated `tables.generated.ts` and `COMPARISON.md`
- Test: `packages/disasm/test/symbols/data.test.ts`

Sources: `paay` pp. 2–22 (ROM map) and 23–30 (reserved RAM and device addresses), tables 31–65 for purposes; `decker` as the second source; `l2-1979` p. 8/9 for the USR linkage. Entered from these sources, not copied from `rom-model3`. Names by the spec's §4.3: Tandy's `$` name when a Model I source describes the same routine at the same address (cite both), else coined. Scope: every address of Asylum's list in spec §7 except the four above its image, then the rest of Paay's map to about 100, at least 60.

- [ ] **Step 1: Write the failing assertions:** at least 60 entries; each of `0x0000`, `0x0008`, `0x0010`, `0x0020`, `0x0030`, `0x0038`, `0x002B`, `0x0033`, `0x0112`, `0x01F8`, `0x0212`, `0x0235`, `0x0264`, `0x0287`, `0x0296`, `0x093E`, `0x1A19` has an entry; `$KBWAIT` at `0x0049` cites `paay`; `COMPARISON.md` lists `0060` (`$DELAY`) with a note on the timing difference (`decker` p. 53) or classes it shared, and `unexplained` is empty.
- [ ] **Step 2: Run** — FAIL. **Step 3: Enter;** for every address `pnpm symbols` reports as unexplained, decide from the sources and add the `note`. **Step 4: Run** — PASS. **Commit:** `p3: enter the Model I ROM table from Paay's map and compare the two`.

### Task 9: DOS tables and service calls

**Files:**
- Modify: `dos-trsdos13.json`, `dos-ldos51-model1.json`, `dos-ldos51-model3.json`, `svc-lsdos6.json`, regenerated files
- Test: `packages/disasm/test/symbols/data.test.ts`, `packages/disasm/test/symbols/naming.test.ts`

Sources: `trsdos13` pp. 74–86 (every routine and storage address the section documents; its page 78 list is the checklist, and a spelling that differs between the list and the heading takes the heading, with a `note`); `ldos51` pp. 6-29 to 6-31 (Model I) and 6-32 to 6-34 (Model III), with p. 6-35's cross-index for the differences (`@CMD` `4400` vs `4296`); `soltoff` pp. 101–103 for every service call, `m4-trm` p. 334 as the second source. Only RAM-resident addresses go in DOS tables.

- [ ] **Step 1: Write the failing assertions:** `dos-ldos51-model3` has `@CMD` at `0x4296` and `@EXIT` at `0x402D`; `svc-lsdos6` has `@KEY` 1, `@DSPLY` 10, `@ABORT` 21, `@EXIT` 22; `dos-trsdos13` has every name on its page-78 list; with the real tables, a machine 4 listing of `LD A,0AH` / `RST 28H` comments `@DSPLY (SVC 10)`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Enter,** `pnpm symbols`. **Step 4: Run** — PASS. **Commit:** `p3: enter the TRSDOS 1.3, LDOS 5.1, and LS-DOS 6 tables`.

### Task 10: Names in `.BAS` listings

**Files:**
- Create: `packages/disasm/src/basic/addresses.ts`
- Modify: `packages/disasm/src/listing.ts` (`RenderOptions.tables?: SymbolSet`, `renderBasListing` and the BASIC lines of `renderPass1Listing`), `packages/cli/src/index.ts` (pass `tables` to `renderBasListing`)
- Test: `packages/disasm/test/symbols/bas-names.test.ts`

**Interfaces:**
- Consumes: `parseLine` and its `Expr`/`Statement` types (phase 2C); `SymbolSet.data`/`code`.
- Produces: `basAddresses(line: ParsedLine): number[]` in `src/basic/addresses.ts` — constant addresses in `PEEK(n)` calls, `POKE n,…` statements, and `DEFUSRn = n`, where `n` is a `num` literal or `-` applied to one (an address above 32767 written negative: `65536 - value`). After each BASIC line with such addresses, the listing adds one line per address: `;   16526 = $408E USR vector (USRVEC)` — decimal as written, hex, purpose, name.

- [ ] **Step 1: Write the failing tests:** `basAddresses` of `POKE 16526,0:POKE 16527,82` is `[16526, 16527]`, of `X=PEEK(14400)` is `[14400]`, of `DEFUSR3=&H7D00` is `[0x7D00]`, of `POKE -1,0` is `[0xFFFF]`, of `PRINT 16526` is `[]`; with in-memory tables, the listing of a synthetic `.BAS` (built with the test tokenizer) shows the note line under the POKE line and none under others.
- [ ] **Step 2: Run** `pnpm -s vitest run packages/disasm/test/symbols/bas-names.test.ts` — FAIL.
- [ ] **Step 3: Implement.** **Step 4: Run** `pnpm -s test` — PASS. **Commit:** `p3: note the ROM and RAM addresses BASIC lines PEEK and POKE`.

### Task 11: asylum16 and Volcano Hunter

**Files:**
- Create: `packages/disasm/test/real/symbols.test.ts`; `fixtures/hints/volcano.hints` if Step 3 needs it
- Modify: data files if the programs reach an address the sources document but the tables lack

Asylum is a Model I program: run it with `--machine 1` and `fixtures/hints/asylum16.hints`. Volcano Hunter writes Model III port `$EC`: run it with the default machine.

- [ ] **Step 1: Write the failing tests** (each with `skipIfMissing`, and a placeholder test so the suite is never empty): asylum16's listing has no `CALL`/`JP` to a numeric address that `rom-model1` names, includes `CALL $VDCHAR` (its `$0033` call), and its zmac output round-trips (`assemble` + `expectSameImage`); Volcano Hunter's listing names `OUT (<the EC port's name>),A` and every ROM or DOS address its pass 1 reaches, and round-trips.
- [ ] **Step 2: Run** `pnpm -s vitest run packages/disasm/test/real/symbols.test.ts` — FAIL.
- [ ] **Step 3: Volcano Hunter's calls.** Its pass 1 decodes 26% and reaches no ROM call. Read its listing for code it does not reach (data runs that decode as plausible code after reached code, jump tables, the transfer path), add `entry` and `table` hints to `fixtures/hints/volcano.hints` with a `comment` on each saying why, and stop when the hints reach its ROM or DOS calls or after one hour of effort; in the second case ledger what it reached. Add the hint file to the test.
- [ ] **Step 4: Run** — PASS. **Commit:** `p3: name asylum16's and Volcano Hunter's ROM and DOS calls`.

### Task 12: The Landscape table and the docs

**Files:**
- Modify: `docs/Fugloy-Project-Plan.md` (Landscape table, phase 3 status), `README.md`, `CHANGELOG.md`, `CLAUDE.md` (current phase)

- [ ] **Step 1: The Landscape table.** For each row (z80dasm/dz80/zdis, Ghidra's Z80 module, IDA Pro, trs80gp, TRSTools), check every cell against the tool's current documentation or source; replace a cell that is wrong, mark one that cannot be checked "unverified", and add a line under the table with the date and the sources used. Confirm the README repeats no claim the table now marks unverified.
- [ ] **Step 2: The docs.** README: a "Symbols" section showing a before/after line (`CALL 0049H` → `CALL $KBWAIT ; wait for a key`) and the two flags. CHANGELOG `[Unreleased]` → Added: the tables, their sources and counts, the flags, the `.BAS` notes. The plan's phase 3 entry gets a "Met" paragraph like phase 2's. CLAUDE.md: "Current phase" says phase 3 is done and phase 4 is next.
- [ ] **Step 3: Run** `pnpm -s typecheck && FUGLOY_REQUIRE_ZMAC=1 pnpm -s test && pnpm -s build && pnpm symbols && git diff --exit-code packages/disasm/src/symbols packages/disasm/data/symbols/COMPARISON.md` — all green, no diff. **Commit:** `p3: verify the Landscape table and record phase 3`.
