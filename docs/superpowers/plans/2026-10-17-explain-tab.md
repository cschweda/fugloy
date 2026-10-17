# Explain Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click a line of the listing and the right page's new Explain tab says what it does in plain English, as a tutor would. It names the routine and the data region the line belongs to, and lets the user turn that into block comments that live in the hint file.

**Architecture:** The engine lives in `@fugloy/disasm` under `src/explain/`. It is pure, with no DOM, and turns a `Session` and an address into structured output (sentences made of text and link pieces, previews, details, a routine summary, a data-region summary). The web app renders that output in `side/ExplainTab.vue`. The register rule is shared with movers. Block comments are a new `note` hint directive, so the hint file stays the one source of truth.

**Tech Stack:** TypeScript (strict, ESM), Vitest, Nuxt 4 + Nuxt UI 4, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-explain-tab-design.md` (read it; it is the authority).

## Global Constraints

- `packages/z80` and `packages/disasm`: no DOM, no Node APIs, no runtime dependencies.
- Opcode tables are generated, never hand-edited; new z80 fields come from the generator in `packages/z80/src/tables.ts`, and `test/exhaustion.test.ts` covers them.
- Addresses print `$3C00` in prose and UI, `3C00H` in assembly.
- Hint format stays line-oriented text keyed by `block <index>:<offset>`. `note` is added without a version bump. Existing hint files must parse and apply unchanged.
- The 112 listing goldens and every zmac round trip must not change: notes only appear when a hint file has them.
- Explain never states a register value that is not proven on every path to the line (spec, Anti-goals). When it is unsure, it says less.
- Per-keypress cost: a cursor step with Explain open stays within the listing's bar (`listing-perf.spec.ts` thresholds, `FUGLOY_PERF=1`).
- Commit messages: imperative, one line, prefix `p4:`, no AI co-author trailer.
- Copyrighted samples stay in gitignored `fixtures/real/`; tests use `examples/sea-dragon/seadrg01.cmd` with `seadrg01.hints`.

## Review Focus

1. **A value set on one of two paths.** A line reached from a jump and a fall-through, where only one path loads HL, must not get a value for HL. Test: the tracker's `merge-point` cases (Task 4), and the browser golden at `$5FC4` (Task 6).
2. **A loop body writing its own count or pointer.** At `$4E03`, `LD (HL),8CH` inside a `DJNZ`, the body writes HL with `INC HL`, so no value for HL may be stated. Test: Task 4 `loop-body-writes`.
3. **Notes beside existing comments and names.** A `note` at an address that already has `name` and `comment` must print above the label, keep the comment in the comment column, and survive undo. Tests: Task 3 rows and zmac, and Task 10 browser undo.
4. **A data row in a region nothing references.** It must still explain the extent and draw the picture, and say "no instruction refers to this region by address". It must not invent users. Test: Task 8 `unreferenced-region`.
5. **BASIC and plain-BASIC sessions.** Explain shows the "machine code only; BASIC comes later" note and never throws. Tests: Task 6 `bas-session`, and Task 9 browser.

---

### Task 1: Generated flag effects in `@fugloy/z80`

**Files:**
- Modify: `packages/z80/src/types.ts`, `packages/z80/src/tables.ts`, `packages/z80/src/decode.ts`
- Test: `packages/z80/test/exhaustion.test.ts`, `packages/z80/test/decode.test.ts`

**Interfaces:**
- Produces: `Template.flags: string` and `Instruction.flags: string`. These are the affected flags in the fixed order `SZHPNC`, using only those letters, with `''` for none. For example `ADD A,B` → `'SZHPNC'`, `INC BC` → `''`, `ADD HL,DE` → `'HNC'`, `BIT 0,A` → `'SZHPN'`, `CP n` → `'SZHPNC'`, `LD A,I` → `'SZHPN'`, `SCF` → `'HNC'`, `DAA` → `'SZHPC'`. Undocumented flag bits 3 and 5 are not listed.

**Ruling recorded here:** the spec's "opcode family" field is not added. The mnemonic plus the operand kinds already identifies the family, which is how `tables.ts` builds the entries. Adding a parallel field would duplicate that. The explain engine keys templates on `mnemonic` and operand shape. Tell the user in the final report.

- [ ] **Step 1: Write the failing tests.** In `exhaustion.test.ts`, every template and every decoded instruction has `flags` matching `/^S?Z?H?P?N?C?$/`. In `decode.test.ts`, check the eight examples above, plus `LD A,B` → `''`, `DJNZ` → `''`, `RLCA` → `'HNC'`, `RLC B` → `'SZHPNC'`, `LDIR` → `'HPN'`, `CPIR` → `'SZHPN'`, `INC (IX+d)` → `'SZHPN'`, and `NEG` → `'SZHPNC'`.
- [ ] **Step 2: Run** `pnpm vitest run packages/z80` and see them fail on the missing field.
- [ ] **Step 3: Implement** `flagsOf(mnemonic, operands): string` in `tables.ts`, applied in `entry()` and `db()`, with DB fallbacks giving `''`, and copy it onto `Instruction` in `decode.ts`. Group mnemonics by effect, following Zilog's tables: 8-bit ALU, INC/DEC r versus rr, the rotates, BIT, the block instructions, the specials. Keep it as one table of rules in the generator.
- [ ] **Step 4: Run** `pnpm vitest run packages/z80 && pnpm typecheck`; expect PASS.
- [ ] **Step 5: Commit** `p4: generate each Z80 instruction's flag effects`

