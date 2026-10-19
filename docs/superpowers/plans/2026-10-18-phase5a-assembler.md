# Phase 5A (the Assembler) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@fugloy/asm` assembles Z80 source to a TRS-80 memory image, entry, symbol table, source map, and `.CMD`, with plain-sentence diagnostics on the right line, ROM routines by name, and byte-for-byte agreement with zmac across the disassembler's whole round-trip corpus.

**Architecture:** A new package `packages/asm` (TypeScript strict, ESM, browser-safe like disasm). The encoder is an index built at module load by inverting `@fugloy/z80`'s generated `TABLES` (mnemonic + operand shapes → prefix, opcode, operand order), so lengths are exact and encoder and decoder cannot disagree. A hand-written lexer and parser keep line:column spans for the IDE; two passes resolve forward references; output fills a `MemoryImage` and goes through `writeCmd`. zmac is the referee: the disassembler's round-trip harness runs both assemblers on every source it assembles.

**Tech Stack:** TypeScript, Vitest, zmac (pinned, `pnpm zmac:install`) as the oracle.

**Spec:** `docs/superpowers/specs/2026-10-18-phase5-assembler-ide-design.md` (Decisions; sub-project 5A); `docs/Fugloy-Project-Plan.md` phase 5. Recon behind the decisions: the emitter's constructs (`packages/disasm/src/emit/zmac.ts`), the zmac harness (`packages/disasm/test/roundtrip/zmac.ts`, `assemble()`), the corpus (`roundtrip/table.test.ts`'s 1,786-encoding file, `fixtures.test.ts`, `hints.test.ts`, `symbols-roundtrip.test.ts`, `real.test.ts` — 83 real programs locally, 25 in CI from `examples/`).

## Global Constraints

- `packages/asm`: no DOM, no Node APIs, no runtime dependencies other than `@fugloy/z80` and `@fugloy/disasm` (`workspace:^`). Dev dependencies are fine.
- Opcode decisions come only from `@fugloy/z80`'s generated tables; nothing hand-tabulated. If an encoding is wrong, fix the inversion (or the generator and its exhaustion test), never patch a byte.
- Never produce bytes for a line that has an error; an error-free result is the only one with an image.
- Diagnostics are sentences that name the problem and, where possible, the fix; each has `line` (1-based), `column`, `endColumn`, `severity` (`error` | `warning` | `info`).
- Addresses in prose `$3C00`, in emitted text `3C00H` (CLAUDE.md conventions).
- Commit messages: imperative, one line, prefix `p5:`. No `Co-Authored-By` or any AI trailer.
- Keep `docs/Fugloy-Project-Plan.md` (phase 5 status), `CLAUDE.md`, `CHANGELOG.md` (detailed, under [Unreleased] for the next core release), and the root README current; add `packages/asm/README.md`.

## Rulings made while planning

1. **Build, don't adopt** `cschweda/z80-assembler` (recon 2026-10-18: silent miscompiles, no IX/IY, one ORG, a committed ROM). Its 27 example programs may be used as a test corpus only after zmac re-verifies their bytes; none of its code or `roms/`.
2. **Release with core** (z80, disasm, cli, asm at one version) — it depends on disasm's tables and writer and the CLI gains `asm`.
3. **No macros, INCLUDE, or conditionals** in 5A (spec non-goals).
4. **No ORG → `$5200`** with an `info` diagnostic; **no END entry → `entry: null`** (zmac's behaviour; the IDE runs from the first byte).
5. **ROM names:** the chosen model's ROM table names (and, with `dos`, that DOS's) are predefined at lowest priority: a user definition of the same name wins with no message; an undefined name that matches a table entry resolves to it. The emitter's EQUs redefine them with the same value, which must not be an error.

## Review Focus

