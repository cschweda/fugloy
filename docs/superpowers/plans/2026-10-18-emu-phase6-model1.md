# Emu Phase 6 (Model I) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `new Machine({ model: 1 })` is a Model I with Level II BASIC and the Expansion Interface: its ROM boots to READY, its fixture programs run to their title screens, and it boots from a JV1 disk through the WD1771 (emu spec §11 phase 6, first half).

**Architecture:** `TRS80System` today is the Model III. This phase factors the model-specific parts (memory map, I/O decode, clock, timer interrupt, video, cassette bits, disk controller wiring) into a model description chosen at construction, keeping the Model III path byte-identical (every phase 2–5 determinism and golden test unchanged). The Model I adds memory-mapped devices at `$37E0–$37EF` (interrupt latch, drive select, the WD1771's four registers), a 40 Hz heartbeat through the latch, the stock video's missing bit 6, and the 1.77408 MHz clock.

**Tech Stack:** plain JavaScript ESM (emu, mcp), Vitest.

**Spec:** `docs/fugloy-emu-spec.md` §5 (the Model I column: clock 1.774 MHz, 12 KB ROM at `0000–2FFF`, keyboard `3800–3BFF`, video `3C00–3FFF` 64×16, RAM 4/16/32/48 KB from `4000`, port `FF` cassette and sound, WD1771 at `37EC–37EF`, drive select `37E1`, interrupt latch `37E0`, 40 Hz timer, printer `37E8`), §3 (`Machine({ model })`), §6 (loaders on both models), §11 row 6; `docs/fugloy-mcp-spec.md` §5 `load { model }`.

## Global Constraints

- emu: plain JS ESM, no DOM, no Node APIs, deterministic, no runtime dependencies; `test/no-dom.test.js` passes.
- The Model III must not change: every existing emu and mcp test, golden, and the phase 3 Sea Dragon label file stay byte-identical; Sea Dragon stays ≥ 20× real time (measure, and run the benchmark when the machine is quiet).
- Every Model I hardware fact is cited (Model I Technical Reference Manual, the Expansion Interface manual, the Level II ROM disassembly in `kiwisincebirth/TRS-80-ROMS` as `fugloy-rom-sources` memory records) in a comment where the code decides it, or marked unverified in spec §5.
- ROMs, DOSes, and copyrighted programs are never committed; tests needing them read `fugloy.mcp.json` / `fixtures/real/` and skip without them; every behaviour also has a synthetic-ROM test that runs in CI.
- Commit messages: imperative, one line, prefix `e6:`. No `Co-Authored-By` or any AI trailer.
- Keep `docs/fugloy-emu-spec.md`, `docs/fugloy-mcp-spec.md`, `CLAUDE.md`, `CHANGELOG.md` (detailed), the emu and MCP READMEs, and the root README current.

## Rulings made while planning

1. **Model 4 is split off.** No Model 4 ROM or boot disk is in `fixtures/real/`, so "its ROM boots" cannot be proven; Model 4 becomes its own plan when one is supplied (record it in spec §11 and CLAUDE.md). This plan is the Model I.
2. **RAM sizes.** Model I takes `ram: 4 | 16 | 32 | 48` (default 48); the Model III keeps 48 only for now (16/32 are cheap but untested programs; leave them refused with a sentence naming a later phase).
3. **Video.** The stock Model I has no bit-6 video RAM: a stored byte reads back and displays as `b & 0xBF` when bit 5 or bit 7 is set, else `b | 0x40` (the gate the Explain work cited; verify against the Model I manual or MAME's trs80 driver and cite). `m.video.text()` follows it. A `lowercase: true` option models the common lowercase modification.
4. **Timer.** The Expansion Interface raises a 40 Hz interrupt through the latch at `$37E0` (bit 7 timer, bit 6 disk), IM 1, read clears per the manual; without the Expansion Interface (`expansion: false`) there is no timer and no disk.
5. **Disk.** The WD1771 reuses the phase 5 controller core with the 1771's differences (single density only; no side compare; data address marks `F8–FB` read as written; 128–1024-byte sectors by the length code; INTRQ to the latch, not an NMI), memory-mapped at `$37EC–$37EF`, drive select at `$37E1`. JV1 is the Model I's native format.
6. **Keyboard hook.** The Model I ROM's scan entries are checked against the Level II disassembly; the hook stands in only where the routine contract matches the Model III's (cite the addresses), otherwise `feed` is refused on the Model I with a sentence and matrix typing is used.

## Review Focus

1. Constructing a Model III after this change must give byte-identical `serializeState` to before for the same session (Task 1 test `the Model III is unchanged`, comparing against a state captured from `main` before the refactor and committed as a synthetic-ROM fixture).
2. A Model I ROM image passed as `model: 3` (or the reverse) must be refused with a sentence naming the model the hash recognises (Task 1 test).
3. A Model I program that writes video RAM with bit 6 set must read back the gated value, as the hardware does (Task 2 test), and lowercase mod changes that.
4. Reading `$37E0` must clear the latch bits the manual says it clears, so the ROM's interrupt handler doesn't loop (Task 2 test against the real ROM: READY and a 40 Hz cursor blink).
5. MCP `load { model: 1 }` of a Model I program on a Model III ROM config must say which ROM it needs (Task 4 test).

---

### Task 1: Model descriptions and the Model I memory map

**Files:** Modify `packages/emu/src/machine/trs80-system.js`, `memory.js`, `io.js`, `machine.js`, `rom-hashes.js`, `devices/video.js`; create `packages/emu/src/machine/models.js`; tests `packages/emu/test/unit/model1.test.js`, a Model III state fixture under `fixtures/synthetic/emu/` written by a test writer.

**Interfaces:** `Machine({ model: 1 | 3, ram?, roms: { level2 }, expansion? = true, lowercase? = false, log })`; `m.rom.recognized` names Model I ROMs (add the Level II ROM's SHA-256 from the local `fixtures/real/level2-model1.rom` and any revisions the ROM sources list); `CPU_CLOCK_HZ` per model exported as `clockHz(model)`; `m.model`.

- [ ] Steps: failing tests (memory map reads/writes per region, RAM size limits, ROM size 12 KB, model/ROM mismatch refused, `the Model III is unchanged`), run (FAIL), implement, run (PASS) and the emu + mcp suites, commit `e6: describe the machine by model and map the Model I's memory`.

### Task 2: Model I timer, video, cassette and sound, keyboard

**Files:** `io.js`, `video.js`, `devices/cassette*.js`, `devices/key-queue.js`, `machine.js`; tests `packages/emu/test/unit/model1-devices.test.js`, `packages/emu/test/integration/model1-boot.test.js` (ROM-gated).

- [ ] Steps: failing tests (40 Hz latch interrupt and read-clear; `expansion: false` has none; the bit-6 video gate and the lowercase option; port `FF` cassette bits and `m.sound` on the Model I; the cassette deck at 500 baud through the Model I ROM's loader; keyboard matrix and Ruling 6's hook decision; the real Level II ROM boots to `READY` with `MEMORY SIZE?` answered), run, implement, run, commit `e6: run the Model I's timer, video, cassette and keyboard`.

### Task 3: The Expansion Interface disk (WD1771)

**Files:** `devices/fdc-wd1793.js` (a 1771 variant or a shared core), `machine/memory.js` (`$37E0–$37EF` decode), `loaders/load.js`; tests `packages/emu/test/unit/fdc-wd1771.test.js`, `packages/emu/test/integration/model1-disk.test.js` (gated).

- [ ] Steps: failing tests (each 1771 difference in Ruling 5 on synthetic JV1 images; drive select; INTRQ to the latch; the Model I ROM boots a synthetic JV1 boot sector; a real Model I disk in `fixtures/real/` if one boots — the dual-boot DMKs are Model I and Model III — record what each reaches), run, implement, run, commit `e6: add the Expansion Interface's WD1771 disk controller`.

### Task 4: Programs on the Model I, the MCP server, and docs

**Files:** `packages/emu/test/integration/model1-programs.test.js` (gated), `packages/mcp/src/tools/load.js` and config (`roms.model1`), MCP tests; docs.

- [ ] Steps: tests — Model I fixture programs reach their title screens (choose from `fixtures/real/` the Model I builds the samples memory names, e.g. Eliminator `elimin8a` which is Model I only, Asylum, Space Warp; assert stable title text per program, recording the screens in the report); determinism of a Model I session; MCP `load { model: 1 }` boots the Model I ROM from `roms.model1` and refuses with a sentence when it is missing; docs (spec §5 Model I column verified items, §11 row 6 first half Met, MCP spec §5); `pnpm typecheck && pnpm test && pnpm test:web`, benchmark, ROM-free worktree check; commit `e6: run Model I programs and load them from the MCP server` and `e6: document emu phase 6 (Model I)`.
