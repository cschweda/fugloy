# Phase 2, sub-project C: hidden code, heuristics, rebasing, and relocation

Design spec, 2026-10-16. The last third of phase 2 of `docs/Fugloy-Project-Plan.md`,
on top of sub-projects A (`2026-10-15-phase2a-pass1-roundtrip-design.md`) and B
(`2026-10-15-phase2b-labels-hints-design.md`). Three slices, built in order:
C1 hidden code in `.BAS`, C2 heuristics, C3 rebasing and relocation.

## 1. Goal

1. **C1.** Find machine code hidden in tokenized BASIC by parse validity, place
   it at its true addresses, mine the entry points the BASIC text plants, and
   list and emit a `.BAS` program with its BASIC lines as text and its code
   lines disassembled, round-tripping through zmac.
2. **C2.** Type runs of printable text as strings and emit them quoted; propose
   jump tables without applying them.
3. **C3.** Rebase a `.BAS` program to another address with its stale references
   marked and its hints still matching; declare that bytes execute somewhere
   other than where they load (`relocate`), analyze them there, and emit them
   with zmac's `.phase` so the round trip holds. Use it to analyze Asylum's
   game code at its runtime address.

**Done when:** for every Valkyrie file present, lines 2–247 are reported as
code and every other line parses as BASIC; `base+14` is mined from line 250
with its evidence; the `.BAS` zmac output round-trips with labels. Strings and
table proposals appear on the real samples and every round trip still holds.
Hints written for a `.BAS` apply after `--rebase`. asylum16 analyzes from
`$43AE` through generated `relocate` hints, reaching its game code, with the
file-image round trip intact.

## 2. Non-goals

Execution tracing; automatic discovery of the routines Valkyrie reaches only
through computed addresses (each code line is a candidate region, and the
listing shows it; which routine the game actually calls is Part 2's tracing
job). Symbol tables for ROM and DOS addresses (phase 3). A general BASIC
interpreter: the entry miner evaluates only the idioms the plan names.

## 3. Decisions

- **Parse validity is statement-shape validity.** Each keyword has an argument
  shape class over one expression grammar (§4). A line is BASIC when every
  statement parses; the phase-1 lexical check stays as the first stage. The
  Valkyrie acceptance test is the measure, not grammar completeness.
- **Code lines are candidate regions, not forced code.** A failing line's body
  start is a root; descent decides what inside it is code. Line headers (two
  words) and terminators (a byte) are typed as data; parsed BASIC bodies are
  typed as data with their text attached, so descent never decodes BASIC text.
- **Mined entries are roots with evidence.** Idioms: `DEFUSR[n]=expr`; pokes
  to 16526/16527 (the USR vector); `POKE a,195` with pokes to `a+1` and `a+2`.
  Values come from an abstract evaluator whose domain is constants and
  "program start plus N" (from `PEEK(16548)`/`PEEK(16549)` in either order
  and either `*256` placement) with `INT(x/256)` and `x-h*256` yielding the
  high and low bytes; variable assignments are tracked in file order. Anything
  else is `unknown`, reported as a note naming the line.
- **A `.BAS` round-trips like a `.CMD`.** The zmac output emits each line as
  `DW` header, body (instructions for code lines; `DB` for BASIC text with
  the detokenized line as a comment), and `DB 00H`. The image comparison is
  unchanged.
- **Strings are applied, tables are proposed.** A string is at least four
  printable bytes (`20H`–`7EH`) in untyped memory ending in `0DH`, `03H`, or
  `00H`, found after descent. A table proposal is three or more consecutive
  little-endian words in untyped memory that all land on instruction starts.
  Proposals carry the exact hint line that would declare them.
- **Quoted `DB` is byte-exact.** `'` is doubled inside quotes; bytes outside
  `20H`–`7EH` are emitted as hex; the table-wide and fixture round trips prove
  it.
- **Rebasing rewrites pointers only.** `--rebase <hex>` for `.BAS` produces the
  program as saved from the new base: the pointer chain changes, nothing else.
  Operands that still point into the old program range are marked stale; the
  header names the original base.
- **`.BAS` identity ignores pointers.** For a `.BAS` image, block identity is
  computed over the first 64 bytes with each line pointer replaced by its
  offset from the base, so hints match before and after a rebase. `.CMD` and
  raw identities are unchanged.