1. A memory operand vs an immediate (`LD A,(3C00H)` vs `LD A,3C00H & 0FFH` vs `LD A,(5)+1`) must follow zmac's rule exactly (Task 2 test against zmac probes) — the failure that disqualified the old assembler.
2. Forward references that change an instruction's form must not exist (lengths come from the template), but a forward `EQU` used in `DS` or `ORG` must be a clear error, not a silent zero (Task 2/3 tests).
3. Every out-of-range value (`JR`/`DJNZ` beyond −128..127, `n` beyond −128..255, `(IX+d)` beyond −128..127, `RST` not a multiple of 8, `IM` not 0–2, `BIT` not 0–7) is an error naming the value and the limit, never a truncated byte (Task 2 tests).
4. Two `ORG`s that overlap, and `.PHASE` code, must give the same image and runtime labels as zmac (Task 3 tests against zmac).
5. A typo (`LDA 5`, `JMP X`, `CALL CLS` with no such ROM name) gives one error on that line with a suggestion, and assembly of the rest continues so every error shows at once (Task 2/5 tests).

---

### Task 1: The package and the table-driven encoder

**Files:** Create `packages/asm/{package.json,tsconfig.json,vitest config as the other packages do}`, `src/index.ts`, `src/encode.ts`, `src/shape.ts`; tests `packages/asm/test/encode.test.ts`. Wire into the workspace (root `tsconfig` references, `pnpm typecheck`, `pnpm test`).