### Task 2: Shared register rule, and movers on it

**Files:**
- Create: `packages/disasm/src/analysis/regs.ts`
- Modify: `packages/disasm/src/analysis/movers.ts`
- Test: `packages/disasm/test/analysis/regs.test.ts`. Existing: `test/analysis/movers.test.ts` and the listing goldens.

**Interfaces:**
- Produces:
  ```ts
  export type Reg8Name = 'A' | 'B' | 'C' | 'D' | 'E' | 'H' | 'L' | 'IXH' | 'IXL' | 'IYH' | 'IYL';
  /** Known 8-bit values (null = unknown); pairs are read through `pair`. */
  export type RegState = Record<Reg8Name, number | null>;
  export const unknownRegs: () => RegState;
  export function pair(r: RegState, p: 'BC' | 'DE' | 'HL' | 'IX' | 'IY'): number | null;
  /** What one instruction does to what is known; LDIR/LDDR clear BC, DE, HL; CALL/RST clear everything. */
  export function stepRegs(ins: Instruction, r: RegState): void;
  ```
  Rules (spec, "How the tutor knows values"):
  - `LD r,n`, `LD rr,nn`, `LD r,r'`, `EX DE,HL`, and `XOR A` (A becomes 0) set known values.
  - `INC`/`DEC` of a known register keeps it known, wrapping at 8 or 16 bits.
  - Anything else that writes a register makes it unknown. That covers `WRITES_FIRST`, `RES`/`SET` on a register, `POP`, `EXX` (everything), `EX AF,AF'` (A), and the block and I/O-repeat group (the registers each one changes).

- [ ] **Step 1: Write failing tests.** Cover each rule above with a hand-assembled byte sequence. Include: `LD HL,3C00H; INC HL` → HL `$3C01`; `LD B,0; DEC B` → B `$FF`; `LD A,5; CALL x` → everything unknown; `LD DE,1; EX DE,HL` → HL 1 and DE unknown; and `LD H,3CH; LD L,0` → HL `$3C00`.
- [ ] **Step 2: Run** `pnpm vitest run packages/disasm/test/analysis/regs.test.ts`; expect FAIL.
- [ ] **Step 3: Implement** `regs.ts`. Change movers to keep a `RegState` and read `pair(r,'HL')` and so on in place of its own `Regs` and `step()`. Its forward walk, `MAX_STEPS`, LDIR handling and PUSH tracking stay as they are.
- [ ] **Step 4: Run** `pnpm test`. Expect every existing test to PASS, in particular `movers.test.ts`, the listing goldens and the hint snapshot tests. A changed movers proposal is a bug in Step 3, not a golden to update.
- [ ] **Step 5: Commit** `p4: share one register rule between movers and the explain engine`

### Task 3: The `note` directive: parse, apply, listing, zmac, IR

**Files:**
- Modify: `packages/disasm/src/hints/format.ts`, `hints/apply.ts`, `rows.ts`, `emit/zmac.ts`, `ir.ts`, `pipeline.ts` (the annotations merge), and `analysis/words.ts` (a note starts a data row)
- Test: `packages/disasm/test/hints/format.test.ts`, `test/hints/apply.test.ts`, `test/rows.test.ts`, `test/emit.test.ts`, `test/ir.test.ts`, and the Sea Dragon round trip in `test/roundtrip/`