- **Relocation uses an analysis image.** A `relocate` declares that a file
  region executes at another address. The analysis image is the file image
  with each relocated region placed at its runtime address and unloaded from
  its file address; Pass 1 and Pass 2 run on it unchanged. Hints stay keyed by
  file offsets; annotations are mapped to runtime addresses when applied. The
  emitter walks the file image and wraps each relocated region in `.phase
  addr` / `.dephase`, so assembled bytes stay at file addresses and labels take
  runtime values. A destination overlapping loaded or already-relocated memory
  is an error.
- **Asylum's relocations are generated, not typed.** Its loader stream is
  machine-readable; a test-suite script derives one `relocate` line per
  128-byte record from the sample and the committed fixture must match it.

## 4. BASIC grammar

Tokens: keyword bytes `80H`–`FBH` by name; `"…"` string literals; numbers
(digits, `.`, `E±nn`, type suffixes `!`, `#`, `%` are accepted); identifiers
(letter, then letters and digits, optional `$ % ! #`); `: , ; ( )`;
relational pairs `<=`, `>=`, `<>` built from the `<`, `>`, `=` tokens.

Expression grammar, lowest to highest: `OR`; `AND`; `NOT`; relational;
additive `+ -`; multiplicative `* /`; unary `-`; power `^`; primary: number,
string, variable with optional subscripts, function token with parenthesized
arguments (`SGN INT ABS FRE INP POS SQR RND LOG EXP COS SIN TAN ATN PEEK CVI
CVS CVD EOF LOC LOF MKI$ MKS$ MKD$ CINT CSNG CDBL FIX LEN STR$ VAL ASC CHR$
LEFT$ RIGHT$ MID$ STRING$ INSTR POINT VARPTR USR`), nullary tokens (`TIME$
MEM INKEY$ ERL ERR`), `FN name(args)`, parenthesized expression.

Statement shapes: `none` (END STOP RETURN CLS TRON TROFF CONT NEW RANDOM
SYSTEM); `optional-number` (CLEAR RESTORE RUN LIST LLIST DELETE AUTO EDIT
RESUME accept nothing, a number, a range, or `NEXT`); `line-list` (GOTO GOSUB
one line number; `ON expr GOTO|GOSUB n,n,…`; `ON ERROR GOTO n`); `print`
(PRINT LPRINT: optional `#n,`, optional `USING expr;`, items separated by `,`
or `;`, `TAB(` items); `input` (INPUT LINE INPUT: optional `#n,`, optional
`"prompt";`, variable list); `var-list` (READ DIM NEXT; DIM subscripts); `two-
expr` (POKE OUT; SET RESET POINT with parentheses); `assign` (LET or bare
`var = expr`); `for` (FOR var = expr TO expr [STEP expr]); `if` (IF expr
[THEN] statements-or-line [ELSE statements-or-line], with `GOTO` allowed after
`IF`); `def` (DEF FN name(args) = expr; DEFUSR[n] = expr; DEFINT DEFSTR
DEFSNG DEFDBL letter ranges); `error` (ERROR expr); `raw` (DATA to the next
colon outside quotes; REM and `'` to the end); `disk` (OPEN FIELD GET PUT
CLOSE LOAD MERGE NAME KILL LSET RSET SAVE CLOAD CSAVE CMD: an expression list
with `,` `;` `AS` `FOR` keywords tolerated). Any other token at statement
start, any dangling operator, unbalanced parenthesis, unterminated string,
or unknown byte fails the line with a reason naming the byte offset.

## 5. Components and interfaces

### 5.1 `src/basic/lexer.ts`, `src/basic/parser.ts`

```ts
export type Expr =
  | { kind: 'num'; value: number } | { kind: 'str'; value: string } | { kind: 'var'; name: string; subscripts: Expr[] }
  | { kind: 'call'; fn: string; args: Expr[] } | { kind: 'unary'; op: '-' | 'NOT'; expr: Expr }
  | { kind: 'binary'; op: string; left: Expr; right: Expr } | { kind: 'fn'; name: string; args: Expr[] };
export type Statement =
  | { kind: 'assign'; name: string; subscripts: Expr[]; expr: Expr }
  | { kind: 'poke'; addr: Expr; value: Expr }
  | { kind: 'defusr'; n: number; expr: Expr }
  | { kind: 'other'; keyword: string };
export interface ParsedLine { ok: boolean; reason?: string; statements: Statement[] }
export function parseLine(body: Uint8Array): ParsedLine;   // body without its terminator; lexical failure ⇒ ok=false
```

