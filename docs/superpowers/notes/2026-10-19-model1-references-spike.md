# Model I references spike: xtrs and MAME (emu phase 7, Model I, Task 1)

Run on 2026-10-20 on macOS (arm64), Node 22. Plan:
`docs/superpowers/plans/2026-10-19-emu-phase7-model1-differential.md`, Task 1.
Every number below comes from a run made for this note.

## Result in one paragraph

Both references work headless and give a per-instruction record. Booting the
user's Level II ROM (`fixtures/real/level2-model1.rom`, SHA-256 `5515d95d…6776`,
recognised by `models.js` as `model1-level2-1.3`) to its `MEM SIZE?` prompt
(Level II 1.3's wording; the plan's `MEMORY SIZE?` is wrong for this ROM, and
this note says `MEM SIZE?` throughout), all three machines (xtrs,
MAME, and our Model I) agree on PC and on the cumulative T-state count at
**every one of the first 3,000,000 instructions** (22,553,071 T-states), so
the first 1,000 agree too. The `?` lands at `$3C08` at instruction 14,525
(T 204,057) and the ROM reaches its wait-for-key at `$0049` at instruction
14,726 (T 206,114) on all three. The only differences in the registers are the
reset state, the power-on video RAM, and one flag class in MAME (below).

## The spike's files

Committed in `packages/emu/scripts/spike-model1/` (no xtrs source, no ROM
bytes, no traces):

- `build.sh` and `fugloy-step.c` (the xtrs build and driver) were superseded
  in Task 2 by `scripts/install-xtrs.sh` (`pnpm xtrs:install`) and
  `packages/emu/scripts/xtrs/fugloy-xtrs.c`, and removed. The driver keeps
  xtrs's two copyright notices in its header, and they stay in
  `tools/xtrs/src/LICENSE`. `fugloy-xtrs <rom> --trace <n>` prints the spike's
  record: over 1,000,000 instructions it is byte-identical to
  `fugloy-step`'s. The synced comparison is now the adapter's lockstep test
  (`packages/emu/test/diff/xtrs-adapter.test.js`).
- `ours.mjs`: our Model I in the same line format (`mame` argument: MAME's reset
  state).
- `boot.lua`: MAME's autoboot script (power-on fill, the trace with its
  `tracelog` line, the `wpset` W/K/L logging, the screen at stop; trace path
  from `FUGLOY_MAME_TRACE`).
- `key.lua`: answers `MEM SIZE?` through `natkeyboard:post`.
- `mame-to-lines.sh`: MAME trace → the common line format.
- `fielddiff.py`: the field-by-field comparison.

The ROM, the MAME ROM set, the built binaries and the traces stay in the
gitignored `tools/` and `fixtures/real/`.

## Step 1: the user's answer

Asked on 2026-10-20 before installing anything. Answer: **"Both"** —
`brew install mame` (MAME 0.289), and building xtrs from source at a pinned
commit in `tools/xtrs/`. Nothing else was installed: xtrs was built without
X11, readline or XQuartz.

## xtrs

- **Canonical repository:** https://github.com/TimothyPMann/xtrs (Tim Mann's
  page, tim-mann.org/xtrs.html, says xtrs "is now hosted on GitHub" there).
  **Pinned commit `3a2180c063811a715faa28d39a94739c33e0abd0`** (2025-08-19,
  "Fixed minor typos (#41)"), the head of the default branch on 2026-10-20.
- **Licence:** `LICENSE` has two parts. Clarendon Hill Software (1992): use, copy
  and redistribute with the notice kept; "may be modified ... but modified versions
  must retain this notice". Tim Mann (1996–2020): MIT. **A modification
  patch may be committed to this repository** as long as it keeps both notices. The
  ROM is not part of xtrs, so it is still never committed.
