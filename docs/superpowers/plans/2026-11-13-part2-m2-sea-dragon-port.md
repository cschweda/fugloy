# Part 2, M2: Sea Dragon's Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Sea Dragon (`examples/sea-dragon/seadrg01.cmd`, Model III) to JavaScript with no ROM, no Z80 interpreter and none of its code bytes, prove it against `@fugloy/emu` on three scripted games played from the title to GAME OVER (Novice, Expert, two players), and play it in a browser.

**Architecture:** M1's pipeline (`@fugloy/recomp` → a module on `@fugloy/runtime`, checked by the referee) gains what a real game needs. `port()` takes the hinted, relocated image and a **trace**: a small JSON file an emulator session writes, naming the code bytes the program rewrites, the return addresses it drops, and the ROM bytes it reads. From the trace the recompiler turns a rewritten operand into a read of memory, a swapped opcode into a choice between two translated instructions, and a dropped return address into an explicit unwind. The runtime gains Fugløy's own stand-in for the one ROM routine the game calls (`$0060`), the screen renderer the workbench already has, and a player: the port running in a Web Worker, paced by the emulated clock, with keys through shared memory and sound from its cassette-port writes.

**Tech Stack:** as M1 — TypeScript strict ESM (`@fugloy/recomp`), plain JavaScript ESM with JSDoc (`@fugloy/runtime`), Vitest, `@fugloy/emu` and `@fugloy/asm` as test dependencies; `tsx` for the census tool; `SharedArrayBuffer` and `Atomics.wait` in the player.

**Spec:** `docs/superpowers/specs/2026-10-23-part2-port-and-remake-design.md` — Goals 1 and 2, the Anti-goals, "What the port's code looks like", "The runtime", "The referee for the port" and milestone M2. M1's plan (`docs/superpowers/plans/2026-10-23-part2-m1-port-pipeline.md`) and the two packages' READMEs describe what exists.

## What was measured before this plan (2026-11-13, the local Model III ROM, 125 s of play)

These are facts the tasks build on. Each was measured by running the original on `@fugloy/emu`.

- **Load.** 13,968 bytes at `$5200`–`$888F`, transfer `$8881`. The mover at `$8881`–`$888F` (`NOP / LD HL,5200H / LD DE,497FH / LD BC,3681H / LDIR / JP 497FH`) copies 13,953 bytes to `$497F`–`$7FFF`. With `seadrg01.hints`, `@fugloy/disasm`'s IR is the relocated image at its run addresses plus the mover's one block: 727 blocks, 2,896 instructions, `externals` `[$0060]`, no indirect jump, no RST, no undocumented form. `port()` refuses it today (`packages/recomp/src/port.ts:59`).
- **Code the game rewrites: eight sites.**

  | Cell | Instruction | What is rewritten | Writers | Values seen |
  |---|---|---|---|---|
  | `$49C1` | `$49BF LD A,(IY+d)` | displacement | `$49BC` | `$00`–`$0C` |
  | `$4F41` | `$4F3F LD A,(IY+d)` | displacement | `$4F3C` | `$00`–`$0D` |
  | `$5AD0` | `$5ACE LD A,(IX+d)` | displacement | `$5AC7` | `$00`–`$50` |
  | `$5ADD` | `$5ADB LD B,(IX+d)` | displacement | `$5ACB` | `$01`–`$51` |
  | `$509B`, `$509C` | `$509A JP nn` | target word | `$4D00`, `$4D3A` | `$509D`, `$50C1` |
  | `$525E` | `JP NZ,nn` / `JP Z,nn` | opcode | `$4D0B` (`$C2`), `$4D4C` (`$CA`) | `$C2`, `$CA` |
  | `$5174` | `LD (HL),A` / `NOP` | opcode | `$5D5E`, `$5D77`, `$5DB6`, `$5DCD`, `$5C60` | `$77`, `$00` |
  | `$5AEA` | `CALL 6212H` / `RET` | opcode | `$4D54` (`$CD`), `$5AEF` (`$C9`) | `$CD`, `$C9` |

  `$50C1`–`$50E7` is code the static analysis does not find: it is reached only through the rewritten `JP` at `$509A`. Nothing else writes into code after the mover.
