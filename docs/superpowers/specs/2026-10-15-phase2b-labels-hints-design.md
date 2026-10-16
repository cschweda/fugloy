# Phase 2, sub-project B: labels and the hint file

Design spec, 2026-10-15. The second third of phase 2 of
`docs/Fugloy-Project-Plan.md`: Pass 2 label synthesis, the hint file, and
overrides, on top of sub-project A (`2026-10-15-phase2a-pass1-roundtrip-design.md`).
Sub-project C (hidden code and heuristics) follows.

## 1. Goal

1. A **hint file**: line-oriented text, keyed by block and offset, with
   content-based block identity, read and written by the core library, that
   records every user decision (entry points, code/data overrides, jump
   tables, names, comments) and survives relocation of the program.
2. **Annotations** applied before Pass 1: overrides win over descent, `nocode`
   stops it, declared jump tables seed it. This is what makes Asylum's
   indirect dispatch reachable.
3. **Pass 2**: a symbol table synthesized from use (`L`, `SUB_`, `DATA_`,
   `TBL_`) with user names on top, changing only what bytes are called.
4. The emitter, listing, IR, and CLI use the symbols, and the round trip
   stays byte-exact with labels in the source.

**Done when:** every synthetic fixture and every present real sample
round-trips with labels on; a hint file round-trips through the writer and
the parser; a hint file written against asylum1b applies unchanged to
asylum1c and asylum1d; a committed hint fixture documents asylum16's loader
and applies with nothing unmatched; the CLI reads and writes hints.

*Outcome note (2026-10-16):* asylum16 has no dispatch table. Its stub
interprets a stream at `$80DD` whose `<` records copy the loaded payload down
to `$42F3` and whose final `x` record jumps to `$43AE`, an address never in
the loaded image. The game relocates itself at run time, so no static hint
can reach its code; the fixture documents the loader instead, and a
`relocate` hint emitted through zmac's `.phase` directive is proposed for a
later sub-project.

## 2. Non-goals

The JSON label and coverage file of `docs/label-format.md` (the annotation
model is designed so a reader for it can be added when emu phase 3 exists,
but none is written here). Symbol tables for ROM, DOS, and hardware
addresses (phase 3): external targets stay numeric. String and jump-table
heuristics, hidden-code detection, and `.BAS` rebasing (sub-project C). A
`string` region is typed and emitted as bytes here; quoted text rendering
arrives with C's heuristic.

## 3. Decisions

- **Hints are the only annotation source in B** (user's choice). Pass 1 and
  Pass 2 take an in-memory `Annotations` value that the hint reader produces;
  nothing in the passes knows the file format.
- **Block = loaded run.** Identity is `(length, hash)` where `hash` is the
  first 16 hex digits of SHA-256 over the run's first 64 bytes (or the whole
  run when shorter). Measured: asylum1b/1c/1d share one 20,297-byte run with
  identical first 64 bytes and differ in 130 relocated bytes; asylum1e,
  asylum32, and asylumd.bad share a 20,001-byte run. Index order breaks ties
  between runs with equal identity.
- **SHA-256 in pure TypeScript** inside `disasm` (no Node, no async Web
  Crypto in the core), verified against Node's implementation in tests.
- **Numbers in the hint file** are `$hex` (or `hexH`, `0xhex`) or plain
  decimal, never bare hex, so a length is never misread. The writer emits
  `$hex` for offsets, lengths, and addresses and decimal for indices, counts,
  and widths.
- **Program hash mismatch is a warning, not a refusal**, because a relocated
  build is a different file with matching blocks; the workbench may refuse
  later. Unmatched hint blocks are reported with the count of hints skipped.
- **Overrides win.** `bytes`, `words`, `string` pre-type the map before
  descent, which then treats them as data; `nocode` ends any path that
  reaches it; `entry`, `code`, and table targets are roots; `code` with a
  length forces linear decoding of its range *before* the worklist runs, so
  the override wins over a disagreeing natural path and the forced
  instructions' transfers are followed; data overrides inside the range are
  skipped.
- **Tables are two bytes wide in B.** `table <count> <width>` accepts the
  plan's grammar; width 1 is rejected with a message, because a one-byte
  entry needs a base the plan does not specify.
- **Data references** are the 16-bit immediates of `LD BC|DE|HL|IX|IY,nn` and
  every `(nn)` memory operand whose address is loaded; `LD SP,nn`, ports,
  and immediates of other instructions are constants. (The plan names HL and
  DE; BC, IX, and IY are the same idiom.)