- **Build (headless, no X11):**
  `git clone https://github.com/TimothyPMann/xtrs.git tools/xtrs/src && git -C tools/xtrs/src checkout 3a2180c…`,
  then the spike's `build.sh` (now `pnpm xtrs:install`, which also clones and
  applies the Task 2 patch), which builds out of tree into
  `tools/xtrs/build/`. It assembles the three built-in ROM stand-ins
  (`fakerom`, `esfrom`, `xtrsrom4p`) with our `tools/zmac/zmac -P`, runs
  `compile_rom`, and compiles every object except `main.o`, `trs_xinterface.o`
  and the GTK files with `cc -O2 -D_DARWIN_C_SOURCE`. It does **not** define
  `KBWAIT`; the Makefile does. It also builds the driver (the spike's `fugloy-step.c`, now
  `packages/emu/scripts/xtrs/fugloy-xtrs.c`).
  **In the spike no xtrs source file was modified** (Task 2's patch adds
  exported setters and an interrupt entry, below): the driver holds the stubs that
  `trs_xinterface.c` and `main.c` would have given (screen, mouse, grafyx, HRG,
  `trs_get_event`, `trs_model`, `trs_paused`, `trs_autodelay`, `program_name`),
  and `z80.c` is compiled with `-Dmem_write=fg_mem_write
  -Dmem_write_word=fg_mem_write_word`, which routes every CPU write (the
  interrupt push included) through a logger in the driver.
- **Headless:** no display at all; the X interface is replaced, not run.
- **Three things in xtrs that had to change for determinism** (all handled in the driver):
  1. **The 40 Hz timer is real time** (`trs_interrupt.c`, `trs_timer_event` is a
     `SIGALRM` handler re-armed with `setitimer`). The driver ignores `SIGALRM` and
     calls `trs_timer_event` itself every 44,352 T-states (1.77408 MHz / 40, the same
     period as our `rtcInterval`), with a phase argument.
  2. **`KBWAIT`** (`trs_keyboard.c`, `trs_next_key`) blocks in `trs_get_event(TRUE)`
     until an interrupt when the ROM waits for a key. With a timer driven from
     T-states that would never return, so it is compiled out.
  3. `z80_reset` calls `srand(time(NULL))`. The seed is not used for `LD A,R`
     (`do_ld_a_r` reads `REG_R`), so it does no harm.
- **Single step:** `z80_run(0)` runs one instruction, then takes an NMI or IRQ due
  at its end. The interrupt response therefore counts with the instruction
  *before* it; in our `Machine.step` it counts with the instruction after it.
  The lockstep adapter has to shift by one, as trsjs's did.
