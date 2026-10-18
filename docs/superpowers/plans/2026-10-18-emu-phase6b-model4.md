# Emu Phase 6b (Model 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `new Machine({ model: 4 })` is a Model 4: it boots the Model 4 ROM into Model III mode and runs Model III programs, and its Model 4 hardware (the port `$84` memory maps with 64K/128K RAM banking, the 80×24 video page, the 4 MHz clock switch, the 60 Hz timer option) works for any program that switches into it — the second half of emu spec §11 phase 6.

**Architecture:** Phase 6 left the machine described by model (`packages/emu/src/machine/models.js`) with the Model III byte-identical. The Model 4 is a Model III with more: its own ROM (the user supplied `fixtures/real/trs32-MODEL4.ROM`, 14 KB, "Radio Shack Model III Basic (c) '80 Tandy", 727 bytes different from Model III Rev C), RAM 64K or 128K behind the port `$84` map register, video RAM that maps 2 and 3 move to `$F800–$FFFF` with an 80×24 mode, a CPU clock doubled by port `$EC` bit 6, and the timer at 30 or 60 Hz. Native Model 4 mode is what LS-DOS 6 / TRSDOS 6 switches on; no such disk is local yet, so native mode is proven by synthetic programs that program the hardware directly, and the DOS boot waits on a disk image (Ruling 1).

**Tech Stack:** plain JavaScript ESM (emu, mcp), Vitest.

**Spec:** `docs/fugloy-emu-spec.md` §5 (the Model 4 column: 4.055 MHz, or 2.027 in III mode; 14 KB ROM bankable out; keyboard `3800–3BFF` in maps 0–1, absent in 2–3; video `3C00–3FFF` in maps 0–1 or `F800–FFFF` in maps 2–3, 64×16 or 80×24 via port `EC` bit 2 and port `84` bit 2; RAM 64/128 KB with map select port `84` bits 0–1 and the 128 KB page select bits 4–5; FDC same as the Model III; timer 30 or 60 Hz via port `EC` bit 6), §3, §8 (the `(map, page)` coverage keying), §11 row 6, §12 (the open question whether `(map, page)` keying holds).

## Global Constraints

- emu: plain JS ESM, no DOM, no Node APIs, deterministic, no runtime dependencies.
- The Model III and Model I must not change: their fixtures, goldens, the phase 6 Model III state fixture, the phase 7 differential runs (`FUGLOY_TRSJS=1`), and the speed (Sea Dragon ≥ 20× with `FUGLOY_BENCH=1`).
- Every Model 4 hardware fact is cited (the Model 4 Technical Reference Manual if the user supplies it; otherwise MAME's `trs80m4` driver, the LS-DOS 6 technical documentation, or Tim Mann's xtrs documentation, each as a secondary source) where the code decides it, or marked unverified in spec §5.
- ROMs and DOSes are never committed; tests needing them read `fugloy.mcp.json` / `fixtures/real/` and skip without them; every behaviour also has a synthetic-ROM test that runs in CI.
- Commit messages: imperative, one line, prefix `e6:`. No `Co-Authored-By` or any AI trailer.
- Keep the spec, `docs/label-format.md`, `CLAUDE.md`, `CHANGELOG.md` (detailed), the emu and MCP READMEs, and the root README current.

## Rulings made while planning

1. **Native mode without a DOS.** No LS-DOS 6 or TRSDOS 6 image is local, so "a version 6 DOS boots" stays open in spec §10/§11 until the user supplies one; native-mode hardware is proven by synthetic programs (map switches, banking, 80×24 video, the clock switch) and by the Model 4 ROM booting Model III mode.
2. **The 4P is out of scope:** the user's `MODEL4P.ROM` (504 bytes) is an emulator's stand-in loader, not Tandy's 4 KB boot ROM; the 4P waits for the real one.
3. **Coverage keying.** Banked RAM makes the §8 `(map, page)` keys real: the emulator's coverage keeps one bitfield per `(map, page)` seen, and the label file writes each as its own key (`"0:0"`, `"2:1"`, …); the disassembler reads `"0:0"` as today and warns on others (it already does). Decide the §12 question by building it: if a cleaner scheme appears, record it there.
4. **The ROM** is recognised by its SHA-256 (add it to `ROM_HASHES` as the Model 4 ROM) and refused on `model: 3`, as Model I/III ROMs already are across models.

## Review Focus

