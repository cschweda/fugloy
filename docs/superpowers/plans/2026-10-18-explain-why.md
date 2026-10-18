# Explain "Why" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Explain tab says, for a code line, not only what the instruction does but why it is there: why this register, what the line does for the program, and why a programmer writes it this way — without ever stating what it cannot prove.

**Architecture:** Three new modules in `packages/disasm/src/explain/` add a `why` part to `Explanation`: `why-register.ts` (facts of the Z80 that force the register choice), `why-idiom.ts` (recognised idioms with the cost comparison that motivates them, computed from `@fugloy/z80`), and `why-purpose.ts` (the value's proven journey through the line: where the register's value came from and where it goes next, and what that destination means on a TRS-80, using `track.ts`, the symbol tables, `machine.ts`'s screen helpers, and the routine summary). `explainLine` fills `why`; the web Explain tab shows it as a "Why it's here" section.

**Tech Stack:** TypeScript strict (disasm), Vue 3 / Nuxt 4 (apps/web), Vitest, Playwright.

**Spec:** this plan's Design section (the user asked, 2026-10-18: explain "why it's important in the overall app … why are we using A … what is this doing specifically to the app? And why did the coder do it?", then said "build it" without further questions), plus the Explain tab design `docs/superpowers/specs/2026-10-17-explain-tab-design.md` whose anti-goal binds: never state an unproven value.

## Design

Three questions, three evidence classes, each labelled so a reader can tell a fact from an inference:

1. **Why this register** — *facts about the Z80*, always true for the instruction form. Examples: every 8-bit arithmetic, logic, and compare instruction works on A, so a value must be in A to be added, masked, or compared; only A can be stored to or loaded from a fixed address (`LD (nn),A`, `LD A,(nn)`) or through BC/DE (`LD (BC),A`, `LD A,(DE)`); only A goes to or from a port named in the instruction (`OUT (n),A`, `IN A,(n)`); `DJNZ` counts in B; `LDIR`/`LDDR`/`LDI`/`LDD`/`CPIR`/`CPDR` fix HL as source, DE as destination, BC as count; the rotate-A and adjust instructions (`RLCA RRCA RLA RRA CPL NEG DAA`) work only on A; 16-bit adds land only in HL, IX, or IY; `JP (HL)` jumps only through HL, IX, or IY; `EX DE,HL` exists because HL is the register most memory instructions use. A ROM call whose table `purpose` names its input register (for example "send the byte in A …") explains why that register was loaded before the call, citing the table entry. Shown under **Why A** (or the register's name). Lines with no forced choice get nothing here.
2. **What it does for the program** — *proven flow*, never guessed. From `knownBefore`/`walkBack` and a forward scan of straight-line code to the next consumer of the register the line writes (or the producer of the register the line reads): "A carries the byte read from $5A20 to $3C45, the screen (row 1, column 5)"; "A holds the key `$002B` returned, and the next `CP 0DH` tests it for ENTER"; "B is the count for the `DJNZ` at $6150, so this loop runs 8 times". Destinations get their TRS-80 meaning: video RAM (row and column, the character when known), the keyboard matrix, port $FF (sound and cassette), a named ROM routine (its table purpose), a named variable or a region. The enclosing routine's summary is referenced when it exists ("part of the routine at $6140, which writes to the screen"). If the next consumer is past a branch, a join, or unknown code, the sentence stops at what is proven ("its next use is not certain: the code branches at $6152"). Shown under **What it does here**.
3. **Why write it this way** — *idioms with a computed motive*. A catalogue of common forms with the cost comparison that makes them the usual choice, the numbers taken from `@fugloy/z80` (never typed in): `XOR A` vs `LD A,0` (bytes, T-states, and it clears the carry); `OR A`/`AND A` to test A for zero and clear the carry; `CP n` to compare without changing A; `SUB A`; `LD B,n` … `DJNZ` as a counted loop; `ADD A,A` / `ADD HL,HL` to double; `SLA`/`SRL`/`RLA` to multiply or divide by two; `INC (HL)`/`DEC (HL)` as an in-place counter; `PUSH AF`…`POP AF` to keep A and the flags across a call; `EX AF,AF'`; `RST n` as a 1-byte call against `CALL nn`'s 3; `LD A,(HL)` + `INC HL` to walk a table; `LDIR` to copy a block. Phrased as the usual reason ("Programmers write `XOR A` rather than `LD A,0` because it is 1 byte and 4 T-states against 2 bytes and 7, and it also clears the carry"), never as a claim about this programmer's mind. Shown under **Why write it this way**.

Non-goals: BASIC lines; guessing a variable's meaning from its use count; anything from a runtime label file (the web app does not read them yet).

## Global Constraints

- Anti-goal: never state an unproven value or an unproven destination. Every flow sentence comes from `track.ts` facts or a straight-line scan that stops at branches, joins, writes to the register, and unknown code.
- Numbers in idiom comparisons come from `@fugloy/z80`'s table at runtime (decode the alternative's bytes), never literals in prose.
- disasm: no DOM, no Node APIs, no runtime dependencies. Web: the existing ExplainTab/ExplainText components and `utils/explain-view` patterns.
- Every address in a sentence is a link piece (`addrPiece`), every table name an `entry` piece, as the existing words do.
- Commit messages: imperative, one line, prefix `x2:` (Explain, second round). No `Co-Authored-By` or any AI trailer.
- Update `docs/superpowers/specs/2026-10-17-explain-tab-design.md` with a "Why" section, the CHANGELOG `[Unreleased]` in its detailed style, and the README's workbench description.

## Review Focus

1. A register whose next use is past a conditional jump must not be given a single destination (Task 3 test `stops at a branch`).
2. A value loaded from an address the program also writes elsewhere must not be described as a constant (Task 3 test `a variable is not a constant`).
3. An idiom must not fire on a look-alike with different semantics (`OR B` is not "test A for zero"; `XOR B` does not zero A) (Task 2 test `look-alikes do not match`).
4. A line whose register is chosen freely (`LD C,5` with nothing forcing C) must get no "Why C" sentence (Task 1 test `no forced choice, no sentence`).
5. Sea Dragon's annotated print routine around $6140 gets a "What it does here" that names the screen, checked against the listing (Task 4 test on `examples/sea-dragon`).

---

### Task 1: Why this register

**Files:** Create `packages/disasm/src/explain/why-register.ts`; modify `types.ts` (`Explanation.why?: { register: Sentence[]; purpose: Sentence[]; idiom: Sentence[] }`), `line.ts`, `index.ts`. Test `packages/disasm/test/explain/why-register.test.ts`.

**Interfaces:** Produces `registerWhy(c: LineCtx): Sentence[]` — the Design §1 facts keyed by instruction form (use the decoded `Instruction`'s mnemonic and operand kinds, not text matching), plus the ROM-call input-register sentence when the line loads a register that a later call in straight-line code consumes per its table `purpose` (cite the entry).

- [ ] **Step 1: Write the failing tests:** one per fact class in Design §1 on synthetic bytes; `no forced choice, no sentence`; `a ROM call's input register is explained with its table entry` (`LD A,'X'` then `CALL 0033H` on Model III tables).
- [ ] **Step 2: Run** `pnpm vitest run packages/disasm/test/explain/why-register.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, wiring `why.register` into `explainLine`.
- [ ] **Step 4: Run** it and the explain suite. Expected: PASS.
- [ ] **Step 5: Commit** `x2: explain why an instruction uses the register it does`.

### Task 2: Why write it this way

**Files:** Create `packages/disasm/src/explain/why-idiom.ts`; modify `line.ts`. Test `packages/disasm/test/explain/why-idiom.test.ts`.

**Interfaces:** Produces `idiomWhy(c: LineCtx): Sentence[]` for the Design §3 catalogue; each idiom names its alternative as bytes, decodes it with `@fugloy/z80`, and states the computed difference. Multi-line idioms (`LD B,n` … `DJNZ`, `PUSH AF` … `POP AF`, `LD A,(HL)` + `INC HL`) are recognised from the line that starts them using existing helpers (`djnzLoop`, straight-line scan).

- [ ] **Step 1: Write the failing tests:** each idiom; `look-alikes do not match`; `the numbers come from the table` (the test decodes the same alternative and compares).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit** `x2: explain the idioms programmers chose and why`.

### Task 3: What it does here

**Files:** Create `packages/disasm/src/explain/why-purpose.ts`; modify `line.ts`, possibly `track.ts` (a forward straight-line consumer scan if none exists). Test `packages/disasm/test/explain/why-purpose.test.ts`.

**Interfaces:** Produces `purposeWhy(c: LineCtx): Sentence[]` per Design §2: for a register the line writes, its next proven consumer; for a register it reads, its proven producer; the destination's meaning (screen cell and character, keyboard, port $FF, ROM routine by table purpose, named variable, region); the routine summary reference.

- [ ] **Step 1: Write the failing tests:** `carries a byte to the screen`; `a key from the ROM tested for ENTER`; `a DJNZ count`; `stops at a branch`; `a variable is not a constant`; `nothing proven, nothing said`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them and the whole disasm suite. Expected: PASS.
- [ ] **Step 5: Commit** `x2: explain what a line does for the program`.

### Task 4: The "Why it's here" section in the workbench, Sea Dragon, and docs

**Files:** Modify `apps/web/app/components/side/ExplainTab.vue`, `apps/web/app/utils/explain-view.ts` (if a helper is needed), the web unit and e2e tests (`apps/web/test/…`, `apps/web/e2e/…`), `docs/superpowers/specs/2026-10-17-explain-tab-design.md`, `CHANGELOG.md`, `README.md`. Test `packages/disasm/test/explain/why-sea-dragon.test.ts`.

**Interfaces:** The tab shows, after the lead sentences and details strip, a "Why it's here" section with up to three labelled parts (**Why A** / the register, **What it does here**, **Why write it this way**), each rendered with `ExplainText` so links work; the section is absent when all three are empty.

- [ ] **Step 1: Write the failing tests:** the Sea Dragon test (print routine around $6140 with the committed hints: "What it does here" names the screen; at least five lines across the program get an idiom sentence, each checked for correctness by its expected text); a web unit test for the section's presence and absence; an e2e step that clicks a Sea Dragon line and sees the section.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the section and the docs.
- [ ] **Step 4: Run** `pnpm typecheck && pnpm test && pnpm test:web && pnpm --filter @fugloy/web test:e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `x2: show why each line is there in the Explain tab`.