**Interfaces (produces):**
- `type Shape` — an operand's shape: a register (`A`…`L`, `I`, `R`, `IXH`…), a pair (`BC`, `DE`, `HL`, `SP`, `AF`, `AF'`, `IX`, `IY`), a condition, `(HL)`/`(BC)`/`(DE)`/`(SP)`/`(C)`/`(IX)`/`(IY)`, `n`, `nn`, `(nn)`, `(n)`, `e`, `(IX+d)`/`(IY+d)`, or a fixed number (bit, RST, IM).
- `encode(mnemonic: string, operands: { shape: Shape; value?: number }[], pc: number): { bytes: number[] } | { error: string }` — `pc` is the instruction's runtime address (for `e`). Errors are sentences (range errors, "LD has no form A,(BC)+… ").
- `lengthOf(mnemonic, shapes): number | null` — from the template, for pass 1.
- `forms(mnemonic): string[]` — every legal operand form as text, for suggestions.

- [ ] Steps: failing tests — `decodeAt(encode(x))` round-trips every one of the 800 non-`DB` templates in all seven tables with representative values (including DDCB/FDCB displacement order); `LD (nn),HL` → `22`, `LD HL,(nn)` → `2A`; range errors for each of Review Focus 3's limits; `lengthOf` equals `template.length` for every form. Run (fail), implement, run (pass), commit `p5: add @fugloy/asm with an encoder built from the z80 tables`.

### Task 2: Lexer, parser, expressions, and two passes

**Files:** `src/lex.ts`, `src/parse.ts`, `src/expr.ts`, `src/assemble.ts`; tests `test/syntax.test.ts`, `test/expr.test.ts`, `test/diagnostics.test.ts`, `test/zmac-probes.test.ts` (zmac-gated via the disasm harness's `findZmac`/`skipIfNoZmac`, imported or copied into an asm test helper).

**Interfaces (produces):** `assemble(source: string, options?: { model?: 1 | 3 | 4; dos?: string }): AsmResult` where `AsmResult = { ok: boolean; image: MemoryImage | null; entry: number | null; symbols: Map<string, { value: number; line: number; kind: 'label' | 'equ' | 'defl' | 'rom' }>; sourceMap: { lineOf(address: number): number | null; addressesOf(line: number): number[] }; listing: { line: number; address: number | null; bytes: number[]; text: string }[]; diagnostics: Diagnostic[] }`.

- [ ] Steps: failing tests — the spec's syntax list (labels with colon anywhere / without in column 1, case rules decided by a zmac probe, every number form, `'A'`, `''` in strings, comments); zmac operator precedence, `HIGH`/`LOW`, `$`; Review Focus 1 (each case assembled by zmac in the probe test and by `assemble`, same bytes); Review Focus 3 and 5 messages (exact sentences in the test, e.g. `JR reaches 128 bytes either way; LOOP is 300 bytes back. Use JP.`, `Unknown instruction LDA. Did you mean LD A,…?` from edit distance over mnemonics, `JMP` → `JP`); errors on several lines all reported; an undefined symbol names itself; a duplicate label names both lines. Run, implement, run, commit `p5: parse Z80 source and resolve it in two passes with errors on the right line`.

### Task 3: Directives, the image, the source map, and `.CMD`

**Files:** `src/directives.ts`, `src/output.ts` (`toCmd`), extend `assemble.ts`; tests `test/directives.test.ts`, `test/output.test.ts`.

**Interfaces (produces):** `toCmd(result: AsmResult, options?: { name?: string }): Uint8Array` (via `writeCmd`; throws a sentence if `!result.ok`). Source map keys are runtime addresses (under `.PHASE`, the phase address), and the listing shows both.

- [ ] Steps: failing tests — `ORG` (several, gaps, overlap is a warning naming both lines, with the image zmac gives (later bytes win)), `EQU`, `DEFL`/`=` redefinition, `DB`/`DEFB`/`DEFM` (strings and expressions mixed), `DW`/`DEFW`, `DS`/`DEFS` (with fill), `.PHASE`/`.DEPHASE` (Review Focus 4 against zmac), `END` with and without an entry, text after `END` ignored as zmac does; Ruling 4 defaults; Review Focus 2; `toCmd` output reloads through `loadCmd` to the same image and entry; the source map round-trips for every emitted byte. Run, implement, run, commit `p5: assemble directives, phased code, and .CMD output with a source map`.

### Task 4: zmac as referee across the corpus

**Files:** `packages/disasm/test/roundtrip/zmac.ts` (make `assemble()` also run `@fugloy/asm` and assert the same 64K image, loaded bitmap, runs, and entry — `@fugloy/asm` becomes a disasm devDependency; mind the cycle: asm depends on disasm at runtime, disasm on asm only in tests), a corpus script `packages/asm/scripts/corpus.mjs` (`pnpm asm:corpus`: every real program in `examples/`, `fixtures/real/`, `sample/` disassembled, emitted, assembled by both, compared; prints a table); tests `packages/asm/test/negative.test.ts` (sources zmac rejects are rejected too, zmac-gated).

- [ ] Steps: wire the hook so `table.test.ts` (1,786 encodings), `fixtures.test.ts`, `hints.test.ts`, `symbols-roundtrip.test.ts`, `real.test.ts`, `rom.test.ts`, and every other `assemble(` caller check both; fix every mismatch in asm (never by special-casing a test); run `pnpm asm:corpus` locally over all 83 real programs: zero mismatches, counts recorded; verify in a ROM- and sample-free worktree that CI-visible tests pass; commit `p5: check @fugloy/asm against zmac on every round-trip source`.

### Task 5: ROM names, the Model I/III warning, friendly messages, the CLI, and docs

**Files:** `src/symbols.ts` (from disasm's symbol tables/select API for the model and DOS), extend `assemble.ts`; `packages/cli/src` (`fugloy asm <source> [-o out.cmd] [--model 1|3|4] [--listing]`, exit code 1 on errors, diagnostics as `file:line:col: severity: message`); a starter program `packages/asm/examples/clear-screen.z` (fills video RAM `$3C00–$3FFF` with spaces and loops, commented line by line in plain words) with a test that it assembles and, through `@fugloy/emu` as a devDependency, leaves the screen blank on a synthetic or gated real ROM; docs.

- [ ] Steps: failing tests — `CALL` of a ROM name resolves per model (Ruling 5, including the emitter-EQU redefinition case); a user label shadows a ROM name silently; a warning when an instruction uses an address the two ROMs' tables classify as different (e.g. `CALL 0060H` on model 3: names both ROMs' meaning); `CALL CLSS` suggests the nearest ROM name; the CLI's output format and exit codes; the starter test. Run, implement, run (`pnpm typecheck && pnpm test && pnpm test:web`, `pnpm asm:corpus`), docs (`packages/asm/README.md` with the syntax, messages, and API; root README "The assembler" section; CHANGELOG; CLAUDE.md layout and current phase; the plan's phase 5 status), commit `p5: name ROM routines, warn on Model I/III differences, and add fugloy asm` and `p5: document the assembler`.
