# Phase 2B: Labels and the Hint File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A line-oriented hint file with content-based block identity, annotations that drive Pass 1 (overrides, `nocode`, declared jump tables), Pass 2 symbol synthesis with user names, and labels in the emitter, listing, IR, and CLI, with every round trip re-proven with labels on and hints shown to survive relocation.

**Architecture:** `src/hints/` turns hint text into an address-keyed `Annotations` value by matching hint blocks to image runs by `(length, hash)`; descent consumes annotations before it starts; `src/analysis/symbols.ts` derives a `SymbolTable` from Pass 1 plus annotations; a shared operand renderer puts symbol names into both the zmac source and the listing. Nothing in the passes knows the file format.

**Tech Stack:** as sub-project A (TypeScript strict ESM, Vitest, `@fugloy/z80`, pinned zmac harness); a pure-TypeScript SHA-256 in `disasm`.

**Spec:** `docs/superpowers/specs/2026-10-15-phase2b-labels-hints-design.md` (binding), under `docs/Fugloy-Project-Plan.md` ("Pass 2", "Hint file") and `CLAUDE.md`.

## Global Constraints

- No Node or DOM APIs and no runtime dependencies in `packages/z80` and `packages/disasm` `src/` (CLAUDE.md); SHA-256 is therefore implemented in TypeScript.
- Hint-file format is line-oriented text keyed by `block <index>:<offset>`; not JSON (CLAUDE.md, plan).
- Block identity is `(length, hash)` with `hash` = first 16 hex digits of SHA-256 over the run's first 64 bytes; ties broken by index order (spec §3).
- Numbers in hint text: `$hex`, `hexH`, `0xhex`, or decimal; never bare hex (spec §3).
- Overrides win: applied before descent; `nocode` ends paths; tables seed roots; width-1 tables rejected (spec §3).
- Data references: `LD BC|DE|HL|IX|IY,nn` immediates and `(nn)` memory operands in loaded memory; `LD SP,nn` and ports are constants (spec §3).
- Kind precedence at one address: `SUB_` > `L` > `TBL_` > `DATA_`; user names replace the name and keep the kind (spec §3).
- User names: `[A-Za-z_][A-Za-z0-9_]{0,31}`, not reserved (Z80 mnemonics, registers, conditions, zmac directives), not of the synthesized shape `^(L|SUB_|DATA_|TBL_)[0-9A-F]{4}$` (so they cannot collide with a synthesized label elsewhere), unique per address.
- Round trips compare images and bitmaps; every fixture and real sample re-proven with symbols on; the table-wide encoding test unchanged.
- Loaders and phase-1 behavior unchanged; `fugloy <file>` without hints behaves as in A except that synthesized labels now appear in `zmac` output and the listing.
- Commits: imperative, one line, `p2:` prefix, no AI attribution trailers.

## Review Focus

1. A `bytes` override placed on a byte that descent would otherwise decode as code: descent must treat it as data (the jump into it is `in-data`) and the emitter must emit `DB`, not the instruction. (Task 4, Task 6)
2. A `name` hint on an address inside an instruction: the symbol must emit as `EQU`, never as a `NAME:` line that would shift bytes, and the round trip must hold. (Task 6)
3. Two symbols at adjacent addresses inside one unknown run: DB rows must split so each `NAME:` precedes exactly its own address. (Task 6)
4. A hint file whose blocks match by `(length, hash)` but whose program hash differs (the relocated build): applied with a warning, addresses computed from the matched run's start. (Task 3, Task 8)
5. A user name equal to a zmac directive or mnemonic in another case (`org`, `Call`): rejected at parse time with the line number. (Task 2)

---

## File structure