- **The ROM.** The game calls one routine, `$0060` (`$DELAY`), from `$4EAC`, `$4EBC`, `$4EC6`, `$5512`, `$5F71` and `$6022`. On the real ROM it is `JP 01FBH`, then at `$01FB` `LD A,A / DEC BC / LD A,B / OR C / JR NZ,01FBH / RET`: **30·BC + 15** T-states after the CALL (BC = 0 counts as 65,536), leaving A = `$00`, F = `$44`, BC = 0. The game also reads ROM bytes as data through a null pointer: `$515D LD A,(IX+00H)` reads `$0000` (`$F3` on the real ROM and on Fugløy's stub), and `$5168 SET 0,(IX+03H)` reads `$0003` and writes it back, which the ROM ignores.
- **Interrupts.** The game's only interrupt instruction is `DI` at `$497F`. It never enables them and the emulator takes none. **M2 adds no interrupts to the port.**
- **Devices.** `OUT ($FF)` at `$6217` and `$621E` (sound: 12,552 records in the session); `OUT ($EC),$30` at `$499F`; `IN ($00)` at `$5192` and `$5B49` (the joystick, reads `$FF`); keyboard rows `$3804`, `$3810`, `$3840`, `$3880`; video RAM read at ten sites.
- **The stack.** `$4BAC POP AF` drops a CALL's return address (the title loop is left for good when a game starts); it ran 6 times. `$550A`/`$550B` (two `POP AF`) may do the same but never ran. Every RET popped an address a CALL pushed. Deepest nesting: 3.
- **A trial port of the relocated image:** 27 routines, all structured; 110 blocks translated in two routines; 382,197 bytes.
- **The sessions.** The title shows 5.0 s after the load. ENTER, then `1` or `2` (players), then `0` (Novice) or `1` (Expert) per player. Played with a repeating key pattern, each chord held 0.2 s: Novice `[UP+SPACE], [UP]` reaches GAME OVER in 27.6 s; Expert `[RIGHT], [UP], [SPACE], [DOWN+SPACE], [ENTER], [UP+SPACE], [], [LEFT]` in 15.4 s; two players `[SPACE], [], [UP+ENTER], [DOWN], [SHIFT+UP], [RIGHT+SPACE]` in 48.2 s. GAME OVER returns to the title in about 8 s. On Fugløy's stub ROM the game halts at its first `CALL 0060H`, 12.49 s into a Novice game.
- **Speed.** The emulator runs the game at about 100M T-states a second alone and about 38M with a second `Machine` in the process; M1's referee ran at about 19M. The three sessions are about 250M T-states.

## Global Constraints

- M1's constraints stand: `@fugloy/runtime` is plain JavaScript ESM with JSDoc, **no dependencies**, and its `.` and `./ops` entries use no DOM and no Node APIs; `@fugloy/recomp` is TypeScript strict ESM with runtime dependencies `@fugloy/z80` and `@fugloy/disasm` only, no DOM, no Node APIs; `packages/cli` is the only package that touches `fs`. Code that needs `@fugloy/emu` (the referee, the census) lives in `packages/recomp/test/` or `packages/recomp/tools/`, never in `src/`.
- A port is generated, never hand-edited, and deterministic: the same program, model, hints and trace give the same module byte for byte.
- A port carries **none of the program's code bytes** and nothing decodes Z80 at run time. Two things are allowed and listed in the port's report: the **initial value of a rewritten operand** (one or two bytes per site, which the program treats as data), and a **choice between translated instructions** where the program swaps an opcode (each alternative is translated ahead of time from the values the trace saw; a value it did not see throws).
- **Sea Dragon's port has no labelled routine and no interpreter region** (the design's first anti-goal). If a task cannot keep that, stop and say so.
- Every block's T-states and R increments, flags, MEMPTR and Q stay exact against `@fugloy/emu`, as in M1. The referee's comparison is never weakened to make a session pass.
- Anything the port cannot follow fails loud with a sentence naming the address and the instruction. From this milestone that includes, in a standalone port, **a write into a code byte that is not one of the trace's cells**.
- The referee runs in CI on Fugløy's stub ROM extended with Fugløy's own stand-ins, never the user's ROM. Locally, when `fugloy.mcp.json` names a Model III ROM, the same sessions also run on it; with no ROM those tests skip (and the suite still passes in a clean checkout).
- No ROM byte of Tandy's is committed or bundled. The stand-in for `$0060` is Fugløy's own code, written from the routine's documented behaviour and the timing measured above.
- M2 is `seadrg01.cmd` on the Model III. The other Sea Dragon builds and the Model I are not in scope.
- A test an earlier task wrote that a later task makes false on purpose (Sea Dragon's `refused` list shrinking, the trace's `entered` emptying) is updated by the later task, which says so in its report. No other earlier test changes.
- Commit messages: one line, imperative, prefix `m2:`, no trailers of any kind. Work on branch `part2-m2` (from `staging`); the pull request targets `staging`; `main` is merged only on the user's word.
- Keep the design's M2 status, `docs/Fugloy-Project-Plan.md`'s Part 2 section, `CLAUDE.md`, `CHANGELOG.md` (`[Unreleased]`) and the packages' READMEs current. The records are written once, in Task 7 (the port) and Task 9 (the browser); each task keeps the READMEs of the packages it changes current.