- **Precedence of synthesized kinds:** `SUB_` over `L` over `TBL_` over
  `DATA_` at the same address; a `name` hint replaces the name and keeps the
  kind, or creates a `data` symbol where none was synthesized.
- **User names** match `[A-Za-z_][A-Za-z0-9_]{0,31}`, are not Z80
  mnemonics, registers, condition codes, or zmac directives, and do not have
  the generated shape `L`/`SUB_`/`DATA_`/`TBL_` plus four hex digits (so a
  user name can never collide with a synthesized label elsewhere); the same
  address named twice is an error.
- **Labels in the source** are `NAME:` lines before the row at that address;
  DB and DW rows split at every symbol address; a symbol inside an
  instruction is emitted as `NAME EQU addrH` after the header. Jump and call
  targets, data references, and `DW` table entries use symbol names when a
  symbol exists; everything else stays numeric. zmac resolves a symbol to the
  same value, so bytes do not change.
- **`words` and tables emit as `DW`** (zmac writes little-endian, as the
  image holds them); an odd trailing byte emits as `DB`.
- **`--write-hints` refuses to overwrite** an existing file; the user names
  a new one.

## 4. Hint file format

```
# Fugløy hints. Numbers: $hex or decimal. Offsets are relative to a block.
fugloy-hints 1
program sha256 3f1c…e9a0
block 0 length $4F49 hash 7f83b1657ff1fc53    # start $6300
block 1 length $0002 hash 2c26b46b68ffc68f    # start $4016
block 0:$0000 entry
block 0:$0D12 table 16 2
block 0:$0D12 name DISPATCH
block 0:$1A00 bytes $40
block 0:$1A40 words $10
block 0:$1A60 string $0C
block 0:$2000 code
block 0:$2000 name MAIN_LOOP
block 0:$2000 comment main game loop, entered from the dispatch table
block 0:$3F00 nocode
```

Grammar: blank lines and `#` comments ignored; the first non-comment line is
`fugloy-hints 1`; `program sha256 <64 hex>` optional; `block <i> length <n>
hash <16 hex>` declares identities; `block <i>:<offset> <directive> [args]`
declares hints. Directives and arguments: `entry`; `code [length]`; `bytes
<length>`; `words <length>`; `string [length]` (without a length: through the
first `00H`, `0DH`, or `03H` byte in the run); `nocode`; `table <count>
<width>`; `name <identifier>`; `comment <text to end of line>`. An offset at
or past the block's length, an unknown directive, a malformed number, a bad
name, a duplicate name at one address, or a hint for an undeclared block is
an error carrying its line number; a file with errors is not applied.

## 5. Components and interfaces

All in `packages/disasm` unless noted. No Node or DOM APIs in `src/`.

### 5.1 `src/hash.ts`

```ts
export function sha256(bytes: Uint8Array): Uint8Array;   // 32 bytes
export function sha256Hex(bytes: Uint8Array): string;    // 64 lowercase hex digits
```

### 5.2 `src/hints/identity.ts`

```ts
export interface BlockIdentity { index: number; start: number; length: number; hash: string }  // hash: 16 hex digits
export function blockIdentities(image: MemoryImage): BlockIdentity[];   // one per run, in address order
export function programHash(bytes: Uint8Array): string;                 // sha256Hex of the file
```

### 5.3 `src/hints/format.ts`

```ts
export interface HintBlock { index: number; length: number; hash: string; start?: number }
export type Directive =
  | { directive: 'entry' } | { directive: 'code'; length?: number } | { directive: 'bytes'; length: number }
  | { directive: 'words'; length: number } | { directive: 'string'; length?: number } | { directive: 'nocode' }
  | { directive: 'table'; count: number; width: number } | { directive: 'name'; name: string } | { directive: 'comment'; text: string };
export type Hint = Directive & { block: number; offset: number; line: number };
export interface HintFile { version: 1; program?: string; blocks: HintBlock[]; hints: Hint[] }
export interface HintError { line: number; message: string }
export function parseHints(text: string): { file: HintFile; errors: HintError[] };
export function writeHints(file: HintFile): string;     // canonical text; parseHints(writeHints(f)) deep-equals f
export function isValidName(name: string): boolean;     // identifier and not reserved
```

### 5.4 `src/hints/apply.ts`