```
packages/disasm/src/hash.ts                    sha256, sha256Hex
packages/disasm/src/hints/identity.ts          blockIdentities, programHash
packages/disasm/src/hints/format.ts            parseHints, writeHints, isValidName, RESERVED
packages/disasm/src/hints/apply.ts             applyHints, Annotations, emptyAnnotations
packages/disasm/src/analysis/map.ts            + mark(addr, length, kind)
packages/disasm/src/analysis/descent.ts        + annotations: overrides, nocode, tables, code length
packages/disasm/src/analysis/symbols.ts        SymbolTable, synthesizeSymbols
packages/disasm/src/emit/operands.ts           renderOperands
packages/disasm/src/emit/zmac.ts               + symbols, EQU, DW, label lines, comments
packages/disasm/src/pipeline.ts                + annotations, symbols
packages/disasm/src/listing.ts                 + label lines, hint header, comments
packages/disasm/src/ir.ts                      + symbols, hints
packages/disasm/src/index.ts                   exports
packages/disasm/test/hash.test.ts
packages/disasm/test/hints/identity.test.ts
packages/disasm/test/hints/format.test.ts
packages/disasm/test/hints/apply.test.ts
packages/disasm/test/analysis/descent-hints.test.ts
packages/disasm/test/analysis/symbols.test.ts
packages/disasm/test/emit-symbols.test.ts
packages/disasm/test/fixtures.ts               + CMD_FIXTURES['hint-paths'], HINT_FIXTURES
packages/disasm/scripts/write-fixtures.ts      + fixtures/hints/*.hints
packages/disasm/test/roundtrip/fixtures.test.ts, real.test.ts   symbols on
packages/disasm/test/roundtrip/hints.test.ts   hint-paths fixture round trip
packages/disasm/test/real/hints.test.ts        rebasing proof, asylum16 acceptance
packages/cli/src/index.ts                      --hints, --write-hints
fixtures/hints/hint-paths.hints                generated
fixtures/hints/asylum16.hints                  hand-written (offsets, identities only)
```

---

### Task 1: SHA-256 and block identity

**Files:**
- Create: `packages/disasm/src/hash.ts`, `src/hints/identity.ts`, `test/hash.test.ts`, `test/hints/identity.test.ts`

**Interfaces (produces):**

```ts
export function sha256(bytes: Uint8Array): Uint8Array;   // 32 bytes
export function sha256Hex(bytes: Uint8Array): string;    // 64 lowercase hex digits
export interface BlockIdentity { index: number; start: number; length: number; hash: string }
export function blockIdentities(image: MemoryImage): BlockIdentity[];
export function programHash(bytes: Uint8Array): string;
export const IDENTITY_BYTES = 64;
```

- [ ] **Step 1: Failing tests.**

```ts
// hash.test.ts
import { createHash } from 'node:crypto';
it('matches the FIPS vectors', () => {
  expect(sha256Hex(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
it('matches node:crypto on lengths around block boundaries', () => {
  for (const n of [55, 56, 63, 64, 65, 119, 120, 1000, 20297]) {
    const data = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff);
    expect(sha256Hex(data)).toBe(createHash('sha256').update(data).digest('hex'));
  }
});
// identity.test.ts
it('identifies each run by index, start, length, and a 16-digit hash of its first 64 bytes', () => {
  const img = image({ 0x6000: pattern(100), 0x7000: [1, 2, 3] });
  const ids = blockIdentities(img);
  expect(ids.map((b) => [b.index, b.start, b.length, b.hash.length])).toEqual([[0, 0x6000, 100, 16], [1, 0x7000, 3, 16]]);
  expect(ids[0]!.hash).toBe(sha256Hex(Uint8Array.from(pattern(64))).slice(0, 16));
  expect(ids[1]!.hash).toBe(sha256Hex(Uint8Array.from([1, 2, 3])).slice(0, 16));
});
it('gives relocated builds the same identity', () => { /* asylum1b/1c/1d main run equal (length, hash); asylum1e/asylum32/asylumd main run equal; skip when absent */ });
```

- [ ] **Step 2: RED. Step 3: implement** (standard SHA-256: 64 round constants, message schedule with `Math.imul`/`>>>`, padding to 56 mod 64 with a 64-bit big-endian length; `blockIdentities` from `image.runs()`). **Step 4: GREEN; typecheck. Step 5: commit** `p2: add SHA-256 and block identity`.

---

### Task 2: Hint file parser and writer

