# Phase 2C: Hidden Code, Heuristics, Rebasing, and Relocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Level II BASIC parser that separates BASIC lines from hidden machine code by statement validity, candidate code regions at their true addresses with mined entry points, `.BAS` listings and zmac output that round-trip, string typing and jump-table proposals, `.BAS` rebasing with stable hint identity, and relocation of file regions to runtime addresses emitted through zmac's `.phase`, proven on Valkyrie and Asylum.

**Architecture:** `src/basic/` turns line bodies into statements (lexer, shape-class parser, abstract evaluator) and into annotations the existing Pass 1 consumes (headers and BASIC bodies as data, code bodies and mined entries as roots). Heuristics run after descent on the kind map. Rebasing rewrites pointers in the file bytes; relocation builds an analysis image on which Pass 1 and Pass 2 run unchanged, while the emitter walks the file image and wraps relocated regions in `.phase`.

**Tech Stack:** as A and B.

**Spec:** `docs/superpowers/specs/2026-10-16-phase2c-hidden-code-heuristics-relocation-design.md` (binding).

## Global Constraints

- No Node or DOM APIs and no runtime dependencies in `packages/z80` and `packages/disasm` `src/`.
- Parse validity is statement-shape validity over one expression grammar (spec §4); the lexical check stays as the first stage and its reasons are kept.
- Code lines are candidate regions (roots), never forced code; headers are words, terminators bytes, BASIC bodies bytes with text attached (spec §3).
- Mined entries use only the plan's idioms, evaluated in the abstract domain {const, base+N, hi, lo, unknown}; anything else is a note (spec §3).
- Strings: at least four printable bytes ending in `0DH`/`03H`/`00H`, untyped memory only, found after descent; tables are proposed, never applied (spec §3).
- Quoted `DB` is byte-exact: `'` doubled, unprintables as hex (spec §3).
- `--rebase` rewrites pointers only; `.BAS` identity normalizes pointers; `.CMD` identity unchanged (spec §3).
- Relocation uses an analysis image; hints stay keyed by file offsets; a destination overlapping loaded or relocated memory is an error; the emitter uses `.phase`/`.dephase` (spec §3).
- Every round trip (fixtures, real samples, the 1786-encoding table) stays green at every task.
- Commits: imperative, one line, `p2:` prefix, no AI attribution trailers.

## Review Focus

1. A genuine BASIC line using a disk-BASIC statement or a quirky but legal form (`IF A GOTO 10`, `PRINT #1,"X";`, `ON ERROR GOTO 0`, `DEFINT A-Z`, `FOR I=A TO B STEP -1`) must parse; a code line whose bytes happen to spell a keyword must not. (Task 2)
2. Valkyrie's line 250 splits the address across `Q0`, `Q1`, and `INT`/`-` arithmetic before poking; the miner must still resolve `base+14` and name the line. (Task 3)
3. A BASIC body that contains bytes `C3 xx xx` inside a string literal must stay data; descent must never decode it because the body is typed before any root runs. (Task 3, Task 4)
4. A string candidate adjacent to typed data or crossing an instruction start must not be typed; a `string` hint always wins. (Task 5)
5. A `relocate` whose destination overlaps a loaded run, or two relocations whose destinations overlap, must be a hint error with exit 2, not a silent overwrite. (Task 7)

---

## File structure

