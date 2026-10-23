# Part 2, M1: The Port Pipeline on Fugløy's Own Programs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a TRS-80 program into readable JavaScript that runs on a small runtime with no Z80 interpreter, and prove it: every Learn lesson and Space Invaders chapter, ported for the Model III and the Model I, runs block for block identically to `@fugloy/emu` through its `check.json` session, in CI.

**Architecture:** `@fugloy/recomp` (TypeScript, like `@fugloy/asm`) loads a `.CMD` with `@fugloy/disasm` (`loadCmd`, `analyze`, `buildIr`), decodes each basic block's instructions with `@fugloy/z80`, translates every instruction to JavaScript statements over a machine-state object `z`, groups blocks into routines (the entry and every CALL target), and emits one ES module: one function per routine, a data table of the program's non-code bytes, and no code bytes. `@fugloy/runtime` (plain JavaScript, like `@fugloy/emu`) is what that module runs on: registers, the 64K with the model's memory map, the keyboard matrix, the ports, the T-state and R counters, and the flag helpers. The referee runs the original on `@fugloy/emu` (on Fugløy's stub ROM, so CI can) beside the port, and at every block start compares the two. M1's runtime is headless: the canvas screen, sound, the Web Worker and frame pacing the design describes come with M2, when a port must play in a browser.

**Tech Stack:** TypeScript strict ESM (`@fugloy/recomp`, built with `tsc -b` like z80/disasm/asm); plain JavaScript ESM with JSDoc (`@fugloy/runtime`); Vitest; `@fugloy/emu` and `@fugloy/asm` as test dependencies only.

**Spec:** `docs/superpowers/specs/2026-10-23-part2-port-and-remake-design.md` (approved 2026-10-23) — its Goals, Anti-goals, "The how — decided" and milestone M1. The project plan's Part 2 section and `CLAUDE.md` bind as everywhere.

## Global Constraints

- `@fugloy/runtime`: plain JavaScript ESM with JSDoc types, **no dependencies**, no DOM, no Node APIs (it runs in a page and in a Web Worker). `@fugloy/recomp`: TypeScript strict ESM, runtime dependencies `@fugloy/z80` and `@fugloy/disasm` only, no DOM, no Node APIs. `packages/cli` is the only package that touches `fs`. Both new packages start at version 0.1.0 and are not published in M1.
- A port is generated, never hand-edited, and deterministic: the same program, model and names give the same module byte for byte.
- A port carries **none of the program's code bytes**. It carries the bytes of the program's non-code regions (its data: text, tables, graphics) as a data table the runtime copies into memory, and nothing decodes or interprets Z80 at run time (the design's first anti-goal). A labelled-block `switch` over a routine's *translated* blocks is structure, not interpretation, and is allowed (Task 6 reduces it).
- Names come from the caller's names (for M1, `@fugloy/asm`'s symbols for the Learn programs), else the disassembler's symbols; a hint file's notes become JSDoc. Output is readable: one statement per instruction, one function per routine.
- Every block's T-states and R increments are exact against `@fugloy/emu` (whose T-states match `@fugloy/z80`'s tables for every opcode), including conditional branches taken and not taken and every iteration of a repeating block instruction. Flags are exact, including bits 3 and 5 and every rule `@fugloy/emu` implements (SCF/CCF's Q, MEMPTR for BIT n,(HL), a repeating block instruction's bits from PC, EX (SP),rr writing the high byte first).
- The referee runs in CI: the original on `@fugloy/emu` with Fugløy's stub ROM (`apps/web/app/utils/emulator/stub-rom.z`, assembled as `packages/asm/test/lessons.test.ts` does), never the user's ROM.
- Anything the port cannot follow fails loud with a sentence naming the address and the instruction: an unknown jump target, self-modifying code (refused in M1), a return to an address other than the one after its CALL, a device address or port the runtime does not model.
- Commit messages: one line, imperative, prefix `m1:`, no trailers of any kind.
- Keep the design's M1 status, `docs/Fugloy-Project-Plan.md`'s Part 2 section, `CLAUDE.md`, `CHANGELOG.md` (`[Unreleased]`) and each new package's README current.