**Files:**
- Create: `src/hints/format.ts`, `test/hints/format.test.ts`

**Interfaces (produces):** as spec §5.3, plus `export const RESERVED: ReadonlySet<string>` (upper-case) built from every mnemonic in `TABLES` of `@fugloy/z80` plus registers, conditions, and zmac directives, and `export const SYNTH_NAME = /^(L|SUB_|DATA_|TBL_)[0-9A-F]{4}$/`.

Number syntax: `$1A2F`, `1A2FH`, `0x1a2f`, `4660`. Offsets, lengths, counts, widths are unsigned integers; counts and widths decimal in the writer.

- [ ] **Step 1: Failing tests** (one per rule):

```ts
const ok = (text: string) => { const r = parseHints(text); expect(r.errors).toEqual([]); return r.file; };
it('parses the header, identities, and every directive', () => {
  const f = ok(`# comment\nfugloy-hints 1\nprogram sha256 ${'a'.repeat(64)}\nblock 0 length $4F49 hash 7f83b1657ff1fc53 # start $6300\nblock 1 length 2 hash 2c26b46b68ffc68f\n` +
    `block 0:$0000 entry\nblock 0:$0D12 table 16 2\nblock 0:$0D12 name DISPATCH\nblock 0:$1A00 bytes $40\nblock 0:$1A40 words 16\nblock 0:$1A60 string\nblock 0:$1A70 string 0xC\nblock 0:2000H code\nblock 0:$2000 code $10\nblock 0:$2000 comment main loop, entered from the table\nblock 0:$3F00 nocode\n`);
  expect(f.version).toBe(1);
  expect(f.program).toBe('a'.repeat(64));
  expect(f.blocks).toEqual([{ index: 0, length: 0x4f49, hash: '7f83b1657ff1fc53', start: 0x6300 }, { index: 1, length: 2, hash: '2c26b46b68ffc68f' }]);
  expect(f.hints.map((h) => ({ ...h, line: undefined }))).toEqual([
    { block: 0, offset: 0, directive: 'entry', line: undefined },
    { block: 0, offset: 0xd12, directive: 'table', count: 16, width: 2, line: undefined },
    { block: 0, offset: 0xd12, directive: 'name', name: 'DISPATCH', line: undefined },
    { block: 0, offset: 0x1a00, directive: 'bytes', length: 0x40, line: undefined },
    { block: 0, offset: 0x1a40, directive: 'words', length: 16, line: undefined },
    { block: 0, offset: 0x1a60, directive: 'string', line: undefined },
    { block: 0, offset: 0x1a70, directive: 'string', length: 12, line: undefined },
    { block: 0, offset: 0x2000, directive: 'code', line: undefined },
    { block: 0, offset: 0x2000, directive: 'code', length: 16, line: undefined },
    { block: 0, offset: 0x2000, directive: 'comment', text: 'main loop, entered from the table', line: undefined },
    { block: 0, offset: 0x3f00, directive: 'nocode', line: undefined },
  ]);
  expect(f.hints[1]!.line).toBe(7);
});
it.each([
  ['fugloy-hints 2\n', 1, 'unsupported hint file version'],
  ['block 0 length 1 hash 00\n', 1, 'expected "fugloy-hints 1" first'],
  ['fugloy-hints 1\nblock 0:$0 entry\n', 2, 'block 0 is not declared'],
  ['fugloy-hints 1\nblock 0 length $10 hash 0123456789abcdef\nblock 0:$10 entry\n', 3, 'offset $0010 is past the end of block 0 (length $0010)'],
  ['fugloy-hints 1\nblock 0 length $10 hash 0123456789abcdef\nblock 0:$1 frob\n', 3, 'unknown directive "frob"'],
  ['fugloy-hints 1\nblock 0 length $10 hash 0123456789abcdef\nblock 0:1A entry\n', 3, 'bad number "1A"'],
  ['fugloy-hints 1\nblock 0 length $10 hash 0123456789abcdef\nblock 0:$1 name org\n', 3, 'name "org" is reserved'],
  ['fugloy-hints 1\nblock 0 length $10 hash 0123456789abcdef\nblock 0:$1 name Call\n', 3, 'name "Call" is reserved'],
  ['fugloy-hints 1\nblock 0 length $10 hash 0123456789abcdef\nblock 0:$1 name L6000\n', 3, 'name "L6000" has the shape of a generated label'],
  ['fugloy-hints 1\nblock 0 length $10 hash 0123456789abcdef\nblock 0:$1 name 9lives\n', 3, 'name "9lives" is not an identifier'],
  ['fugloy-hints 1\nblock 0 length $10 hash 0123456789abcdef\nblock 0:$1 name A\nblock 0:$1 name B\n', 4, 'address 0:$0001 already has a name'],
  ['fugloy-hints 1\nblock 0 length $10 hash 0123456789abcdef\nblock 0:$1 bytes\n', 3, 'bytes needs a length'],
  ['fugloy-hints 1\nblock 0 length $10 hash 0123456789abcdef\nblock 0:$1 table 4 1\n', 3, 'table width 1 is not supported'],
])('reports %j at line %i: %s', (text, line, message) => {
  const r = parseHints(text);
  expect(r.errors.map((e) => [e.line, e.message])).toEqual([[line, message]]);
});
it('writes canonical text that parses back to the same file', () => { /* build a HintFile, writeHints, parseHints, compare ignoring line; writing twice is identical; hints sorted by block, offset, input order */ });
it('rejects and accepts names per the rules', () => { expect(isValidName('MAIN_LOOP')).toBe(true); expect(isValidName('ixh')).toBe(false); expect(isValidName('DEFB')).toBe(false); expect(isValidName('SUB_1234')).toBe(false); expect(isValidName('SUB_12345')).toBe(true); });
```

- [ ] **Step 2–5: RED, implement, GREEN, commit** `p2: add hint file parser and writer`.

---

### Task 3: Applying hints to an image

**Files:**
- Create: `src/hints/apply.ts`, `test/hints/apply.test.ts`

**Interfaces (produces):** spec §5.4.

- [ ] **Step 1: Failing tests:** match by `(length, hash)` regardless of start (an image at `$7000` matches a block declared with `start $6000`); index tiebreak for two equal runs; unmatched block reported with its hint count and a warning; program hash mismatch warning; addresses are `run.start + offset`; `string` without length resolves to the terminator inclusive (`00H`, `0DH`, `03H`) or the run end; `table` width 1 warning and skip; names and comments keyed by address; `entries` in hint order.
- [ ] **Step 2–5: RED, implement, GREEN, commit** `p2: apply hints to an image as annotations`.

---

### Task 4: Descent with annotations

**Files:**
- Modify: `src/analysis/map.ts` (`mark(addr, length, kind)`), `src/analysis/descent.ts`, `src/pipeline.ts`
- Create: `test/analysis/descent-hints.test.ts`

**Interfaces:**

```ts
export function recursiveDescent(image: MemoryImage, roots: number[], annotations?: Annotations): Pass1;
export type DiagnosticKind = ... | 'nocode';
export interface AnalyzeOptions { entries?: number[]; annotations?: Annotations }
export interface Analysis { ...; annotations: Annotations }   // symbols added in Task 5
```

Root order: module entry, `entries`, hint `entries`, `code` hints, table targets. Tables: type `count * 2` bytes as `Kind.Word` (clipped to the run), read little-endian entries, loaded ones become roots, unloaded ones externals, and `xrefs` gain `{ from: tableAddr, to, kind: 'jump' }` so Pass 2 labels the targets `L`. After the worklist, `code` hints with a length decode linearly through still-unknown bytes.

- [ ] **Step 1: Failing tests:** hint entry is a root; `nocode` ends the path with a `nocode` diagnostic and the next byte stays unknown; a jump into a `bytes` region is `in-data` and the bytes stay `Kind.Byte` (Review Focus 1); `words` and `string` pre-type; a table of two entries types four bytes as `Word`, seeds both targets, records xrefs, and an unloaded entry becomes an external; `code` with length decodes a region no path reaches; `code` without length is only a root; an override on a byte already reached by an earlier root does not apply (overrides are applied first, so this cannot happen: test that overrides are applied before any decoding by placing `bytes` on the entry itself and asserting the entry is `in-data` with no instructions).
- [ ] **Step 2–5: RED, implement, GREEN (whole suite), commit** `p2: drive descent from hint annotations`.

---

### Task 5: Pass 2 symbols

**Files:**
- Create: `src/analysis/symbols.ts`, `test/analysis/symbols.test.ts`
- Modify: `src/pipeline.ts` (`Analysis.symbols`)

**Interfaces (produces):** spec §5.6; `pipeline.analyze` computes `symbols = synthesizeSymbols(pass1, annotations, image)`.

Data-reference detection: an instruction whose mnemonic is `LD`, whose first operand is `reg16` in `{BC, DE, HL, IX, IY}`, and whose second is `imm16` with a loaded value; or any operand of kind `mem` whose `addr` is loaded.

- [ ] **Step 1: Failing tests:** `L` for a jump target, `SUB_` for a call target, `SUB_` wins over `L`; `DATA_` for `LD HL,nn` and `LD (nn),A` into loaded memory, none for `LD SP,nn` or an unloaded `nn` or a port; `TBL_` for a table and `L` for its targets; user `name` replaces a synthesized name keeping the kind, with `source: 'user'`; a user name on an unreferenced address creates a `data` symbol; no symbol for externals; `list()` is sorted by address; names are `L%04X` upper-case hex.
- [ ] **Step 2–5: RED, implement, GREEN, commit** `p2: synthesize labels from use and user names`.

---

### Task 6: Emitter with symbols

**Files:**
- Create: `src/emit/operands.ts`, `test/emit-symbols.test.ts`, `test/roundtrip/hints.test.ts`
- Modify: `src/emit/zmac.ts`, `test/fixtures.ts` (`CMD_FIXTURES['hint-paths']`, `HINT_FIXTURES`), `scripts/write-fixtures.ts`, `test/fixtures.test.ts`, `test/roundtrip/fixtures.test.ts`, `test/roundtrip/real.test.ts`

**Interfaces:**

```ts
export function renderOperands(ins: Instruction, symbols?: SymbolTable): string;   // 'HL,DATA_7000' or 'HL,7000H'
export interface EmitOptions { source?: string; addresses?: boolean; symbols?: SymbolTable; annotations?: Annotations }
```

Operand rule: `rel` → symbol at target when present; `imm16` → symbol when the instruction is `JP`/`CALL` or a `LD rr,nn` with rr in `{BC, DE, HL, IX, IY}`; `mem` → symbol when present; everything else numeric. Row rules: label line `NAME:` before any row starting at a symbol address; rows split at symbol addresses and at kind changes; `Kind.Word` runs emit `DW` four per row with symbol names for values that have one; `Kind.Byte`, `Kind.String`, unknown emit `DB` eight per row; `EQU` lines for symbols at `Tail` addresses go right after the header; comments append `\t; text`.

The `hint-paths` fixture (code written with the `CmdWriter`): at `$6000` a program containing a `CALL` to a subroutine, a conditional `JR` loop, `LD HL,` a data area, `LD (nn),A` to a variable, `LD HL,TBL` then `JP (HL)`-style dispatch with a two-entry table of loaded targets, a `words` area, a `bytes` area, a string ending in `0DH`, and a byte inside a multi-byte instruction that the hints `name`. Its hint file (generated by `writeHints` in `write-fixtures.ts` so identities are computed) declares the table, the words, bytes, string, a `name` on the subroutine, a `name` inside an instruction, a `comment`, and a `nocode`.

- [ ] **Step 1: Failing unit tests:** each operand rule; label line placement; adjacent symbols split DB rows (Review Focus 3); `EQU` for an inside-instruction name (Review Focus 2); `DW` rows with names and an odd trailing `DB`; comment append; output with no symbols equals A's output byte for byte (regression).
- [ ] **Step 2: Failing round trips:** `roundtrip/hints.test.ts` assembles the `hint-paths` fixture with its hints and compares images; `fixtures.test.ts` and `real.test.ts` now pass `{ symbols: a.symbols, annotations: a.annotations }`.
- [ ] **Step 3–5: implement, GREEN (full suite with zmac), regenerate fixtures, commit** `p2: emit labels, EQU, and DW from the symbol table; round trips re-proven`.

---

### Task 7: Listing, IR, and CLI

**Files:**
- Modify: `src/listing.ts`, `src/ir.ts`, `src/index.ts`, `packages/cli/src/index.ts`, `packages/cli/test/cli.test.ts`, `test/pass1-listing.test.ts`, `test/ir.test.ts`, `README.md`

Listing: `NAME:` on its own line in the address column position before the row; operands via `renderOperands`; comments appended after the entry marker; header lines `; hints: <source>: N blocks matched, M unmatched, K hints applied` and `; warning:` lines. IR: `symbols: Symbol[]`, `hints?: { matched, unmatched, warnings }`. CLI: `--hints <path>`, `--write-hints <path>`, `--sweep --hints` refused; parse errors `fugloy: <path>:<line>: <message>` each on a line, exit 2; `--write-hints` writes `writeHints({ version: 1, program, blocks: identities, hints: entries as entry lines })` and refuses an existing path (exit 2).

- [ ] **Step 1: Failing tests:** listing label lines and comments on the `hint-paths` fixture; IR snapshot updated and `symbols` present; CLI `--hints` applies (listing shows `DISPATCH:`), parse error output and exit 2, `--write-hints` content (`fugloy-hints 1`, block lines with `# start`, entry lines) and refusal to overwrite, `--sweep --hints` refused.
- [ ] **Step 2–5: RED, implement, GREEN, commit** `p2: show labels in the listing and IR; add --hints and --write-hints`.

