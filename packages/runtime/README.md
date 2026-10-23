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
recompiler that writes ports, `@fugloy/recomp`, comes in the plan's next tasks.

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
| `read(addr)` `write(addr, v)` | one byte through the memory map; the address is taken to 16 bits |
| `read16(addr)` `write16(addr, v)` | a word, low byte first, each byte through the map |
| `in(port)` `out(port, v)` | the ports below |
| `sound` | every write to port `$FF`, as `{ t, v }`: `t` is `cycles` at the call. The host drains it |
| `columns32` | true in the 32-column mode |
| `cycles`, `tick(t, r)` | T-states since the start; `tick` adds `t` and adds `r` to R's low seven bits, keeping bit 7 |
| `at(addr)` | called at each block's start; does nothing unless the referee replaces it |
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
| `$4000`–`$FFFF` | RAM (48K) | the same |

`'flat'` has none of this: all 64K is RAM. A Model I gate applies on the write because emu's does, so `mem`
holds what emu's video RAM holds.

## The ports

| Port | Model III | Model I |
|---|---|---|
| `$FF` | read `$40 \| mode & $3E`; write: the byte to `sound` | read `$7F`, or `$3F` in the 32-column mode; write: the byte to `sound`, and D0–D3 to the mode register |
| `$EC`–`$EF` | read `$FF`; write: the mode register, bit 2 the 32-column mode | not modelled |
| any other | throws a sentence naming it | throws a sentence naming it |

`'flat'` has no ports: they float high and a write is lost.

## What it does not model

Interrupts (a port takes none), the cassette, the disk controller, the printer, the Model I's Expansion
Interface (its interrupt latch, drive select, printer and disk controller at `$37E0`–`$37EF`), the Model I's
RAM sizes other than 48K, the Model 4, and any drawing or sound output: a program's writes to video RAM and
to port `$FF` are all there is, and showing or playing them is a host's work. What the port cannot follow
fails loud with a sentence naming it.

## How it is checked

It mirrors `@fugloy/emu`, which is the oracle, and cites emu's lines where it does. The tests build emu
beside a `Z` and compare the two: every address after the same writes, the video gate for every byte value,
the keyboard reads, the ports and the 32-column bit for every value, the R counter, the sound stamps, and the
key table for every name emu's `m.keyboard.press` accepts. `pnpm --filter @fugloy/runtime check:no-dom` links
and loads the package in an empty `node:vm` context (emu's check), and a test scans the source for a browser or
Node global.

`@fugloy/runtime/ops` is where the helpers a port's statements call (the flag and arithmetic routines) will
live; it exports nothing yet.

MIT, as the rest of Fugløy.
