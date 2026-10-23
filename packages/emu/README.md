# @fugloy/emu

Headless, deterministic TRS-80 emulator core (the Model III and, since emu phases 6 and 6b, the Model I and the Model 4) in plain
JavaScript, for Node and the browser alike. Emu phase 0 brought in the core of
[cschweda/trs80-emulator](https://github.com/cschweda/trs80-emulator) (v1.6.0):
the Z80 CPU (`src/cpu/`), the Model III memory map, I/O ports, and system
(`src/machine/`), the keyboard matrix, cassette, WD1793 disk controller, disk
images, and printer (`src/devices/`), the `.CAS` and `.CMD` formats
(`src/loaders/`), and save states (`src/debug/`). Emu phase 6 added the
Model I with its Expansion Interface (released in 0.3.0), and emu phase 6b
the Model 4 (in 0.4.0, published with `@fugloy/mcp` 0.1.2): Model III mode on the Model 4 ROM and the native
hardware, with a version 6 DOS booting still open, as no LS-DOS 6 or TRSDOS 6
disk is at hand.
Phases 0–7 of the spec's eight are done (6 for the Model I, 7 for the Model III): the Z80 core passes ZEXDOC and
ZEXALL, the `Machine` below runs real programs, `m.debug` writes the label
and coverage file, and phase 4, the MCP server
[`@fugloy/mcp`](https://github.com/cschweda/fugloy/blob/main/packages/mcp/README.md),
drives it for an AI assistant. Version 0.5.0 (on npm since 2026-10-19; 0.4.0 brought the Model 4)
(`npm i @fugloy/emu`; or use it from a clone for development; Node 22 or later, or any browser bundler: it has no
dependencies).

The renderer, the WebAudio driver, the turbo throttle, the web UI, and every
ROM, disk, and program file stayed upstream: rendering and sound belong to the
workbench, and the caller supplies ROM bytes. Provenance and license:
[`NOTICE.md`](https://github.com/cschweda/fugloy/blob/main/packages/emu/NOTICE.md).

The core never writes to the console. Pass a logger to see what it reports,
such as an unimplemented opcode or a tape load:
`new TRS80System({ romData, log: (level, text) => console[level === 'info' ? 'log' : level](text) })`.
Without one it stays silent, unlike upstream, which printed warnings;
`system.cpu.unimplementedOpcodes` still records every opcode it hit and does
not implement.

## Using the machine

```js
import { readFileSync, writeFileSync } from 'node:fs'
import { Machine, CPU_CLOCK_HZ } from '@fugloy/emu'

const m = new Machine({ roms: { level2: readFileSync('model3.rom') } })   // Model III, 48K; you supply the ROM
const shows = (text) => (mm) => mm.video.text().join('\n').includes(text)
const second = CPU_CLOCK_HZ                                              // T-states per emulated second

m.run({ until: shows('Cass?'), cycles: 5 * second })          // boot; stops at the prompt, or after 5 s
m.keyboard.type('\n')                                          // ENTER: 1500 baud
m.run({ until: shows('Memory Size?'), cycles: 5 * second })
m.keyboard.type('\n')                                          // ENTER at Memory Size?
m.run({ until: shows('READY'), cycles: 5 * second })

m.load.cmd(readFileSync('seadrg01.cmd'))   // PC at the program's entry
m.run({ cycles: 5 * second })
console.log(m.video.text().join('\n'))     // the screen, 16 lines
```

`m.cpu.regs` and `m.cpu.flags` read the registers and the flags, and
`m.cpu.halted` is true while the CPU sits in a HALT (PC is then just past it),
until an interrupt or a reset (on the Model I, below, the NMI its HALT raises
at the next instruction).

A disk image (JV1, JV3, or DMK, detected from its content) goes in a drive
with `m.fdc.mount(drive, bytes)`, or through `m.load.dsk(bytes)`, which mounts
it in drive 0 and resets so the ROM boots from it:

```js
m.load.dsk(readFileSync('game.dmk'))       // → { format: 'dsk', container: 'dmk', drive: 0, boot: true, blocks: [] }
m.fdc.drives                               // [{ drive: 0, container: 'dmk', tracks, sides, sectorsPerTrack, writeProtected }, null, null, null]
writeFileSync('saved.dmk', m.fdc.export(0)) // the disk as DMK bytes, with what the program wrote to it
```

Writes stay in memory; `m.fdc.export(drive)` returns the disk as a DMK file,
whatever container it was mounted from (read JV1, JV3, and DMK; write DMK). A snapshot carries each disk's bytes and container, so a
disk the session formatted restores as it was. With a disk loaded through
`m.load.dsk` the label file lists no load blocks and `m.debug.labelFile()`
needs a `name`.

The WD1793 behind the drives follows the Western Digital FD179X data sheet in
T-states (spec §5): heads step at the programmed rate, sectors come round at
300 rpm, and bytes arrive one byte time apart, so a disk loads as slowly as it
does on a real drive, and a program that misses a byte sees Lost Data.
Give a disk session room: the ROM reaches the boot sector about a quarter
second after the reset, a loader reading a game takes seconds (Scarfman's
title is up about 8 s after the reset), and a sector that is not there costs
about a second. Check the screen between slices of `run` rather than in an
`until` callback, which reads it after every instruction.

`step`, `run`, the registers, memory, the keyboard (matrix typing and a ROM
keyboard hook), sound events, the loaders, and the disk drives are described
in spec §3.

### The Model I

`model: 1` builds a Model I (since 0.3.0, emu phase 6): the 12K Level II ROM
(1.2 and 1.3 are recognised; a Model III ROM given for it is refused naming its
model), 4, 16, 32, or 48K of RAM (`ram`, default 48), and the Expansion
Interface (`expansion`, default `true`) with its 40 Hz clock in the latch at
`$37E0`, its WD1771 disk controller at `$37EC`–`$37EF`, and its printer.
`expansion: false` is a bare keyboard unit: no clock, no disk, `$37E0`–`$37EF`
read `$FF`. The stock video RAM has no bit 6, so lowercase reads back and shows
as punctuation and a program's mixed-case title in capitals; `lowercase: true`
fits the lowercase modification. Its clock is 1,774,080 Hz, `clockHz(1)`
(`CPU_CLOCK_HZ` stays the Model III's):

```js
import { Machine } from '@fugloy/emu'

const m1 = new Machine({ model: 1, roms: { level2: readFileSync('level2-model1.rom') } })
const sec = m1.clockHz                                     // clockHz(1): 1,774,080 T-states an emulated second
m1.run({ until: shows('SIZE?'), cycles: sec })             // MEMORY SIZE? (MEM SIZE? in Level II 1.3); no Cass?
m1.keyboard.type('\n')
m1.run({ until: shows('READY'), cycles: 5 * sec })
m1.load.cmd(readFileSync('elimin8a.cmd'))                  // Eliminator's Model I-only build
m1.run({ cycles: 2 * sec })                                // "BY: WAYNE WESTMORELAND & TERRY GILMAN"
m1.load.dsk(readFileSync('rrgarddb.dmk'))                  // or a disk: the ROM reads track 0, sector 0 to $4200
```

Type at 10 characters a second on the Model I (`m1.keyboard.type(text, {
cps: 10 })`): the Level II keyboard routine drops every other key at the
default 20. T-states, `m.sound` stamps included, are the model's own
(`m.clockHz`). A label file records its model, and `mergeLabelFiles` refuses
a Model I file with a Model III one. Cassettes play at 500 baud only. A HALT
does not stay halted: the Model I wires the CPU's HALT output into the reset
switch's NMI, so the next instruction boundary takes that NMI and the ROM's
handler at `$0066` runs (under Level II, back to READY). Real programs that run on it, and
what is still unverified against the Model I manual, are in spec §5.

### The Model 4

`model: 4` builds a Model 4 (emu phase 6b, in 0.4.0), with 64 or 128K of RAM
(`ram`, default 128) and 2K of video RAM, on the Model 4 ROM (the TRS32 set's
14K `MODEL4.ROM` is recognised as `model4-trs32`; a Model I or Model III ROM is
refused, and the Model 4's on those models). The ROM boots it in Model III
mode: memory map 0, 2 MHz, 64 by 16, where it answers `Cass ?` and
`Memory Size?` and runs Model III programs and disks: Sea Dragon matches the
Model III screen for screen and T-state for T-state from READY, and the
Model III disks reach their titles; the two ROMs differ in 727 bytes, so the
boot to READY takes 11 T-states more. The native hardware is there for a program that selects it: the four
memory maps and the 128K page select behind port `$84` (`m.mem.ram` holds the
32K banks in order, so in map 0 the CPU's address A is `ram[A]`; on the other
models `ram[0]` is `$4000`; `m.mem.map` reads `{ map, page, register }`, null
on the other models), 80 by 24 video (port `$84` bit 2;
`m.video.columns`, `m.video.rows`, and `m.video.wide`), inverse video (`m.video.inverse`), and 4 MHz (port `$EC`
bit 6; `m.clockHz` follows it, and the timer runs at 60 Hz there, following xtrs; unverified, spec §5). Every fact
is from MAME and xtrs, cited in spec §5 with what is unverified:

```js
const m4 = new Machine({ model: 4, roms: { level2: readFileSync('model4.rom') } })
m4.run({ until: shows('Cass ?'), cycles: m4.clockHz })    // Model III mode: Cass ?, then Memory Size?
m4.mem.map                                                 // { map: 0, page: 0, register: 0 }, until a program writes port $84
m4.video.columns                                           // 64; 80 after OUT (84H) with bit 2 set
```

Coverage is kept per memory map and page: `m.debug.coverage.bits` is the
bitfield of the map and page in force, `m.debug.coverage.keys` lists those
recorded (`'0:0'`, `'3:2'`, …), and the label file writes each as its own key,
of which `@fugloy/disasm` applies `"0:0"` and warns about the rest. A Model 4
left in Model III mode writes only `"0:0"`.

## Debugging

`m.debug` stops on breakpoints and watches, logs memory hits, records which
bytes ran, were read, written, jumped to, and called, keeps a bounded trace,
takes snapshots, and writes the label and coverage file that `@fugloy/disasm`
reads (`fugloy seadrg01.cmd --labels seadrg01.labels.json`). Continuing the
example above, just after `m.load.cmd`:

```js
import { writeFileSync } from 'node:fs'

m.debug.break(0x497f, { once: true })        // Sea Dragon's stub copies the game down, then jumps here
m.run({ cycles: second })                    // → { reason: 'break', id: 1, cycles }
m.debug.coverage.enable()                    // from here on: exec, operand, read, write, jump, call
m.debug.trace.enable({ depth: 10_000 })      // the last 10,000 instructions
const top = m.debug.watch(0x3c00, 64, { write: true })    // log every write to the screen's top line
m.run({ cycles: 5 * second })
m.debug.hits(top)                            // [{ id: 2, kind: 'write', cycle, pc, addr, value, prev }, …]
m.debug.callers(0x6212)                      // [{ from: 18974, kind: 'call', count: 80 }, …]
m.debug.label(0x6212, 'TONE')                // a user label: the listing names the routine TONE
writeFileSync('seadrg01.labels.json', JSON.stringify(m.debug.labelFile({ name: 'seadrg01.cmd' }), null, 2))
```

Coverage can start at the load: the label file's `write` field marks every
byte a self-relocating program's copy writes, and every loaded byte that
differs from what the load placed, so the disassembler neither mistakes moved
code for data nor applies the moved code's coverage to the file's bytes (a
relocate hint says where it runs).
Everything on `m.debug` is described in spec §3 and §7, the file in §8 and
[`docs/label-format.md`](https://github.com/cschweda/fugloy/blob/main/docs/label-format.md).
`examples/sea-dragon/seadrg01.labels.json` is the file of the scripted session
in `test/integration/sea-dragon-session.js`; `node
packages/emu/scripts/sea-dragon-labels.mjs` rewrites it (it needs the ROM).

Debugging off costs nothing measurable, and the debugger keeps the §4 target.
On Sea Dragon, 20 emulated seconds of its title screen
(`node packages/emu/scripts/benchmark.mjs off|debug`, each mode in its own
process, on the laptop that built phase 3):

| Mode | Speed |
|---|---|
| Debugging off | about 42× real time (41.5–43.3× over three runs; phase 2 measured about 43×) |
| Coverage and a 10,000-deep trace | about 30× real time (29.5–30.7×) |

`test/integration/benchmark.test.js` asserts at least 20× for both, but only
when asked: `FUGLOY_BENCH=1 pnpm exec vitest run
packages/emu/test/integration/benchmark.test.js`, by itself on a quiet machine
(`./publish.sh check` runs it that way after the suite). In the full parallel
suite, beside the other ROM tests, it measured 12–15× against about 40× alone,
so it is skipped there. On the laptop that built phase 6 it measured 40× (off)
and 29× (debug); Sea Dragon on the Model I runs at about 48×.

- Spec: [`docs/fugloy-emu-spec.md`](https://github.com/cschweda/fugloy/blob/main/docs/fugloy-emu-spec.md) (phases 0–7 in §11)
- Label and coverage file shared with `mcp` and `disasm` (coverage keyed by `"<map>:<page>"`, `"0:0"` on the Model I and III): [`docs/label-format.md`](https://github.com/cschweda/fugloy/blob/main/docs/label-format.md)
- ROM images are never bundled or committed; `roms/` here is gitignored and
  paths are supplied by the caller.

## Differential testing

Emu phase 7 runs a program here and in a reference emulator and compares the
two after every instruction: PC, every register (F bit by bit, R as 7 bits),
IFF1/2, IM, the T-states, and every memory write, with video RAM at
checkpoints and at the end. The Model III's reference is
[trsjs](https://trsjs.48k.ca/) (Peter Phillips's JavaScript conversion of
George Phillips's trs80gp), stepped in lockstep in this process. The Model I
has two: [xtrs](https://github.com/TimothyPMann/xtrs) (Tim Mann's), built
headless with a small patch and stepped in lockstep over a pipe, and MAME
0.289's `trs80l2`, which records every instruction into a trace that our
machine follows from power-on, taking MAME's interrupts where it took them and
its keyboard bytes where it read them. Keys go into both keyboard matrices at
the same T-state (a trace brings its own). On the Model I the comparison also
covers the `$37E0` latch after every read of it and video RAM through the
bit-6 gate (raw with `--lowercase`). None of the references is committed or
bundled: `pnpm trsjs:install` fetches trsjs (it has no license),
`pnpm xtrs:install` clones and builds xtrs at a pinned commit, and
`pnpm mame:install` checks Homebrew's MAME 0.289 (`brew install mame`) and
assembles its ROM set from your Level II ROM, each into the gitignored
`tools/`, pinned; the tests that need them are opt-in.

```sh
pnpm trsjs:install
FUGLOY_TRSJS=1 pnpm vitest run packages/emu/test/diff                     # about a minute: the harness tests and six Model III game sessions
FUGLOY_TRSJS=1 FUGLOY_TRSJS_SWEEP=1 pnpm vitest run packages/emu/test/diff --silent=false # also every other .CMD in examples/ and fixtures/real/, logging each one's class counts and the sum
pnpm diff examples/sea-dragon/seadrg01.cmd --instructions 10000000        # one program, with a report
pnpm xtrs:install && pnpm mame:install                                    # the Model I's references
FUGLOY_XTRS=1 pnpm vitest run packages/emu/test/diff                      # about 40 minutes: thirteen Model I sessions in lockstep with xtrs
FUGLOY_MAME=1 pnpm vitest run packages/emu/test/diff                      # about 12 minutes: the same thirteen, following MAME
FUGLOY_XTRS=1 pnpm vitest run packages/emu/test/diff/model1-fixtures.test.js -t elimin8c # one session
FUGLOY_XTRS=1 FUGLOY_XTRS_SWEEP=1 pnpm vitest run packages/emu/test/diff/model1-sweep-xtrs.test.js --silent=false # every other .CMD against xtrs, logging each one's counts and the sum: 3 to 8 minutes a program, one at a time (-t splits it across processes)
FUGLOY_MAME=1 FUGLOY_MAME_SWEEP=1 pnpm vitest run packages/emu/test/diff/model1-sweep-mame.test.js --silent=false # the same, following MAME: about 40 minutes, five at a time
pnpm diff examples/eliminator/elimin8c.cmd --model 1                      # one program against xtrs, with a report
pnpm diff examples/sea-dragon/seadrg01.cmd --model 1 --reference mame     # one program against MAME: it records its own trace, about half a minute
```

`pnpm diff <program> [--model 3|1] [--reference trsjs|xtrs] [--lowercase] [--keys <script.json>] [--instructions N] [--from-cycle C] [--rom <file>] [--strict | --strict-all]`
boots the model's ROM from `fugloy.mcp.json` (the Model III against trsjs by
default; `--model 1` against xtrs), loads the `.CMD` or `.BAS`, and prints the
reference and model, the count of each known difference and the first
divergence, if any, with ten instructions disassembled on each side.
`pnpm diff --model 1 --reference mame --trace <file>` compares our Model I,
from power-on, against a MAME trace recorded with
`pnpm mame:trace record <instructions>` (the ROM's boot and typed keys), our
40 Hz on MAME's schedule as the report says; a trace that loaded a program
(the tests record those) is compared with that program named first.
`pnpm diff <program> --model 1 --reference mame [--keys <script.json>] [--instructions N]`
records MAME's run of a `.CMD` itself, as the Model I sessions do: ENTER at
MEM SIZE?, the program loaded at 4 s, the keys of `--keys` (T-states after the
load, as for xtrs) pressed on MAME's matrix, and `--instructions` (default
1,000,000) past the load; MAME records about 70,000 instructions a second, so
the default takes about half a minute. It follows the recording on MAME's
schedule, prints the report and the screen MAME showed at the end, and deletes
the trace, whatever the result. Exit status 0 means no divergence, 1
a divergence, 2 a usage or setup error (an unexpected error, such as the ROM
not reaching READY or the reference throwing, counts as one), 3 a MAME trace
that ends before the instructions asked for.

Where a reference departs from the Z80 or the machine, the harness says so
explicitly: it corrects the reference (trsjs: a write to ROM or the keyboard,
a byte stored wider than 8 bits, PC running past `$FFFF`, a repeating CPDR's
T-states, a DD or FD prefix it skips; MAME: its CPU reads video bit 6 as
written, so where its byte is ours but for the gate our read takes MAME's), or
counts a known class in `test/diff/known.js`, each with the evidence that the
reference is the inaccurate side and each declared by the reference that
needs it (`Reference.classes`), so one reference's evidence never excuses
another's difference: flag bits 3 and 5 (trsjs's own rules, a class only trsjs
declares); BIT's S and P/V; R on an interrupt and on DDCB/FDCB; the HALT
return address; carry after CPI/CPD/CPIR/CPDR; three interrupt timings (all
trsjs); EX (SP),rr writing (SP) before (SP+1) (xtrs, trsjs); a repeating
LDIR/LDDR/CPIR/CPDR's flags 3 and 5 from PC (xtrs, trsjs); SCF and CCF's
flags 3 and 5, which trsjs leaves as they were (xtrs's are below); `BIT n,(HL)`
and `BIT n,(IX+d)`'s flags 3 and 5, which xtrs clears where the Z80 shows
MEMPTR; IN and block I/O one T-state short (xtrs); the return address of the
NMI that answers a Model I HALT, which xtrs pushes one too far. MAME declares none of these,
only its video read. Everything else is a divergence, so against MAME any flag
difference is one. On the six Model III sessions (Sea Dragon,
Eliminator c and e, Rear Guard 5 and 4, Armored Patrol, 10 million
instructions each) there is none, and none on the thirteen Model I sessions
(Eliminator a and c, Sea Dragon and Rear Guard 5 from `examples/`, nine more
from `fixtures/real/` where present, 10 million instructions each past the
load) against either reference; against MAME the only difference counted is
its video read. A sweep of every other `.CMD` in `examples/` and
`fixtures/real/` (50 here, under one generic script) passes against both but
for the programs that take the 40 Hz interrupt in IM 0 without ever reading
the `$37E0` latch, which neither reference can follow (xtrs has no IM 0
response; MAME's recorder decodes only IM 1, and its request is gone after one
response where the latch keeps it): they stand open (spec §11, phase 7), and
each sweep tests them for that limitation, so it passes while they stay as
they are. The harness found six bugs on our side, all now fixed: a
halted CPU did not count R, port `FF` did not read port `EC`'s bits back
(both against trsjs), EX (SP),rr wrote its low byte first, a repeating block
instruction took flags 3 and 5 from its byte rather than PC, and SCF and CCF
ignored F's flags 3 and 5 after an instruction that left them alone (all three
against MAME), and the Model I stayed halted after a HALT, which its wiring
answers with the reset switch's NMI (the sweep, against both). The harness cannot see a bug both machines share: where the two
agree, both may be wrong, so behaviour such as EI's one-instruction delay is
pinned by our own unit tests (against Zilog UM0080 and Young §5.5) as well as
compared. Two are judgment calls rather than reference errors: port `FF` bit
6, which the Model III Technical Reference Manual calls undefined (we read it
as 1, as trsjs and trs80gp do), and SCF and CCF against xtrs, where Zilog's
NMOS Z80 and NEC's differ (we follow Zilog's, as MAME does; xtrs follows
NEC's, a class of its own). Typing at 20 characters a second drops every other
key under the Model I's Level II 1.3, the ROM's doing: its keyboard driver
debounces each key for 18.8 ms and waits 51.3 ms after taking one, so type at
10 (the default). xtrs drops the same keys; MAME, whose keys change only at a
frame, drops every key at `type`'s 25 ms holds and the same ones at 35 ms.
Details in spec §5, §10 and §11 (phase 7).

## Testing the Z80 core

ZEXDOC and ZEXALL, Frank Cringle's Z80 instruction exercisers, are GPL-2.0, so
they are never committed. `pnpm zex:install` downloads them into the
gitignored `tools/zex/`, pinned to one commit of
[agn453/ZEXALL](https://github.com/agn453/ZEXALL) and checked by SHA-256. Then:

```sh
FUGLOY_ZEX=1 pnpm vitest run packages/emu/test/exerciser               # about 5 minutes, one test per group
FUGLOY_ZEX=1 pnpm vitest run packages/emu/test/exerciser -t "daa,cpl"  # one group
```

They run on `test/cpm.js`, a CP/M stand-in: the program at `0100H`, BDOS
functions 2 and 9 at `0005H`, and a jump to `0000H` to end.
`test/unit/cpu-timing.test.js` checks every opcode's T-states against
`@fugloy/z80`.