```
packages/disasm/src/basic/lexer.ts            lexLine → Token[]
packages/disasm/src/basic/parser.ts           parseLine → ParsedLine, Statement/Expr AST
packages/disasm/src/basic/entries.ts          mineEntries, abstract evaluator
packages/disasm/src/basic/structure.ts        basStructure → annotations + texts
packages/disasm/src/bas.ts                    + grammar validity in `parsed`/`reason`
packages/disasm/src/analysis/heuristics.ts    findStrings, proposeTables
packages/disasm/src/emit/strings.ts           dbString
packages/disasm/src/bas-rebase.ts             rebaseBas
packages/disasm/src/hints/identity.ts         + normalizer parameter, basIdentityNormalizer
packages/disasm/src/analysis/relocate.ts      analysisSpace, Relocation, AnalysisSpace
packages/disasm/src/hints/format.ts, apply.ts + `relocate` directive and runtime mapping
packages/disasm/src/pipeline.ts               + .BAS structure/entries, heuristics, space
packages/disasm/src/emit/zmac.ts              + quoted strings, .phase blocks
packages/disasm/src/listing.ts                + .BAS mixed listing, proposals, stale marks, relocated sections
packages/disasm/src/ir.ts                     + proposals, relocations, entries
packages/cli/src/index.ts                     + --rebase, .BAS default
packages/disasm/test/basic/*.test.ts, test/analysis/heuristics.test.ts, test/bas-rebase.test.ts, test/analysis/relocate.test.ts
packages/disasm/test/real/valkyrie.test.ts, test/real/asylum-relocate.test.ts, test/real/rom.test.ts
packages/disasm/test/real/asylum-relocations.ts   generator for the relocate lines
fixtures/synthetic/cmd/relocated-code.cmd, fixtures/synthetic/hints/relocated-code.hints
fixtures/hints/asylum16.hints                 regenerated with relocate lines
```

---

### Task 1: Lexer

**Files:** `src/basic/lexer.ts`, `test/basic/lexer.test.ts`

```ts
export type Token =
  | { t: 'kw'; name: string; at: number }          // keyword token byte, by TOKENS name
  | { t: 'id'; name: string; at: number }          // identifier incl. type suffix, upper-cased
  | { t: 'num'; text: string; value: number; at: number }
  | { t: 'str'; value: Uint8Array; at: number }    // bytes between quotes
  | { t: 'punct'; ch: ':' | ',' | ';' | '(' | ')' | '#'; at: number }
  | { t: 'raw'; bytes: Uint8Array; at: number };   // DATA item text or REM/' tail
export interface LexResult { tokens: Token[]; error?: { at: number; message: string } }
export function lexLine(body: Uint8Array): LexResult;   // body without terminator
```