**Interfaces:**
- Produces:
  - `Directive` gains `{ directive: 'note'; text: string }`, where an empty text is allowed.
  - `Annotations.notes: Map<number, string[]>`, in file order.
  - Listing rows: for an address with notes, a `{ kind: 'blank' }` row, then one `{ kind: 'note'; text: '; ' + line, addr }` row per line, with `';'` for an empty line. These come before that address's label row, or before its code or data row when it has no label.
  - zmac: the same lines in the same place.
  - IR: `notes?: { addr: number; lines: string[] }[]`, in address order, present only when there are some.
- `at <addr> note …` is a parse error: `notes describe loaded code; use block <i>:<offset> note`.

- [ ] **Step 1: Write failing tests:**
  - parse and write: `block 0:$0010 note Draws the sub` twice with different text keeps its order through `writeHints(parseHints(x))`, and an empty `note` round-trips as `note`;
  - `at $7F00 note x` gives the error above;
  - apply produces `annotations.notes`;
  - `listingRows` puts a blank row and the note rows before the label;
  - a note on a data address starts a new data row at that address;
  - zmac output has the lines above the label;
  - IR `notes`;
  - Sea Dragon with a `note` added at `L497F`'s key (from `addressKey(session, 0x497F)`) still assembles byte-identically through zmac in the existing round-trip harness;
  - a note at an address that also has `name` and `comment` prints above the label, with the comment still in the comment column.
- [ ] **Step 2: Run** them; expect FAIL.
- [ ] **Step 3: Implement.** Parsing follows the `comment` case. `writeHints` already sorts stably, so input order holds within an address. The note rows reuse the `note` row kind, so `formatRow` and the web need no new kind.
- [ ] **Step 4: Run** `pnpm test`. The 112 listing goldens must be unchanged.
- [ ] **Step 5: Update the docs.** In `docs/label-format.md`, only if it lists hint directives; it does not today, so leave it. Add a `CHANGELOG.md` `[Unreleased]` line for `note`.
- [ ] **Step 6: Commit** `p4: add the note directive for block comments above an address`

### Task 4: The value tracker

**Files:**
- Create: `packages/disasm/src/explain/track.ts`
- Test: `packages/disasm/test/explain/track.test.ts`

**Interfaces:**
- Consumes: `stepRegs`, `unknownRegs`, `pair` (Task 2); `Analysis.pass1` (`instructions`, `xrefs`).
- Produces:
  ```ts
  export interface Known {
    regs: RegState;
    /** Where control can come from when the walk stopped at a merge point: callers and jumpers of that address. */
    from?: { addr: number; callers: number[]; jumpers: number[] };
  }
  /** What is proven about registers just before the instruction at `addr` runs. */
  export function knownBefore(a: Analysis, addr: number): Known;
  /** For a DJNZ at `addr`: its loop (head = target, end = addr) and B's value on entry when proven, else count null. */
  export function djnzLoop(a: Analysis, addr: number): { head: number; end: number; count: number | null } | null;
  ```
  Walk rules, exactly as in the spec:
  - Go backward along the fall-through predecessor.
  - Stop at a call target or entry point, at any xref target (a merge point), after a CALL/RST, after 32 instructions, or at the start of a run.
  - Then replay `stepRegs` forward to `addr`.
  - **Loop counts (`djnzLoop`).** `count` is B as `knownBefore` proves it at the line before the head, plus that line's own step. All of these must hold:
    - every xref into the head comes from this DJNZ;
    - no xref from outside head..end targets an address inside the body (jumps inside the body are fine);
    - no instruction in the body writes B, or is a CALL, RST or EXX.

    Otherwise `count` is null.
  - **Ruling:** this replaces the spec's general "skip the loop body" exception. With that exception, a forward branch inside a body (such as Sea Dragon's `JR Z,L49BC` inside the loop at `$49B1`–`$49CA`) stops the walk, so no count could ever be proven there. The narrower rule is sound and covers the DJNZ counts the patterns need. A line inside a loop still stops at the head, which is a merge point, so the body's registers stay unknown, as the anti-goal requires. The spec's "Loops" paragraph is already updated to match.