- **RAM at power-on:** `memory[]` is a static array, so it is all `00`. That covers
  RAM `$4000`–`$FFFF` (48K always) and video RAM. xtrs applies the bit-6 gate
  when a byte is written (`mem_write`, `!trs_lowercase`) and returns the stored
  byte on a read. The driver sets `trs_lowercase = 0` (xtrs's default is 1).
- **CPU reset state:** AF `FFFF`, SP `FFFF`, IX `0000`, IY `0000`, PC `0000`, IFF 0, IM 0.
- **T-states:** cumulative, `z80_state.t_count` (64-bit), read before each step.
- **Memory writes:** logged by the `fg_mem_write` wrapper (up to 16 per
  instruction), as `wADDR=VV` after each record. 33,098 of the first 200,000
  instructions write.
- **Keyboard reads:** the ROM reads the matrix through `mem_read` →
  `trs_kb_mem_read`. The same `-D` trick on `mem_read` in `z80.c` can log reads
  of `$3800`–`$3BFF` and `$37E0`. Setting a key: `keystate[]` and
  `change_keystate` are `static` in `trs_keyboard.c`, and the public
  `queue_key` path adds a 4,000 T-state "stretch" (`STRETCH_AMOUNT`) and a
  heartbeat. Exact-T-state key bits (`key <row> <bit>`) therefore need **one
  small patch**, an exported setter for `keystate[]`. **Decision:** Task 2
  commits it as a patch file beside the driver (the licence allows it, with
  both notices kept), and `pnpm xtrs:install` applies it with `git apply` to the
  pinned checkout. Task 2 does not use `queue_key` and its 4,000 T-state stretch.
- **Speed:** 3,000,000 instructions in 0.884 s (3,393,450 instructions/s), and
  in 0.928 s on a second run (3,234,125/s). Both runs print one text line per
  instruction to a file.
- **Determinism:** two runs of 3,000,000 instructions are byte-identical.

## MAME

- **Version:** `brew install mame` installed **MAME 0.289** (`mame -version`:
  `0.289 (unknown)`; `/opt/homebrew/Cellar/mame/0.289/bin/mame`, SHA-256
  `02621c77445ec0934e684d46baaa7731af4dbf50d20476e3c860e2ab40432139`).
- **`trs80l2`'s ROMs** (`mame -listroms trs80l2`; driver `trs/trs80.cpp`):

  | BIOS | file | size | CRC | SHA-1 |
  |---|---|---|---|---|
  | `level2` (default, "Radio Shack Level II Basic") | `rom-a.z1` | 4096 | `37c59db2` | `e8f8f6a4…4969` |
  | | `rom-b.z2` | 4096 | `05818718` | `43c538ca…00c1` |
  | | `rom-c.z3` | 4096 | `306e5d66` | `1e1abcfb…2369` |
  | `rsl2` ("R/S L2 Basic") | `rom-a_alt.z1` | 4096 | `be46faf5` | `0e63fc11…128b` |
  | | `rom-b_alt.z2` | 4096 | `6c791c2d` | `2a38e0a2…2aee` |
  | | `rom-c_alt.z3` | 4096 | `55b3ad13` | `6279f6a6…c339` |
  | (both) character generator | `mcm6670p.z29` | 1024 | `0033f2b9` | `0d2cd419…eda7` |

- **The user's ROM splits exactly into the `rsl2` set:** its three 4K pieces
  (`dd bs=4096 skip=0/1/2`) have CRC and SHA-1 equal to `rom-a_alt.z1`,
  `rom-b_alt.z2` and `rom-c_alt.z3`. It is not the default `level2` set, so
  every run needs `-bios rsl2`. The character generator is not among the
  user's files. A 1,024-byte file of zeros named `mcm6670p.z29` lets MAME run
  with a `WRONG CHECKSUMS ... might not run correctly` warning. With
  `-video none` the character generator is never seen. The set lives in
  `tools/mame/roms/trs80l2/` (gitignored; `git check-ignore` confirms
  `/tools/`). `trs80l2` lists no `ramoption`; its RAM is fixed.
- **Headless run:**
  `mame trs80l2 -rompath tools/mame/roms -bios rsl2 -video none -sound none -nothrottle -debug -debugger none -autoboot_script packages/emu/scripts/spike-model1/boot.lua -autoboot_delay 0 -seconds_to_run N -skip_gameinfo -nvram_directory … -cfg_directory …`
- **Per-instruction record: the debugger's `trace` command does it, issued from Lua.**
  `-debugscript` with `-debugger none` produced no trace. The Lua autoboot (`boot.lua`)
  script did: `manager.machine.debugger:command('trace <file>,maincpu,noloop,{tracelog "%04X %04X %04X %04X %04X %04X %04X %04X %d %d\n",pc,af,bc,de,hl,ix,iy,sp,iff1,totalcycles}')`
  then `command('go')`. `noloop` keeps every repeat of a loop. The trace starts
  at PC `0000`, `totalcycles` 0, with the state before each instruction. MAME
  also writes its disassembly line after each record. No Lua hook on each
  instruction was needed or tried. Lua notifier subscriptions
  (`emu.add_machine_stop_notifier`, `add_machine_frame_notifier`) must be kept in
  a global. Otherwise they are garbage-collected and never fire.
- **T-states:** `totalcycles` is cumulative.
- **Memory writes and keyboard reads:** debugger watchpoints with a logging action,
  written in order into the same trace file after the instruction's record:
  `wpset 3c00,c400,w,1,{tracelog "  W %04X=%02X\n",wpaddr,wpdata; g}`,
  `wpset 3800,400,r,1,{tracelog "  K %04X=%02X\n",wpaddr,wpdata; g}` (51,285
  writes and 14,227 matrix reads in the first emulated second), and the same on
  `37e0,4,r` for the interrupt latch (no reads during the boot). The trace has
  no explicit "interrupt taken" record. One shows as a PC jump to `$0038` with
  the return address pushed (two `W` lines at SP−1 and SP−2). Task 3 must derive
  it from that and test it. No interrupt was taken in this spike (below).
- **Keyboard input:** `manager.machine.natkeyboard:post("\n")` from a frame
  notifier at 2 emulated seconds answered `MEM SIZE?`, and the screen read
  `R/S L2 BASIC` / `READY` / `>_`.
- **RAM at power-on:** read through Lua before instruction 0: `$4000`–`$FFFF`
  all `00` (49,152 bytes), and video RAM `$3C00`–`$3FFF` all `00` (1,024 bytes).
- **CPU reset state:** AF `0040`, SP `0000`, IX `FFFF`, IY `FFFF`, PC `0000`, IFF 0.
- **Speed:** 13 emulated seconds traced took 29.55 s wall (16.86 s user) for
  3,072,080 instructions, about 104,000 instructions/s. The trace file is
  203,766,687 bytes, about 66 bytes per instruction with the disassembly lines.
  A 10-million-instruction session is therefore about 1.6 minutes and about
  660 MB of text. These are **extrapolated** from the 3,072,080-instruction
  run; no 10-million run was made. Untraced, the same run takes 1.31 s wall.
- **Determinism:** a second traced run gave a byte-identical record.

## Comparison with our Model I

Tools: `fugloy-step` for xtrs (now `fugloy-xtrs --trace`), and `ours.mjs`, which steps
`new Machine({ model: 1 })` and prints the same line (index, PC, AF, BC, DE,
HL, IX, IY, SP, IFF1, cycles before the instruction), and `fielddiff.py`, which
compares the records field by field (all in `packages/emu/scripts/spike-model1/`). Our power-on: RAM `00`, video RAM `20`
(`clearVideoRAM`), and AF `0000`, SP `FFFF`, IX `0000`, IY `0000`. Our machine
also applies the bit-6 gate on the write.

| pair, first 3,000,000 instructions | PC | T-states | other registers |
|---|---|---|---|
| xtrs vs ours, unsynced | 0 differ | 0 differ | AF rows 0–1 (reset AF); D at rows 8272–8279 (`00` vs `20`) |
| xtrs vs ours, synced (xtrs AF set to `0000`, its video RAM written with `20`) | 0 | 0 | **0 — the records are byte-identical** |
| MAME vs ours, unsynced | 0 | 0 | AF, IX, IY, SP from row 0 (reset state); D at rows 8272–8279 |
| MAME vs ours, synced (ours set to AF `0040`, SP `0000`, IX/IY `FFFF`, video RAM `00`) | 0 | 0 | F only, 5,112 rows |

So the first 1,000 instructions agree on PC and T-states with no syncing at
all. Every register matches as well once the reset state is copied.

What the differences are:

1. **Reset register state.** It differs on all three machines (above). The Z80
   leaves most registers undefined at reset. The harness should copy one
   machine's state into the other at instruction 0. It is **unverified** that
   Young's "The Undocumented Z80 Documented" gives AF and SP as `FFFF` after
   reset, as xtrs has. Task 4 must quote it before anything rests on it. We
   start AF at `0000`. That is a Task 4 question (Ruling 6), not fixed here.
2. **Power-on video RAM** (`D` at instruction 8272, `LD D,(HL)` at `$0486` with
   HL `$3C00`, the character under the cursor). xtrs and MAME read `00`; we read
   `20` because we fill video RAM with spaces. Real video RAM powers on random,
   so the run fixes one fill. Ruling 4's "same RAM fill" has to include video RAM.
3. **F bits 3 and 5 during a repeating LDIR (MAME only).** All 5,112 rows are
   at `$067F` (5,088) and `$007E` (24), both `LDIR`. They come right after an
   iteration that repeated, and the XOR is always in `$28` (bits 3/5). MAME
   gives `0044` where we and xtrs give `0064` (row 8, `$067F`), and `0085` where
   we give `00A5` (row 7814, `$007E`). When the instruction
   repeats, MAME's bits 3/5 follow PC's high byte: `$06` and `$00` both give 0.
   We and xtrs take them from A plus the byte moved, as for a finished LDIR, which
   Young describes. Where the block instruction ends (BC = 0), all agree. This
   matches the later finding that an interrupted block instruction takes X/Y from
   PC (the Z80Decoder "Undocumented Flags" research, which MAME's core
   appears to follow). It is a **known-class candidate** for Task 4. Which side
   is right must be cited from MAME's `z80.cpp` source and that research before
   a class is added or our core changed (Ruling 6).

Not exercised: the 40 Hz timer and interrupts. The ROM keeps interrupts off
(IFF1 0 at every one of the 3,000,000 instructions on all three) through the
boot to `MEM SIZE?`, so the timer's phase, `$37E0` read-to-clear, and when each
reference takes the IRQ are untested. The first session past `READY`
(Tasks 2–3) is where they meet.

Our rate in the same scratch loop (string per instruction): 537,351 and 578,332
instructions/s.

## Recommendation: Rulings 2 and 4

- **Ruling 2 is confirmed.** xtrs can be the lockstep reference. Its core runs
  one instruction per `z80_run(0)` call under a small driver we own. That driver
  holds the stubs, the timer driven by T-states, the write logger, and the
  pipe protocol Task 2 adds. One patch is needed: an exported `keystate[]`
  setter, for keys at exact T-states. It is committed as a patch file, and
  `pnpm xtrs:install` applies it. A second, optional patch is a read hook in
  `trs_memory.c` for keyboard reads and latch reads (or the same `-D` rename on
  `mem_read`). The licence lets us commit them with both notices kept. The
  install script should still check the pinned commit and the SHA-256 of the
  patched tree. Two conditions are mandatory: no `KBWAIT`, and no `SIGALRM`
  timer. The interrupt response counts with the instruction before it, which
  the adapter must shift. MAME stays the trace reference. Its debugger `trace`
  + `wpset` actions, started from a Lua autoboot script, give PC, registers,
  `totalcycles`, writes and keyboard reads at about 104,000 instructions/s.
  That is fast enough (about 1.6 minutes per 10 million instructions, extrapolated from the 3M run). Task 3
  should stream or compact the text (66 bytes per instruction with disassembly).
  It must also derive interrupt boundaries from the trace (a PC jump to `$0038`
  with the push), since MAME writes no explicit record for them.
- **Ruling 4 is confirmed, with two revisions.** (a) "The same RAM fill" means
  RAM **and video RAM** (MAME: all `00`), **plus the CPU's reset registers**
  (MAME: AF `0040`, SP `0000`, IX/IY `FFFF`). Our machine is set to these at
  instruction 0 of a MAME session. Without them, D differs at instruction 8272
  and IX, IY and SP differ from row 0. (b) Keyboard input for MAME sessions is
  posted with `natkeyboard:post`. Our machine follows the trace's `K` records
  for the bytes read. The repeating-block F bits 3/5 must be settled (Ruling 6)
  before MAME sessions can show zero unexplained divergence. They appear from
  instruction 8 of every boot.
