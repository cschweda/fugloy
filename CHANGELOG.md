# Changelog

All notable changes to Fugløy are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

The repository holds parts that are versioned and released separately:

- **Core**: `@fugloy/z80`, `@fugloy/disasm`, and `@fugloy/cli`, released
  together at one version. Phases 1 and 2 of the plan landed as minor
  versions (0.1.0, 0.2.0); 1.0.0 is v1, phases 1–4 of the plan, and a
  release that adds features raises the minor version. Core releases have the plain `## [X.Y.Z]` headings below and are tagged `vX.Y.Z` on
  `main`. 1.1.0 is the first on npm; 0.1.0, 0.2.0, and 1.0.0 were tagged and
  published as GitHub releases only.
- **The emulator**, `@fugloy/emu`, is versioned 0.x on its own. Its
  releases have `## [emu X.Y.Z]` headings and are tagged `emu-vX.Y.Z`; 0.2.0,
  emu phases 0–4, is its first npm release (published 2026-10-18).
- **The MCP server**, `@fugloy/mcp`, is versioned 0.x on its own. Its
  releases have `## [mcp X.Y.Z]` headings and are tagged `mcp-vX.Y.Z`; 0.1.0,
  MCP phases A–F, is its first npm release (published 2026-10-18, after emu's). It depends on `@fugloy/emu`, so emu
  was published first.
- **The web workbench**, `apps/web`, is not on npm and has no version of its
  own: Netlify builds it from `main` and serves it at app.fugloy.dev
  (live since 2026-10-18; `fugloy.dev` and `www.fugloy.dev` redirect to it). Its changes are listed under the core release
  they shipped with.

A release is cut from `main`. An ordinary commit bumps the set's
`package.json` versions and moves its entries out of [Unreleased] into the new
heading; then `./publish.sh check core` (or `check emu`, or `check mcp`) runs every check,
installs and runs the packed tarballs, and stages them in `.release/`, and
`./publish.sh publish` publishes those tarballs with npm's two-factor code and
creates and pushes the tag.


## [Unreleased]

### Added

Emu phase 7 (the differential harness against trsjs; emu spec §10, §11, §12;
plan `docs/superpowers/plans/2026-10-18-emu-phase7-differential.md`), test
and tooling code in `@fugloy/emu` (nothing in `src/` depends on trsjs), on
the `emu-phase7` branch:

- `pnpm trsjs:install` (`scripts/install-trsjs.sh`) fetches trsjs
  (`trsemu-1.6.js`, Peter Phillips's JavaScript conversion of trs80gp) into
  the gitignored `tools/trsjs/` and refuses a file whose SHA-256 is not
  `d6e5b270…ac052fc`. trsjs has no license: it is never committed, bundled,
  or redistributed, and the tests that need it run only with
  `FUGLOY_TRSJS=1`, so CI is unaffected.
- `test/diff/trsjs-adapter.js`: `loadTrsjs()` checks the hash, runs the
  script in `node:vm` with DOM stubs, and wraps its Z80 as a reference that
  steps one instruction at a time (`step({ irq: 'auto' | 'hold' | 'force' })`),
  logs each memory write, syncs from our machine (`syncFrom`, `syncRegs`:
  RAM, video RAM, registers, IFF, IM, port latches, the 30 Hz phase), and
  takes keys into its matrix (`setKeyBit`). The script's text is changed in
  memory only, never on disk. The adapter corrects five places where trsjs
  departs from the Z80 or the Model III, each with a test: a write below
  `$3C00` (ROM and keyboard) is dropped, where trsjs stored writes from
  `$3000` up (Eliminator d, f, g, and h write `$3723` and read it back); a
  stored value is masked to 8 bits, where trsjs's RLD and RRD stored 12; PC
  and the `(IX+d)` address wrap at 16 bits, where trsjs ran PC on to
  `$10000`; a repeating CPDR takes 21 T-states, where trsjs counted none
  (Zilog UM0080; found on Asylum 1g); and a DD or FD the next instruction
  ignores is run as the Z80 runs it, where trsjs skipped both bytes in no
  T-states.
- `test/diff/compare.js`: `compareRun({ machine, reference, instructions,
  keys, strict, progress })` compares after every instruction PC, every
  register (F and F' bit by bit, R as 7 bits), IFF1/2, IM, the T-states, and
  every write, and video RAM at the end; it returns the class counts and the
  first divergence, with ten instructions of context on each side
  (`formatReport`). Keys go into both matrices at the same boundary, never
  through our ROM keyboard hook.
- `test/diff/known.js`: the known differences, each with its predicate, the
  exact fields it explains, and the evidence that trsjs is the inaccurate
  side: flag bits 3 and 5 (ZEXALL); BIT's S and P/V (Young §4.1); R not
  counted on an interrupt response (Young §5, §6.1); R counted three times on
  DDCB/FDCB (Young §6.1); HALT: trsjs pushes the HALT's own address (Young
  §5.4); CPI/CPD/CPIR/CPDR: trsjs sets C on a mismatch (Zilog UM0080: C is
  not affected; trsjs saves C in a scratch its `cp` overwrites, found on
  Asylum); and three interrupt timings (a request trsjs drops while DI, takes
  right after EI, or takes after a lone prefix), which the comparator holds
  and makes the reference take at our boundary, comparing that step in full.
- `pnpm diff <program> [--keys <script.json>] [--instructions N]
  [--from-cycle C] [--strict | --strict-all]` (`packages/emu/scripts/diff.mjs`):
  one program, booted on the Model III ROM, compared, and reported; exit 0, 1
  (a divergence), or 2 (a usage error).
- `test/diff/fixtures.test.js`: six scripted sessions of 10 million
  instructions each (Sea Dragon `seadrg01`, Eliminator `elimin8c` and
  `elimin8e`, Rear Guard `reargrd5` and `reargrd4`, Armored Patrol), the
  phase 2 title-screen scripts carried on into play; each reaches the screens
  it lists with no unexplained divergence, video RAM equal every 100,000
  instructions, and exact class counts. With `FUGLOY_TRSJS_SWEEP=1`, every
  other `.CMD` in `examples/` and `fixtures/real/` runs 10 million
  instructions under one generic script: 57 programs (20 builds in `examples/`, 37 in `fixtures/real/`, Planetfall and Enchanter without their story disks), none with an unexplained divergence; class counts in all, flag bits 3 and 5, 24,162,163; BIT's S and P/V, 2,964,829; CPI/CPD C, 24,098; DDCB/FDCB R, 23,696; interrupt-response R, 22,187; an interrupt held while DI, 189. 17 end at the BASIC prompt or a reboot on the Model III (Eliminator a, b, d, f, g, h; Rear Guard 1, 2, 3, 7; Sea Dragon 7, 9; Armored Patrol's `GO.CMD`; Asylum 1c, 1d; the two Infocom interpreters), the same on both machines. About 1.5 million
  compared instructions a second.
- Emu phase 7 is met for the Model III (emu spec §11). The Model I waits for
  a Model I reference (MAME or xtrs, with the user's agreement), since trsjs
  is Model III only.

Emu phase 5 (disk controller and images; emu spec §3, §5, §6), `@fugloy/emu`,
unreleased, on the `emu-phase5` branch:

- `m.fdc`, the four floppy drives behind `Machine`: `mount(drive, bytes |
  DiskImage, { writeProtect })` detects JV1, JV3, or DMK from the content and
  returns `{ drive, container, tracks, sides, sectorsPerTrack?,
  writeProtected }` (`sectorsPerTrack` only when every track side holds the
  same count); `unmount(drive)` returns whether the drive held a disk;
  `drives` lists the four drives' info or null, read from the controller so
  it follows a snapshot restore. A non-image, a drive outside 0–3, and a
  `writeProtect` that is not a boolean are refused. With nothing mounted the
  controller's ports float and the machine boots to cassette BASIC as before.
- `m.load.dsk(bytes, { drive = 0, boot = true })` mounts and, with `boot`,
  resets so the ROM boots from drive 0 (it reads track 0, sector 1 to `$4300`
  and jumps there, ROM `$34D9`–`$3516`); its manifest is `{ format: 'dsk',
  container, drive, boot, blocks: [] }`, recorded in `m.debug.loaded`.
  Booting with drive 0 empty throws.
- JV1 detection accepts only a real geometry, 35, 40, 77, or 80 tracks of 10
  or 18 sectors. Before, any file whose length was a whole number of 10- or
  18-sector tracks mounted as a short JV1 (a 13,824-byte `.CMD` as three
  tracks), which the ROM would then boot; now it is refused as
  `Unrecognized disk image (N bytes): …`, a sentence that no longer claims a
  1,792-byte file is "not a multiple of 256-byte sectors".
- Tests (`test/unit/fdc-api.test.js`) on synthetic JV1, JV3, and DMK images
  from a new writer (`test/unit/disk-writers.js`, which also builds a boot
  sector): each container mounts and boots, through a small ROM that boots
  the way the Model III ROM does (in CI) and through the real ROM when one is
  configured; a snapshot with disks mounted restores their bytes and write
  protection.
- The WD1793 follows the Western Digital FD179X data sheet (the FD179X-01
  sheet of October 1979, whose commands, flags, and status bits the -02 part
  shares), checked behaviour by behaviour in `test/unit/fdc-wd1793.test.js`
  (52 tests on synthetic images through the ports). Time is in T-states:
  the disk turns at 300 rpm (405,504 T-states a revolution), IDs pass at
  their place on the track (the DMK's raw offsets; JV1 and JV3 sectors
  spaced evenly in image order), and bytes arrive one byte time apart (65
  T-states in MFM, 130 in FM). What changed:
  - Type I: Seek steps from the track register to the data register (it had
    jumped the head to the data register's track); one step pulse per r1 r0
    period at the 1 MHz rates (6, 12, 20, 30 ms) instead of a flat 6 ms;
    Restore loads zero into the track register at Track 00 and gives up with
    Seek Error after 255 pulses; Step remembers the direction of Restore and
    Seek too; verify (V) waits the 30 ms settle and checks the first good ID
    against the track register (Seek Error on a mismatch, CRC Error for a bad
    ID CRC, Seek Error at the fifth index pulse with no good ID); h loads and
    unloads the head, which also unloads after 15 idle index pulses (Head
    Loaded had always read 1); the Type I status is live while busy (Track 00
    and Index had read 0 until the command ended); no index pulses without a
    disk.
  - Type II: the ID must carry the track register's track (not the head's
    position), the sector register's sector, and, with C = 1, the S flag's
    side; IDs recorded in the other density are invisible (port F4 bit 7);
    E adds the 30 ms settle; Record Not Found comes at the fifth index pulse
    (it had come after 6 ms); Read Sector with m = 1 reads on until a sector
    is not found (it had read one); Lost Data is set when the computer leaves
    a byte unread when the next arrives, or does not load a byte to write in
    time (a zero goes to the disk, or, for the first byte, the command ends);
    ID and data CRCs are checked on DMK images (and JV3's CRC-error flag),
    setting CRC Error; a write to a protected disk and a command to a drive
    that is not ready end at once with an interrupt.
  - Type III: Read Address returns the next ID's six bytes with its CRC and
    puts the ID's track (not the head's) in the sector register; Read Track,
    which had returned nothing, returns a revolution of raw track bytes
    (DMK) or an IBM layout synthesized from the sectors (JV1, JV3); Write
    Track raises DRQ at once, writes from index pulse to index pulse one byte
    per byte time, and ends with Lost Data if no byte was loaded by the first
    index pulse.
  - Type IV: Force Interrupt keeps the status bits of the command it stops
    (it had replaced them with Type I status), interrupts on I0, I1 (ready
    transitions), I2 (every index pulse), and I3 (at once, holding INTRQ
    until a D0 lets a status read clear it).
  - Port F4: bit 6 (WAIT) holds the CPU until DRQ or INTRQ, which the ROM's
    boot read and the DOSes' INI loops rely on now that bytes are timed; a
    write with no drive bit selects no drive (it had kept the last one).
    Ports F4 and E4 follow MAME's Model III driver and the ROM's use of them;
    the Model III Technical Reference Manual was not at hand (spec §5).
  - Boot timing on the local disk images (real ROM): the dual-boot
    Eliminator and Rear Guard DMKs, the Eliminator DMK, and Scarfman reach
    the same screens as before, more slowly, as a real drive does (Scarfman's
    title by 10 emulated seconds instead of by 2). The ROM sometimes reads the boot
    sector twice: the 30 Hz interrupt it leaves enabled can cost a byte, and
    the ROM retries on Lost Data as it was written to.
  - `DiskImage.trackIds(track, side)` lists a track's ID fields as the
    controller meets them, and `DiskImage.rawTrack` gives a DMK track's raw
    bytes.
- The disk NMI (phase 5 plan, Ruling 3): an NMI that arrives right after a
  lone `DD` or `FD` prefix waits one instruction, as a maskable interrupt
  does (Young §3.6; `cpu.nmi()` now returns whether it was taken, and
  `TRS80System` keeps the edge pending until it is); and the NMI edge latch
  is part of a snapshot (`nmiWasPending`), so a restore while INTRQ is up
  neither fires the NMI again nor loses one (`test/unit/nmi.test.js`).
  Snapshots from before restore the latch as clear, as before. A snapshot
  taken mid-command also restores the controller's new state (the command
  byte, step direction, head load, idle count, and interrupt conditions).
- The disk images read exactly (emu spec §5, "Disk images", after Tim
  Mann's format notes in the xtrs distribution), and `m.fdc.export(drive)`
  returns any mounted disk as DMK bytes (spec §6: write DMK only):
  - `m.fdc.export(drive)` (and `DiskImage.toDMK()`): a DMK as it stands, its
    write-protect byte following the drive's; a JV1 or JV3 laid out as raw
    tracks, each ID in order with its track, side, sector, size code,
    density, data mark, and CRCs (a JV3 CRC error stays one), JV1's
    10-sector tracks in FM and 18-sector ones in MFM. The bytes mount back
    with the same sectors, writes the program made included; an empty drive
    throws. A blank disk exports as a DMK with no tracks, which a format
    extends.
  - JV3: a free header entry keeps its data area, so the sectors after it
    are read from where the header puts them (they had been read from the
    wrong offset once a free entry sat between sectors); a second header
    block (more than 2,901 sectors) is read and written; the data marks
    `FA`, `F9`, and `F8` are told apart (`DiskImage.trackIds` and
    `readSectorEx` report `dam`); a write clears the CRC-error flag.
  - DMK: any of `F8`–`FB` is a data mark (`FA` and `F9` had been missed in
    FM, losing the sector), in MFM only after its `A1` sync; header flag
    `80` (density ignored) is honoured; a sector whose data runs past the
    track's end is kept with a data CRC error (it had vanished: Scarfman's
    track 0 sector 15 now reads as a CRC error, not as missing); a Write
    Track in FM lays the track out in FM (it had been written as MFM and
    could not be read back in FM).
  - Two IDs with one sector number on a track are kept apart: the
    controller reads and writes the ID it found (`trackIds` gives each its
    `index`, which `readSectorEx` and `writeSector` take).
  - JV1: the geometry fixes the sector numbering (0–9 for 10 sectors, 1–18
    for 18); a read of a sector outside it no longer falls back to the other
    base and remaps the disk.
  - Detection is stricter: a DMK header with a write-protect byte other than
    `00` or `FF`, an undefined flag bit, or an IDAM pointer outside its
    track is refused; tests check that the committed `.CMD` files and random
    bytes are refused.
  - Six synthetic images (`fixtures/synthetic/disk/`, written by
    `pnpm fixtures` from `test/unit/disk-samples.js`): a 35×10 JV1, a mixed
    JV3 (two sides, both densities, `FA`/`F9`/`F8`, a CRC error, free
    entries), and double-sided MFM, doubled FM, single-byte FM, and
    mixed-density DMKs; `test/unit/disk-image.test.js` reads every sector of
    each, through the controller too.
- WD1793 and machine fixes from the phase's review: a Step-Out, a Step
  outward, or an outward Seek with Track 00 active issues no step pulse and
  loads 0 into the track register (the data sheet's Type I flow chart; the
  register had counted below zero to 255 with u = 1); the controller now
  ticks for interrupt and NMI response T-states, so the disk's angle no
  longer drifts against the CPU's clock with each interrupt.
- Real disks boot on the Model III (emu spec §5, "Checked on real disks";
  §11 row 5 met as the phase 5 plan's Ruling 1 reads it), in
  `test/integration/disk-boot.test.js` with the configured ROM, each image
  skipped when it is missing from the gitignored `fixtures/real/`:
  - The dual-boot Eliminator and Rear Guard DMKs and the Eliminator DMK
    (`ELIMATOR.dsk`) boot to the menu of the loader they carry, Russ
    Wetmore's "Model I/III Duo-Loader" (the DOS stand-in: no TRSDOS 1.3
    image is present, so spec §10's TRSDOS row stays open).
  - ENTER, held half a second, loads Eliminator and Rear Guard from their
    dual-boot disks to their titles; Scarfman boots from its disk to its
    title and into its attract play.
  - Determinism: Scarfman for 16 s, and Rear Guard from its menu through
    ENTER to its title, each end byte-identical in `m.debug.snapshot()` when
    run twice.
  - The ROM reaches the boot sector at `$4300` 0.23 s (the dual-boot DMKs)
    to 0.43 s (`ELIMATOR.dsk`, Scarfman) after the reset.
  - `test/rom.js` gained `configuredFixtures(pattern)`, the files under the
    config's `fixtures` folder.
- `@fugloy/mcp` (unreleased) `load` takes a disk image (MCP spec §5; the
  phase 5 plan's Ruling 4):
  - Detected from the content as `m.fdc.mount` does (`DiskImage`): a DMK
    header or a JV3 sector table before the program formats, a JV1, which is
    only a size, after them all, so every committed example `.CMD` stays a
    program. `formatOf` returns `'dsk'`, and `diskContainer(bytes)` names
    the container.
  - With `reset` (the default) the image goes into drive 0 of a fresh
    machine, and `load` runs until the ROM jumps to the boot sector at
    `4300h`, for at most 5 s emulated; the `Boot:` line says when, or that it
    did not get there and where the PC is, and tells the agent to follow with
    `run until: "settled"`, repeated, since a disk loader takes seconds of
    emulated time. The screen baseline and coverage start there.
  - The manifest names the container and geometry (`Format: disk image (DMK,
    40 tracks, 1 side, sectors a track varying), in drive 0`), with no blocks
    and no entry. `coverage` says why a disk has no blocks (what it ran
    counts as outside them) instead of blaming ASCII BASIC.
  - With `reset: false` the image is only put in drive 0 of the running
    machine (`Boot: none`), and `reset` boots from it.
  - A file that is neither is refused with a sentence naming both kinds.
  - Tests (`packages/mcp/test/disk.test.js`): on a synthetic disk-boot ROM
    and a JV1 built by the test, the committed DMK and JV3 samples, and the
    synthetic ROM that never boots, in CI; with the Model III ROM and the
    local Rear Guard dual-boot DMK, `load`, `run until: "settled"`, ENTER,
    and the title. `test/helpers.js` gained `diskBootRom` and `bootJv1`.
- Docs: emu spec §3 (an export lays a JV1 or JV3 out with standard gaps, so
  rotational positions and timing change; the four local images are DMKs and
  export as themselves), §5 (a DMK is detected only at its exact length; a
  field cut off by a DMK track's end, Scarfman's track 0 sector 15, moved to
  the unverified list, with `_dmkWriteSector` dropping bytes past the end;
  the real-disk checks), §10 and §11 row 5; MCP spec §5 `load`; the emu and
  MCP READMEs, the root README, and CLAUDE.md.
- Phase 6 prep, behaviour-neutral on the Model III: the WD1793 takes its CPU
  clock as a constructor option (`new FDC1793({ cpuHz })`, 2,027,520 by
  default), and derives the step rates, settling, byte times, revolution, and
  index-pulse width from it (`fdcTimes(cpuHz)`; the exported constants are
  the Model III's values, unchanged). The drive-select latch is taken decoded,
  `fdc.select(drive, side, mfm)`; the Model III's port `F4` is decoded in
  `src/machine/io.js` (`decodeModel3Select`), and `fdc.selectDrive(byte)`
  stays as a convenience for a bare controller.

### Fixed

Found by the emu phase 7 differential harness, `@fugloy/emu`, on `emu-phase7`:

- A halted CPU now increments R on every step it idles (4 T-states, R + 1,
  bit 7 kept). The Z80 runs NOP M1 cycles while halted (Zilog UM0080, HALT)
  and R counts every M1 (Young §6.1); before, R stood still, so a program
  that read R after a HALT saw a different value than on the hardware.
- Port `FF` reads bits 5–1 as port `EC`'s latch (DISWAIT, ENEXTIO, ENALTSET,
  MODSEL, CASMOTORON) and bit 6 as 1, as the Model III Technical Reference
  Manual gives CASIN* (p. 22; bit 6 is undefined there, and an undriven bit
  reads 1, as trs80gp has it); before, only bit 7 (the 500-baud latch) and
  bit 0 (the 1500-baud level) could be set.
- No committed golden or fixture changed with either fix: the MCP story
  transcripts, the Sea Dragon label file
  (`examples/sea-dragon/seadrg01.labels.json`), and the save-state tests all
  pass unchanged, none capturing R after a HALT or a port `FF` read.

From the emu phase 5 final review, `@fugloy/emu`, on `emu-phase5`:

- Read Track no longer throws (a `TypeError` on a null disk) when the drive
  goes empty or none is selected while it waits for the index pulse (a guest
  `OUT` to port `F4`, or `m.fdc.unmount`): the command ends on the not-ready
  path, Busy reset, an interrupt, Not Ready in the status. Write Track ends
  the same way. Every other place the controller reaches the disk was checked
  to sample Ready or find an ID first.
- A snapshot restores each disk as the container it was: each disk entry
  carries `format`, and a JV1's `dirTrack`, and `restoreState` parses the
  bytes as that container (`new DiskImage(bytes, name, { format, dirTrack })`)
  instead of detecting. Before, a blank disk formatted with a first track of
  5 × 1024 or 8 × 512 sectors serialized but threw on restore (JV3 detection
  refuses fewer than ten sectors), and a JV1 whose track 0, sector 0 the
  program rewrote came back with the directory track its new byte 2 named.
  A snapshot without these fields is detected as before.
- A DMK ID with no data mark within 30 (FM) or 43 (MFM) bytes of its CRC is
  kept (`noData` in `trackIds`) instead of dropped: Read Address and a Type I
  verify read it, Read Sector passes over it to Record Not Found, and Write
  Sector lays its data field where the chip writes one, which Read Sector
  then reads.
- `TRS80System.stepInstruction` resets its in-instruction flag (`_executing`)
  in a `finally`, so a `beforeExecute` callback or an instruction that throws
  no longer leaves later debugger port pokes waiting on the controller.
- Docs: emu spec §5 (the ENTER-to-title check covers the two dual-boot DMKs;
  `ELIMATOR.dsk` is checked only to its menu; Master Reset not modeled and
  Read or Write Track with no disk at the index pulse, both unverified; the
  DMK ID with no data mark; disks in a snapshot), §3, and §8 and
  `docs/label-format.md` (a disk loaded with `m.load.dsk` contributes no
  `load` blocks, and `labelFile()` needs a `name` for one). MCP `formatOf`
  notes that a JV1 that also parses as a `.CMD` loads as a program.

### Release coupling

`@fugloy/mcp`'s disk support needs emu APIs that `@fugloy/emu` 0.2.0 does not
have (`m.fdc`, `m.load.dsk`, `DiskImage`, `CPU_CLOCK_HZ`). Its dependency is
`workspace:^`, which publishes as `^` the emu version in the workspace, so
`@fugloy/emu` must be bumped to 0.3.0 and released before the next
`@fugloy/mcp` release; an mcp published against emu 0.2.0 would install an
emu without the disk controller.

## [1.2.0] - 2026-10-18

`@fugloy/z80`, `@fugloy/disasm`, and `@fugloy/cli` 1.2.0, released with
`@fugloy/emu` 0.2.0 and `@fugloy/mcp` 0.1.0. The disassembler says why each
machine-code line is there (Explain's "why" layer, shown in the workbench's
Explain tab), and shows a label's `note`, the remark the label and coverage
file gained in emu phase 4 (emu 0.2.0 below).

### Added

Core, Explain's "why" layer (design in
`docs/superpowers/specs/2026-10-17-explain-tab-design.md`, section Why):

- `Explanation.why` on every code line, four lists of sentences, each empty
  when nothing applies:
  - `register`: facts about the Z80 that make the line use the register it
    does (8-bit arithmetic, logic and compares on A; only A at a fixed
    address, through BC or DE, or to a port named in the instruction; a
    register-picked port in C; DJNZ counting in B; the block instructions'
    HL, DE and BC; the rotate-A and adjust instructions; 16-bit adds into HL,
    IX or IY; `JP (HL)`; `EX DE,HL`), and, for a line that loads a register,
    the ROM or DOS routine called next in straight-line code whose table
    entry says it takes its input there, cited by entry. `registerName`
    names the one register the sentences speak of (absent when several).
  - `purpose`: what the line does for the program, from proven flow only. A
    value is followed forward to its next use (a store to the screen with
    row, column and, when proven, the character; a port, with port $FF's
    sound and cassette; a DJNZ count with the loop's runs; a ROM routine that
    takes it; a CP after a key routine, with the key's name) or back to where
    it was set. The scan stops at a branch, a join, a call that does not take
    the register, a jump or return, undecoded bytes, and a rewritten opcode,
    and says the next use is not certain and why. Only the Model III and 4
    show $60–$7F as lowercase; on a stock Model I (no bit 6 in video RAM, so
    $61 shows as "!") and with no machine selected, those bytes are not
    named.
  - `idiom`: why a programmer usually writes the line this way: `XOR A` and
    `SUB A`, `OR A` and `AND A` (and before `SBC HL`), `CP`, `LD B,n` with
    `DJNZ`, `DJNZ`, `ADD A,A` and `ADD HL,HL`, `SLA` and `SRL`, the one-byte
    rotates, `INC`/`DEC (HL)` and `(IX+d)`, `PUSH AF` and `POP AF` around a
    call, `EX AF,AF'`, `RST`, `LD r,(HL)` with `INC HL`, and `LDIR`/`LDDR`,
    each against the usual alternative. Every byte and T-state count is
    decoded from `@fugloy/z80` at run time, and the line is quoted as the
    listing prints it.
  - `routine`: "It is part of the routine TITLE_FRAME ($4B5E), which writes
    to the screen and reads the keyboard", from the routine summary's new
    structured `touches` (`screen`, `keyboard`, `portsOut`, `portsIn`).
  The package exports the `Why` type.
- The workbench's Explain tab shows them in **Why it's here**, after the lead
  and the details strip: **Why A** (or the register's name; "Why this
  register" when the facts speak of several), **What it does here**, and
  **Why write it this way**, each only when it has sentences, with the same
  address and Symbol-tab links as the lead. The routine reference closes the
  section in a muted line, since it repeats on most lines of a routine, and
  only when the routine section below is not shown (that section already
  names the routine). The section is absent when all three parts are empty.

- The disassembler shows a label's `note` from the label and coverage file as
  the line's comment, ahead of an observed label's evidence (`note;
  observed: …`); a hint file's comment still wins.


## [mcp 0.1.0] - 2026-10-18

`@fugloy/mcp` 0.1.0, the MCP server's first npm release (published 2026-10-18): MCP phases A–F
(MCP spec §11), 29 tools, four prompts, and five resources over
`@fugloy/emu` 0.2.0. Install it with `npx -y @fugloy/mcp` as a Claude Code
MCP server (or run `node packages/mcp/bin/fugloy-mcp.js` from a clone for development; `packages/mcp/README.md`). It depends on `@fugloy/emu` `^0.2.0`,
`@fugloy/disasm` and `@fugloy/z80` `^1.2.0`, the MCP SDK 1.32.0, and zod
4.6.5.

Agent acceptance (MCP spec §10), the release check: story 7, the
`label-pass` prompt with `minCalls` 5, run headless on 2026-10-18 on the three
public-domain games that run under `Machine`, each on a scratch copy
(`claude -p`, the server from the working tree, the MCP tools its only tools,
nobody helping). All three finished, exported the sidecar, and said what they
left alone and which names were guesses. Every label carries the agent's
evidence note. What was checked: all 18 of Sea Dragon's labels (12 against
the hint file's names, 3 against its notes, 3 in the disassembly), 4 of
Eliminator's 17, and 4 of Rear Guard's 24 (in the disassembly); every one
checked agreed, and the rest are unchecked. A label's `note` is shown by
the disassembler from core 1.2.0, the next core release; `@fugloy/disasm`
1.1.0 reads the file but ignores `note`.

- **Sea Dragon** (`seadrg01.cmd`; 90 turns, 5 min): 18 labels of the 22
  routines `suggest` listed, each with a note giving its evidence (code, plus
  watches for the air supply and the arrow keys). Twelve name routines the
  hand-annotated `seadrg01.hints` names, and agree with it: `PrintText`
  (`PRINT_TEXT`), `BlitSprite` (`DRAW_SHAPE`), `DrawObject`, `PlayTone`
  (`TONE`), `SoundStep` (`NEXT_NOTE`), `TitleShowPollEnter` (`TITLE_FRAME`),
  `DrawTerrain` (`DRAW_CAVERN`), `SurfaceAndAir` (`AIR_SUPPLY`),
  `DrawPlayerSub`, `UpdateEnemies` (`UPDATE_OBJECTS`), `ReadMoveKeys`
  (`MOVE_PLAYER`), `UnpackLevelObjects` (`SETUP_OBJECTS`). Three are the
  title routines the hints describe without naming, and three
  (`OneShotTone`, `ReadFireKeys`, `LaunchTorpedo`) the code bears out. It
  left `$57C4`, `$5525`, `$586D`, and `$557C` alone: their object tables
  stayed empty in a minute of play, so the code that would show what they
  are never ran. 18 checked, all agree; 0 unchecked.
- **Eliminator** (`elimin8c.cmd`; 119 turns, 4 min): all 17 listed routines,
  among them `RenderFrame` (confirmed with a trace from call to return),
  `DrawObject` (12,234 calls), `HitTestPlayerShip`, `PlayToneOnce` (a
  self-patching beeper), `CopyTextToScreen` (the same uppercase-fallback
  print routine as Sea Dragon's), `SpawnObjects` and `SpawnWave`, and
  `ResetPlayerShip`. It marked three as weaker readings in their notes:
  `InitHumanoids` (a *Defender*-style name for objects enemies carry up),
  and `ShotMoveUp`/`ShotMoveDown`. 4 checked against the disassembly, all
  agree; 13 unchecked.
- **Rear Guard** (`reargrd5.cmd`; 93 turns, 5 min): all 24 listed routines,
  from `PlayTone`, `SoundUpdate`, and `PrintToScreen` to `UpdateEnemies`,
  `SpawnEnemyBombs`, and `AnimateExplosions`, mostly from reading the code
  (it said so) with the fire and movement paths confirmed in play. To get
  past "1 or 2 Players?" it found on its own that this build writes `$03E3`,
  the Model I's keyboard driver, into the keyboard vector at `$4016`, so the
  Model III ROM's key wait never returns, and poked `$4016` to the Model III
  driver at `$3024` in the running machine. 4 checked against the
  disassembly, all agree; 20 unchecked. It said it guessed which terrain
  layer is the "slow" one.

Two of the three answers pointed out that `coverage` counts only the loaded
blocks: each game copies itself elsewhere before running, so the export
reports 0.1% executed for Eliminator and Rear Guard (10.6% for Sea Dragon)
though the labels sit at the addresses that ran.

Phase E's check, also headless: given the `orient` prompt on Sea Dragon, a
session (19 turns, 56 s) found that the entry only copies the game to `$497F`,
read the ROM symbols resource, found with `callers` that the game calls no
ROM routine, and proposed the drawing, keyboard, sound, and title routines
to name first, labelling nothing.

### Added

MCP phase F, part 2: the release (`@fugloy/mcp`; MCP spec §9–§11):

- `@fugloy/mcp` 0.1.0 and `@fugloy/emu` 0.2.0 get their npm packaging: a
  `LICENSE` in `packages/mcp`, `repository`, `homepage`, `bugs`, and
  `publishConfig` as the core packages have, README links absolute so they
  work on npmjs.com, and `files` that ship `bin`, `prompts`, and `src`. mcp
  names its `@fugloy` dependencies `workspace:^`, which `pnpm pack` turns
  into `^0.2.0` (emu) and `^1.2.0` (disasm, z80).
- `./publish.sh check mcp`: the `mcp` set. It refuses unless the `@fugloy`
  versions mcp needs are on npm, or emu is staged by `check emu`, in which
  case the whole check runs with the staged emu tarball as a rehearsal and
  stages nothing, keeping emu's staging for `publish`. The tarball check
  accepts mcp's `^` ranges on the local versions and its exactly pinned
  third-party dependencies. The smoke test installs the tarball (with the
  staged emu, if that is the case) in a scratch project and checks that
  `npx fugloy-mcp` answers `initialize`, with its name and version, and
  `tools/list` over a pipe, printing nothing but JSON-RPC. `publish` refuses
  an mcp release whose `@fugloy` dependencies are not on npm. Tags are
  `mcp-vX.Y.Z`. The core and emu sets are unchanged.
- The README's setup describes the npm install (`npx -y @fugloy/mcp` in
  `.mcp.json` or `claude mcp add`), and the clone setup as an
  alternative for development.
- `screen diff: "<snapshot>"` against a snapshot of another program adds the
  line `diff` gives in that case (`Note: title belongs to RAIDERS and now to
  SCORER.`), after its count line.
- The restart round trip in `test/guardrails.test.js` closes both servers in
  `finally`, whatever failed, and prints each child's stderr when it fails.
- Story 7 on three games, above.

MCP phase D, snapshots and `diff` (`@fugloy/mcp`; MCP spec §3, §5 Snapshots):

- `snapshot {name}` saves the machine (`m.debug.snapshot()`, emu spec §7) as
  `snapshot "before" at cycle N (K KB)`; a second snapshot of one name
  replaces the first. At most 16 are kept (`limits.snapshots`, a new limit in
  `fugloy.mcp.json`); past that the least recently used (taken, restored, or
  diffed longest ago) is evicted, and the result names it. `snapshots` lists
  name, cycle, and program, least recently used first; `status` counts them.
- `restore {name, clearDebug?}` puts the machine back exactly and returns the
  register block. Coverage, callers, the hit log, and the trace are kept, as
  in the emu spec; `clearDebug: true` clears coverage, callers, the hit log,
  and the facts `suggest` reads, so an abandoned branch does not count as
  covered (MCP spec §12's last question, settled). Each snapshot records the
  program it belongs to and outlives a `load`, but restoring one of another
  program (or one taken before any load over a program) is refused with a
  sentence naming the program to load first, never mixing one program's
  memory with another's labels and sidecar.
- `diff {a, b, range?}` compares two snapshots, or one and `now`, over video
  RAM and RAM (`$3C00–$FFFF`, or `range` inside it): a count of runs and
  bytes, then each run of adjacent changed bytes as `addr old → new`, eight
  bytes a line, with any label inside a run named. Story 2 ("locate game
  variables") runs on a synthetic program, SCORER, and is byte-compared with
  the committed `test/golden/story-02.txt`: the diff after one press of A
  shows the score byte at `$7E10` and the press counter at `$7E20`.

MCP phase D, `search` and `callees` (`@fugloy/mcp`; MCP spec §5):

- `search {bytes | text, range?, fold?}` lists every address where a byte
  string (hex or an array) or printable ASCII text sits, scanning the 64K
  address space as the CPU sees it, ROM included, unless `range` narrows it;
  a match lies wholly inside the range. `fold: true` makes text match either
  case and the `00h`–`1Fh` bytes the Model III's character generator shows as
  `@`, `A`–`Z`, and `[` to `_`. At most 256 addresses, eight a line, then a
  line counting the rest. An empty pattern, both patterns, or neither is
  refused with a sentence, never answered with every address.
- `callees {addr, depth?}` draws the routines a routine called since load as
  an indented tree (depth 1–4, default 2), each with its call count, call
  sites, and name. It reads coverage's callers map: the `call` and `rst`
  edges from inside the routine's extent, which runs to its first executed
  RET as `suggest` defines it. Routines already expanded and calls back into
  the path are marked rather than drawn again.
- `screen diff: "<snapshot>"` shows the cells changed since a snapshot (the
  spec §5 form that was missing), and `restore` makes the restored screen the
  baseline for the next `screen diff: true`.
- `diff` also names a sized label that starts before a run and covers it.
- `poke`'s byte parsing moved to `args.js` for `search`; an empty hex string
  now says `bytes is empty` rather than `not hex pairs`.

MCP phase E, resources, prompts, and the ROM symbols (`@fugloy/mcp`; MCP
spec §6):

- Resources, plain text, reading one changing nothing: `fugloy://status`,
  `fugloy://screen` (which leaves `screen diff`'s baseline alone),
  `fugloy://labels`, `fugloy://program/manifest` (the text `load` returned),
  and `fugloy://rom/{model}/symbols`. One that needs a program reads as the
  tool's sentence until one is loaded.
- `fugloy://rom/3/symbols` is generated from `@fugloy/disasm`'s cited Model
  III ROM and hardware tables, 167 lines of address (or range, or port),
  kind, name, and purpose, such as `0033h routine $VDCHAR display the
  character in A at the cursor`. Other models read as a sentence naming emu
  phase 6. MCP spec §12's `@fugloy/rom-symbols` question is settled: no
  separate package.
- Prompts `orient {path}`, `find-writer {path, range}`, `label-pass {path,
  minCalls?}`, and `explain {addr}`. Their texts are Markdown files in
  `packages/mcp/prompts/`, shipped in the npm package and read at startup;
  the server sends each file's `## Prompt` section with its placeholders
  filled in. `find-writer` gets the range as `3C00h–3FFFh` with the `watch`
  arguments worked out, and `explain` gets the address as the tools echo it,
  labels included. Arguments are checked like a tool's and refused with
  sentences; a missing prompt file does not stop the server, and asking for
  that prompt names the file.
- The story prompts moved from the root `prompts/` to `packages/mcp/prompts/`,
  so each text has one copy: story 7's prompt is now `label-pass.md`, written
  with `{path}` and `{minCalls}` (and the keys described for any game, Sea
  Dragon's as the example), and `story-01.md` moved unchanged. The root
  `prompts/README.md` points there.

MCP phase F, part 1: guardrails and golden transcripts (`@fugloy/mcp`; MCP
spec §7, §10):

- `test/guardrails.test.js` trips every §7 limit through the protocol and
  checks its text: the output cap (each page within `limits.outputBytes`, the
  pages joined giving the whole output back) and the 8,192-byte default on
  the longest output, `run`'s emulated and wall-clock caps, trace depth,
  `step`, `peek`, the 16-snapshot cap, `poke` into ROM (nothing written
  without `force`), and `load` outside the fixtures folder echoing the path.
  A session that calls every tool, export included, leaves only the sidecar
  and the export file behind, and a non-label file at an export path is
  kept.
- `trace` shows at most 100 trace lines a page, after its heading line, as
  spec §7 says; the rest page with `offset`. A tool can now declare such a
  line page (`page: { lines, heading }`) beside the byte cap.
- The label round trip of spec §10 with a real restart: two child processes
  of the bin, one after the other, the second showing the first's label from
  the sidecar.
- Story 3 joins the golden transcripts (`test/golden/story-03.txt`): on a
  synthetic program, TABLER, coverage tells executed code, a table and flag
  read as data, and a skipped CALL and its routine never seen apart, and
  `disasm` marks them. The story scripts live in `test/stories.js`, each
  replay in a folder of its own, and `test/golden.test.js` replays every
  golden story twice, byte for byte, cycle counts included.
- `screen diff: "<snapshot>"` against a snapshot taken in the other of the
  32- and 64-column widths says the widths differ and shows both screens,
  each in its own width, instead of comparing cells at the wrong positions.
- The prompts refuse a `path`, `range`, or `addr` holding a control
  character with a sentence, instead of pasting it into the prompt's text.
  `orient` now asks for the ROM calls made from the program's own blocks
  only, not those the ROM makes to itself.
- `fugloy://program/manifest` reads as a sentence if the manifest text was
  not kept, never as no text; a test pins that `search` over `FFFE-FFFF`
  for three bytes finds nothing.

MCP phases A–C, built as emu phase 4 (MCP spec §5, §11):

- The stdio server (`bin/fugloy-mcp.js`, MCP SDK 1.32.0, zod 4.6.5, plain
  JavaScript, no build step): one Model III per process, nothing running
  between calls. The `fugloy.mcp.json` config is read from `$FUGLOY_CONFIG`
  (a set variable that names no file is an error, not a fallback), then the
  working directory, then `~/.config/fugloy/`; ROM and fixtures paths are
  relative to the file; `limits` override the §7 defaults (output 8,192 bytes
  a call, `run` 10 s emulated and 5 s wall clock, trace depth 2,000, `step`
  100, `peek` 1,024), and an unknown limit or a bad value is refused with a
  sentence naming the file. A stdout guard, installed before anything else
  loads, sends console output and the emulator's log to stderr, so stdout
  carries JSON-RPC and nothing else (a test spawns the bin over pipes and
  checks every line).
- Conventions for every tool (spec §4): results are text; errors are
  `isError` sentences, never stack traces. Addresses take `5200`, `0x5200`,
  `$5200`, `5200h`, a JSON number (decimal), or a label name, and echo as
  `5200h`; an all-hex label such as `ACC` is refused naming both readings.
  Lengths and counts are decimal, and a string where one belongs is answered
  `write 1024, not "400"`. Tools list real JSON schemas, and invalid
  arguments get the same plain sentences. Output past the cap is cut at a
  line with `… (N more; use offset=…)`; `offset` pages through the last
  output without running the tool again.
- Phase A, lifecycle, execution, inspection: `load`, `reset`, `status`,
  `run`, `step`, `key`, `regs`, `peek`, `poke`, `screen`.
  - `load` detects `.CMD`, `.BAS` (tokenized or ASCII), and `.CAS` by
    content, never by extension, boots the ROM to `READY` first (ENTER at
    Cass? and Memory Size?), and returns a manifest: format, every block
    with its range and record, the entry, the ROM recognised by hash, the
    boot time, the sidecar found, and the resolved path. `model: 1` or `4` is
    refused naming emu phase 6. A load that fails leaves the session as it
    was. `reset: false` loads into the running machine.
  - `run` takes `cycles`, `seconds`, or `until`: `break`, `halt`, `screen`
    (the first change, checked every 2,000 T-states), `settled`, or
    `pc:<addr>`, with `trace` on request. `settled` waits for the first
    change, then stops when video RAM returns to a state it held since then
    (an animation or blink cycle closed; states kept by hash, compared
    exactly) or stays the same for 0.5 s emulated. Sea Dragon reaches its
    title with two calls: the intro's cycle, then the title's. Every stop is
    cycle-based, so a session repeats byte for byte; the wall-clock cap is
    the one exception, and only when it trips.
  - `step` (1–100) prints the instructions it ran, then the registers.
  - `key` types `text`, then named `keys` (`ENTER`, `BREAK`, `CLEAR`, the
    arrows, `SHIFT`, `SPACE`), through the keyboard matrix at `cps` (default
    20) or, with `mode: "hook"`, through the ROM's keyboard routine; it runs
    until every key is delivered plus 0.2 s, within one wall-clock deadline,
    and returns the screen diff.
  - `regs` (text or JSON), `peek` (up to 1,024 bytes, with labels), `poke`
    (old → new; ROM only with `force`, the keyboard never), `screen` (the 64
    or 32 columns as text, or a diff since the last call).
  - `reset` before any load powers on a machine with no program, for BASIC.
- Phase B, debugging: `break`, `unbreak`, `watch`, `unwatch`, `hits`,
  `trace`, `callers`, `disasm`.
  - `break` takes `once` and a `condition` of `<reg> <op> <value>` clauses
    joined by `&&` and nothing else (registers, pairs, `IX IY SP PC`, flags
    `ZF CF SF PVF HF NF`; `C` and `H` are the registers), echoed with values
    in hex. `unbreak` by id, address, or all.
  - `watch` on read, write, or both, optionally stopping `run`; `hits` shows
    the log newest last, after a `By pc:` line that counts every hit by the
    instruction that made it and names the routine each is in (the nearest
    call target at or below it, a heuristic), with `clear` and JSON.
  - `trace`: `run trace: true` and every `step` record (tracing costs about
    4× speed, so nothing else does); the server keeps the newest 2,000
    instructions across stretches, marks untraced gaps, and collapses loops
    unless `regs` is asked for.
  - `callers`: `from kind count` rows (`call`, `jp`, `jr`, `rst`,
    `ret-to`), recorded from the load; for an address nothing reached, the
    nearest call target at or below it.
  - `disasm`: a linear listing with `@fugloy/z80`, each line marked `*`
    executed, `d` read or written as data, or `?` never seen, and names after
    `;`: session labels, then the Model III ROM and hardware tables of
    `@fugloy/disasm` (`VIDEO+28Dh`). A 16-bit constant gets only data names,
    never a ROM routine's.
- Phase C, knowledge: `label`, `unlabel`, `labels`, `coverage`, `suggest`,
  and the sidecar.
  - `label` checks a name as the disassembler does (no mnemonic, register,
    zmac word, or generated `SUB_hhhh` shape, and not a name another address
    has), takes `kind`, `size`, and a `note`, replaces a label at the same
    address and says so. `unlabel` by address or name; `labels` by range and
    source, with notes and evidence.
  - `coverage`: the share of loaded bytes executed, the code and data
    ranges, the bytes never seen, and what ran outside the loaded blocks;
    `ranges` as a table; JSON; and `export`, which writes the full label and
    coverage file, this session merged into the earlier sessions' coverage
    and callers and appended as a session record, to `path` or the sidecar.
    Exporting again in one session replaces its record instead of counting
    twice.
  - `suggest`: the unnamed call targets outside the ROM reached by `CALL` or
    `RST` at least `minCalls` times (default 5), most calls first: calls,
    distinct callers, then notes by address, heuristic: `writes video RAM`,
    `reads the keyboard`, `writes port FFh (sound)`, `loops ≥ 1000× a call`.
    The server watches memory and port traffic from the load through the
    emulator's hooks and credits a routine with what its instructions did,
    from the target to its first executed unconditional `RET`, within 256
    bytes. The hooks cost about 1–3% (Sea Dragon at about 33× real time with
    coverage and them, 42× with debugging off).
  - The sidecar `<program>.fugloy.json` beside the program, in the format of
    `docs/label-format.md`: `load` reads it (or one in the config's
    fixtures folder; writes still go beside the program) and its labels are
    used at once; `label` and `unlabel` rewrite it at once. A sidecar that
    is not JSON, breaks a rule of the format, was written for another
    program, or is a link is reported and never overwritten. Before every
    write the server checks the file is still what it last read or wrote, so
    a hand edit, a removal, or a file that appeared is never overwritten; it
    never writes through a link, and `coverage export` compares files by
    device and inode, so no spelling can name the program, the ROM, or an
    ignored sidecar. After `load` with `reset: false` of another program,
    `export` refuses and `coverage` and `suggest` say the coverage is mixed.
    The sidecar and explicit export paths are the only files the server
    writes.
- Tests, on a synthetic 14K ROM and synthetic programs, so CI runs them: the
  config, the argument rules and formatters, every tool, the guardrails, the
  stdout rule over a real pipe, determinism (one session twice, identical
  text), and story 1 replayed on RAIDERS and byte-compared with the committed
  `packages/mcp/test/golden/story-01.txt`. With the Model III ROM in
  `fugloy.mcp.json`: `phase-a-rom.test.js` (Sea Dragon to its title and
  "1 or 2 Players?", an ASCII `.BAS` program typed in and run) and
  `story-7-rom.test.js`, story 7 in scripted form on Sea Dragon: a minute of
  arrow keys and SPACE, `suggest minCalls=5` (`$6140`, 700 calls from 6
  sites, writes video RAM), a watch on the screen line holding text whose
  every write comes from `$6141` with a printable value, `label` with a
  note, `coverage export`, and `@fugloy/disasm` listing `PRINT:`, the note,
  and `CALL PRINT` from the exported file. Golden transcripts are committed
  only for synthetic sessions; ROM sessions assert properties, since their
  output would carry ROM screen text.
- The story prompts to paste into Claude Code (now
  `packages/mcp/prompts/story-01.md` and `packages/mcp/prompts/label-pass.md`,
  story 7's; MCP phase E moved them from the root `prompts/`), and `.mcp.json.example`, the dev config that runs the
  working tree (copy it to `.mcp.json`, now gitignored; a committed one
  would start the server in every contributor's session).

## [emu 0.2.0] - 2026-10-18

`@fugloy/emu` 0.2.0, the emulator's first npm release (published 2026-10-18): phases 0–4 of the
eight in the emu spec (§11). It goes from 0.1.0 to 0.2.0 because phases 2–4
changed its API (the `Machine` facade, `m.debug`, the hooks' `pc` argument).
It has no dependencies. Phases 0 and 1 were merged while core 1.0.0 was being
built, phases 2 and 3 between 1.0.0 and 1.1.0, and phase 4 after 1.1.0.

Emu phase 4 is the MCP server, `@fugloy/mcp` (above), with MCP phases A–C.
Its done-criterion is met: Claude Code loaded a game, found its print
routine, and labelled it unaided. Given only story 1's prompt on Sea Dragon
(`packages/mcp/prompts/story-01.md`), a headless session (`claude -p`, the
server from the working tree, the MCP tools its only tools; 2026-10-18, 15
turns, 47 s) watched video RAM, ran until the screen settled, read `hits`
(the credits written at `$6141`, in the routine called at `$6140`),
`suggest`, `callers`, and `disasm`, and labelled `$6140` `PRINT_TEXT` with a
note that matches the hand annotation in `seadrg01.hints`. This is the first
entry in the agent acceptance log of MCP spec §10.

Emu phase 3: the debugger and the label and coverage file, which the
disassembler reads from 1.1.0. Phase 3's done-criterion is met: a scripted
session produces a label file Fugløy's disassembler consumes.

Emu phase 2: the Model III as a `Machine`, with the devices and loaders that
run real programs. Phase 2's done-criterion is met: Sea Dragon, Eliminator,
and Rear Guard load and reach their title screens through `Machine` (Armored
Patrol was tried and left out).

Emu phase 1: the Z80 core passes the ZEXDOC and ZEXALL instruction
exercisers, and its timing matches `@fugloy/z80`.

Emu phase 0: the core of `cschweda/trs80-emulator`, without its DOM, boots
the Model III ROM to `READY` in Node.

### Added

Emu phase 4, the emulator's side (the server itself is `@fugloy/mcp` 0.1.0,
above):

- The label and coverage file (emu spec §8, `docs/label-format.md`) gains
  `note` on a label of any source: a remark for a human, without control
  characters. The emulator's `parseLabelFile` checks it, `m.debug.label`
  takes it, and `@fugloy/disasm` reads it and shows it as the line's comment,
  ahead of any evidence (`note; observed: …`); a hint file's comment still
  wins.
- The emulator's memory and port hooks get the instruction's address as a
  trailing `pc` argument (`onMemRead(addr, value, pc)`,
  `onMemWrite(addr, value, prev, pc)`, `onPort(port, value, dir, pc)`), the
  same `pc` a watch hit carries. Existing hooks are unaffected.
- `m.keyboard.type` and `feed` document an array of keys, each a character
  or a key name (`type(['ENTER'])` presses ENTER, where `type('ENTER')`
  types five letters), with a test.

Emu phase 3:

- `m.debug` (spec §3, §7): breakpoints with `once` and `when`, read and write
  watches with a 65,536-entry hit log, memory and port hooks, coverage of
  executed, operand, read, written, jumped-to, and called bytes with a callers
  map (one switch), a bounded instruction trace with loops collapsed,
  snapshots and `m.video.diff`, and user labels. Debugging off costs nothing
  measurable: Sea Dragon runs at about 42× real time with it off and about 30×
  with coverage and a 10,000-deep trace on, both over the §4 target of 20×.
- How the debugger behaves at the edges: a breakpoint stops a run before its
  instruction, and the next run starts past it, so hit counts do not depend on
  how a session is split into runs; a halted CPU is never stopped by a
  breakpoint; a watch hit by an interrupt response at a boundary a breakpoint
  then holds is returned by the next run; logged hits are frozen objects;
  where a return lands is not marked as a jump target (the callers map
  records it as `ret-to`), and the keyboard hook's stand-in `RET` marks no
  coverage; `step` and `run` throw when called from a `when` or `until`
  callback.
- `m.debug.labelFile()`, `parseLabelFile`, `mergeLabelFiles`, and the
  `rle-hex` coverage encoding: the label and coverage file of spec §8 and
  `docs/label-format.md`, with a committed synthetic fixture.
- `examples/sea-dragon/seadrg01.labels.json`: the file of a scripted Sea Dragon
  session (coverage from `$497F`, after the loader's copy, through the title
  screen and ENTER), written by `packages/emu/scripts/sea-dragon-labels.mjs`.
  With the committed hints every executed root it gives starts an instruction
  the hints decode; without them it states nothing the file's bytes do not
  hold.
- The deliverable proof, `packages/emu/test/integration/label-session.test.js`:
  a synthetic session's file makes the disassembler type a table as data and
  name the subroutine, and two runs end with identical hit logs and files.
  `packages/emu/scripts/benchmark.mjs` measures speed per mode.

Emu phase 2:

- `Machine` (spec §3): `step(n)` and `run({ cycles, until })` with reasons,
  registers, flags, memory, ports, ROM identification (`m.rom`, `ROM_HASHES`),
  and `m.system` as an escape hatch. `run` refuses a `cycles` budget that is
  negative or not a finite number.
- `m.video.text()`: the screen as 16 lines, 64 or 32 columns.
- `m.sound`: every port `FF` write in a 65,536-event ring, stamped in T-states,
  with `events(sinceCycle)` and `overflowed`. `events()` with no argument
  includes a write at cycle 0, and a reset or a state restore clears the ring.
- `m.keyboard`: `press`, `release`, cycle-timed `type` through the matrix, and
  `feed` through a hook on the ROM's keyboard-scan entries (`$002B`, `$0049`),
  verified against the Model III ROM listing. `type` holds each key 50 ms of
  emulated time at its default 10 characters a second (Rear Guard needs ENTER
  held about half a second, `{ cps: 1 }`); `feed` checks every character
  first and queues nothing when one is bad; the hook's stand-in `RET` costs
  10 T-states and does the CPU's end-of-instruction bookkeeping (a pending
  `EI` takes effect). `m.keyboard.clear()` drops queued input, and
  `m.load.cmd` and the fast path of `m.load.cas` call it, so a new program
  does not read the last one's keys.
- `m.load.bas`: tokenized (`FF`) and ASCII `.BAS` files; ASCII goes through the
  keyboard hook. A file without the `FF` header is rejected with a message
  that says to add one.
- `m.load.cmd` and `m.load.cas` with manifests of where bytes landed and why,
  including the ROM-loader path (`via: 'rom'`, blocks marked `predicted`) and
  the `m.cassette` deck.
- Determinism proof: a scripted session run twice ends byte-identical
  (synthetic ROM in CI, Sea Dragon locally), and splitting a run into slices
  does not change where it ends.

Emu phase 1:

- The Z80 core passes ZEXDOC and ZEXALL, all 67 groups each, run one Vitest
  test per group through a CP/M harness (`pnpm zex:install`, then
  `FUGLOY_ZEX=1`; CI runs them in `exerciser.yml`), and its T-states match
  `@fugloy/z80` for every opcode, both ways for each conditional. On the way:
  - `CPL` sets flags 3 and 5.
  - MEMPTR follows the documented rules, interrupt entry included, and save
    states keep it.
  - `IN F,(C)`, `OUT (C),0`, and the `NEG`, `RETN`, and `IM` duplicates exist,
    and the other undefined `ED` opcodes are 8-T-state NOPs.
  - A `DD` or `FD` before another prefix or `ED` is a 4-T-state step with no
    maskable interrupt after it, and one before `EX DE,HL` or `EXX` is
    ignored.
  - The block I/O instructions set every flag.
  - `ADC`, `SBC`, `AND`, `XOR`, `OR`, and `CP` on `(HL)` take 7 T-states, not 4.

Emu phase 0:

- `packages/emu`: the core of `cschweda/trs80-emulator` (v1.6.0) — Z80 CPU,
  Model III memory map and I/O, keyboard matrix, cassette, WD1793 disk
  controller, disk images, printer, `.CAS`/`.CMD` formats, save states — as
  plain ESM with no DOM (`NOTICE.md` records the source). An injected logger
  replaces `console` and a built-in base64 replaces `Buffer`/`atob`/`btoa`. A
  check links and runs the package in an empty `node:vm` context, as the spec
  requires. The Model III ROM named in `fugloy.mcp.json` (see
  `fugloy.mcp.example.json`) boots to `READY` in Node, the same way twice; a
  `FUGLOY_CONFIG` that names no file is an error, not a silent skip. 348
  upstream tests came along, 23 of them needing the ROM; the renderer, sound,
  UI, and every ROM, disk, and program file stayed upstream.

### Changed

- The load hand-off: `fastLoadCmd` and `fastLoadSystem` now clear a latched
  interrupt request, a pending `DD`/`FD` prefix, and HALT, and complete an `EI`
  still in flight, before jumping to the entry. A caller that relied on a
  latched tick surviving a load will see it dropped.

### Fixed

- `fromBase64` accepts whitespace and the URL-safe alphabet again, as
  upstream's decoder did; phase 0's replacement for `atob` had dropped both.

### Security

- The emulator's `parseLabelFile` refuses a label name or evidence that holds a control character (C0 or DEL), so a file cannot
  start a new line in a listing or zmac source made from it. The
  disassembler's reader refuses the same from 1.1.0.

## [1.1.0] - 2026-10-18

`@fugloy/z80`, `@fugloy/disasm`, and `@fugloy/cli` 1.1.0, the first release
published to npm (`@fugloy/cli` installs the `fugloy` command). The
disassembler reads the label and coverage file the emulator writes, so code
that only a run reaches becomes code in the listing. Emu phases 2 and 3 were
merged in this release's range; `@fugloy/emu` itself stays 0.1.0 and
unpublished. `@fugloy/z80` changes only its version and package files, and
the web workbench is unchanged. The `v1.1.0` tag is made by `./publish.sh
publish`.

### Added

- `@fugloy/disasm` reads the file (`parseLabelFile`, `withLabelFile`), and the
  CLI applies it with `--labels <path>`: executed bytes become roots, runs read
  and never run or written stop descent (never at another source's entry
  point), observed subroutines get their evidence as a comment, and a file
  written for another program is refused. Hint files win. The file's `write`
  field also marks loaded bytes changed since the load, and code that changed
  at runtime (a program that moved or rewrote itself) is not applied to the
  file's bytes outside a relocate hint's region; one warning counts it.
- What a label file shows: the listing header gains `; labels: <file>: N
  names, M roots, K data runs applied` and a `; warning:` line for each
  warning (with `--format zmac` or `ir` the warnings go to stderr); a root
  that only the file's coverage gave is an instruction that ran and is not
  marked as an entry point; a path ending in a read-only run says `read,
  never executed, per the label file`; the IR gains a `labels` summary
  (`fugloyIr` stays 1).
- The reader takes format version 1 (`"fugloy": 1`) and refuses any other.
  Parse errors print one per line and exit 2, as does a file for another
  program; an unreadable file exits 1. `--labels` with `--sweep` or
  `--write-hints` is a usage error (exit 2).
- `@fugloy/disasm` also exports `COVERAGE_FIELDS`, `decodeRle`,
  `labelAnnotations`, and `mergeAnnotations`, and the `LabelFile`, `Label`,
  `LabelSource`, `Coverage`, `CallerEdge`, and `LabelsSummary` types.

### Changed

- Releases: `./publish.sh` publishes the `@fugloy` packages to npm in two
  steps, `check <set>` (every check, the packed tarballs installed and run,
  staged in `.release/`) and `publish` (those tarballs, with npm's two-factor
  code). The packages gained a `LICENSE`, a `README.md` where they had none,
  repository links, and a `publishConfig` that drops the `source` export
  condition, which points at TypeScript files the tarballs do not carry.
- The README describes the npm packages, `--labels`, and the emulator's
  phases 0–3, and its user stories say what works today and what is planned;
  the `cli`, `disasm`, and `emu` package READMEs follow.

### Security

- A label file's names and evidence may not hold a control character (C0 or
  DEL); such a file is refused, so it cannot forge lines in the listing or
  the zmac source.

## [1.0.0] - 2026-10-17

v1: phases 3 and 4 of the plan. Phase 3 names ROM, hardware, and DOS
addresses from eight cited symbol tables (634 entries, every one citing a
page of a published source). Phase 4 is the web workbench in `apps/web`, a
static Nuxt site that runs the disassembler in the browser: facing pages, the
four public-domain Westmoreland and Gilman games one click away, keyboard
editing through the hint file, a spec sheet, saving in the browser with back
up and restore, exports to zmac, hints, IR, `.CMD` and `.CAS`,
bring-your-own manuals opened at the cited page, the **Explain** tab that
explains each line in plain English from proven values, and block comments.
Deliverable, met: asylum16 opens in Chromium with its hints under Model I,
shows its ROM calls named, and keeps a rename and a comment across a reload;
CI runs the same flow on Sea Dragon. The site went live on Netlify
(at app.fugloy.dev since 2026-10-18). `@fugloy/z80`,
`@fugloy/disasm`, and `@fugloy/cli` are 1.0.0; the `@fugloy/emu` and
`@fugloy/mcp` packages keep their own 0.1.0. Emu phases 0 and 1 were merged
in this release's range and are listed under [Unreleased], since the
emulator is not released. Tagged `v1.0.0` on 2026-10-17; its GitHub release
was published at 03:11 UTC on 2026-10-18.

### Added

- The workbench's **Explain** tab, first on the right page: a click on a
  listing row opens it, and while it shows every cursor move re-explains, so
  code can be stepped through a line at a time. A code line gets one or two
  plain-English sentences with its real addresses, values, and names (`Copy
  $3681 (13,953) bytes from $5200 (L5200) to $497F (L497F)`), from register
  values proven on every path to the line and never from a guess; a "what's
  at" preview for each address it uses (the listing lines there, or the
  symbol-table entry with purpose and citation), each moving the cursor there;
  the patterns it is part of (block copies and fills, counted loops, delay
  loops, a loader moving the program to where it runs); and a quieter strip
  with size, T-states, flags changed, and "undocumented". The **routine
  summary** says what the routine around the line provably does: length,
  callers and jumpers, how it ends, screen writes by row and column, keyboard
  reads, ports, ROM and program calls, data read and written, and loops.
  A data row explains its **data region**: its extent (to the next code or
  label, user names included), the instructions that load its address, the
  variable that address is kept in, the loop that reads it and the tests that
  split its bytes into kinds, and a **picture** of its bytes in the TRS-80
  character set, block graphics included, at a width of 8, 16, 32, 64 (the
  default), or any other. A `.BAS` listing says Explain covers machine code.
  `@fugloy/disasm` exports the engine (`explainLine`, `explainRow`,
  `summarizeRoutine`, `summaryNotes`, `dataRegion`, `sentenceText`,
  `screenCell`, `blockCells`, `trsGlyph`), which has no DOM and returns
  structured sentences, not HTML. It claims only what is proven: the value
  tracker forgets what it knows at every label and after an undocumented
  `DB` fallback; an instruction the program rewrites (a store through a
  proven register, or into a prefixed instruction's real opcode byte) is
  flagged and its values are unknown; a `DJNZ` loop is counted only when
  nothing else enters it or changes `B`, and its count is bounded by early
  exits; a delay loop only when it tests the pair it decrements; and calls
  and jumps the program rewrites are left out of a label's ways in. The
  guarantees are collected in one test file.
- Block comments: the `note <text>` hint directive (`block <i>:<offset> note
  …`), printed as `; text` lines above an address in the listing and the zmac
  source, and carried in the JSON IR as `notes`. An empty `note` is a blank `;`
  line; several notes at one address print in file order. `at … note` is
  refused. In the workbench, **:** or **Block comment…** on the right-click
  menu opens a box prefilled with the notes there, offering "above the
  routine" or "above this line" inside a routine; saving replaces the notes
  as one undoable edit, and emptying the box removes them. **Use as comment**
  under Explain's routine summary opens the box with the summary, after any
  notes already there, for the user to rewrite before saving. A note at an
  address inside an instruction, where no row could show it, draws a
  warning.
- An annotated Sea Dragon: `examples/sea-dragon/seadrg01.hints` now names 19
  routines and labels and 22 variables and tables, and carries block comments
  on 46 addresses: the loader, the title screen, the main loop (`MAIN_LOOP`)
  and what it calls (`DRAW_CAVERN`, `DRAW_PLAYER`, `MOVE_PLAYER`,
  `AIR_SUPPLY`, `UPDATE_OBJECTS`), sound (`TONE`, `NEXT_NOTE`), scoring, lost
  ships and restarts, and the data (`CAVERN_MAP`, `MAP_PTR`, `RESTARTS`,
  `MAP_CHARS`, `ROW_OFFSETS`). Researched with Explain and the listing;
  what is a reading of the code says "probably". It is the example of a fully
  commented program, and its zmac source still rebuilds the identical image.
  Among the findings: two buffers the game clears before use hold leftover
  text of the authors' assembler source, with their own label names
  (`HITFLG`, `NOTEBUF`, `WATBEG`, `WATLEV`, `DECAIR`).
- `@fugloy/z80`: every template and decoded instruction has a generated
  `flags` field, the flags it changes in `SZHPNC` order (`''` for none;
  the undocumented bits 3 and 5 are not listed), covered by the exhaustion
  test. The design also proposed an "opcode family" field; none was added,
  since the mnemonic and operands already identify the family.
- The workbench numbers every listing line in a gutter of its own (not part
  of the text), and the status line gives the total.
- `examples/rear-guard/`, `examples/eliminator/`, and `examples/armored-patrol/`:
  three more of the Westmoreland and Gilman games released into the public
  domain in 1995, beside Sea Dragon, each with a README saying what every
  build is; the real-program tests run on them in CI too. Builds that carry
  someone else's code or credit stay out.
- A social card at the top of the README, for the site's `og:image` too:
  `docs/images/og-image.svg`, and `og-image.png` at 1200×630. It is dark,
  in the explainer's palette, its text outlined so it looks the same
  everywhere (Inter and JetBrains Mono, both SIL OFL 1.1), and its listing is
  Fugløy's own output.
- Symbol tables, phase 3: listings, zmac source, and the IR name the ROM,
  hardware, and DOS addresses a program uses outside its own image, and every
  name cites a page of a published work. The tables are eight hand-edited JSON
  files in `packages/disasm/data/symbols/`, 634 entries from ten works, each
  with a purpose and a citation (the source, and the page as it prints it):
  - `rom-model1` 125 entries (Paay's *Level II ROM Reference Manual*, Decker's
    *TRS-80 ROM Routines Documented*, Radio Shack's *Level II BASIC Reference
    Manual*) and `rom-model3` 150 (Tandy's *Model III Operation and BASIC
    Language Reference Manual*, chapter 12, and Decker, with the `$4000`-page
    RAM he gives for both machines), entered separately and compared:
    `COMPARISON.md` lists 102 addresses as shared, 4 as different, 19 as Model I
    only, and 44 as Model III only, and a test fails when a difference has no
    note.
  - `hardware-model1` 13 and `hardware-model3` 17, ports included (Radio
    Shack's Model I technical handbook, the Level II manual, Decker, and Paay;
    the Model III *Technical Reference Manual*).
  - `dos-trsdos13` 24 (the TRSDOS 1.3 owner's manual), `dos-ldos51-model1` 107
    and `dos-ldos51-model3` 101 (the LDOS 5.1 manual), and `svc-lsdos6`, 97
    service calls (Soltoff's *Programmer's Guide to LDOS/TRSDOS Version 6* and
    the Model 4 *Technical Reference Manual*).
  - `pnpm symbols` validates the files (schema, hex ranges, citations, names
    zmac accepts and unique ignoring case, no repeated port or service call
    numbers, no line breaks in a purpose, note, or cited page, no overlapping
    regions) and writes
    the generated `src/symbols/tables.generated.ts` and `COMPARISON.md`; CI runs
    it and fails on a difference.
- `--machine 1|3|4` (default 3) and `--dos trsdos|ldos|none` (default `trsdos`
  on a Model III, `ldos` on a Model I) choose the tables; `--machine 4` names
  LS-DOS 6 service calls only. A pair with no tables (`--dos trsdos` on a
  Model I, `--dos trsdos` or `ldos` on a Model 4) and an unknown value are usage
  errors (exit 2) that say what to use. `@fugloy/disasm` exports
  `selectSymbols`, `defaultDos`, `tablesFor`, `describeSelection`, `SymbolSet`,
  `SelectionError`, `SYMBOL_TABLES`, and `SYMBOL_SOURCES`, and `analyze` takes
  the resulting `SymbolSet` as `tables`.
- What the names reach, only outside the loaded image: `CALL`, `JP`, `JR`, and
  `DJNZ` targets and declared jump tables take routine and vector names, with
  the routine's purpose as a comment (`CALL $KBWAIT ; wait for a key and return
  it in A`); `(nn)` operands, `LD rr,nn` immediates, and typed `DW` rows take
  variable, vector, and region names (`LD HL,VIDEO+0140H`); `IN` and `OUT` take
  port names; an `RST` comment reads `NAME: purpose`, and on `--machine 4` an
  `RST 28H` after `LD A,n` reads `@DSPLY (SVC 10): …`. A routine name never
  replaces a number used as a value, and a table name that equals one of the
  program's own, ignoring case, is dropped and reported. The listing header
  gains `; symbols: Model III ROM, hardware, TRSDOS 1.3`, `N external targets
  (M named)`, and a legend line for each name used (address, purpose,
  citation); the zmac source defines each name with an `EQU`, so every round
  trip still rebuilds the identical image; the IR gains `machine`, `dos`, and
  `tableNames` (`fugloyIr` stays 1). A comment ends in `[Model I]` or
  `[Model III]` when the other machine's ROM table does not confirm the name,
  because it names a different routine there or has no entry. The default
  listing changes with this (`CALL 0033H` is now `CALL $VDCHAR`); `--sweep`
  still prints numbers, and `--color` paints a `$` or `@` name as one token.
- `.BAS` notes: a tokenized BASIC line that `PEEK`s, `POKE`s, or `DEFUSR`s a
  constant address the tables name is followed by a note line, not a trailing
  comment, since `;` is BASIC's `PRINT` separator: `;   14400 = $3840
  memory-mapped keyboard (KEYBOARD+64)`. The parser now keeps every statement's
  expressions, so a `PEEK` is found in an `IF` condition, a `PRINT` item, a
  `FOR` bound, an `ON` selector, and a `DEF FN` body as well as in an
  assignment; `USR`'s argument is a value and gets no note. Both machines' ROM
  tables name 16526/16527 (the USR vector) and 16548/16549 (the program-start
  pointer), so those notes carry no machine tag.
- Real programs: asylum16, listed with `fixtures/hints/asylum16.hints` under
  `--machine 1`, has 16 of the 17 ROM addresses it reaches named. The 17th,
  `$0112`, is banner text in the ROM, not a routine, and no table names it,
  nor the four addresses above the game's image. Volcano Hunter calls no ROM or
  DOS routine at all; its listing names its hardware (`MODEPORT`, `CASSETTE`,
  `KEYBOARD`), and the new `fixtures/hints/volcano.hints` relocates its game to
  the runtime address its loader copies it to, `$42E9`, which lifts decoded
  code from 26% to 34% and removes 37 notes. Both still round-trip, now with
  their names defined.
- The project plan's Landscape table of other tools was checked against their
  documentation on 2026-10-17, with the sources dated under the table. It was
  wrong or incomplete for trs80gp (its Record → Bus Use writes a disassembly
  from a run) and TRSTools (its viewer disassembles `.CMD` files), it left out
  DASM80 and DSMBLR III, which read `.CMD` files, and `zdis` could not be
  identified.
- The web workbench, phase 4 (`apps/web`, Nuxt 4 and Nuxt UI, generated as a
  static site, no server): drop a `.CMD`, a `.BAS`, or a raw binary, or open
  one of the four public-domain games with one click, and read its listing on
  the left of two facing pages beside a Symbol, Index, Program, and Manual
  tab on the right. The listing is the CLI's text, virtualized and
  highlighted, with names and labels as links. Edit from the keyboard or a
  right-click menu (C/D/W/S/T to mark, N to rename, ; to comment, G to go,
  Alt+←/→ back and forward, ⌘Z/⇧⌘Z undo and redo); every edit is a hint-file
  line, shown in the Hints tab. Hints and the machine and DOS choice save to
  IndexedDB by program SHA-256, a build's hints are offered to another build
  whose blocks match, and Back up and Restore move the work between browsers
  as one JSON file. The Program tab is a spec sheet: the machine verdict with
  its evidence, loading, memory needed and a memory map, what the program
  talks to, code statistics, and the analysis's proposals with an "apply".
  Export ▾ writes the zmac source, the hint file, the JSON IR, a `.CMD` load
  module, and a `.CAS` tape. The `/manuals` page lists every cited work with
  its archive.org cover; add your own PDF and a citation opens it at the cited
  printed page, through a checked page table per archive.org scan. Also
  `/technical-details` (the Inside Fugløy explainer, refreshed to phase 3's
  output) and `/about`, a title, description, canonical URL on
  `app.fugloy.dev`, Open Graph and Twitter card on every page, favicons,
  `sitemap.xml`, `robots.txt`, and JSON-LD.
- `@fugloy/disasm` grows what the workbench needs, all usable from the CLI or
  any script: `openProgram`, `withHintText`, `withHintFile`, `withSelection`,
  and `renderSession` (one session for opening, hinting, and rendering a
  program; the CLI now runs through it); `listingRows`, `basRows`, and
  `formatRow` (the listing as typed rows, the text renderers now a formatter
  over them, byte-identical on 112 golden listings); `programFacts` (the spec
  sheet's facts and an evidence-based machine fit); `writeCmd`/`CmdWriter`
  (moved from the test suite), `writeSystemCas`, and `writeBasicCas`;
  `nameProblem` (why a name is refused); and `MANUALS`/`manualPage` (the
  printed-page tables of the archive.org scans).
- The `at` hint directive: `at <addr> name <label>` and `at <addr> comment
  <text>` name and comment addresses outside the loaded image (RAM variables,
  unnamed operand targets). The listing header, the zmac source (an `EQU`),
  and the IR use them like any name; on a loaded address one is not applied
  and draws a warning, since the block-relative form survives relocation.
- Symbol sources gain `url`, `catalog`, `archiveId` (derived from an
  archive.org url), and `permissionUrl` (required wherever a source is marked
  redistributable), replacing the free-text `locator`.
- Browser tests in CI: a `web` job in `ci.yml` installs Chromium and runs the
  web type check, the unit tests, the SEO checks on the generated pages,
  and the Playwright specs; the specs that need gitignored samples or PDFs
  skip there. `done-criterion.spec.ts` tells the workbench
  story on Sea Dragon in one test: open it, go to `4B9E`, rename it `INIT`,
  comment it, undo both and redo them, reload and find both saved, export the
  hint file and zmac source and match the zmac byte for byte against
  `@fugloy/cli`'s `run` for the downloaded hints, export a `.CMD` that reloads
  through `loadCmd` to seadrg01's image and entry, undo and redo a new edit in
  the reloaded page, and drop a JPEG. The
  listing performance spec's timing limits apply only with `FUGLOY_PERF=1`.
- Phase 4's checks, recorded 2026-10-17:
  - The v1 done-criterion, met locally: `asylum.spec.ts` opens asylum16 in
    Chromium, drops `fixtures/hints/asylum16.hints` on it, picks Model I, sees
    `CALL $KBCHAR`, `CALL $CSHIN`, and `CALL $CSOFF`, renames `SUB_53F8` to
    `TAPE_LOAD` (its caller at `$43CB` follows) and comments it, reloads, and
    finds the rename, the comment, the hints, and Model I kept. It skips
    without the sample.
  - The exported Sea Dragon `.CMD` and `.CAS` run: `emulator-run.test.ts`
    boots `@fugloy/emu` on the real Model III ROM to `READY`, loads each
    export through the emulator's own loaders (`parseCmd`/`fastLoadCmd`, and
    `parseCas`/`fastLoadSystem` with no checksum errors), runs five emulated
    seconds, and finds the title screen ("BY: Wayne Westmoreland & Terry
    Gilman", "(C) Copyright 1982"), identical in video RAM to the screen the
    original `seadrg01.cmd` draws; ENTER then brings "1 or 2 Players?". This
    stands in for a run by hand in trs80gp or trsjs. The tape is loaded by
    the fast path, not by playing its pulses through `CLOAD`/`SYSTEM`. It
    skips without the ROM.
  - Listing performance in Chromium on an Apple M4, with
    `FUGLOY_PERF=1`: a raw 48K load of seadrg01 (18,562 rows) flings to the
    bottom and back with frames at p50 16.7 ms and p95 16.8 ms and no long
    task; 101 scrollbar jumps a frame apart, p95 16.7 ms; `scrollToAddr`
    median 16.4 ms, max 18.0 ms; a rename's re-render 87.7 ms (a table
    change 25 ms) with the cursor row unmoved. asylum16 (7,779 rows): the
    same frame times, `scrollToAddr` median 15.3 ms, re-renders 16–44 ms.

### Changed

- A BASIC line with an empty body prints as `10`, not `10 ` with a trailing
  space, in the listing (found when the text renderers became formatters
  over rows).
- MEMTOP's purpose in `rom-model3` no longer says it falls back to the top of
  RAM; it is the Memory Size? answer.
- The workbench's G box (UI input only; the hint file keeps its number
  rules): an explicit `$4B9E`, `0x4B9E`, or `4B9EH` is an address; otherwise
  a label name, ignoring case, so a label spelled like hex (`CAFE`) wins;
  otherwise bare hex of one to four digits (`4000` is `$4000`, `B` is
  `$000B`); decimal needs a `#` (`#19358`). Anything past `$FFFF` is refused,
  and an unknown token says what to type.
- In the workbench, Eliminator opens as Model I: `elimin8d` calls `$01D3`,
  which only the Model I ROM has, though its README says it runs on both.
- The workbench, after its final review:
  - Saved hints that no longer apply to their program are kept, never
    overwritten: opening the program says why ("Your saved hints for … no
    longer apply: …. They are kept, not replaced."), the status line reads
    "not saved (saved hints kept)", and the first edit asks, with Download
    the saved hints and Replace them, before anything saves over them. Esc
    does not answer it.
  - Restore lists backup entries whose hints do not parse and skips them,
    restoring the rest, and writes any edit still waiting to save before it
    compares.
  - Pending saves are also written when the page is hidden (a tab or app
    switch), not only on `pagehide`.
  - Questions whose yes replaces saved work (Restore's Replace, the kept
    hints' Replace them) put the first focus on the safe button.
  - A file over 64K that is not a program (a disk image) is no longer offered
    as a raw binary, and the raw load address is refused when the file would
    run past `$FFFF` from it, with the highest address it fits at.
  - JetBrains Mono, the listing's face, is self-hosted from Fontsource
    (Latin, 400 and 700) and credited on the About page; before, the CSS
    named it but nothing loaded it.
  - Canonical, `og:url`, and `sitemap.xml` URLs end in a slash past the home
    page (`https://app.fugloy.dev/about/`), where Netlify serves each page,
    and so do the site's internal links, which Netlify then serves without a
    redirect.

### Removed

- The free-text `locator` field of a symbol source, replaced by `url`,
  `catalog`, `archiveId`, and `permissionUrl` (see Added).

### Fixed

- `fugloy` no longer crashes when the reader of its output goes away and the
  write fails with `ENOTCONN` or `ECONNRESET` instead of `EPIPE`, as Node's
  piped stdio can on macOS; 0.2.0's fix caught only `EPIPE`.

### Security

- The workbench's `window.__fugloyTest` hook, which the browser checks drive
  it through, is compiled in only when `NUXT_PUBLIC_E2E=1` (Playwright's web
  server); the site's build leaves it out, and `test:seo` checks that.

## [0.2.0] - 2026-10-16

Phase 2 of the plan: Pass 1 and Pass 2, built as sub-projects A (Pass 1 and
the round-trip proof), B (labels and the hint file), and C (hidden code,
heuristics, rebasing, and relocation), plus `--color`, the emulator and MCP
server stubs, and the first program the repository ships, the public-domain
*Sea Dragon*. Deliverable, met: every synthetic fixture round-trips, and
Valkyrie's hidden code disassembles at its true addresses. `@fugloy/z80`,
`@fugloy/disasm`, and `@fugloy/cli` are 0.2.0; the `@fugloy/emu` and
`@fugloy/mcp` stubs keep their own 0.1.0 (no emulator phase had started).
Tagged `v0.2.0` and published as a GitHub release on 2026-10-16.

### Added

- `examples/sea-dragon/`: *Sea Dragon* (Wayne Westmoreland and Terry Gilman,
  1982), public domain since 1995, in ten `.CMD` builds with a ready hint file
  for `seadrg01.cmd`. It is the first real program in the repository, so the
  real-program tests now run on it in CI too.
- `--color`: the listing in color on a terminal (addresses, bytes,
  mnemonics, registers, numbers, labels, strings, comments, warnings). It
  stays plain when piped, written with `-o`, or with `NO_COLOR` set; zmac
  source and the IR are never colored, since other tools read them.
- Level II BASIC lexer and parser: a line counts as BASIC only when every
  statement parses, each keyword checked against its argument shape over one
  expression grammar, Disk BASIC statements and `&H`/`&O` constants included.
  On every Voyage of the Valkyrie file exactly lines 2–247, 182 lines, come
  out as machine code.
- `.BAS` analysis: line headers typed as words and BASIC bodies as bytes with
  their text attached, each code line's body a candidate root; entry points
  mined from `DEFUSR`, the USR vector, and a poked `JP`, through an abstract
  evaluator over constants and "program start plus N" (Valkyrie's line 250
  resolves to program start + 14 in all 13 files).
- `.BAS` listing and zmac output: BASIC lines as text, code lines
  disassembled at their true addresses; the zmac output (`DW` headers, `DB`
  bodies with the line as a comment, instructions) reassembles to the
  identical image, labels included, for every Valkyrie file.
- Strings: terminated runs of printable bytes are typed as strings and
  emitted as quoted `DB` rows (quotes doubled, other bytes in hex), byte-exact
  under zmac.
- Proposals, reported in the listing header and the IR (`proposals`) and
  never applied: jump tables (three or more words that all land on decoded
  instructions) and LDIR mover stubs (`LD HL,src / LD DE,dst / LD BC,len /
  LDIR` and a jump or pushed address into the copy), each with the exact hint
  lines that would declare it.
- `--rebase <hex>` for a `.BAS`: the program as saved from another address.
  Hints written before still match, since block identity reads line pointers
  as offsets, and operands that still point into the old range are marked
  stale.
- `relocate <addr> <length>` hint directive and an analysis space: a region
  is analyzed at the address it executes at and emitted under zmac's
  `.PHASE`/`.DEPHASE`, so the file image still round-trips. A destination over
  memory that stays loaded, or over another destination, is an error (exit 2).
- `fixtures/hints/asylum16.hints` now relocates Asylum's 123 loader-stream
  records, generated from the sample by a test script: the game decodes from
  `$43AE` at its runtime address, 61% of its bytes as code.
- New real samples in the round-trip tests (Space Warp, Sea Dragon, Pirate's
  Adventure, Voodoo Castle, Deathmaze 5000). Applying their mover proposals
  lifts decoded code from under 1% to between 19% and 68%.
- A smoke test on the Model I Level II ROM: half of it decodes as code from
  its documented entry points, and it reassembles byte for byte.
- Hint file (`--hints`): line-oriented text keyed by block and offset, with
  content-based block identity (length plus a SHA-256 prefix of the first 64
  bytes, computed in pure TypeScript) so the same hints apply to relocated
  builds; directives `entry`, `code`, `bytes`, `words`, `string`, `nocode`,
  `table`, `name`, `comment`; every parse error reports its line. A line may
  end in a `# comment` (except `comment`, whose text runs to the end), extra
  arguments and a bad `program sha256` are errors, a user name already used
  elsewhere (ignoring case, as zmac folds it) is refused, and a table that
  runs past the end of its run is clipped with a warning.
- `--write-hints <path>` writes a hint-file skeleton (identities and `--entry`
  addresses) and refuses to overwrite.
- Annotations drive Pass 1: overrides win and are applied before descent,
  `nocode` ends paths, declared tables seed roots, `code` with a length
  forces decoding.
- Pass 2 symbols: `L` jump targets, `SUB_` call targets, `DATA_` data
  references (`LD BC|DE|HL|IX|IY,nn` and `(nn)` operands into loaded memory),
  `TBL_` tables; user names replace them.
- Labels in zmac output (`NAME:` lines, `EQU` for a symbol inside an
  instruction, `DW` rows for words and tables), in the listing, and in the IR
  (`symbols`, `hints`); every round trip re-proven with labels on, including
  all real samples.
- `fixtures/hints/asylum16.hints`, documenting that build's self-relocating
  loader: it copies the payload from `$80DD` down to `$42F3` and jumps to
  `$43AE`, so its game code is never at a loaded address.
- Pass 1 recursive descent (`@fugloy/disasm`): a byte-kind map parallel to
  the image, decoded instructions, cross-references, external (ROM) targets,
  indirect jumps, and diagnostics; paths end at returns, indirect and
  unconditional jumps, and `HALT`; the first decode of a byte wins; the byte
  after `RST 08H` is data.
- zmac emitter with absolute operands, proven byte-exact against all 1786
  non-prefix Z80 encodings under the pinned zmac; the redundant `ED 63`/`ED 6B`
  forms are emitted as `DB`; `END` carries only a transfer address the file
  itself had.
- Versioned JSON IR (`fugloyIr: 1`): loaded ranges, regions, basic blocks
  with successors, xrefs, externals, indirect jumps, diagnostics.
- Pass 1 listing with a reached-bytes summary and notes.
- CLI: `--entry <hex>` (repeatable), `--format listing|zmac|ir`, `--sweep`,
  `-o <path>`. `--sweep` with another format, or with `--entry`, is a usage
  error (exit 2), since the sweep ignores both.
- Round-trip harness: `pnpm zmac:install` builds `gp48k/zmac` at a pinned
  commit into gitignored `tools/`; tests assemble emitted source and compare
  memory images and bitmaps, never files; every synthetic fixture and every
  present real sample round-trips; CI builds zmac and requires it.
- `@fugloy/emu` and `@fugloy/mcp` as stub packages: ESM `package.json`, empty
  `src/index.js`, READMEs linking their specs in `docs/`, one import test
  each; `mcp` depends on `emu` by the semver range `^0.1.0`.
- `docs/label-format.md`, the label and coverage file format shared by emu,
  mcp, and disasm, extracted from §8 of `docs/fugloy-emu-spec.md`.
- `packages/disasm/README.md`.
- `docs/technical-details/inside-fugloy.html`, the source of the Inside
  Fugløy explainer (how Fugløy works, what makes it new, and where Part 2
  leads), for phase 4's technical details page.
- A Roadmap in `CLAUDE.md`: disasm phase 2 (in progress), then emu phases
  0–7, then mcp phases A–F.

### Changed

- `fugloy <file>` prints the pass 1 listing for load modules and raw
  binaries; the phase-1 linear sweep is `--sweep`. A `.BAS` with hidden code
  or a planted entry gets the pass 1 listing too; a plain BASIC program keeps
  its BASIC listing.
- `BasLine.parsed` and `detokenize().ok` mean the line parses as BASIC,
  lexically and by statement shape; the reason names the byte offset. A
  file's line 1 still has to read as BASIC bytes for the file to count as
  BASIC, but a grammar failure there only marks that line as code.
- A line whose bytes happen to read as BASIC, such as `XOR A / RET` as
  `LPRINT INKEY$`, stays BASIC unless a `code` hint covers it; the hint lists
  it as code, and a jump that lands inside such a line says so and names the
  hint.
- The IR (`fugloyIr: 1`) gains `entries`, `proposals`, and `relocations`;
  with relocations, `regions` describe runtime addresses while `loaded`
  keeps the file's runs.
- Listing and zmac rows break at the start of every typed region, and bytes
  typed as a string (including by a `string` hint) print quoted.
- A `.BAS` block's identity reads its line pointers as offsets from the
  program start, so a `.BAS` hint file written before this change no longer
  matches.
- The pass 1 header counts bytes decoded as code and, separately, bytes typed
  as data by hints.
- Project plan: the undocumented-opcode spelling question is closed (zmac's
  names, which the listing already used).
- README: CI badge, release badge (latest semver tag, live now that the
  repository is public), repository link; changelog release links. It was
  rewritten to say what Fugløy is and how it differs, with verified examples
  on public-domain Sea Dragon, user stories, and where to get ROMs and
  programs.
- `linkWorkspacePackages` in `pnpm-workspace.yaml`, so a semver range on a
  workspace package resolves locally the way npm workspaces would.
- Project plan: phase 5, an assembler with an IDE in the workbench, after
  v1; Part 2's public bundles gather on an arcade page, starting with the
  Westmoreland and Gilman games released into the public domain in 1995; the
  `LDDR`/`JP (HL)` mover shape is a deferred idea.
- `BasLine.statements` holds each line's parsed statements, and the entry
  miner reads them instead of parsing every line a second time.
- A `.CMD` `03` record that whole records follow is skipped as a comment, as
  TRSDOS 2.3 and NEWDOS/80 do; only a `03` that ends the file, or one followed
  by debris, ends the load. Rear Guard's cracked copies open with one
  (`THE MARK OF "ZORRO"`) and were rejected before. Two `03` tags before the
  first load are both skipped.
- New real samples in the round-trip tests: Rear Guard, Eliminator,
  Planetfall, Penetrator, Super Nova, Crazy Painter, and the BASIC programs
  of Super Star Trek, Crush, Crumble & Chomp, and Eliminator's patchers.

### Fixed

- `analyze` keeps the reasons it refuses relocations in annotations built
  without `applyHints` (`Analysis.relocationErrors`, also listed as warnings)
  instead of dropping those relocations silently.
- The string heuristic finds a message in a `.BAS` code line that runs up to
  the line's `00` terminator or ends just before it; the typed line frame no
  longer blocks it.
- A hint that starts before a relocated source and runs into it is clipped
  where the source starts, and the warning names the source; it used to
  cover bytes that execute elsewhere.
- `--entry` given the file address of relocated code says where that code
  runs (`use --entry 5005`) instead of "not in loaded memory".
- The BASIC lexer and parser read a name or a string of any length; one
  past about 125K bytes overflowed the call stack (no 64K program has one,
  but the library takes any bytes).
- A BASIC line that leaves `THEN` out of `IF` (`IF A PRINT`, `IF A,100`)
  parses, as the ROM's IF handler at `$2039` allows; such lines were reported
  as machine code (all 59 "code lines" in Super Star Trek were these).
- `fugloy` no longer crashes with an unhandled `EPIPE` when the reader of its
  output stops early (`fugloy game.cmd | head`); it ends quietly. When the
  same reader holds stderr (`2>&1 | head`), it stops writing there and keeps
  its exit code.

## [0.1.0] - 2026-10-14

Phase 1 of the plan: core decoder and loaders. Deliverable, met: a CLI that
prints a linear-sweep listing of any `.CMD` or raw binary and a detokenized
listing of any `.BAS`. `@fugloy/z80`, `@fugloy/disasm`, and `@fugloy/cli` are
0.1.0. Tagged `v0.1.0` and published as a GitHub release on 2026-10-14.

### Added

- pnpm monorepo with `@fugloy/z80`, `@fugloy/disasm`, and `@fugloy/cli`;
  TypeScript strict, ESM only, Vitest, `tsc` project references for `dist/`.
- `@fugloy/z80`: opcode tables generated from the x/y/z/p/q decomposition for
  the unprefixed, `CB`, `ED`, `DD`/`FD`, and `DDCB`/`FDCB` groups, each entry
  with length, operands, cycle counts, and control-flow effect; a decoder and
  zmac-style formatter. `SLL` and the IX/IY half registers are decoded; other
  undocumented forms decode as `DB` of the bytes the CPU would consume. An
  exhaustion test decodes all 1792 encodings against a committed reference
  built from independently typed flat tables.
- `@fugloy/disasm`: 64K memory image (`Uint8Array(65536)` plus a parallel
  bitmap) with a block log and overlap log; `.CMD` loader implementing every
  rule in the plan, including the `01` length wrap, overlapping and
  out-of-order blocks, missing `02`, `03`, `05`, `1F`, and the `04`/`06`–`10`
  PDS/ISAM records; Level II BASIC token table, `.BAS` loader with pointer
  chain validation and base-address derivation, and a detokenizer that reports
  lines failing the phase-1 lexical check as unparsed with address and length;
  content-based format detection; raw loader; linear sweep; listing renderers.
  No Node or DOM APIs. Detection believes a `.CMD` whose record walk ends in
  damage only after two load blocks, since raw code can start with `01`
  (`LD BC,nn`); a `.BAS` may hold a single line, as long as its pointer chain
  covers at least half the file.
- `@fugloy/cli`: `fugloy <file> [--base <hex>]`.
- `fixtures/synthetic`: 18 `.CMD` and 7 `.BAS` fixtures generated by the test
  suite's own record writer and BASIC tokenizer; a test fails if a committed
  fixture drifts from its writer.
- Real-program tests that assert the plan appendix's load ranges and entry
  points for every listed file and skip when the (uncommitted) programs are
  absent.
- README, MIT license, `.nvmrc`, `netlify.toml` for the phase-4 static site,
  GitHub Actions CI, `.editorconfig`.

### Changed

- Project plan: the core is built with `tsc` project references rather than
  tsup (TypeScript 7's native compiler has no JS API for tsup's declaration
  plugin).

### Fixed

- A transfer (`02`) record with a `00` length byte, as ARMOUR.III carries, is
  read as the transfer address rather than a truncated record.

### Security

- `.CMD` module name and copyright text are escaped before they reach a
  listing, so file content cannot forge listing lines or terminal escapes.

### Known limitations

- Hidden-code detection by parse validity, recursive descent, label
  synthesis, symbol tables, and hint files are phase 2 and later; the listing
  is a plain linear sweep from each loaded run.
- The `03` record's length semantics are not specified by the plan; the
  loader stops at it and skips a length-prefixed payload when one is present.
- A damaged `.CMD` (truncated record or unknown record type) is detected only
  when at least two load records precede the damage; there is no `--format`
  override yet.

[Unreleased]: https://github.com/cschweda/fugloy/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/cschweda/fugloy/releases/tag/v1.2.0
[emu 0.2.0]: https://github.com/cschweda/fugloy/releases/tag/emu-v0.2.0
[mcp 0.1.0]: https://github.com/cschweda/fugloy/releases/tag/mcp-v0.1.0
[1.1.0]: https://github.com/cschweda/fugloy/releases/tag/v1.1.0
[1.0.0]: https://github.com/cschweda/fugloy/releases/tag/v1.0.0
[0.2.0]: https://github.com/cschweda/fugloy/releases/tag/v0.2.0
[0.1.0]: https://github.com/cschweda/fugloy/releases/tag/v0.1.0