- [ ] **Step 1: Write failing tests.** Use synthetic images built with the test helpers in `test/images.ts`:
  - `straight`: `LD HL,3C00H; LD A,20H; LD (HL),A` → before the third instruction, HL is $3C00 and A is $20;
  - `merge-point`: `JR Z,x; LD HL,1; x: LD A,(HL)` → HL unknown before `x`, with `from.jumpers` = [the JR];
  - `loop-count`: `LD B,40H; loop: …; JR Z,skip; …; skip: …; DJNZ loop` → `djnzLoop` count = $40, with an inner forward branch;
  - `loop-body-writes`: `LD HL,3FD0H; LD B,5; l: LD (HL),8CH; INC HL; DJNZ l` → before `LD (HL),8CH`, HL is unknown, and `djnzLoop` count = 5;
  - `second-entry`: a loop with another jump into its body → count null;
  - `body-writes-b`: a body containing `LD B,A` → count null;
  - `after-call`: everything unknown;
  - `cap`: 40 straight `NOP`s then a use → stops at 32.

  Sea Dragon, with hints:
  - before `$888B`, HL is $5200, DE is $497F, BC is $3681;
  - `djnzLoop` at `$49CA` gives head $49B1 and count $40;
  - before `$5FC4`, HL is unknown.
- [ ] **Step 2: Run**; expect FAIL.
- [ ] **Step 3: Implement** `knownBefore`. Build a predecessor index once per `Analysis`, cached in a `WeakMap<Analysis, …>`, and look up xref targets from `pass1.xrefs`.
- [ ] **Step 4: Run**; expect PASS.
- [ ] **Step 5: Commit** `p4: add the explain engine's value tracker`

### Task 5: Line sentences, TRS-80 knowledge, previews and details

**Files:**
- Create: `packages/disasm/src/explain/types.ts`, `explain/line.ts`, `explain/words.ts` (the per-mnemonic templates), `explain/machine.ts` (screen, table lookups), `explain/index.ts`
- Modify: `packages/disasm/src/index.ts` (export the API)
- Test: `packages/disasm/test/explain/line.test.ts`, `test/explain/exhaustion.test.ts`

**Interfaces:**
- Consumes: `knownBefore` (Task 4), `Instruction.flags` (Task 1), `selectSymbols`, `SymbolSet.code/data/port/svc`, `Analysis.symbols`, `annotations.comments`/`names`, `formatRow`, `listingRows`.
- Produces (exported from `@fugloy/disasm`):
  ```ts
  export type Piece = { text: string; addr?: number; entry?: TableEntry };   // addr: links the listing; entry: links the Symbol tab
  export type Sentence = Piece[];
  export interface Preview { addr: number; title: string; lines: string[]; entry?: TableEntry; comment?: string }
  export interface Details { bytes: number; cycles: number; cyclesNotTaken?: number; flags: string; documented: boolean }
  export interface Explanation {
    kind: 'code' | 'data' | 'label' | 'other' | 'basic';
    addr: number | null;
    line: string;               // the row as the listing prints it
    sentences: Sentence[];      // the plain-English lead
    pattern?: { name: string; from: number; to: number; sentences: Sentence[] };
    previews: Preview[];
    details?: Details;
    label?: { name: string; callers: number[]; jumpers: number[]; entry: boolean };
    region?: DataRegion;        // Task 8
  }
  export function explainLine(s: Session, addr: number): Explanation;
  export const sentenceText: (s: Sentence) => string;
  ```
  - **Templates:** one per mnemonic, with operand-shape branches. Every sentence fills in known values and names: `LD A,(nn)` → "Get the byte at $nnnn (NAME) and put it in A."
  - **Screen:** an address in $3C00–$3FFF reads as "the screen, row r, column c". It is 0-based, row = (a−$3C00)>>6.
  - **Ports and ROM routines:** these read through the selection's `SymbolSet`. `purpose` is used as the clause, with the entry as a link piece.
  - **`RST 08H`** mentions its inline byte.
  - **Previews:** one per address the line refers to (operand target, a known HL for `(HL)`, a jump target). It has up to 4 listing lines from that address, the label and comment, or the table entry.
  - **Details:** taken from the `Instruction`.
  - **A label row** for the address (when one exists) fills `label` with its callers, jumpers and entry flag.
  - **A plain-BASIC or `.BAS` session** returns kind `'basic'` with the one sentence "Explain covers machine code; BASIC comes later."