## Review Focus

1. **A program that reads its own code bytes as data** (copies or checksums itself): the port has no code bytes, so the referee must stop at the first register or memory difference that read causes and name the address; never a silently wrong port (Task 4).
2. **A jump or call to an address the disassembly did not find** (a computed target, missed code): the port must stop with a sentence naming the target and the instruction that went there, never fall through into nothing (Tasks 3–4).
3. **Self-modifying code** (a write into a byte that executes): detected during the referee run and refused with the site named; M1 translates none (Task 4).
4. **Exact time and R**: block T-states and R increments match emu's on every path, since chapter 11 picks bombs with `LD A,R` and every `check.json` screen is taken at an exact T-state (Tasks 2–5).
5. **The Model I**: its video read gate (no lowercase: a stored byte reads `b & 0xBF` when bit 5 or 7 is set, else `b | 0x40`), its 32-column bit in port `$FF`, and its 1.77408 MHz clock — a program ported for model 1 must match emu's Model I, not the Model III (Tasks 1, 5).

---

### Task 1: `@fugloy/runtime` — the machine a port runs on

**Files:**
- Create: `packages/runtime/package.json` (`@fugloy/runtime` 0.1.0, `"type": "module"`, `"files": ["src"]`, exports `.` → `./src/index.js` and `./ops` → `./src/ops.js`; `@fugloy/emu` as a devDependency for tests), `packages/runtime/src/index.js`, `src/z.js`, `src/model.js`, `src/keys.js`, `src/ops.js` (empty export list until Task 2), `packages/runtime/README.md`, `packages/runtime/LICENSE` (the repo's MIT text)
- Test: `packages/runtime/test/z.test.js`, `packages/runtime/test/keys.test.js`

**Interfaces:**
- Produces: `createZ({ model })` with `model` `1`, `3` or `'flat'` (64K of plain RAM, no map: for Task 2's per-opcode tests) → a `Z` with
  - 8-bit fields `a f b c d e h l i r ixh ixl iyh iyl`; 16-bit fields `sp wz af_ bc_ de_ hl_`; `iff1 iff2` (booleans), `im` (0–2), `q` (0 or 1: whether the last instruction of the block that just ended wrote flags, for SCF/CCF);
  - accessors `af bc de hl ix iy` (get and set 16-bit);
  - `mem` (`Uint8Array(65536)`), `read(addr)`, `write(addr, v)`, `read16(addr)`, `write16(addr, v)` (low byte first);
  - `in(port)`, `out(port, v)`; `sound` (an array of `{ t, v }`, each port `$FF` write with its T-state); `columns32` (boolean);
  - `cycles` (T-states since the start), `tick(t, r)` (adds `t` T-states and `r` to R's low seven bits, keeping bit 7), `at(addr)` (called at each block's start; a no-op unless the referee replaces it);
  - `keys` (`Uint8Array(8)`, one byte per matrix row, a set bit a key down), `press(name)`, `release(name)` with the key names `@fugloy/emu`'s `m.keyboard.press` accepts;
  - `model`, `clockHz` (Model I 1,774,080; Model III 2,027,520, as emu's `models.js`).
- Memory map (models 1 and 3, as `@fugloy/emu`'s memory and keyboard modules do; cite their lines in `z.js`): reads below `$3800` return `mem`; `$3800`–`$3BFF` return the OR of the rows the address's low byte selects; `$3C00`–`$3FFF` return `mem`, through the Model I gate above on model 1; writes below `$3C00` are ignored; on model 1, `$37E0`–`$37FF` (the Expansion Interface) throws `the port does not model $37E0 (the Model I's Expansion Interface)`-style sentences. Ports: `$FF` (both models) and `$EC`–`$EF` (model 3) as emu's `io.js` and its Model I counterpart define them for reads and writes, including the 32-column bit; any other port throws a sentence naming it.

- [ ] **Step 1: Write the failing tests.** `z.test.js`: a write to `$3C00` reads back on model 3 and gated on model 1 (`0x61` → `0x21`, `0x41` → `0x41`, `0x20` → `0x60`); a write to `$2000` is ignored; `press('SPACE')` sets the bit `read(0x3840)` shows and `read(0x38FF)` ORs every row; `tick(10, 3)` on R `0x7E` with bit 7 set gives `0x81`; `out(0xFF, 1)` at `cycles` 1234 records `{ t: 1234, v: 1 }`; the 32-column bit follows port `$FF` on model 1 and `$EC` on model 3; reading `$37E0` on model 1 and `in(0x84)` on model 3 throw sentences naming them; `'flat'` reads and writes all 64K plainly. `keys.test.js`: the runtime's key table (name → row and bit) equals `@fugloy/emu`'s for every name emu accepts.
- [ ] **Step 2: Run** `pnpm vitest run packages/runtime`: they fail (no module).
- [ ] **Step 3: Implement** `createZ` and the tables in `z.js`, `model.js`, `keys.js`, exported from `index.js`.
- [ ] **Step 4: Run** the tests, and `packages/emu/scripts/check-no-dom.mjs`'s check over `packages/runtime/src` (add a `check:no-dom` script to the runtime's package.json that runs it there): all pass.
- [ ] **Step 5: Commit** `m1: add @fugloy/runtime, the machine state a port runs on`

### Task 2: Translating every instruction, proven per opcode against emu's core

**Files:**
- Create: `packages/recomp/package.json` (`@fugloy/recomp` 0.1.0, dependencies `@fugloy/z80` and `@fugloy/disasm` as `workspace:^`; devDependencies `@fugloy/emu`, `@fugloy/runtime`, `@fugloy/asm`), `packages/recomp/tsconfig.json` (as `packages/asm/tsconfig.json`), `src/index.ts`, `src/translate.ts`, `packages/recomp/README.md`, `LICENSE`
- Modify: `packages/runtime/src/ops.js` (the helpers), the root `package.json`'s `build` and `typecheck` scripts and the root `tsconfig` references (add `packages/recomp`)
- Test: `packages/recomp/test/translate.test.ts`

**Interfaces:**
- Consumes: `decodeAt` / `Instruction` from `@fugloy/z80` (`mnemonic`, `operands`, `length`, `cycles`, `cyclesNotTaken`, `flow`, `documented`, `flags`).
- Produces: `translate(ins: Instruction, at: number, ctx: { qPrev: 0 | 1 | null }): Translation`, where `Translation = { lines: string[]; writesFlags: boolean; flow: 'next' | 'jump' | 'call' | 'return' | 'halt'; cond?: string; target?: number; cycles: number; cyclesNotTaken?: number; r: number; repeats?: true }`. `lines` are JavaScript statements over `z` and the helpers imported as `o` (for example `z.a = o.add8(z, z.a, z.b);`); `cond` is a JavaScript boolean expression over `z.f` for a conditional transfer; `r` is the R increment (one per opcode fetch: 1, or 2 with a prefix). `ops.js` exports the helpers the lines call.
- Rules (match `packages/emu/src/cpu/z80cpu.js`, cite it): SCF/CCF take bits 3 and 5 by the Q rule — `ctx.qPrev` is the previous instruction's `writesFlags` when it is in the same block, `null` at a block's start, where the helper reads `z.q`; repeating block instructions (LDIR, LDDR, CPIR, CPDR, INIR, INDR, OTIR, OTDR) become a loop of the single-step helper whose iteration ticks 21 (or 16 on the last) T-states and 2 R, and whose repeating iterations take bits 3 and 5 from the instruction's own address as emu's `_xyRepeat`; MEMPTR (`z.wz`) is updated wherever emu updates it; EX (SP),rr writes the high byte first. Instructions `@fugloy/z80` decodes only as a DB fallback (`documented: false` with mnemonic `DB`) are refused with a sentence naming their bytes.

- [ ] **Step 1: Write the failing test** `translate.test.ts`, "every opcode matches emu's core": for every opcode the tables decode to an instruction (unprefixed, CB, ED, DD, FD, DDCB, FDCB; every DD/FD form, documented or not), 64 states from a seeded PRNG: random registers (`wz` included), random F, random bytes at every address the instruction touches; run one instruction on emu's CPU over a flat 64K bus (as emu's own unit tests build it, `packages/emu/test/unit/`), and run the translation (`new Function('z', 'o', lines.join('\n'))`, then the transfer `cond` decides taken or not) on `createZ({ model: 'flat' })` with the same state and memory; expect every register, F, `wz`, `iff1/iff2/im`, the 64K, and the T-states (`cycles` or `cyclesNotTaken` by the branch) and R equal. Repeating block instructions are checked for one iteration and for a full run of BC = 3. A second test: SCF and CCF with `qPrev` 0, 1 and `null` (with `z.q` 0 and 1) match emu after a flag-writing and a non-flag instruction.
- [ ] **Step 2: Run** `pnpm vitest run packages/recomp/test/translate.test.ts`: it fails (no translator).
- [ ] **Step 3: Implement** `translate` (a table from mnemonic and operand kinds to a line template; no opcode byte named in it, as `@fugloy/asm` names none) and the helpers in `ops.js`.
- [ ] **Step 4: Run** the test, `pnpm typecheck` and `pnpm vitest run packages/runtime`: all pass, output pristine.
- [ ] **Step 5: Commit** `m1: translate every Z80 instruction to JavaScript, each proven against emu's core`

### Task 3: Routines, the port module, and `port()`

**Files:**
- Create: `packages/recomp/src/routines.ts`, `src/emit.ts`, `src/port.ts`; `packages/runtime/src/run.js` (exported from `index.js`)
- Test: `packages/recomp/test/port.test.ts`

**Interfaces:**
- Consumes: Task 1's `createZ`; Task 2's `translate`; `loadCmd`, `analyze`, `buildIr` from `@fugloy/disasm` (the IR's `blocks` with `succ`, `xrefs`, `entry`, `regions`, `symbols`, `notes`).
- Produces: `port(cmd: Uint8Array, opts: PortOptions): PortResult`, with `PortOptions = { model: 1 | 3; names?: ReadonlyMap<number, string>; hints?: string; runtimeImport: string; source?: string }` and `PortResult = { ok: true; js: string; report: PortReport } | { ok: false; errors: string[] }`, `PortReport = { entry: string; routines: { name: string; addr: number; blocks: number; labelled: boolean }[]; data: { addr: number; length: number }[]; refused: string[] }`.
- The module (`js`) imports `o` from `runtimeImport` (`@fugloy/runtime/ops` in a bundle; a relative path in tests) and exports `MODEL`, `DATA` (an array of `[addr, Uint8Array]`: every non-code region of the loaded image), `ENTRY`, and each routine by name. A routine is the entry or a CALL or RST target; its blocks are those reachable from its start by jumps and fall-through without entering another routine's start. Each block begins `z.at(addr);` and ends with its tick and `z.q = 0|1;`. A CALL pushes the return address on the Z80 stack in memory and runs the callee through `o.call(z, CALLEE, returnAddr)`; a RET pops and `o.ret(z, expected)` throws a sentence when the popped address is not the expected one; a jump into another routine's start returns that routine (a trampoline `o.call` runs until a routine returns nothing), so a game loop that jumps between routines never grows the JavaScript stack. Within a routine, blocks are labelled cases of `for (;;) switch (b)` (Task 6 structures them); a transfer to an address no block starts throws `o.unknown(z, target, from)`'s sentence.
- `run.js`: `load(z, mod)` copies `DATA` into `z.mem`; `runPort(z, mod)` runs `ENTRY` and returns `{ reason: 'returned' }` when the entry returns to the stub ROM's `RETURNED` (the address the stub leaves on the stack, `apps/web/app/utils/emulator/stub-rom.z`).

- [ ] **Step 1: Write the failing tests** `port.test.ts`, programs assembled in the test with `@fugloy/asm` (`toCmd`): a straight line of loads and arithmetic; a DJNZ count; a conditional JP and JR both ways; nested CALL and RET three deep; a JP from one routine into another's start, a thousand times round a loop (no stack growth); a data table read with `LD A,(HL)`; a two-block `.CMD`. Each runs to its RET on emu (the stub ROM booted and the program loaded as `lessons.test.ts` does) and on the port (`createZ` loaded with emu's registers and memory at the entry, then `runPort`), and the registers, F, R, the 64K and the T-states are equal at the end. Also: the module is identical when ported twice; it contains no code byte of the program (every code region's bytes are absent from `DATA`); a `JP (HL)` is refused with a sentence; an unknown target throws `o.unknown`'s sentence naming it.
- [ ] **Step 2: Run** them: they fail.
- [ ] **Step 3: Implement** `routines.ts` (routines from the IR), `emit.ts` (the module text, names from `opts.names` then the IR's symbols, notes as JSDoc) and `port.ts`.
- [ ] **Step 4: Run** the tests and `pnpm typecheck`: all pass.
- [ ] **Step 5: Commit** `m1: group a program's blocks into routines and emit its port as one module`

### Task 4: The referee

**Files:**
- Create: `packages/recomp/test/referee.ts` (the helper), `packages/recomp/test/referee.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3; `Machine` from `@fugloy/emu`; the stub ROM as `lessons.test.ts` assembles it.
- Produces: `referee({ cmd, model, names, steps }): RefereeResult`, with `steps` in `check.json`'s form (`run`, `press`, `release`, `row`, `cell`, `pcIn`, as `lessons.test.ts` documents), and `RefereeResult = { ok: true; cycles: number; blocks: number } | { ok: false; report: string; at: { routine: string; block: number; cycles: number }; field: string }`.
- Mechanism: boot emu on the stub ROM, load the program, copy emu's registers and 64K into the port's `z` (so the stub's bytes and its `RETURNED` on the stack are the same on both), then run the port with `z.at` replaced: at each block start, step emu until its T-states reach the port's, then require emu's T-states equal to the port's, emu's PC equal to the block's address, and every register, F, R and MEMPTR equal; at the first block start at or after each frame (1/60 s of the model's clock), video RAM equal; at the end, `$4000`–`$FFFF` equal. Each `check.json` step applies at the first block start at or after its T-state, on both: keys to both keyboards; `row`, `cell` and `pcIn` checked against both (`pcIn` on emu's PC). The run ends when the steps' T-states are spent (`z.at` throws an end marker the referee catches). A write by emu into a byte of the program's code regions fails the run: `self-modifying code: $XXXX written by the instruction at $YYYY (M1 does not translate it)`. The report names the routine, the block, the instruction, the field and both values.

- [ ] **Step 1: Write the failing tests** `referee.test.ts`: Task 3's programs pass the referee with a `run` step each; planted bugs are caught where they should be — a test-only `ops` whose `add8` gets H wrong diverges at the first ADD's following block with field `f`; a test-only emit with one block's tick one T-state short diverges at the next block with field `cycles`; a program that stores into its own next instruction is refused with the self-modifying sentence naming both addresses; a key pressed by a step reaches both machines at the same block (a program that waits for SPACE leaves its wait loop at the same T-state on both).
- [ ] **Step 2: Run** them: they fail.
- [ ] **Step 3: Implement** `referee.ts`.
- [ ] **Step 4: Run** the referee tests and the whole `packages/recomp` suite: all pass.
- [ ] **Step 5: Commit** `m1: add the referee that runs a port beside emu block by block`

### Task 5: Every lesson and chapter, ported and refereed in CI; `fugloy port`

**Files:**
- Create: `packages/recomp/test/learn.test.ts`; the CLI's `port` command in `packages/cli/src/` (following how `fugloy asm` is wired there)
- Modify: `packages/cli` (its command list, README), `CHANGELOG.md`, `CLAUDE.md` (layout: the two new packages; current phase), `docs/Fugloy-Project-Plan.md` (Part 2: M1's status), the design's milestone M1 (done, with the counts)
- Test: `packages/recomp/test/learn.test.ts`, the CLI's test for `port`

**Interfaces:**
- Consumes: Tasks 1–4; `assemble(source, { model })`, `toCmd(result)` and `result.symbols` from `@fugloy/asm`.
- Produces: `fugloy port <program.cmd> --model 1|3 [--hints <file>] [-o <dir>]`, which writes `<name>.port.js` and `<name>.port.txt` (the report) and exits 1 with the errors when the port is refused.

- [ ] **Step 1: Write the failing test** `learn.test.ts`: for every lesson and chapter folder (`apps/web/content/learn/NN-*` and `invaders/NN-*`, found as `lessons.test.ts` finds them) and every model its `check.json` names, assemble `program.z`, port it with names from the assembler's symbols, and expect `referee(...)` to be ok over the check's steps. Timeout as `lessons.test.ts`'s `RUN_TIMEOUT_MS`. And the CLI test: `fugloy port` on chapter 1's `.CMD` writes both files, and the module imports `@fugloy/runtime/ops`.
- [ ] **Step 2: Run** it: it fails until the earlier tasks cover what these programs use; fix any instruction, routine shape or runtime gap it finds in the task's own files, each with a test beside the existing ones.
- [ ] **Step 3: Implement** the CLI command.
- [ ] **Step 4: Run** `pnpm typecheck`, `pnpm test` (the root suite, CI's), and `pnpm --filter @fugloy/web test` (nothing there changed, but the stub ROM is shared): all pass. Report the per-program port sizes, routine counts and how many routines are labelled.
- [ ] **Step 5: Records** as listed under Files; **commit** `m1: port every Learn lesson and chapter and referee each against emu, and add fugloy port`

### Task 6: Structured control flow

**Files:**
- Create: `packages/recomp/src/structure.ts`
- Modify: `packages/recomp/src/emit.ts`
- Test: `packages/recomp/test/structure.test.ts`

**Interfaces:**
- Consumes: Task 3's routines and blocks; Task 4's referee and Task 5's Learn suite as the behaviour check.
- Produces: `structure(routine): Structured`, consumed by `emit`: a routine whose blocks form a straight run, `if`/`else` diamonds and single-entry loops (a backward transfer to a block that dominates its source: DJNZ, JR/JP cc back, an unconditional jump back to a loop head) is emitted with `if`, `while (true)` / `do … while` and `break`/`continue`, and the rest stays labelled; `PortReport.routines[].labelled` says which.

- [ ] **Step 1: Write the failing tests** `structure.test.ts`: the straight-line, DJNZ, diamond and nested-loop programs of Task 3 emit no `switch`; a routine with an irreducible jump stays labelled and its report says so; and the readability check: lesson 1's port has no `switch` and its loop reads as a loop.
- [ ] **Step 2: Run** them: they fail.
- [ ] **Step 3: Implement** `structure.ts` (dominators over the routine's blocks, natural loops, then if/else regions; anything else labelled).
- [ ] **Step 4: Run** the structure tests, the referee and Task 5's Learn suite (behaviour unchanged: every port still matches emu), and `pnpm typecheck`; report how many routines across the Learn ports are still labelled.
- [ ] **Step 5: Commit** `m1: emit loops and conditionals where the control flow allows, labelled blocks elsewhere`