## Claude's calls, for the user to check

1. **An opcode swap is translated as a choice, not refused.** The design says a rewritten site "becomes a variable the write updates and the instruction reads" and that a site it cannot express that way is an error. Three of Sea Dragon's eight sites swap a whole opcode. Each becomes `switch (z.mem[site])` over the two instructions the trace saw, both translated ahead of time. This is not the interpreter the anti-goal forbids (nothing is decoded at run time, and an unseen value throws), but it is a judgment, and the report lists each one.
2. **The trace is written on the stub ROM**, so CI can regenerate it and check it is not stale, and so the two ROM bytes a port carries (`$0000`, `$0003`) are Fugløy's own.
3. **The loader's mover is not translated.** The port starts at the game's own entry (`$497F`) with its data already at its run addresses; the report says so.
4. **The browser player needs cross-origin isolation** (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`). The port is ordinary functions that never yield, so the worker it runs in must block to keep time and must read keys from shared memory. M2's player runs from a local server that sends those headers; putting it on the site is M3.
5. **The player is not added to `app.fugloy.dev` in M2.** M3 is the bundle and the arcade page.

## Review Focus

1. **A code write the trace did not see** (a path the three sessions never took rewrites another byte): the referee refuses it naming both addresses, and a standalone port throws at the write, never runs on with stale code (Tasks 3, 4).
2. **A rewritten cell holding a value the trace did not see**: a displacement cell takes any value (it is read when the instruction runs); a jump-target cell or an opcode cell with an unseen value throws a sentence naming the cell, the value and the values known (Tasks 4, 5).
3. **A dropped return address the trace did not see** (`$550A`/`$550B` never ran): the port's next RET finds the wrong address and throws M1's sentence, which now adds that the census may need a longer session (Task 6).
4. **`$DELAY` at its edges**: BC = 0 (65,536 passes), BC = 1, and a key pressed while it runs; the stand-in's T-states, R, A, F and BC match the emulator on the stub ROM and, locally, on the real ROM (Task 2).
5. **Time in the browser**: a tab left in the background, or a slow frame, must not make the game run fast to catch up, and a key pressed and released within one frame must still be seen by the game (Task 9).

---

### Task 1: Porting a relocated program

**Files:**
- Modify: `packages/recomp/src/port.ts`, `src/emit.ts` (the report), `packages/recomp/test/referee.ts`, `test/helpers.ts`, `packages/recomp/README.md`
- Test: `packages/recomp/test/relocate.test.ts`

**Interfaces:**
- Consumes: `analyze`, `buildIr` and the hint parser from `@fugloy/disasm` (the IR's `relocations`, `entry`, its roots, `regions` at run addresses; `analysis.space.image` holds the bytes at run addresses).
- Produces: `PortReport` gains `entryAddr: number`, `loader?: { addr: number; length: number; note: string }` and `data: { addr: number; length: number; kind: 'data' | 'unknown' }[]` (`unknown` is a region the analysis did not reach). With a relocating hint file, `ENTRY` is the routine at the hinted entry inside the relocated range, `DATA` holds the non-code regions at their run addresses, and the loader's code (the file's transfer routine) is not translated. `referee()` starts its comparison the first time the emulator's PC equals `report.entryAddr`, takes its code map from the IR's run-address code regions, and excludes from the end-of-run memory comparison only the bytes the loader left behind (the file range outside the run range), stated in a comment.

- [ ] **Step 1: Write the failing tests** in `relocate.test.ts`. A synthetic program built in the test with `@fugloy/asm`: a body assembled at `$6000` (a loop that fills a row of video RAM from a data table and returns), placed in the file at `$7000` behind a mover (`LD HL / LD DE / LD BC / LDIR / JP 6000H`), with a hint file written from disasm's own skeleton plus `block 0:$0000 relocate $6000 $<len>` and `block 0:$0000 entry`. Expect: `port()` is ok; `report.entryAddr === 0x6000`; `report.loader` names the mover's address; no `DATA` entry lies in the file range; the module holds none of the body's code bytes; `referee()` over a `run` step is ok. A second test: `seadrg01.cmd` with `seadrg01.hints` ports ok, with `entryAddr === 0x497F`, 27 routines, none labelled, and `refused` naming the six `CALL 0060H` sites. A third: with no hint file the report's 15 data regions are all `kind: 'unknown'`.
- [ ] **Step 2: Run** `pnpm vitest run packages/recomp/test/relocate.test.ts`: it fails with "relocates part of the program".
- [ ] **Step 3: Implement.** Remove the refusal; slice `DATA` from the analysis image, not the file image; choose the entry; fill the report; teach the referee the three things above.
- [ ] **Step 4: Run** the new tests, `pnpm vitest run packages/recomp` (the Learn suite's 38 runs must still pass unchanged) and `pnpm typecheck`.
- [ ] **Step 5: Commit** `m2: port a program its hint file relocates, from its own entry`

### Task 2: ROM stand-ins, and the ports Sea Dragon uses

**Files:**
- Create: `packages/runtime/src/rom.js`; `packages/recomp/test/game-rom.ts`
- Modify: `packages/runtime/src/ops.js`, `src/z.js` (port `$00`), `src/index.js`, `packages/runtime/README.md`; `packages/recomp/src/port.ts`, `src/emit.ts`, `packages/recomp/README.md`; `packages/cli/src/port.ts` and its `package.json` (it now depends on `@fugloy/runtime` for the stand-ins' names)
- Test: `packages/runtime/test/rom.test.js`, `packages/recomp/test/standin.test.ts`

**Interfaces:**
- Produces, in `rom.js`: `standins(model: 1 | 3): ReadonlyMap<number, { name: string; run(z): void }>` — for model 3, `0x0060` → `{ name: 'DELAY' }`; for model 1, empty; and `STANDINS_Z: string`, the same routines as Z80 source for `@fugloy/asm`, laid out as the ROM lays them out (`ORG 0060H / JP 01FBH`, and the loop at `01FBH`), so the emulator running them matches the real ROM's timing.
- `o.standin(z, addr, returnAddr)` in `ops.js`: pushes `returnAddr` as a CALL does, runs the stand-in (which ticks its own T-states and R), and pops, leaving the stack bytes the emulator leaves.
- `PortOptions` gains `standins?: ReadonlyMap<number, string>` (address → name). A CALL to an address in it is emitted as `o.standin(z, 0x0060, 0x4EAF); // CALL $DELAY` and is no longer in `refused`; `PortReport` gains `standins: { addr: number; name: string; sites: number[] }[]`. The CLI passes the model's.
- `gameStubRom(model): Uint8Array` in `test/game-rom.ts`: Fugløy's stub ROM source followed by `STANDINS_Z`, assembled with `@fugloy/asm`. The referee and every later task use it for games; the Learn suite keeps the plain stub.
- Port `$00` on the Model III reads what `@fugloy/emu` returns (cite `packages/emu/src/devices/io.js`), and is no longer a refusal.

- [ ] **Step 1: Write the failing tests.** `rom.test.js`: for BC = 1, 2, 3, 256, 8192 and 0, `standins(3).get(0x0060).run(z)` adds `30 * (BC || 65536) + 15` T-states and `5 * (BC || 65536) + 2` to R (mod 128), and leaves A = 0, F = `0x44`, BC = 0, every other register unchanged. `standin.test.ts`: a program that calls `$0060` with each of those BC values between writes to video RAM passes `referee()` on `gameStubRom(3)`; the same program on the user's Model III ROM passes when `fugloy.mcp.json` names one (skipped otherwise); `IN A,(00H)` matches the emulator; a CALL to a ROM address with no stand-in is still in `refused` and still throws when it runs.
- [ ] **Step 2: Run** them: they fail (no `rom.js`).
- [ ] **Step 3: Implement** the stand-in in JavaScript and in Z80, `o.standin`, the emitter's case, the report, the port.
- [ ] **Step 4: Run** `pnpm vitest run packages/runtime packages/recomp` and `pnpm typecheck`.
- [ ] **Step 5: Commit** `m2: stand in for the ROM's $DELAY, in JavaScript and in the stub ROM the referee boots`

### Task 3: The sessions, the census and the trace file

**Files:**
- Create: `packages/recomp/src/trace.ts`; `packages/recomp/tools/census.ts`, `tools/census-cli.ts`; `packages/recomp/test/sessions/sea-dragon.ts`; `docs/port-trace-format.md`; `examples/sea-dragon/seadrg01.trace.json` (generated)
- Modify: the root `package.json` (`"census": "tsx packages/recomp/tools/census-cli.ts"`), `packages/recomp/src/index.ts`, `packages/recomp/README.md`, `examples/sea-dragon/README.md`
- Test: `packages/recomp/test/census.test.ts`

**Interfaces:**
- `PortTrace` and `parseTrace(text: string, programSha256: string): PortTrace` in `trace.ts` (pure; throws a sentence for another format version or another program). The file, with addresses as JSON numbers as in `docs/label-format.md`:

  ```json
  {
    "fugloy-trace": 1,
    "program": { "name": "seadrg01.cmd", "sha256": "…" },
    "model": 3,
    "rom": "stub",
    "sessions": [{ "name": "novice", "cycles": 0 }],
    "patches": [{ "addr": 18881, "writers": [18876], "values": [0, 1] }],
    "entered": [[20673, 20711]],
    "drops": [{ "at": 19372, "count": 6 }],
    "romReads": [{ "addr": 0, "value": 243 }]
  }
  ```

  `patches`: each code byte written after the program's entry, with the instructions that wrote it and every value written, sorted by address. `entered`: ranges that executed but are not code in the hinted IR. `drops`: each `POP` that took a CALL's return address off the stack. `romReads`: each address below `$3000` read as data, with the byte read. Arrays are sorted, so the file is deterministic.
- `Session = { name: string; play(m: Machine): void }` and `SESSIONS: Session[]` in `test/sessions/sea-dragon.ts`: `novice`, `expert`, `two-players`, each from a fresh machine at the program's entry: wait for the title, ENTER, the player and skill keys, then the measured key pattern (above) until the bottom row reads `Game Over Player 1` (`Player 2` for two players), then run until the title returns. `recordSession(rom, session): Step[]` runs a session on the emulator and returns its keys as T-state-stamped `press`/`release` steps with `row` checks at the title, at each prompt and at GAME OVER, ending in a `run` step: the form the referee replays.
- `census({ cmd, hints, model, rom, sessions }): PortTrace` in `tools/census.ts`, using `m.debug` (coverage, a write hook, a hook on `POP` and `CALL`); `pnpm census <program.cmd> --hints <file> --model 3 --sessions sea-dragon -o <trace.json>` runs it on `gameStubRom`.

- [ ] **Step 1: Write the failing tests** in `census.test.ts`: each of the three sessions, on `gameStubRom(3)`, shows `BY: Wayne` on the title and reaches its GAME OVER row, and `recordSession` gives the same steps twice; `census` over the three finds exactly the eight sites of the table above (nine cells: `$509B` and `$509C` are two), with those writers and with the opcode cells' two values each; `entered` is `[[0x50C1, 0x50E7]]`; `drops` is `$4BAC` alone; `romReads` is `$0000` (`$F3`) and `$0003`; the committed `seadrg01.trace.json` equals what `census` writes now (the staleness check); `parseTrace` refuses a trace for another program.
- [ ] **Step 2: Run** them: they fail.
- [ ] **Step 3: Implement** the sessions (start from the measured timings; adjust the patterns only if a session does not end on the stub ROM, and say so), the census, the parser, the format document; write the trace with `pnpm census`.
- [ ] **Step 4: Run** `pnpm vitest run packages/recomp/test/census.test.ts` and `pnpm typecheck`; report each session's length in T-states.
- [ ] **Step 5: Commit** `m2: record Sea Dragon's three games and take its census into a trace file`

### Task 4: Rewritten operands, and writes into code refused in a standalone port

**Files:**
- Modify: `packages/recomp/src/port.ts`, `src/translate.ts`, `src/emit.ts`, `packages/recomp/test/referee.ts`; `packages/runtime/src/run.js`, `src/z.js`; both READMEs; `examples/sea-dragon/seadrg01.hints` (an `entry` at `$50C1`, with a note saying how it is reached)
- Test: `packages/recomp/test/patch.test.ts`, `packages/runtime/test/guard.test.js`

**Interfaces:**
- `PortOptions` gains `trace?: PortTrace`. `port()` matches each `patches` cell to the instruction byte it is in the IR: a displacement, an immediate, a word operand's low or high byte, or an opcode. A cell that is none of these, or an opcode cell before Task 5, makes `port()` fail with a sentence naming the cell and its instruction.
- `translate`'s `ctx` gains `cells?: { disp?: number; imm?: number; word?: number }`: the addresses to read the operand from. A displacement becomes a signed read of `z.mem[cell]`; a word operand `z.mem[lo] | z.mem[lo + 1] << 8`. For `JP nn` with a patched word the `Translation` has `targetExpr` and `targets: number[]` (the trace's values); `emit` writes a transfer for each known target and `throw o.unknown(...)` otherwise.
- The module exports `CELLS: [addr, byte][]` (each cell's initial value) and `CODE: [start, end][]` (its code ranges). `load(z, mod)` writes `CELLS` and installs a write guard: a write to a `CODE` address that is not a cell throws `self-modifying code: $XXXX written (the trace does not name it; run the census over a session that reaches this)`. `PortReport` gains `cells: { addr: number; instruction: number; kind: 'disp' | 'imm' | 'word' | 'opcode'; values: number[] }[]`.
- The referee allows the emulator's writes to the trace's cells and compares those bytes like any other written byte; any other write into code is still refused with M1's sentence.

- [ ] **Step 1: Write the failing tests.** `patch.test.ts`, synthetic programs with a trace written by `census` in the test: one rewrites the displacement of `LD A,(IX+d)` in a loop and sums a table; one rewrites a `JP nn` between two targets; one rewrites an immediate. Each passes the referee and its module reads the cell (`z.mem[0x…]`) where the operand was. A jump-target cell given a third value at run time throws naming the cell, the value and the two known targets. A program that rewrites a code byte the trace does not name is refused by the referee and, as a standalone port, throws the guard's sentence at the write. `guard.test.js`: `load` installs the guard; a write to a cell passes, to other code throws, to data passes. And: `seadrg01` with its hints and trace now fails only for the three opcode cells, each named.
- [ ] **Step 2: Run** them: they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm vitest run packages/recomp packages/runtime` and `pnpm typecheck`; confirm `census` now reports `entered` empty for Sea Dragon, regenerate the trace, and update Task 3's `entered` assertion to match.
- [ ] **Step 5: Commit** `m2: read a rewritten operand from memory when its instruction runs, and refuse any other write into code`

### Task 5: Swapped opcodes

**Files:**
- Modify: `packages/recomp/src/port.ts`, `src/routines.ts`, `src/structure.ts` (only if a variant site needs it), `src/emit.ts`, `packages/runtime/src/ops.js`; `packages/recomp/README.md`
- Test: `packages/recomp/test/variant.test.ts`

**Interfaces:**
- For an opcode cell, `port()` decodes one instruction per value the trace saw (the cell's byte replaced, the following bytes as loaded) with `@fugloy/z80`. The site is a block of its own whose successors are the union of its variants' successors, and any successor the static analysis did not reach is analysed as code. `emit` writes `switch (z.mem[0x525E]) { case 0xC2: …; break; case 0xCA: …; break; default: throw o.variant(z, 0x525E, [0xC2, 0xCA]); }`, each case being that instruction's ordinary translation with its own tick. `o.variant` returns an `Error` whose sentence names the cell, the value found and the values known. `PortReport.cells[].kind === 'opcode'` entries gain `variants: string[]` (each instruction's text).
- A variant site is not a labelled routine: `PortReport.routines[].labelled` is unchanged by it.

- [ ] **Step 1: Write the failing tests** in `variant.test.ts`, synthetic programs with traces from `census`: a `JP Z` / `JP NZ` swap; a `LD (HL),A` / `NOP` swap; a `CALL nn` / `RET` swap (the two bytes after a `RET` are never run). Each passes the referee over a session that uses both variants; the module has one `switch` on the cell and no `switch (b)`; an opcode cell given a third value throws `o.variant`'s sentence. And: `seadrg01` with its hints and trace ports ok, with eight sites in `report.cells`, no labelled routine and `refused` empty.
- [ ] **Step 2: Run** them: they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm vitest run packages/recomp` and `pnpm typecheck`.
- [ ] **Step 5: Commit** `m2: translate a swapped opcode as a choice between the instructions the trace saw`

### Task 6: Dropped return addresses

**Files:**
- Modify: `packages/recomp/src/routines.ts`, `src/emit.ts`, `packages/runtime/src/ops.js`, `src/run.js`; both READMEs
- Test: `packages/recomp/test/unwind.test.ts`

**Interfaces:**
- For each `drops` entry the instruction after the `POP` starts a routine of its own (a continuation). The `POP` is translated as usual, then its block ticks and throws `o.unwind(1, CONTINUATION)`. `o.call`'s trampoline catches an unwind: with levels left it rethrows with one fewer, abandoning the JavaScript frame whose return address the program dropped; at zero it goes on with the continuation. `runPort`'s top level is such a trampoline. `PortReport` gains `drops: { at: number; continuation: string }[]`.
- `o.ret`'s sentence for a wrong return address gains: `(if a POP dropped a return address here, the census needs a session that reaches it)`.

- [ ] **Step 1: Write the failing tests** in `unwind.test.ts`: a synthetic program shaped like Sea Dragon's title (a loop CALLs a routine that jumps into another routine, which pops the return address and carries on, then returns to the loop's caller) passes the referee with a trace from `census`, runs the loop's exit ten thousand times without growing the JavaScript stack, and its report lists the drop. Without the trace the same program stops with `o.ret`'s sentence. Two return addresses dropped by two `POP`s in a row unwind two frames.
- [ ] **Step 2: Run** them: they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm vitest run packages/recomp packages/runtime` and `pnpm typecheck`.
- [ ] **Step 5: Commit** `m2: unwind the caller whose return address a POP drops`

### Task 7: Sea Dragon refereed from the title to GAME OVER; `fugloy port --trace`; the records

**Files:**
- Create: `packages/recomp/test/sea-dragon.test.ts`
- Modify: `packages/recomp/test/referee.ts` (sound), `packages/runtime/src/run.js` (the ROM bytes); `packages/cli/src/port.ts`, its test and README; `CHANGELOG.md`, `CLAUDE.md`, `README.md`, `docs/Fugloy-Project-Plan.md`, the design's milestone M2; the packages' READMEs; `examples/sea-dragon/README.md`
- Test: `packages/recomp/test/sea-dragon.test.ts`, `packages/cli/test/port.test.ts`

**Interfaces:**
- The referee compares the port's sound records with the emulator's (`z.sound` against `m.sound`: the T-state and the byte of each write to port `$FF`) at every frame, and reports the first difference with field `sound`. A program with no port writes is unaffected.
- The module exports `ROM: [addr, byte][]` from the trace's `romReads`; `load` puts them in memory. The report lists them.
- `fugloy port <program.cmd> --model 1|3 [--hints <file>] [--trace <file>] [-o <dir>]`.

- [ ] **Step 1: Write the failing tests.** `sea-dragon.test.ts`: `seadrg01.cmd` with its hints and committed trace ports ok; for each of the three sessions, `referee()` over `recordSession`'s steps on `gameStubRom(3)` is ok, with `blocks` and `frames` above zero and the session's GAME OVER row checked on both machines; the port's report has no labelled routine, eight cell sites, one drop, the `DELAY` stand-in and two ROM bytes; the module contains none of the game's code bytes (every IR code region's bytes are absent from `DATA`, except the cells' initial bytes, which are in `CELLS`); porting twice gives the same text. The same three sessions on the user's Model III ROM when `fugloy.mcp.json` names one, skipped otherwise. A referee test with a planted sound difference (a test-only `ops` whose `out` stamps one T-state late) fails with field `sound`. The CLI test: `--trace` is read and a trace for another program is refused with a sentence.
- [ ] **Step 2: Run** them: they fail until Tasks 1–6 cover what the game does. Fix any instruction, routine shape, device or referee gap the sessions find in the file that owns it, each with a test beside that file's existing tests, and list each in the report. If the referee reports that the game reads one of its own code bytes as data, stop and report the site: the plan assumed it does not.
- [ ] **Step 3: Implement** the sound comparison, the ROM bytes and the CLI flag.
- [ ] **Step 4: Run** `pnpm typecheck`, `pnpm test` and `pnpm --filter @fugloy/web test`. Report: the port's size, routines, blocks, how many blocks are translated in more than one routine, each session's T-states and wall time, and the referee's speed.
- [ ] **Step 5: Records** as listed under Files (state only what the tests prove; name the limits: Model III and `seadrg01` only, no interrupts, the sessions' three games); **commit** `m2: referee Sea Dragon's port against emu through three games to GAME OVER, and add fugloy port --trace`