- [ ] **Step 1: Write failing tests:**
  - `exhaustion`: for every byte sequence the z80 exhaustion test enumerates, decoded at $5000 in a synthetic image, `explainLine` yields at least one non-empty sentence and does not throw.
  - Sea Dragon goldens, with hints and Model III / TRSDOS selected. Compare `sentenceText` of the lead exactly; the wording is the implementer's within the spec, and the reviewer checks it:
    - `$49A7` `LD IX,VIDEO+0380H` → mentions "$3F80" and "row 14, column 0";
    - `$499F` `OUT (MODEPORT),A` → mentions "$30", "port $EC" and "MODEPORT";
    - `$4EAC` `CALL $DELAY` → mentions "$2000" (BC is known) and the purpose "pause";
    - `$5FC4` `LD A,(HL)` → states no value for HL and names where control comes from;
    - `$888B` `LDIR` → mentions "BC", "HL" and "DE", with values $3681, $5200 and $497F.
  - `$62FA` (a data row) → kind `'data'` (the region is in Task 8).
  - `bas-session`: a synthetic `.BAS` → kind `'basic'`.
  - Details: `$499F` → bytes 2, cycles 11, flags `''`.
- [ ] **Step 2: Run**; expect FAIL.
- [ ] **Step 3: Implement.** Cache `selectSymbols(s.selection)` per session in a `WeakMap`.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`; expect PASS.
- [ ] **Step 5: Commit** `p4: explain each line in plain English with what is at the addresses it uses`

### Task 6: Patterns

**Files:**
- Create: `packages/disasm/src/explain/patterns.ts`
- Modify: `explain/line.ts`
- Test: `packages/disasm/test/explain/patterns.test.ts`

**Interfaces:**
- Consumes: `knownBefore`, `Analysis.proposals` (movers), `annotations.relocations`.
- Produces: `Explanation.pattern`, for the four patterns in the spec. Each has `name` (`'copy'`, `'fill'`, `'counted-loop'`, `'wait'`), the address span, and sentences:
  - **copy:** `LDIR`/`LDDR` with known HL, DE and BC → "Copies N bytes ($nnnn) from $X to $Y." It adds "This moves the program to where it runs." when a movers proposal has this `ldir`, or an applied relocation has `fileAddr`=src, `runAddr`=dst, `length`≥N. When movers proposed it but the tracker cannot prove the values, it says "Fugløy's loader analysis proposes this copies …" and states no values.
  - **fill:** `LD (HL),n` / `LD D,H; LD E,L; INC DE` / `LD BC,len` / `LDIR`. Over screen memory with n=$20 it says "clears the screen", or the rows it covers.
  - **counted-loop:** DJNZ with `djnzLoop`. "Repeats the lines from $head to here N times."
  - **wait:** a loop with no memory writes and no I/O, made only of `DEC`, `LD A,r`/`OR r` tests and a backward conditional jump. "A delay loop", with a T-state total when the count is known.

- [ ] **Step 1: Write failing tests:**
  - Sea Dragon `$888B` → copy, 13,953 bytes from $5200 to $497F, plus the "moves the program" sentence (seadrg01.hints relocates it);
  - `$49CA` → counted-loop, 64 times;
  - `$4E06` → counted-loop with no count ("repeats B times"), because B=A is unknown;
  - synthetic fill over $3C00 with $20 → "clears the screen";
  - a synthetic wait loop;
  - a merge case where only movers knows the values → "proposes", with no numbers.
- [ ] **Step 2: Run**; expect FAIL. **Step 3: Implement.** **Step 4: Run**; expect PASS.
- [ ] **Step 5: Commit** `p4: recognize copies, fills, counted loops and delays in explanations`

### Task 7: Routine summary

**Files:**
- Create: `packages/disasm/src/explain/routine.ts`
- Test: `packages/disasm/test/explain/routine.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface RoutineSummary { start: number; name: string; instructions: number; bytes: number; sentences: Sentence[]; truncated: boolean }
  export function summarizeRoutine(s: Session, addr: number): RoutineSummary | null;
  /** The summary as note lines (each ≤ 72 characters, wrapped), for Use as comment. */
  export function summaryNotes(r: RoutineSummary): string[];
  ```
  The routine definition, the 2,000-instruction cap and the facts are as in the spec, "Routine summary". Screen writes use Task 4's tracker at each store. Keyboard reads are stores and loads in $3800–$3BFF. It is cached per `Analysis` and start.

- [ ] **Step 1: Write failing tests**, on Sea Dragon with hints:
  - `SUB_6140` → the start is $6140, it loops with DJNZ, and it is called from 2 places (among them $4A96 and $4AA1);
  - `SUB_6212` → writes port $FF (CASSETTE), the sound and cassette port;
  - the routine around `$49A7` → writes the screen (a row-14 position), and writes port $EC;
  - `$888B` → the routine at the entry $8881, ending in a jump to L497F;
  - an address in no routine (a data row) → null;
  - `summaryNotes` lines are all 72 characters or fewer.
- [ ] **Step 2: Run**; expect FAIL. **Step 3: Implement.** **Step 4: Run**; expect PASS.
- [ ] **Step 5: Commit** `p4: summarize the routine around a line from what it provably touches`

### Task 8: Data regions and the picture

**Files:**
- Create: `packages/disasm/src/explain/region.ts`, and `packages/disasm/src/explain/charset.ts` (TRS-80 glyph cells: $20–$7F text, $80–$BF 2×3 blocks, as data the web draws)
- Test: `packages/disasm/test/explain/region.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DataRegion {
    start: number; end: number; name: string;
    users: { addr: number; text: string }[];          // instructions and DW words pointing into it
    pointers: { variable: number; name: string; storedAt: number; readers: number[] }[];
    readers: { loop: number; step: 1 | -1; splits: { at: number; text: string }[] }[];
    sentences: Sentence[];
  }
  export function dataRegion(s: Session, addr: number): DataRegion | null;
  /** 2×3 block cell for $80–$BF: bit i set → sub-cell i lit (row-major, top-left first). */
  export function blockCells(byte: number): boolean[];
  ```
  The rules are in the spec, "Data regions". `explainLine` sets `region` on data rows.

- [ ] **Step 1: Write failing tests**, on Sea Dragon with hints:
  - `$7DD5` → region start $7399, name `DATA_7399`, users at $4C42 and $5FB6, and a pointer `DATA_624A` stored at $4C45;
  - the reader loop at L5FB9 has a split at $5FC5 whose text mentions `AND 0F0H`;
  - `unreferenced-region`: a synthetic data region with no users → sentences say no instruction refers to it by address, and `users` is empty;
  - `blockCells(0x80)` is all false, `blockCells(0xBF)` all true, and `blockCells(0x81)` has only cell 0 lit.
- [ ] **Step 2: Run**; expect FAIL. **Step 3: Implement.** **Step 4: Run**; expect PASS.
- [ ] **Step 5: Commit** `p4: explain the data region a row belongs to, and who reads it`

### Task 9: The Explain tab

**Files:**
- Create: `apps/web/app/components/side/ExplainTab.vue`, `apps/web/app/components/side/RegionPicture.vue` (canvas), `apps/web/app/utils/explain-view.ts` (cache and helpers)
- Modify: `apps/web/app/pages/index.vue` (the tab, and opening it on a row click), `apps/web/app/components/listing/ListingView.vue` (emit a click distinct from keyboard selection)
- Test: `apps/web/test/explain-view.test.ts`, `apps/web/test/e2e/explain.spec.ts`

**Interfaces:**
- Consumes: `explainLine`, `summarizeRoutine`, `sentenceText`, `blockCells` (Tasks 5–8); `wb.cursor`, `wb.session`.
- Behaviour, from the spec:
  - Explain is the first right tab: Explain, Symbol, Index, Program, Manual, Run. The tab opened with a program stays Program.
  - ListingView emits a new `row-click` event alongside `select` for mouse clicks on a row, but not for link clicks. `index.vue` switches `rightTab` to `'explain'` on it.
  - While Explain shows, every cursor change re-explains. The results are cached per session and address in `explain-view.ts`, and routine summaries per start.
  - A link piece with `addr` calls `go(addr)`; one with `entry` opens the Symbol tab, as `showTable` does.
  - Previews are buttons that go to their address.
  - The details strip and the routine summary sit under the lead. The picture shows for data rows, with width buttons 8/16/32/64 and a number field.
  - Before any click, the tab shows "Click a line to have it explained."

- [ ] **Step 1: Write failing tests.**
  - Unit: the cache returns the same object for the same session and address, and a new one after the session changes.
  - Browser (Sea Dragon):
    - a click on the `$49A7` row opens Explain with "row 14";
    - ArrowDown re-explains to `$49AB`;
    - with Program showing, ArrowDown leaves Program showing;
    - a preview click moves the cursor;
    - a `$7DD5` click shows `DATA_7399` and a canvas;
    - a `.BAS` example shows the BASIC note;
    - axe finds nothing on the Explain tab.
- [ ] **Step 2: Run** `pnpm test:web` and `pnpm --filter @fugloy/web test:e2e`; expect FAIL.
- [ ] **Step 3: Implement.** Style the tab after `SymbolTab.vue` and `ProgramTab.vue`. Use the existing tokens; `--fg-line` is not for this.
- [ ] **Step 4: Run** the web unit, SEO and e2e tests, and `FUGLOY_PERF=1 pnpm exec playwright test test/e2e/listing-perf.spec.ts`. Add a perf case: 200 ArrowDowns with Explain open, within the existing per-step bar.
- [ ] **Step 5: Commit** `p4: add the Explain tab, opened by a click on a line`

### Task 10: Block comment box and Use as comment

**Files:**
- Create: `apps/web/app/components/listing/NotesEdit.vue`
- Modify: `apps/web/app/utils/edits.ts` (`Edit` gains `{ op: 'notes'; addr: number; lines: string[] }`), `apps/web/app/composables/useListingEditor.ts` (menu item and key), `apps/web/app/components/side/ExplainTab.vue` (the Use as comment button), and the key help, wherever the key list renders
- Test: `apps/web/test/edits.test.ts`, `apps/web/test/e2e/editing.spec.ts`

**Interfaces:**
- `applyEdit(s, { op: 'notes', addr, lines })` replaces every `note` at that key with `lines`, in order. Empty `lines` removes them. Each line is trimmed, and tabs become spaces. It is refused for an `at` (unloaded) address with "notes describe loaded code".
- Menu item **Block comment…**, key `:`. It opens `NotesEdit` at the cursor, a multi-line textarea prefilled with the address's notes. When the cursor is inside a routine whose start is not the cursor, a choice reads "Above the routine (NAME)" (the default) or "Above this line". Save is Ctrl+Enter or the button, and Esc cancels. It goes through `useEditing().apply`, so it can be undone.
- **Use as comment** on the routine summary opens `NotesEdit` at the routine's start, prefilled with `summaryNotes(...)`. It saves only on Save.

- [ ] **Step 1: Write failing tests.**
  - Unit: notes edit add, replace, remove, keep order, and refuse `at`.
  - Browser: `:` then type two lines then Ctrl+Enter → two note rows above `L497F`, and the Hints tab shows two `note` lines; Undo removes them; Use as comment prefills, and Esc leaves the hint file unchanged.
- [ ] **Step 2: Run**; expect FAIL. **Step 3: Implement.** **Step 4: Run** the web suites; expect PASS.
- [ ] **Step 5: Commit** `p4: add block comments from the menu and the : key, and Use as comment from Explain`

### Task 11: Annotated Sea Dragon, docs, and release notes

**Files:**
- Modify: `examples/sea-dragon/seadrg01.hints`, `CHANGELOG.md`, `docs/Fugloy-Project-Plan.md` (the Web app section: Explain tab, block comments), `CLAUDE.md` (current phase line), and `apps/web/app/pages/about.vue` (only if it lists the tabs)
- Test: the existing example tests (`apps/web/test/examples.test.ts`, the disasm example tests) must still pass with the new hints

**Steps:**
- [ ] **Step 1:** Using the new Explain tab and the CLI, write `note` block comments and `name`s for Sea Dragon's main routines and data regions:
  - the entry loader;
  - the start of the game ($497F);
  - the screen setup at $499A–$49CC;
  - SUB_6140, the screen copy;
  - SUB_6212, the sound;
  - DATA_7399 and its reader at L5FB9;
  - at least six more routines found by following calls from $497F.

  Mark interpretation as such ("probably the sea-floor map: …"). Names must pass `nameProblem`.
- [ ] **Step 2:** `pnpm test`, `pnpm test:web`, and the e2e suite pass. Fix any test that pinned a generated name now replaced. The `L497F` and `SUB_4B9E` tests in `editing.spec.ts` and `done-criterion.spec.ts` pin names, so keep those two addresses' names unchanged, or update the tests in the same commit.
- [ ] **Step 3:** CHANGELOG `[Unreleased]` gets the Explain tab, routine and region summaries, block comments, the annotated Sea Dragon, and the z80 `flags` field. Update the plan's Web app section, and CLAUDE.md's current-phase line.
- [ ] **Step 4: Commit** `p4: annotate Sea Dragon's routines and data, and record the Explain tab in the docs`
