# Sea Dragon

*Sea Dragon* (1982) is a submarine game for the TRS-80 Model I and Model III
by Wayne Westmoreland and Terry Gilman, sold by Adventure International. In
1995 Westmoreland released it, with the rest of the TRS-80 games he wrote with
Gilman, into the public domain: "I hereby release them into the public domain,
do with them as you please"
([trs-80.org](http://www.trs-80.org/games-by-wayne-westmoreland-and-terry-gilman.html)).

That is why it ships with this repository, beside three more games from the
same release (Rear Guard, Eliminator, and Armored Patrol, in `examples/`), so
anyone can try Fugløy on real games. For everything else, bring your own (see
"Getting ROMs and programs" in the [main README](../../README.md)). The title screen still
reads "(C) Copyright 1982", as the original did.

## The files

Ten `.CMD` builds of the game, named as they were found in the TRS-80
software archives:

| File | How it loads |
| --- | --- |
| `seadrg01.cmd` | The game at `$5200`, then a stub at `$8881` that copies it down to `$497F` and jumps there |
| `seadrg02.cmd`–`seadrg04.cmd` | The same game at `$8000`, with the stub at `$B681` |
| `seadrg06.cmd`–`seadrg11.cmd` | Builds that load the game where it runs |
| `seadrg01.hints` | The two hint lines Fugløy proposes for `seadrg01.cmd`, under the skeleton `--write-hints` writes, then names and block comments for the game's main routines and data: an annotated listing |
| `seadrg01.trace.json` | The port trace (`docs/port-trace-format.md`) of `seadrg01.cmd`: what three scripted games on `@fugloy/emu` (Novice, Expert, two players, from the title to GAME OVER, on Fugløy's game stub ROM) saw it rewrite in its own code, run that the disassembly does not reach, drop from the stack, and read from the ROM. `pnpm census examples/sea-dragon/seadrg01.cmd --hints examples/sea-dragon/seadrg01.hints --model 3 --sessions sea-dragon -o examples/sea-dragon/seadrg01.trace.json` rewrites it, and a test fails when the committed copy is stale |
| `seadrg01.labels.json` | The label and coverage file `@fugloy/emu` wrote while running `seadrg01.cmd` from `$497F` through the title screen and ENTER: which bytes ran, which were only read, and which subroutines were called and how often (`packages/emu/scripts/sea-dragon-labels.mjs` rewrites it, given the Model III ROM) |

A build numbered 05 also exists. It was rebuilt with Zeta Microcomputer
Software's OFFSET utility, and its loader carries Zeta's own copyright, which
the 1995 release does not cover, so it is not included here.

## Try it

```sh
pnpm build
pnpm fugloy examples/sea-dragon/seadrg01.cmd            # pass 1 finds only the 15-byte stub, and proposes the move
pnpm fugloy examples/sea-dragon/seadrg01.cmd --hints examples/sea-dragon/seadrg01.hints
                                                         # the game at $497F, 45% of its bytes decoded as code, annotated
pnpm fugloy examples/sea-dragon/seadrg01.cmd --hints examples/sea-dragon/seadrg01.hints --labels examples/sea-dragon/seadrg01.labels.json
                                                         # the same, with what the emulator saw run as roots and comments
pnpm fugloy examples/sea-dragon/seadrg06.cmd --color    # a build that loads in place, in color on a terminal
pnpm fugloy port examples/sea-dragon/seadrg01.cmd --model 3 --hints examples/sea-dragon/seadrg01.hints --trace examples/sea-dragon/seadrg01.trace.json -o out
                                                         # the game ported to JavaScript: out/seadrg01.port.js and its report
```

The test suite runs on these files too, so its real-program tests cover a
real game on every machine and in CI.

## The port (Part 2, milestone M2)

`fugloy port` turns `seadrg01.cmd`, with its hint file and trace, into one
JavaScript module on `@fugloy/runtime` (430,623 bytes): 28 routines, none of
them a labelled `switch`, one statement per instruction, the game's data and
none of its code bytes. The trace's eight rewritten sites (nine bytes) are read
from memory as the game runs: four index displacements (`$49C1`, `$4F41`,
`$5AD0`, `$5ADD`), the target of the `JP` at `$509A` (to `$509D` or `$50C1`),
and three swapped opcodes, each a choice between the instructions the census
saw (`$5174` `NOP` or `LD (HL),A`, `$525E` `JP NZ` or `JP Z`, `$5AEA` `RET` or
`CALL`). The title loop's dropped return address (`$4BAC POP AF`) leaves the
routine the game left, its three jumps back to `$497F` discard the stack as the
game does, its six calls of the ROM's `$DELAY` run the runtime's stand-in, and
the two ROM bytes it reads as data (`$0000`, `$0003`) are in the module, so the
port needs no ROM.

`packages/recomp/test/sea-dragon.test.ts` referees the port against
`@fugloy/emu` through the three recorded games, Novice, Expert and two
players, from the title to GAME OVER and back to the title, on Fugløy's game
stub ROM in CI: every block's registers, flags, T-states, R and MEMPTR, every
byte written, video RAM and the sound at every frame, with no difference
(273,482,246 T-states in all, about 2 minutes 15 seconds of play, refereed in
about 12 seconds). Locally the same games pass on the Model III ROM too. What
that does not cover: `seadrg01.cmd` on the Model III only (not the other builds
or the Model I); no interrupts (the game enables none); the paths the three
games take, not every path through the game, so a path they never take may
write into code or drop a return address the trace does not name, and the port
then stops with a sentence, or read a ROM byte the trace does not name, which
the port reads as `$00` without stopping.

To play the port in a browser:

```sh
pnpm play examples/sea-dragon/seadrg01.cmd --model 3 --hints examples/sea-dragon/seadrg01.hints --trace examples/sea-dragon/seadrg01.trace.json
```

It writes `.play/seadrg01/` and prints a localhost address. The port runs in a
Web Worker at the original's speed. The arrow keys move the sub and Space
fires; at the title Enter starts a game (then 1 or 2 players, and 0 or 1 for
each player's skill), and in play it fires the other shot. The sound starts
with the first key or click. `packages/recomp/test/player.test.ts` checks the
first ten seconds against `@fugloy/emu`, screen and sound, frame by frame.