### Task 8: One screen renderer, in the runtime

**Files:**
- Create: `packages/runtime/src/screen.js`, `src/glyphs.generated.js`, `packages/runtime/scripts/build-glyphs.mjs`, `packages/runtime/NOTICE.md` (xtrs's licence, as `apps/web/NOTICE.md` has it)
- Modify: `packages/runtime/package.json` (an export `./screen`), its README; `apps/web/app/utils/emulator/screen.ts` (keeps `screenView` and its types; re-exports the rest from `@fugloy/runtime/screen`), `apps/web/aliases.ts`, `apps/web/package.json`, `apps/web/scripts/build-glyphs.ts` (removed, or a line that runs the runtime's), `apps/web/NOTICE.md`
- Delete: `apps/web/app/utils/emulator/glyphs.generated.ts`
- Test: `packages/runtime/test/screen.test.js`; the web app's `test/screen.test.ts` and `test/glyphs.test.ts` keep passing

**Interfaces:**
- `@fugloy/runtime/screen` exports what `apps/web/app/utils/emulator/screen.ts` exports today except `screenView` (which reads an emulator `Machine`): `SCREEN_FG`, `SCREEN_BG`, `screenSize`, `MODEL3_ASPECT`, `MODEL1_ASPECT`, `tubeAspect`, `tubeFit`, `panelFit`, `renderScreen`, `renderNotice`, and the glyph sets `CG_MODEL1`, `CG_MODEL1_LOWERCASE`, `CG_MODEL3`, `CG_MODEL4`, with the same signatures, as JavaScript with JSDoc types. It draws RGBA into a `Uint8ClampedArray` and uses no DOM.
- `screenOf(z): ScreenView` in `screen.js`: the view of a port's video RAM (its 1K, the model, the 32-column bit), as `screenView` gives for an emulator.

- [ ] **Step 1: Write the failing test** `screen.test.js`: for the Model III and the Model I, a video RAM holding every byte value once renders, through the runtime's `renderScreen`, to exactly the pixels the web app's renderer gave before the move (take the expected hash from the current code and pin it in the test); `screenOf(z)` after a port's writes equals the emulator's `screenView` for the same bytes.
- [ ] **Step 2: Run** it: it fails (no `screen.js`).
- [ ] **Step 3: Move** the renderer and the glyph tables, generate the tables with the runtime's script, and point the web app at them.
- [ ] **Step 4: Run** `pnpm --filter @fugloy/web typecheck`, `pnpm --filter @fugloy/web test`, `pnpm --filter @fugloy/web test:seo`, `test:prefetch`, `size:first-screen` (and `-- --page learn`, `-- --page invaders`), `pnpm --filter @fugloy/web test:e2e`, and `pnpm test`. The first-screen sizes must stay inside their budgets and no first screen may preload the renderer. Report the three sizes before and after.
- [ ] **Step 5: Commit** `m2: keep one screen renderer and one glyph table, in the runtime, for the workbench and the ports`

### Task 9: Sea Dragon in a browser

**Files:**
- Create: `packages/runtime/src/player/frame.js` (pacing; no DOM), `src/player/sound.js` (records to samples; no DOM), `src/player/keys.js` (browser keys to matrix rows; no DOM), `src/player/worker.js`, `src/player/page.js`, `src/player/index.html`; `packages/recomp/tools/play.ts` (ports a game into `.play/<name>/` and serves it)
- Modify: `packages/runtime/package.json` (an export `./player`), its README; the root `package.json` (`"play": "tsx packages/recomp/tools/play.ts"`); `.gitignore` (`.play/`); `CHANGELOG.md`, `CLAUDE.md`, the design's milestone M2 (done), `docs/Fugloy-Project-Plan.md`
- Test: `packages/runtime/test/player.test.js`

**Interfaces:**
- `frame.js`: `createClock({ clockHz, now })` with `due(cycles): number`, the milliseconds the port is ahead of real time at emulated T-state `cycles` (0 when it is behind); when it falls more than a quarter of a second behind, the clock moves its origin forward so the game never runs fast to catch up. `FRAME = clockHz / 60` T-states.
- `sound.js`: `samples(records, from, to, clockHz, sampleRate): Float32Array`, a square wave from the cassette port's writes between two T-states, as the levels `@fugloy/emu`'s `m.sound` documents.
- `keys.js`: `KeyTracker`, which turns `keydown`/`keyup` names into matrix rows written into a shared `Uint8Array(8)`, with the workbench's rule for a character typed with Shift (`apps/web/app/utils/emulator/keyboard.ts`), and which holds a key pressed and released inside one frame until the frame after.
- `worker.js`: creates `z`, loads the port, replaces `z.at` with one that, at the first block start at or after each frame, posts the 1K of video RAM and the frame's sound records to the page, reads the shared key rows, and waits `clock.due(z.cycles)` with `Atomics.wait`. `page.js`: a canvas drawn with `@fugloy/runtime/screen`, key listeners on it, WebAudio fed from `samples`, started on the first key or click. `index.html`: the canvas, the game's name, its authors and its public-domain line, and the keys.
- `pnpm play examples/sea-dragon/seadrg01.cmd --hints … --trace …` writes `.play/seadrg01/` (the port, the runtime's files, `index.html`) and serves it on `localhost` with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.

- [ ] **Step 1: Write the failing tests** in `player.test.js`, all without a DOM: the clock asks for a wait when the port is ahead, for none when behind, and after a two-second stall asks the port to run no more than a quarter of a second of emulated time before waiting again; `samples` over two writes a known number of T-states apart gives a square wave of that length at 48,000 Hz, and no sound for no writes; `KeyTracker` gives `:` without SHIFT for Shift+`;`, and a key pressed and released between two frames is in the rows for one whole frame; a headless run of the worker's loop (its `postMessage` and its wait injected) over Sea Dragon's port for 600 frames posts 600 screens, and the screen it posts at each frame equals the referee's emulator's video RAM at that frame for the same keys.
- [ ] **Step 2: Run** them: they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm vitest run packages/runtime`, `pnpm typecheck` and `pnpm test`. Then `pnpm play` and, in a real browser: the title animates at the original's speed; ENTER, `1`, `0` start a game; the sub moves and fires; sound plays; a game ends at GAME OVER and returns to the title; the tab left in the background for a minute comes back at normal speed. Screenshot the title and a game in progress and name the files in the report. Say plainly anything that was not checked.
- [ ] **Step 5: Records** (M2 done, with what was checked by test and what by hand); **commit** `m2: play a port in a browser, paced by the emulated clock, with keys and sound`

---

## After the last task

A whole-branch review, then a pull request against `staging`. What stays open for later milestones: the bundle, the arcade page and the site's cross-origin headers (M3); interrupts in a port, the Model I, and the other Sea Dragon builds; a `fugloy census` command for a user's own program; the deferred items from M1's reviews that M2 did not touch.