1. A Model 4 left in map 0 at 2 MHz must run a Model III program exactly as the Model III would (Task 2 test comparing a Sea Dragon session's screens and cycle counts across `model: 3` and `model: 4`, allowing only the ROM's own differences).
2. A switch to map 2 or 3 must move video RAM and remove the keyboard from `$3800`, and switching back must restore them, with no stale bytes visible (Task 1 test).
3. The 128K page select must not alias the wrong 32K bank (Task 1 test writing a distinct byte pattern in every bank and reading each back through every legal map/page combination).
4. The clock switch must change the CPU rate without changing what an interrupt-timed loop counts per emulated second beyond what the hardware does (Task 2 test).
5. A save state taken in map 3 with page 1 must restore exactly (Task 1 test).

---

### Task 1: The Model 4 description, memory maps, and banking

**Files:** `packages/emu/src/machine/models.js`, `memory.js`, `io.js`, `machine.js`, `rom-hashes.js`, `debug/state.js`; tests `packages/emu/test/unit/model4.test.js`.

**Interfaces:** `Machine({ model: 4, ram?: 64 | 128 = 128, roms: { level2 } })`; port `$84` map register (bits 0–1 map, bit 2 video page / 80-column select per the cited source, bits 4–5 page select on 128K); `m.mem.read/write` see the current map; `m.mem.ram` exposes all RAM (document the layout); save states carry the map register and all RAM.

*As built:* the cited sources (MAME `trs80m3`, xtrs) put the 80/64-column select at bit 2, inverse video at bit 3, the 128K page select at bits 4–6, and the video page at bit 7; map 2 keeps the keyboard at `$F400–$F7FF` (map 3 has none). Spec §5 records it.

- [ ] Steps: failing tests (each map's layout; keyboard present/absent; video address per map; Review Focus 2, 3, 5; ROM recognised and refused on model 3), run, implement, run, commit `e6: map the Model 4's memory and bank its RAM`.

### Task 2: Model 4 video, clock, timer, and Model III mode

**Files:** `devices/video.js`, `io.js`, `trs80-system.js`, `machine.js` (`m.clockHz` follows the switch); tests `packages/emu/test/unit/model4-devices.test.js`, `packages/emu/test/integration/model4-boot.test.js` (ROM-gated).

- [ ] Steps: failing tests (80×24 text through `m.video.text()` with `m.video.columns` 80; the port `$EC` clock switch and its effect on `m.clockHz`, the timer, and MCP timing; 30/60 Hz timer selection; the Model 4 ROM boots to Model III BASIC `READY`; Review Focus 1 and 4), run, implement, run, commit `e6: run the Model 4's video, clock and timer, and boot it in Model III mode`.

### Task 3: Coverage by map and page, disks, the MCP server, and docs

**Files:** `debug/debugger.js` (coverage per `(map, page)`), `debug/label-file.js`, `docs/label-format.md` / spec §8 (re-extract), `packages/mcp/src/tools/load.js` (`model: 4`, `roms.model4`), MCP tests; Model III disks boot on the Model 4 (`fixtures/real` dual-boot DMKs, Scarfman — gated); docs (spec §5 Model 4 column, §11 row 6 Model 4 Met for Model III mode and native hardware, the DOS boot open; §12 answered; CLAUDE.md; CHANGELOG; READMEs).

*As built:* the `(map, page)` keying held (spec §12 answered): `page` is port `$84` bits 4–6 as `Model4Memory.page` gives it (0 with 64K), each access is marked under the key in force when it is made, and `callers` stays keyed by CPU address alone. The MCP server's `snapshot`/`diff` compare `3C00h`–`FFFFh` as the CPU saw it on the Model 4 (its `m.mem.ram` is the banks), noting a map change and marking off-screen video RAM; `screen` takes the Model 4's layouts and counts off-screen bytes on a last line. Booting the Model 4 ROM from the MCP server needed its `Cass ?` (with a space) answered.

- [ ] Steps: failing tests (coverage keyed by map/page after a bank switch; the label file writes each key and parses back; disasm reads `"0:0"` and warns on others; MCP `load { model: 4 }`; the Model III disks boot on the Model 4), run, implement, run (`pnpm typecheck && pnpm test && pnpm test:web`, `FUGLOY_TRSJS=1` diff tests unchanged, the benchmark alone, ROM-free worktree), commit `e6: key coverage by map and page, and load Model 4 programs from the MCP server` and `e6: document the Model 4`.