`BasLine.parsed` now means "parses as BASIC" (lexical and grammatical); the
reason names the first failure.

### 5.2 `src/basic/entries.ts`

```ts
export type AbstractValue = { kind: 'const'; value: number } | { kind: 'base'; offset: number } | { kind: 'hi' | 'lo'; of: AbstractValue } | { kind: 'unknown' };
export interface MinedEntry { addr: number | null; evidence: string; line: number }   // addr null when unresolved
export function mineEntries(prog: BasProgram): MinedEntry[];
```

### 5.3 `src/basic/structure.ts`

```ts
export interface BasStructure { annotations: Annotations; texts: Map<number, string> }   // texts: body address → detokenized line
export function basStructure(prog: BasProgram): BasStructure;
```

Headers → `words` overrides of length 4; terminators → `bytes` of length 1;
parsed bodies → `bytes` of their length with the text attached; failing
bodies → `entries` at the body start.

### 5.4 Heuristics (`src/analysis/heuristics.ts`)

```ts
export function findStrings(image: MemoryImage, map: ByteMap): { addr: number; length: number }[];   // typed as Kind.String by the caller
export interface TableProposal { addr: number; count: number; hint: string }   // hint: the `block i:$off table n 2` line
export function proposeTables(image: MemoryImage, pass1: Pass1, identities: BlockIdentity[]): TableProposal[];
```

### 5.5 Quoted data (`src/emit/strings.ts`)

```ts
export function dbString(bytes: ArrayLike<number>): string;   // "\tDB\t'HELLO',0DH"
```

### 5.6 Rebasing (`src/bas-rebase.ts`, `src/hints/identity.ts`)

```ts
export function rebaseBas(bytes: Uint8Array, newBase: number): Uint8Array;   // same lines, pointers rewritten, header kept
export function blockIdentities(image: MemoryImage, normalize?: (bytes: Uint8Array, start: number) => Uint8Array): BlockIdentity[];
export function basIdentityNormalizer(prog: BasProgram): (bytes: Uint8Array, start: number) => Uint8Array;
```

The CLI and tests pass the normalizer for `.BAS` modules everywhere identities
are computed or matched. The listing marks an operand whose value lies in the
original program range with `; stale: original base $62C8`; the header says
`; rebased from $62C8 to $7000`.

### 5.7 Relocation (`src/analysis/relocate.ts`, `src/hints/*`)

```ts
export interface Relocation { fileAddr: number; length: number; runAddr: number }
export interface AnalysisSpace { image: MemoryImage; relocations: Relocation[]; toRun(fileAddr: number): number | null; toFile(runAddr: number): number | null }
export function analysisSpace(image: MemoryImage, relocations: Relocation[]): { space: AnalysisSpace; errors: string[] };
```

Hint directive `relocate <addr> <length>`; `Annotations.relocations`;
`applyHints` returns annotations with every address mapped to runtime space.
`analyze` builds the space, runs descent and symbols on `space.image`, and
`Analysis` carries `space`. The emitter walks file runs; at a relocated
region it emits `\t.PHASE\t<runAddr>`, the region's rows from the analysis
keyed by runtime address, and `\t.DEPHASE`. The listing shows runtime
addresses inside the region under `; relocated: file $80E1-$8160 executes at
$42F3-$4372`. The IR gains `relocations`.

### 5.8 `.BAS` listing and emission

`renderPass1Listing` for a `.BAS` analysis prints BASIC lines as `250 CLS:…`
and code lines as a block headed `; line 2: machine code, 41 bytes at $62D5`
followed by listing rows; mined entries appear in the header as
`; entry $62D6 (line 250: POKE 16421,195 with address program start + 14)`.
`emitZmac` for a `.BAS` emits `ORG base`, then per line: `DW ptr,number`,
the body (instructions, or `DB` bytes with `; 250 CLS:…`), `DB 00H`, and `END`.

### 5.9 CLI