```ts
export interface Override { addr: number; kind: 'bytes' | 'words' | 'string' | 'code' | 'nocode'; length: number }
export interface TableHint { addr: number; count: number; width: number }
export interface Annotations {
  entries: number[];
  overrides: Override[];
  tables: TableHint[];
  names: Map<number, string>;
  comments: Map<number, string>;
}
export interface Applied {
  annotations: Annotations;
  matched: { block: HintBlock; run: Run }[];
  unmatched: { block: HintBlock; hints: number }[];
  warnings: string[];        // program hash mismatch, unmatched blocks, width-1 tables, offsets past the run
}
export const emptyAnnotations: () => Annotations;
export function applyHints(file: HintFile, image: MemoryImage, programHash?: string): Applied;
```

Matching: for each hint block in index order, the first image run with equal
`(length, hash)` not yet taken; hints of unmatched blocks are dropped and
counted. Addresses are `run.start + offset`.

### 5.5 Pass 1 with annotations (`src/analysis/descent.ts`, `src/pipeline.ts`)

```ts
export function recursiveDescent(image: MemoryImage, roots: number[], annotations?: Annotations): Pass1;
export interface AnalyzeOptions { entries?: number[]; annotations?: Annotations }
export interface Analysis { module; pass1; entry; roots; transfer; annotations: Annotations; symbols: SymbolTable }
```

Before the worklist: overrides pre-type the map (`Kind.Byte`, `Kind.Word`,
`Kind.String`); `nocode` addresses go into a set the loop checks, ending the
path with a `nocode` diagnostic; each table is typed as words and its
`count` little-endian entries that are loaded become roots (an unloaded entry
is an `external`; the xref's `from` is the entry's own address); then each
`code` hint with a length decodes linearly through still-unknown bytes in its
range, flow ignored, following its transfers. Roots are the module entry,
`entries`, hint entries, code hints, and table targets, in that order.
Descent refuses an instruction whose bytes would cover any typed byte, data
as well as code. `DiagnosticKind` gains `'nocode'`.

### 5.6 Pass 2 (`src/analysis/symbols.ts`)

```ts
export type SymbolKind = 'code' | 'sub' | 'data' | 'table';
export interface Symbol { addr: number; name: string; kind: SymbolKind; source: 'synth' | 'user' }
export class SymbolTable { get(addr: number): Symbol | undefined; has(addr: number): boolean; list(): Symbol[] /* by address */ }
export function synthesizeSymbols(pass1: Pass1, annotations: Annotations, image: MemoryImage): SymbolTable;
```

Rules: every loaded `jump`/`cjump` target is `L%04X` (`code`); every loaded
`call`/`ccall` target is `SUB_%04X` (`sub`, overriding `code`); each table
is `TBL_%04X` (`table`); each data reference per §3 is `DATA_%04X` (`data`)
unless a higher kind exists; names from `annotations.names` replace the
name with `source: 'user'`, creating a `data` symbol when none existed.
Externals get no symbol.

### 5.7 Emitter (`src/emit/zmac.ts`) and operand rendering (`src/emit/operands.ts`)

```ts
export interface EmitOptions { source?: string; addresses?: boolean; symbols?: SymbolTable; annotations?: Annotations }
export function emitZmac(image, pass1, transfer, opts?): string;
export function renderOperands(ins: Instruction, addr: number, symbols: SymbolTable | undefined): string;   // shared with the listing
```

Output order: header comment; `NAME EQU addrH` for every symbol inside an
instruction; per run `ORG`, then rows: a `NAME:` line precedes any row whose
address has a symbol; instruction rows use `renderOperands`; `Kind.Word`
and table bytes emit as `DW` (four per row, symbol names for loaded
entries that have one); `Kind.Byte`, `Kind.String`, and unknown bytes emit
as `DB` (eight per row); rows split at symbol addresses and kind changes;
`comment` hints append `; text`; `END` as in A.

### 5.8 Listing and IR

`renderPass1Listing` prints `NAME:` lines in the address column before the
row, uses `renderOperands`, appends hint comments, and adds header lines:
`; hints: <file>: N blocks matched, M unmatched, K hints applied` and one
`; warning:` per applied warning. The IR gains `symbols: Symbol[]` and
`hints?: { matched: number; unmatched: number; warnings: string[] }`.

### 5.9 CLI

```
fugloy <file> [--base <hex>] [--entry <hex>]... [--hints <path>] [--write-hints <path>] [--format listing|zmac|ir] [--sweep] [-o <path>]
```

`--hints` reads and applies a hint file; parse errors print every error with
its line number and exit 2; apply warnings go to the listing header and to
stderr for `zmac`/`ir` output. `--write-hints` writes a skeleton for the
loaded file (header, program hash, block identities with `# start` comments,
one `entry` line per `--entry`) and exits 0, refusing to overwrite. Both
work with `--sweep` only in the sense that `--sweep` still refuses `--entry`
and now also refuses `--hints`.