Rules: spaces outside strings are skipped; `3A 95` yields `kw ELSE`; `3A 93 FB` yields `kw '` followed by one `raw`; after `REM`/`'` the rest is one `raw`; after `DATA` the text to the next `:` outside quotes is one `raw` (then lexing resumes); bytes `FC`–`FF` outside literals and control bytes outside literals are errors with the offset (same messages as the phase-1 lexical check, which this replaces inside `detokenize`'s `ok` logic); a string may run to the end of the line, as Level II allows.

- [ ] Tests: `PRINT"HI"`, `FOR I=1 TO 10`, `X=PEEK(16548)+256*PEEK(16549)`, numbers `1 2.5 1E3` (Task 2 adds Disk BASIC's `&H`/`&O`; any other `&` lexes as an error), identifiers `A A$ AB% Q0`, `ELSE` and `'` encodings, DATA raw with quoted colon, REM raw, each error class. RED → implement → GREEN → commit `p2: add the Level II BASIC lexer`.

---

### Task 2: Parser and grammar validity

**Files:** `src/basic/parser.ts`, `src/bas.ts` (uses `parseLine` for `parsed`/`reason`), `test/basic/parser.test.ts`, `test/bas.test.ts` (reasons may change for grammar failures)

AST and `parseLine` per spec §5.1. Expression parser: precedence climbing per spec §4. Statement dispatcher: a table `SHAPES: Record<keyword, Shape>` where `Shape` is one of `none | optnum | linelist | onlist | print | input | varlist | twoexpr | setpoint | assign | for | next | if | deffn | defusr | deftype | error | raw | disk`, each a small function over the token stream returning a `Statement`. Statements separate on `:`; `IF` consumes `THEN`/`GOTO` then either a line number or statements to `ELSE`/end; `ELSE` likewise.

- [ ] Tests (RED first): one accepted example per shape, the Review Focus 1 forms, `IF A THEN 10 ELSE PRINT"X"`, `IF A GOTO 10`, `ON X GOSUB 100,200`, `DEFUSR1=24576` and `DEFUSR=&H7000` (Disk BASIC constants parse), `PRINT@512,"X"`, `POKE 16421,195:POKE16422,Q0`, `A(I,J)=B*2^-1`, `NOT A=B`, `A<>B`, nested parentheses, `PRINT TAB(5);"X",Y;`, `LPRINT USING"##";X`, disk statements; failures: dangling `+`, `GOTO` without number, `FOR I=1`, `)` extra, two values with no operator (`A B`), keyword in operand position (`A=FOR`), string where a number is required is *accepted* (types are not checked). Each failure's reason names the offset. The six-line fixture parses; the Valkyrie-style code line `44 79 FE 0D C8 2A A4 40` fails. `loadBas` reports grammar reasons for lines that pass the lexical stage and fail the grammar.
- [ ] Implement, GREEN, full suite, commit `p2: parse Level II BASIC statements; grammar validity decides hidden code`.

---

### Task 3: Structure annotations and entry mining

**Files:** `src/basic/structure.ts`, `src/basic/entries.ts`, `test/basic/structure.test.ts`, `test/basic/entries.test.ts`

`basStructure(prog)`: overrides per line (`words` 4 at `addr`, `bytes` 1 at the terminator, parsed body → `bytes` of body length minus terminator, failing body → `entries` at `bodyAddr`); `texts` maps parsed body addresses to `N text`.

`mineEntries(prog)`: walk parsed lines in file order; maintain `vars: Map<name, AbstractValue>`; evaluate `assign` statements; collect `poke` statements with evaluated address and value, and `defusr`. Evaluator rules (spec §3): `PEEK(16548)` → `lo(base+0)`, `PEEK(16549)` → `hi(base+0)`; `lo(X) + 256*hi(X)` (any operand order) → `X`; `X ± const` → base offset shifted; `INT(X/256)` → `hi(X)`; `X - hi(X)*256` → `lo(X)`; `const op const` folds; else `unknown`. Entries: `defusr` with resolvable value; pokes at 16526 and 16527 forming lo/hi of one value; `poke a,195` with pokes at `a+1`/`a+2` forming lo/hi of one value (constants or `base+N`). Evidence strings: `line 250: POKE 16421,195 with address program start + 14`. Unresolved idioms give `{ addr: null, evidence }`.

- [ ] Tests: structure on the six-line and hidden-code fixtures (kinds and texts); miner on synthetic programs built with `writeBasic`: `DEFUSR=24576`; `POKE 16526,0:POKE 16527,96`; `POKE 30000,195:POKE 30001,0:POKE 30002,96`; the Valkyrie line 250 text verbatim (`CLS:Q0=PEEK(16549)*256+PEEK(16548)+14:Q1=INT(Q0/256):Q0=Q0-Q1*256:POKE16422,Q0:POKE16423,Q1:POKE16421,195`) → `base+14`; an unresolved `POKE 16421,195` alone → note. RED → implement → GREEN → commit `p2: type BASIC structure and mine planted entry points`.

---

### Task 4: `.BAS` analysis, listing, emission, CLI default; Valkyrie acceptance

**Files:** `src/pipeline.ts`, `src/listing.ts`, `src/emit/zmac.ts` (BASIC body comments come from `annotations.comments` filled with `texts`), `src/ir.ts` (`entries: MinedEntry[]`), `packages/cli/src/index.ts`, `test/pass1-listing.test.ts`, `test/roundtrip/fixtures.test.ts` (BAS fixtures now analyzed with structure), `test/real/valkyrie.test.ts`

`analyze` for a `.BAS` module: merge `basStructure` annotations and `texts` (as comments) with hint annotations (hints win on conflict: a hint `code`/`bytes` on a line body overrides the structure's typing), add mined entries to roots after `--entry` and hint entries, and carry `entries` on `Analysis`. Listing: for a `.BAS`, iterate lines: parsed → `N text`; failing → `; line N: machine code, K bytes at $XXXX` then rows for the body range; header gains `; code lines: 181; entries mined: 1` and one `; entry $62D6 (line 250: …)` per mined entry. CLI: pass 1 listing is the default for a `.BAS` with any failing line or mined entry.

- [ ] Tests: hidden-code fixture listing shows line 10 as text, line 20 as rows at `$700D`, line 30 as text; its zmac output has `DW 7009H,000AH` … and round-trips; the six-line fixture's zmac has `DB` bodies with `; 10 CLS:…` comments and round-trips; Valkyrie (skip when absent): for each file, failing lines are exactly those numbered 2–247, one mined entry `base+14` with the line-250 evidence, zmac round trip with labels, and the listing contains `; line 2: machine code`.
- [ ] RED → implement → GREEN (full suite) → commit `p2: list and emit .BAS programs with their hidden code at true addresses`.

---

### Task 5: Strings and table proposals

**Files:** `src/analysis/heuristics.ts`, `src/emit/strings.ts`, `src/emit/zmac.ts`, `src/listing.ts`, `src/ir.ts` (`proposals`), `src/pipeline.ts`, `test/analysis/heuristics.test.ts`, `test/emit-strings.test.ts`, round-trip tests re-run

`findStrings`: scan untyped runs; a candidate is ≥ 4 bytes in `20H`–`7EH` immediately followed by `0DH`/`03H`/`00H` (the terminator included in the string); never crosses an instruction start, a typed byte, a symbol, or a run end. `dbString(bytes)` → `\tDB\t'HELLO',0DH` with `'` doubled and non-printables as hex items, max 8 items of mixed form or one quoted run plus terminator per row. `proposeTables`: in untyped runs, ≥ 3 consecutive LE words each equal to an instruction start → `{ addr, count, hint }` with `hint` = `block i:$off table n 2` using identities. Listing header: `; proposed table at $XXXX, 5 entries, all in code; declare with: block 0:$1234 table 5 2`; IR `proposals`. Emitter and listing render `Kind.String` rows quoted (also for `string` hints).

- [ ] Tests: each terminator; 3 printable bytes not typed; a candidate touching an instruction start or typed byte not typed; a `string` hint wins; `dbString` on `IT'S`, bytes `80H`, and a 20-byte text (row splitting); zmac round trip of a quoted string with `'` and a `0DH` (harness); proposals on a synthetic image and none on a `bytes` region; the full fixture and real round trips still pass with strings quoted.
- [ ] RED → implement → GREEN → commit `p2: type strings and emit them quoted; propose jump tables`.

---

### Task 6: Rebasing

**Files:** `src/bas-rebase.ts`, `src/hints/identity.ts`, `src/listing.ts` (stale marks, header), `packages/cli/src/index.ts` (`--rebase`), `test/bas-rebase.test.ts`, `test/hints/identity.test.ts`, `packages/cli/test/cli.test.ts`, `test/real/valkyrie.test.ts` (rebase proof)

`rebaseBas(bytes, newBase)`: load, rewrite each line's pointer to `newBase + (ptr - base)`, keep the header byte, return new bytes. `blockIdentities(image, normalize?)` applies `normalize(bytes, start)` to the 64-byte window; `basIdentityNormalizer(prog)` replaces each pointer in the window by `ptr - base` (little-endian). The CLI passes the normalizer for `.BAS` in `--write-hints` and `--hints`. Stale marks: when `Analysis.rebasedFrom` is set, operands (`imm16`, `mem`) with values inside the original program range get `; stale: original base $XXXX`; header line `; rebased from $62C8 to $7000`.

- [ ] Tests: rebase the six-line fixture from `$62C8` to `$7000` and compare lines and texts with the `prog-7000` fixture byte for byte; identity equal across the two; hints written for one apply to the other with zero unmatched; a hidden-code fixture rebased shows the stale mark on its `JP 0000H`? (use a fixture whose code references its own body: add `hidden-code-ref` with `21 0D 70` `LD HL,700DH`); CLI `--rebase 7000` output and `--rebase` on a `.CMD` exits 2; Valkyrie: hints written against valkyri1 apply to it rebased to `$7000` (skip when absent).
- [ ] RED → implement → GREEN → commit `p2: rebase .BAS programs with stable hint identity and stale-reference marks`.

---

### Task 7: Relocation

**Files:** `src/analysis/relocate.ts`, `src/hints/format.ts` (`relocate <addr> <length>`), `src/hints/apply.ts` (`relocations`, runtime mapping), `src/pipeline.ts` (`space`), `src/emit/zmac.ts` (`.phase`), `src/listing.ts`, `src/ir.ts`, `test/analysis/relocate.test.ts`, `test/hints/*.test.ts`, `test/roundtrip/harness.test.ts` (`.phase` probe), `test/fixtures.ts` (`relocated-code` fixture + hints), `test/roundtrip/hints.test.ts`

`analysisSpace(image, relocations)`: validate (source inside one run; destination not overlapping loaded memory outside the sources, nor another destination); build a new `MemoryImage` from the file image's runs minus the source ranges, then load each source's bytes at its destination; `toRun`/`toFile` by range lookup. `applyHints` collects `relocate` hints first, then maps every other hint's address through `toRun` (a hint inside a relocated source refers to the runtime copy). `analyze` builds the space, runs descent on `space.image`, and passes `space` to the emitter and listing. Emitter: walk the *file* image runs; at a source range start emit `\t.PHASE\t${hexWord(runAddr)}`; rows come from the analysis at runtime addresses with bytes from the file; at the range end emit `\t.DEPHASE`; symbols and operands use runtime addresses throughout. Listing: section header `; relocated: file $80E1-$8160 executes at $42F3-$4372`, rows show runtime addresses. IR: `relocations`, regions in runtime space.

- [ ] Tests: harness probe (`.phase 5000h` label value and `jr` inside a phase block assemble as zmac documents); space mapping, source outside a run, destination overlaps (Review Focus 5); `relocate` parses and the writer emits it; the `relocated-code` fixture (code at `$8000` executing at `$5000`, with a `CALL` and a `JR` inside, a label referenced from outside) analyzes at `$5000`, emits `.PHASE`, and round-trips; listing and IR shapes.
- [ ] RED → implement → GREEN → commit `p2: analyze relocated regions at their runtime address and emit them with .phase`.

---

### Task 8: Asylum, the ROM smoke test, docs, report

**Files:** `test/real/asylum-relocations.ts`, `test/real/asylum-relocate.test.ts`, `fixtures/hints/asylum16.hints`, `test/real/rom.test.ts`, `CHANGELOG.md`, `README.md`, `docs/Fugloy-Project-Plan.md`

- [ ] Generator: from the asylum16 image, walk the stream at `$80DD` and emit one `block 0:$<src> relocate $<dest> $0080` per `<` record (source offset = record data start − `$8000`), plus `block 0:$<off> entry` for `$43AE` mapped back to its file offset. Regenerate `fixtures/hints/asylum16.hints` keeping the existing names and comments and replacing the `bytes` override by the relocate lines. Test: generator output equals the fixture's relocate/entry lines (skip when absent).
- [ ] Acceptance: with the fixture applied, `$43AE` is loaded in the space, descent from it decodes code (record the instruction count and fraction in the report), the zmac output contains 123 `.PHASE` blocks, and the file-image round trip holds.
- [ ] ROM smoke test (skip when `fixtures/real/level2-model1.rom` is absent): load raw at `$0000`, roots at the documented entries (`$0000`, `$0008`, `$0010`, `$0018`, `$0020`, `$0028`, `$0030`, `$0038`, `$001B`, `$0033`, `$0049`, `$1A19`), assert each decodes as code and descent reaches at least 40% of the image; round trip.
- [ ] Docs: CHANGELOG Unreleased (C items), README (hidden code, `--rebase`, `relocate`, strings/proposals), project plan: mark the phase 2 deliverable met and note the self-relocating-loader finding under the Asylum appendix rows as a reported fact. Full suite, typecheck, build. Report.