`--rebase <hex>` (`.BAS` only; error otherwise); `--hints` with `relocate`
lines; the pass 1 listing becomes the default for a `.BAS` that contains any
code line or mined entry (the plain BASIC listing remains for programs with
neither, and under `--sweep`).

## 6. Data flow

```
.BAS bytes → loadBas → parseLine per line → BasProgram (parsed, reasons)
BasProgram → basStructure → annotations (headers, bodies, candidate roots) + texts
BasProgram → mineEntries → roots with evidence
hints → parseHints → applyHints (file offsets → runtime addresses via relocations)
file image + relocations → analysisSpace → space.image
roots + annotations → recursiveDescent(space.image) → Pass1
Pass1 → findStrings (typed) → proposeTables (reported) → synthesizeSymbols
→ emitZmac (file walk, .phase blocks, quoted strings) | renderPass1Listing | buildIr
```

## 7. Error handling

Parse failures are per line and never stop loading. Unresolved mined entries
are notes, not errors. A `relocate` whose destination overlaps loaded or
relocated memory, or whose source leaves the run, is a hint apply error (exit
2 in the CLI). `--rebase` on a non-`.BAS` is exit 2. A string or table
heuristic never overrides typed bytes or hints.

## 8. Testing

- Lexer and parser: every statement shape, expression precedence (`A+B*C`,
  `-A^2`, `NOT A=B`, `<>`), strings with embedded tokens and graphics bytes,
  DATA and REM raw regions, each failure class with its offset; the six-line
  fixture parses; the synthetic hidden-code fixture's raw line fails.
- Entry miner: `DEFUSR=&H6000`-style constants, USR-vector pokes, the
  `POKE a,195` triple with constants, Valkyrie's split expression across
  variables, an unresolved poke reported as a note.
- Structure: header/terminator/body typing on the six-line fixture; the
  hidden-code fixture's raw line becomes a root and decodes.
- `.BAS` listing and zmac: the hidden-code fixture renders mixed text and
  disassembly; its zmac output round-trips; the six-line fixture emits `DB`
  bodies with text comments.
- Heuristics: strings found with each terminator and not below four bytes;
  quoted `DB` with doubled quotes and hex for unprintables round-trips; a
  `string` hint renders quoted; table proposals on a synthetic image and on a
  `bytes`-typed region (none); proposals name the hint line.
- Rebase: pointers rewritten and the rebased program reloads with identical
  lines; identity equal before and after; a hint file written before applies
  after; stale operands marked; the rebased `.BAS` round-trips.
- Relocation: analysis space mapping and overlap errors; a synthetic `.CMD`
  whose code is copied elsewhere (a relocate hint) analyzes at the runtime
  address, emits `.phase`, and round-trips; symbols take runtime values.
- Valkyrie (skip when absent): lines 2–247 code, all others BASIC, for every
  file; `base+14` mined with evidence; zmac round trip with labels.
- Asylum (skip when absent): the generated `relocate` lines match the
  committed fixture; `$43AE` is a loaded runtime address; descent from it
  reaches a large fraction (recorded in the report); round trip holds.

## 9. Risks

- Parser gaps on real BASIC: a genuine line reported as code. Mitigation: the
  Valkyrie test over 76 BASIC lines, and the fixture corpus; a `code`/`bytes`
  hint overrides either way.
- zmac `.phase` semantics (labels, `JR` across the boundary) are verified in
  the harness before the emitter relies on them.
- Relocation of 123 records emits 123 `.phase` blocks; zmac handles that, but
  the source is long. Acceptable.
- Entry mining is idiom-based; programs using other tricks get a note and a
  `--entry`.

## 10. Sequencing

1. Lexer and parser with tests; `BasLine.parsed` switches to grammar validity.
2. Structure annotations, entry miner, `.BAS` listing and zmac emission, CLI
   default; Valkyrie acceptance.
3. Strings (typed and quoted) and table proposals; round trips re-proven.
4. Rebase: `rebaseBas`, normalized identity, stale marks, `--rebase`.
5. Relocation: analysis space, hint directive and mapping, emitter `.phase`,
   listing and IR; synthetic relocation fixture.
6. Asylum: generated relocate lines, fixture, acceptance; docs; report.

Natural session cuts: after step 2 and after step 4.