---

### Task 8: Rebasing proof and the Asylum acceptance fixture

**Files:**
- Create: `test/real/hints.test.ts`, `fixtures/hints/asylum16.hints`

- [ ] **Step 1: Rebasing test** (skip when absent): write hints for asylum1b with `--write-hints`-equivalent code plus `name MAIN_ENTRY` at the entry offset and a `bytes` override at a fixed offset; apply to asylum1c and asylum1d: zero unmatched, the same offsets, the symbol `MAIN_ENTRY` at `base + offset` in each, and both still round-trip.
- [ ] **Step 2: Find asylum16's dispatch.** Run `pnpm fugloy fixtures/real/.../asylum16.cmd`, read the 71-instruction stub to the `JP (HL)`, and identify how HL is loaded (a `LD HL,nn` plus `ADD HL,DE` indexing a table, or a RAM vector). Write `fixtures/hints/asylum16.hints` by hand from identities printed by `--write-hints`: a `table <count> 2` at the table (or `entry` hints at the routines the stub reaches if it is not a table), with a comment explaining the evidence. No program bytes go into the file.
- [ ] **Step 3: Acceptance test** (skip when absent): apply the fixture; assert zero unmatched blocks, every table target is an instruction start, the reached fraction is at least what the report will state, and the round trip still holds with labels.
- [ ] **Step 4: commit** `p2: prove hints survive relocation; declare asylum16's dispatch`.

---

### Task 9: Docs and report

- [ ] Project plan: the "Hint file" section stays as written; add one sentence under Pass 2 naming the data-reference rule (BC/DE/HL/IX/IY and memory operands) if it differs from the text. CHANGELOG Unreleased: Added (hint file, annotations, Pass 2 symbols, labels in output, `--hints`/`--write-hints`), Changed (zmac output and listing now carry labels). README: Use section examples for hints; package table. Spec: record the user-name shape rule.
- [ ] Full suite with `FUGLOY_REQUIRE_ZMAC=1`, typecheck, build; report: round-trip results with labels, rebasing result, asylum16 coverage before and after the hint, rulings, deferred items, what C needs (string/table heuristics plug into the same `Annotations`).
