# @fugloy/runtime

The machine a generated JavaScript port of a TRS-80 program runs on: the Z80's registers, the 64K with the
Model I's or the Model III's memory map, the keyboard matrix, the ports, and the T-state and R counters.
Plain JavaScript ESM with JSDoc types, **no dependencies**, no DOM, no Node APIs, so it runs in a page and
in a Web Worker.

It is part of Fugløy's Part 2, the port and the remake (design:
[`docs/superpowers/specs/2026-10-23-part2-port-and-remake-design.md`](https://github.com/cschweda/fugloy/blob/main/docs/superpowers/specs/2026-10-23-part2-port-and-remake-design.md);
milestone M1's plan:
[`docs/superpowers/plans/2026-10-23-part2-m1-port-pipeline.md`](https://github.com/cschweda/fugloy/blob/main/docs/superpowers/plans/2026-10-23-part2-m1-port-pipeline.md)).
A port is a module with one function per routine of the original program; each statement of those functions
reads and writes a `Z`, the machine state this package builds. A port holds no Z80 interpreter and none of
the program's code bytes. Version 0.1.0, built in the repository and **not published** in M1; the
recompiler that writes ports is [`@fugloy/recomp`](../recomp/README.md).

## Using it

```js
import { createZ } from '@fugloy/runtime';

const z = createZ({ model: 3 });     // 1 (the Model I), 3 (the Model III), or 'flat' (64K of plain RAM)

z.hl = 0x3c00;                       // a register pair: z.h = 0x3c, z.l = 0x00
z.write(z.hl, 0x41);                 // through the memory map: video RAM
z.tick(7, 1);                        // a block's T-states, and its R increments
z.press('SPACE');                    // a key down: z.read(0x3840) is now 0x80
z.out(0xff, 1);                      // z.sound is [{ t: 7, v: 1 }]
```

## The state

| Field | |
|---|---|
| `a f b c d e h l i r ixh ixl iyh iyl` | 8-bit registers (0–255) |
| `sp wz af_ bc_ de_ hl_` | 16-bit (0–65535): the stack pointer, MEMPTR, the alternate set |
| `af bc de hl ix iy` | 16-bit accessors over the pairs above; a setter takes the low 16 bits |
| `iff1 iff2`, `im`, `q` | interrupt flip-flops (booleans), mode (0–2), and Q (1 when the last instruction of the block that just ended wrote the flags, for SCF and CCF) |
| `mem` | the 64K, a `Uint8Array(65536)`; the host fills ROM and data directly, which skips the map below |
| `guard` | the write guard `load` installs (M2): a `Uint8Array(65536)`, 1 at each byte of the port's code that is not one of its `CELLS`, where `write` throws; `null`, as a `Z` starts, guards nothing |
| `read(addr)` `write(addr, v)` | one byte through the memory map; the address is taken to 16 bits |
| `read16(addr)` `write16(addr, v)` | a word, low byte first, each byte through the map |
| `in(port)` `out(port, v)` | the ports below |
| `sound` | every write to port `$FF`, as `{ t, v }`: `t` is `cycles` at the call. The host drains it |
| `columns32` | true in the 32-column mode |
| `cycles`, `tick(t, r)` | T-states since the start; `tick` adds `t` and adds `r` to R's low seven bits, keeping bit 7 |
| `at(addr)`, `block` | called at each block's start; it records `addr` in `block`, where a refusal finds the block it happened in. The referee replaces it (a replacement that wants refusals to name the block sets `block` too) |
| `keys`, `press(name)` `release(name)` | the matrix (one byte a row, a set bit a key down) and the keys held; the names are `KEY_TABLE`'s |
| `model`, `clockHz` | 1, 3 or `'flat'`; 1,774,080 Hz (Model I), 2,027,520 Hz (Model III) |

A `Z` starts as `@fugloy/emu`'s machine does at reset: registers clear but SP at `$FFFF`, interrupts off, `q` 1,
the screen blank (spaces, on the Model I and III), and the rest of the 64K zero. An 8-bit field holds 0–255 and a 16-bit one
0–65535: the generated code keeps them so.

## The memory map

| Addresses | Model III | Model I |
|---|---|---|
| `$0000`–`$2FFF` | ROM: reads return `mem`, writes are lost | the same |
| `$3000`–`$37FF` | ROM (as above) | nothing: reads `$FF`, writes lost; `$37E0`–`$37EF`, the Expansion Interface, **throws** a sentence on a read or a write |
| `$3800`–`$3BFF` | the keyboard: a read is the OR of the rows the low byte selects; writes lost | the same |
| `$3C00`–`$3FFF` | video RAM: `mem` | video RAM with no bit 6: a write stores `(v & $BF) \| (v & $A0 ? 0 : $40)`, as it will read |
| `$4000`–`$FFFF` | RAM (48K); with a port loaded, a write to a byte of its code that is not one of its cells **throws** (`guard`) | the same |

`'flat'` has none of this: all 64K is RAM. A Model I gate applies on the write because emu's does, so `mem`
holds what emu's video RAM holds.

## The ports

| Port | Model III | Model I |
|---|---|---|
| `$FF` | read `$40 \| mode & $3E`; write: the byte to `sound` | read `$7F`, or `$3F` in the 32-column mode; write: the byte to `sound`, and D0–D3 to the mode register |
| `$EC`–`$EF` | read `$FF`; write: the mode register, bit 2 the 32-column mode | not modelled |
| `$00` | read `$FF`, as emu reads a port no device answers (Sea Dragon's joystick read); a write is not modelled | not modelled |
| any other | throws a sentence naming it | throws a sentence naming it |

`'flat'` has no ports: they float high and a write is lost.

## What it does not model

Interrupts (a port takes none), the ROM (but for the stand-ins above), the cassette, the disk controller, the printer, the Model I's Expansion
Interface (its interrupt latch, drive select, printer and disk controller at `$37E0`–`$37EF`), the Model I's
RAM sizes other than 48K, the Model 4, and any drawing or sound output: a program's writes to video RAM and
to port `$FF` are all there is, and showing or playing them is a host's work. What the port cannot follow
fails loud with a sentence naming it.

## How it is checked

It mirrors `@fugloy/emu`, which is the oracle, and cites emu's lines where it does. The tests build emu
beside a `Z` and compare the two: every address after the same writes, the video gate for every byte value,
the keyboard reads, the ports and the 32-column bit for every value, the R counter, the sound stamps, and the
key table for every name emu's `m.keyboard.press` accepts, and port `$00`'s read. `test/guard.test.js` holds `load`'s write guard to its rule: a cell takes a write, any other code byte
throws its sentence (a word write and a push at the byte they write first), data and the rest of memory take
writes, and a `Z` with no port loaded has no guard. `test/rom.test.js` holds
`$DELAY`'s stand-in to its measured time and registers for BC = 1, 2, 3, 256, 8192 and 0 (from four R
values, bit 7 kept), and `o.standin` to the CALL's push and the RET's pop; `@fugloy/recomp`'s
`test/standin.test.ts` runs the same calls beside emu on the game stub ROM and, locally, the user's ROM.
`pnpm --filter @fugloy/runtime check:no-dom` links and loads the package in an empty `node:vm` context (emu's check), and a test scans the source for a browser or
Node global.

## Running a port

```js
import { createZ, load, runPort } from '@fugloy/runtime';
import * as port from './invaders.port.js';   // what @fugloy/recomp's port() wrote

const z = createZ({ model: port.MODEL });
load(z, port);                                // DATA and CELLS, through z.write; the write guard over CODE
runPort(z, port);                             // { reason: 'returned' }
```

`fugloy port game.cmd --model 3` (`packages/cli`) writes such a module, `game.port.js`, which imports
`@fugloy/runtime/ops`; a bundler, or a page with an import map, resolves it. Every Learn lesson and Build
Space Invaders chapter, ported for the Model III and the Model I, runs on this runtime block for block as
`@fugloy/emu` runs the original through its `check.json` (`@fugloy/recomp`'s `test/learn.test.ts`).

`load(z, port)` writes the port's `DATA` through `z.write`, as emu's `.CMD` loader writes a program through
its memory, so the Model I's video RAM takes its bit 6 here too, and its `CELLS` (M2: the code bytes the
program rewrites, each with its byte as loaded, which the instructions they are operands of read when they
run). Then it installs the write guard over the port's `CODE` (its code's `[first, last]` ranges, none of
whose bytes the port carries): a write to a code byte that is not one of the cells throws
`self-modifying code: $XXXX written (the trace does not name it; run the census over a session that reaches
this)` at the write, where the program would otherwise go on running code the port no longer matches. The
guard is one byte an address, checked on a write to RAM; a module with no `CODE`, and a `Z` no port was loaded
into, have none. `runPort(z, port)` runs `ENTRY`, in the top-level trampoline (`o.top`), until it
returns to the address on top of the stack as it starts: the one Fugløy's stub ROM pushes (its `RETURNED`)
before it hands over to a program, so the runtime needs none of the stub's bytes. Both refuse a port for the
other model.

A program that drops a return address (M2: a `POP` its trace lists) leaves routines the port is running: the
port throws `o.unwind(n, CONTINUATION, at)`, which is not an `Error`. Each trampoline it reaches with levels
left rethrows it with one fewer (its routine is one the program left); the next, at none, goes on with
`CONTINUATION` in place of the routine it was running, with its own return address. `o.reset(ENTRY)` (a jump
back to an entry that reloads SP) passes every trampoline but the top-level one, which runs `ENTRY` again.
Neither gets a place added, and neither is caught as an error.

Anything a port cannot follow throws a sentence naming the address: a RET to an address other than the one
after its CALL (`… (a port follows a RET only back to its CALL) (if a POP dropped a return address here, the
census needs a session that reaches it)`), an unwind that reaches the top-level trampoline with levels left
(`the POP at $XXXX drops a return address that no CALL of the port's pushed …`), a transfer to an address no block starts, a rewritten JP holding a target its trace did not
see, a HALT, a device the runtime does not model, a write into the port's code that its trace does not name. The
trampoline (`o.call`) adds the routine and the block it happened in, once:
`the port does not model $FE (an I/O port; …) (in READ, in the block at $7006)`.

## The helpers

`@fugloy/runtime/ops` holds the helpers a port's statements call, imported as `o`
(`z.a = o.add8(z, z.a, z.b);`): the Z80's flag and arithmetic routines, each doing what emu's core does
(`packages/emu/src/cpu/z80cpu.js`, cited by line), F's bits 5 and 3 included.

| Helpers | |
|---|---|
| `add8 adc8 sub8 sbc8 and8 xor8 or8 (z, a, v)`, `cp8 (z, a, v)` | 8-bit arithmetic: the result, and F; CP takes bits 5 and 3 from the operand |
| `inc8 dec8 neg (z, v)` | INC and DEC of a byte (C kept), NEG |
| `daa cpl rlca rrca rla rra (z)` | the accumulator's own instructions, on `z.a` |
| `scf ccf (z, keep)` | `keep` is 0x28 when the instruction before left the flags alone, else 0 (Q) |
| `add16 adc16 sbc16 (z, a, v)` | 16-bit arithmetic; MEMPTR becomes `a + 1` |
| `rlc rrc rl rr sla sra sll srl (z, v)` | the CB rotates and shifts |
| `bit (z, n, v, xy)` | BIT n: bits 5 and 3 from `xy` (the register, or MEMPTR's high byte for a memory operand) |
| `ldair (z, v)`, `inr (z, v)` | the flags of LD A,I / LD A,R and of IN r,(C); return `v` |
| `rld rrd (z)` | the nibble rotates through `(HL)` |
| `ldi ldd cpi cpd ini ind outi outd (z)` | one iteration of a block instruction (a translated LDIR loops `ldi`) |
| `push (z, v)`, `pop (z)`, `exsp (z, v)`, `exx (z)` | the stack (PUSH writes the high byte first; EX (SP),rr writes `(SP+1)` before `(SP)`) and EXX |
| `call (z, routine, ret)` | CALL: runs `routine`, whose RET must return to `ret`, then each routine it returns (jumps into) in turn, until one returns nothing: a trampoline, so routines that jump into each other never grow the JavaScript stack. An unwind it catches with levels left goes on up with one fewer; at none it runs the unwind's routine next |
| `top (z, routine, ret)` | the top-level trampoline `runPort` runs `ENTRY` in: `call`'s, but a reset ends here and runs its routine, and an unwind with levels left throws a sentence |
| `unwind (levels, to, at)`, `reset (to)` | what a port throws to leave routines (M2): `levels` return addresses dropped by the `POP`(s) ending at `at`, going on with `to`; or a jump back to an entry that reloads SP, leaving every routine but the top-level trampoline's. Not `Error`s |
| `ret (z, expected, at)` | RET: throws a sentence when the popped address (in `z.wz`) is not `expected`; it says the census may need a session that reaches a `POP` that dropped one |
| `standin (z, addr, ret)` | a CALL to a ROM routine the runtime stands in for (below): pushes `ret` as the CALL does, runs the stand-in, pops `ret` into MEMPTR as the RET does, and leaves Q 0; the two stack bytes stay written, as on emu. A sentence for an address with no stand-in on the model |
| `unknown (z, target, from[, known, cell])`, `halt (z, at)` | the sentences (as `Error`s, which the port throws) for a transfer to an address no block starts and for a HALT. With `known` and `cell` (M2), a JP whose target the program rewrites: the targets the trace saw and the address of the byte rewritten, named with the value it holds instead |
| `variant (z, cell, known, instruction)` | the sentence (an `Error`, which the port throws) for an instruction whose opcode the program rewrites (M2) holding a value the port has no translation for: the cell, the instruction as loaded (its assembly), the value the cell holds (`z.mem[cell]`) and the values the port knows |

`@fugloy/recomp`'s translator writes the calls, and its test runs every instruction both as translated
statements here and on emu's core, and requires the two equal.

## The ROM's stand-ins

A port has no ROM. For the few ROM routines a game calls, the runtime has Fugløy's own stand-in
(`src/rom.js`, M2): `standins(model)` maps each routine's address to `{ name, run(z) }`, where `run` does
to the machine what the routine does from its first instruction to its RET (its T-states and R, the RET's
included, and the registers and flags it changes; the stack is `o.standin`'s). A port calls it as
`o.standin(z, 0x0060, 0x4EAF);` where the program CALLs the address; `@fugloy/recomp`'s `port()` is given the
names (`opts.standins`) and lists the calls in its report.

| Model | Address | Name | What it does |
|---|---|---|---|
| III | `$0060` | `DELAY` | pause for BC counts, BC 0 counting 65,536: 30 T-states a count and 15 more after the CALL, 5 R increments a count and 2 more; A 0, F `$44`, BC 0, nothing else changed (measured on emu with the Model III ROM) |
| I | — | — | none in M2 |

`STANDINS_Z` is the same routines as Z80 source for `@fugloy/asm`, Fugløy's own code at the ROM's addresses
(`ORG 0060H` / `JP 01FBH`, and the loop at `01FBH`), so a CALL takes the ROM's time on it, and with no END:
`@fugloy/recomp`'s referee appends it to Fugløy's stub ROM to run a game on emu in CI, where a call to the
routine runs that code beside the port's stand-in. No byte of Tandy's ROM is in the runtime.

MIT, as the rest of Fugløy.