## 6. Data flow

```
file → loader → Module ─┐
hints text → parseHints → HintFile → applyHints(image) → Annotations
Module + entries + Annotations → recursiveDescent → Pass1
Pass1 + Annotations → synthesizeSymbols → SymbolTable
Pass1 + SymbolTable + Annotations → emitZmac | renderPass1Listing | buildIr
emitZmac output → zmac → .cmd → loadCmd → image' == image (labels resolve to the same values)
```

## 7. Error handling

Parse errors never apply a partial file. Apply warnings never stop analysis.
Descent and symbol synthesis never throw on program content. A hint
pointing inside an instruction is honored where it can be (a `name` there
becomes an `EQU`; `bytes` there wins over the instruction because overrides
are applied first). The CLI exits 2 on hint parse errors and on an existing
`--write-hints` target, 1 on unreadable or unwritable files.

## 8. Testing

Test-first per unit, as in A.

- `hash`: SHA-256 vectors (empty, `abc`, 1000-byte pattern) against
  `node:crypto` in the test.
- `identity`: identities of synthetic fixtures; asylum1b/1c/1d produce
  identical `(length, hash)` for the main run and the asylum1e/asylum32/
  asylumd.bad trio likewise (skip when absent).
- `format`: every directive parses; `$hex`, `hexH`, `0xhex`, decimal; each
  error class with its line number; `writeHints` → `parseHints` round trip;
  canonical output is deterministic; reserved names rejected.
- `apply`: match by `(length, hash)` with index tiebreak; unmatched block
  reported with hint count; program hash mismatch warning; offset past the
  run; width-1 table rejected; addresses computed from the matched run's
  start, not the hint's.
- `descent` with annotations: `entry` root; `nocode` ends a path with a
  diagnostic; `bytes` region makes a jump into it `in-data`; `table` types
  words and seeds roots; `code` with length forces decoding.
- `symbols`: each rule, the precedence order, user name replacing a
  synthesized one, user name creating a data symbol, no symbol for
  externals, `LD SP,nn` not a reference.
- `emit`: `NAME:` placement, `EQU` for an inside-instruction symbol, DB row
  split at a symbol, `DW` rows with names, operands with names, comments;
  the table-wide encoding test unchanged; **all fixture and real round trips
  re-run with symbols on**, plus a fixture built to exercise every emitter
  path (`fixtures/hints/*.hints` and a matching synthetic `.CMD`).
- `listing`/`ir`: label lines, header lines, `symbols` in the IR snapshot.
- `cli`: `--hints` happy path, parse error exit 2 listing lines, `--write-hints`
  content and refusal to overwrite, `--sweep --hints` refused.
- **Rebasing proof:** hints written against asylum1b, applied to asylum1c and
  asylum1d, yield the same offsets, the same symbol names relative to each
  base, and no unmatched blocks (skip when absent).
- **Asylum acceptance:** `fixtures/hints/asylum16.hints` (offsets, hashes,
  names, and comments only) documents the loader found by reading the entry
  stub; with it applied nothing is unmatched, the loader's `JP (HL)` is the
  only indirect jump, the stream's `x` record names `$43AE`, and the round
  trip holds (skip when absent). Generated hint fixtures live under
  `fixtures/synthetic/hints/`; hand-written ones under `fixtures/hints/`.

## 9. Risks

- The asylum16 dispatch may not be a plain table (`PUSH HL`/`RET`, or a RAM
  vector); then the acceptance fixture uses `entry` hints at the routines the
  stub reaches, found by reading the code, and the report says so.
- zmac reserved words beyond the list (macros, pseudo-ops) could collide with
  a user name; the harness turns that into a loud round-trip failure, and
  the list grows.
- A `bytes` override inside already-reachable code changes what descent
  reaches (that is the point); the listing's notes make the consequence
  visible.

## 10. Sequencing inside B

1. SHA-256 and block identity, with the Asylum identity test.
2. Hint file model, parser, writer, name validation.
3. `applyHints`: matching and annotations.
4. Descent with annotations: overrides, `nocode`, tables, `code` length.
5. Pass 2 symbols.
6. Emitter with symbols, `EQU`, `DW`, operand rendering; all round trips re-proven.
7. Listing, IR, CLI (`--hints`, `--write-hints`).
8. Rebasing proof and the asylum16 hint fixture.
9. Docs (plan: hint-file section stays as specified; CHANGELOG; README) and the report.

Natural session cut, if needed: after step 4.
